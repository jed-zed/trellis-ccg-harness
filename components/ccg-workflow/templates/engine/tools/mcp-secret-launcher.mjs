#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, isAbsolute, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const MAX_SPEC_BYTES = 1024 * 1024
const BASE_ENVIRONMENT_KEYS = [
  'PATH',
  'PATHEXT',
  'SystemRoot',
  'WINDIR',
  'ComSpec',
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'TMP',
  'TEMP',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
]
const WINDOWS_ACL_EVIDENCE_SCRIPT = [
  '$ErrorActionPreference = "Stop"',
  '$targetPath = [Console]::In.ReadToEnd()',
  '$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()',
  '$sidType = [System.Security.Principal.SecurityIdentifier]',
  '$acl = Get-Acl -LiteralPath $targetPath',
  '$ownerSid = ([System.Security.Principal.NTAccount]$acl.Owner).Translate($sidType).Value',
  '$currentOwnerSid = if ($identity.Owner) { $identity.Owner.Value } else { $identity.User.Value }',
  '$access = @($acl.Access | ForEach-Object { [pscustomobject]@{ '
  + 'identitySid = $_.IdentityReference.Translate($sidType).Value; '
  + 'inherited = $_.IsInherited; type = $_.AccessControlType.ToString() } })',
  '[pscustomobject]@{ currentSid = $identity.User.Value; '
  + 'currentOwnerSid = $currentOwnerSid; ownerSid = $ownerSid; '
  + 'access = $access } | ConvertTo-Json -Depth 5 -Compress',
].join('; ')
const SIGNAL_EXIT_CODES = {
  SIGINT: 130,
  SIGTERM: 143,
}

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
  if (Object.entries(value.env).some(
    ([key, entry]) =>
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ||
      typeof entry !== 'string',
  ))
    throw new Error('invalid environment entry')
  return value
}

function buildChildEnvironment(approved) {
  const environment = {}
  for (const key of BASE_ENVIRONMENT_KEYS) {
    const value = process.env[key]
    if (typeof value === 'string' && value.length > 0)
      environment[key] = value
  }
  return { ...environment, ...approved }
}

function restrictedWindowsEnvironment() {
  return Object.fromEntries(Object.entries({
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR,
    ComSpec: process.env.ComSpec,
    PATH: process.env.PATH,
    PATHEXT: process.env.PATHEXT,
  }).filter(([, value]) => typeof value === 'string' && value.length > 0))
}

function parseWindowsAclEvidence(stdout) {
  try {
    return JSON.parse(String(stdout).replace(/^\uFEFF/, '').trim())
  }
  catch {
    throw new Error('unable to parse the Windows secret ACL evidence')
  }
}

function hasOwnerOnlyWindowsAcl(evidence, { allowInherited }) {
  const currentSid = String(evidence.currentSid ?? '').toLowerCase()
  const ownerSid = String(evidence.ownerSid ?? '').toLowerCase()
  const allowedOwners = new Set([
    currentSid,
    String(evidence.currentOwnerSid ?? '').toLowerCase(),
  ].filter(Boolean))
  const access = Array.isArray(evidence.access)
    ? evidence.access
    : evidence.access
      ? [evidence.access]
      : []
  return Boolean(currentSid)
    && allowedOwners.has(ownerSid)
    && access.length > 0
    && access.every(entry => (
      String(entry.identitySid ?? '').toLowerCase() === currentSid
      && entry.type === 'Allow'
      && (allowInherited || entry.inherited === false)
    ))
}

function verifyWindowsAcl(target, { allowInherited }) {
  const shell = process.env.SystemRoot
    ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
    : 'powershell.exe'
  const result = spawnSync(shell, [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    WINDOWS_ACL_EVIDENCE_SCRIPT,
  ], {
    encoding: 'utf8',
    env: restrictedWindowsEnvironment(),
    input: target,
    shell: false,
    windowsHide: true,
  })
  if (result.status !== 0)
    throw new Error('unable to verify the Windows secret ACL')
  const evidence = parseWindowsAclEvidence(result.stdout)
  if (!hasOwnerOnlyWindowsAcl(evidence, { allowInherited }))
    throw new Error('Windows secret ACL is not owner-only')
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
  if (process.platform === 'win32') {
    verifyWindowsAcl(trustedRoot, { allowInherited: false })
    verifyWindowsAcl(canonicalSpec, { allowInherited: true })
  }
  return canonicalSpec
}

function defaultTaskkill(args) {
  return spawnSync('taskkill.exe', args, {
    shell: false,
    stdio: 'ignore',
    windowsHide: true,
  })
}

function signalWindowsProcessTree(child, pid, signal, runTaskkill) {
  const result = runTaskkill(['/PID', String(pid), '/T', '/F'])
  if (!result?.error && result?.status === 0)
    return
  child.kill(signal)
}

function signalUnixProcessTree(child, pid, signal, killGroup) {
  try {
    if (killGroup)
      killGroup(-pid, signal)
    else
      process.kill(-pid, signal)
  }
  catch {
    child.kill(signal)
  }
}

export function signalProcessTree(child, signal, {
  killGroup = null,
  platform = process.platform,
  runTaskkill = defaultTaskkill,
} = {}) {
  if (!child || child.exitCode != null || child.signalCode != null)
    return
  const pid = Number(child.pid)
  if (!Number.isInteger(pid) || pid <= 0) {
    child.kill(signal)
    return
  }
  if (platform === 'win32') {
    signalWindowsProcessTree(child, pid, signal, runTaskkill)
    return
  }
  signalUnixProcessTree(child, pid, signal, killGroup)
}

export async function runLauncher(argv = process.argv) {
  const specPath = argv[2]
  if (!specPath || argv.length !== 3) {
    fail('expected exactly one secret spec path')
    return
  }
  try {
    const canonicalSpec = await validateSpecPath(specPath)
    const spec = validateSpec(JSON.parse(await readFile(canonicalSpec, 'utf8')))
    if (basename(canonicalSpec) !== `${spec.serverId}.json`)
      throw new Error('secret spec filename does not match its server id')
    const child = spawn(spec.command, spec.args, {
      env: buildChildEnvironment(spec.env),
      shell: false,
      stdio: 'inherit',
      windowsHide: true,
      detached: process.platform !== 'win32',
    })

    let requestedSignal = null
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.on(signal, () => {
        if (requestedSignal)
          return
        requestedSignal = signal
        signalProcessTree(child, signal)
      })
    }

    child.once('error', (error) => fail(`failed to start MCP process: ${error.message}`))
    child.once('exit', (code, signal) => {
      if (requestedSignal)
        process.exitCode = SIGNAL_EXIT_CODES[requestedSignal] ?? 1
      else if (signal)
        process.exitCode = SIGNAL_EXIT_CODES[signal] ?? 1
      else
        process.exitCode = code ?? 1
    })
  }
  catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  }
}

const invokedPath = process.argv[1]
if (
  invokedPath &&
  pathToFileURL(resolve(invokedPath)).href === import.meta.url
) {
  await runLauncher()
}
