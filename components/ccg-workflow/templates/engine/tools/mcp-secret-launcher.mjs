#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, isAbsolute, relative, resolve } from 'node:path'

const MAX_SPEC_BYTES = 1024 * 1024

function fail(message) {
  process.stderr.write(`CCG MCP secret launcher: ${message}\n`)
  process.exitCode = 1
}

function validateSpec(value) {
  if (!value || value.schemaVersion !== 1)
    throw new Error('unsupported or missing spec schema')
  if (typeof value.serverId !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(value.serverId))
    throw new Error('invalid server id')
  if (typeof value.command !== 'string' || value.command.length === 0)
    throw new Error('missing command')
  if (!Array.isArray(value.args) || value.args.some(arg => typeof arg !== 'string'))
    throw new Error('invalid command arguments')
  if (!value.env || typeof value.env !== 'object' || Array.isArray(value.env))
    throw new Error('invalid environment')
  if (Object.entries(value.env).some(([key, entry]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof entry !== 'string'))
    throw new Error('invalid environment entry')
  return value
}

async function validateSpecPath(specPath) {
  if (!isAbsolute(specPath))
    throw new Error('secret spec path must be absolute')
  const metadata = await lstat(specPath)
  if (!metadata.isFile() || metadata.isSymbolicLink())
    throw new Error('secret spec must be a regular file')
  if (metadata.size > MAX_SPEC_BYTES)
    throw new Error('secret spec exceeds the size limit')
  if (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0)
    throw new Error('secret spec permissions must be 0600')

  const trustedRoot = await realpath(resolve(homedir(), '.claude', '.ccg', 'secrets'))
  const canonicalSpec = await realpath(specPath)
  const delta = relative(trustedRoot, canonicalSpec)
  if (delta === '..' || delta.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(delta))
    throw new Error('secret spec path is outside the trusted CCG secret directory')
  return canonicalSpec
}

const specPath = process.argv[2]
if (!specPath || process.argv.length !== 3) {
  fail('expected exactly one secret spec path')
}
else {
  try {
    const canonicalSpec = await validateSpecPath(specPath)
    const spec = validateSpec(JSON.parse(await readFile(canonicalSpec, 'utf8')))
    if (basename(canonicalSpec) !== `${spec.serverId}.json`)
      throw new Error('secret spec filename does not match its server id')
    const child = spawn(spec.command, spec.args, {
      env: { ...process.env, ...spec.env },
      shell: false,
      stdio: 'inherit',
      windowsHide: true,
    })

    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.on(signal, () => {
        if (!child.killed)
          child.kill(signal)
      })
    }

    child.once('error', (error) => fail(`failed to start MCP process: ${error.message}`))
    child.once('exit', (code, signal) => {
      if (signal)
        process.kill(process.pid, signal)
      else
        process.exitCode = code ?? 1
    })
  }
  catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  }
}
