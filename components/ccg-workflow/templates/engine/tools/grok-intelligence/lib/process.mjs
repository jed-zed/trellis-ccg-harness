import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { win32 } from 'node:path'
import { signalProcessTree } from './process-tree.mjs'

const MAX_DIAGNOSTIC_BYTES = 1024 * 1024
const DEFAULT_TIMEOUT_MS = 30000

export function resolveGrokExecutable(command, {
  platform = process.platform,
  env = process.env,
  userHome = homedir(),
  pathExists = existsSync,
} = {}) {
  if (platform !== 'win32' || command !== 'grok')
    return command
  for (const root of [env.GROK_HOME, userHome && win32.resolve(userHome, '.grok')]) {
    if (!root) continue
    const candidate = win32.resolve(root, 'bin', 'grok.exe')
    if (pathExists(candidate)) return candidate
  }
  return command
}

export class UnsafeCliContextError extends Error {
  constructor(message) {
    super(`unsafe_cli_context: ${message}`)
    this.name = 'UnsafeCliContextError'
    this.code = 'unsafe_cli_context'
  }
}

function terminate(child, treeEnabled = false) {
  if (!child || child.exitCode != null || child.signalCode != null)
    return
  try {
    signalProcessTree(child, 'SIGTERM', { treeEnabled })
  }
  catch {}
  setTimeout(() => {
    if (child.exitCode == null && child.signalCode == null) {
      try {
        signalProcessTree(child, 'SIGKILL', { treeEnabled })
      }
      catch {}
    }
  }, 250).unref?.()
}

export function runBoundedProcess(command, args, {
  cwd,
  env,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBytes = MAX_DIAGNOSTIC_BYTES,
  spawnProcess = spawn,
} = {}) {
  if (typeof command !== 'string' || !command || !Array.isArray(args))
    throw new Error('Bounded process command and argument array are required')
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawnProcess(resolveGrokExecutable(command, { env }), args, {
      cwd,
      env,
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: spawnProcess === spawn && process.platform !== 'win32',
    })
    const treeEnabled = spawnProcess === spawn
    const stdout = []
    const stderr = []
    let bytes = 0
    let settled = false
    let pendingFailure
    let forcedFinishTimer
    let timer
    const finish = (callback) => {
      if (settled)
        return
      settled = true
      clearTimeout(timer)
      clearTimeout(forcedFinishTimer)
      callback()
    }
    const failAfterShutdown = (error) => {
      if (settled || pendingFailure)
        return
      pendingFailure = error
      terminate(child, treeEnabled)
      forcedFinishTimer = setTimeout(() => finish(() => rejectPromise(error)), 1000)
    }
    const collect = target => chunk => {
      if (pendingFailure)
        return
      bytes += chunk.length
      if (bytes > maxBytes) {
        failAfterShutdown(new Error('Grok diagnostic output exceeded the bounded byte cap'))
        return
      }
      target.push(chunk)
    }
    child.stdout?.on('data', collect(stdout))
    child.stderr?.on('data', collect(stderr))
    child.once('error', error => finish(() => rejectPromise(new Error(`Unable to start Grok diagnostic: ${error.message}`))))
    child.once('close', (exitCode, signal) => finish(() => {
      if (pendingFailure) {
        rejectPromise(pendingFailure)
        return
      }
      resolvePromise({
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        exitCode,
        signal,
      })
    }))
    timer = setTimeout(() => {
      failAfterShutdown(new Error(`Grok diagnostic timed out after ${timeoutMs}ms`))
    }, timeoutMs)
  })
}

function assertDiagnosticSuccess(name, result) {
  if (!result || result.exitCode !== 0)
    throw new UnsafeCliContextError(`${name} failed locally (exit=${String(result?.exitCode)}): ${String(result?.stderr || '').trim()}`)
}

export function assertGrokDiagnostics(inspect) {
  if (!inspect || typeof inspect !== 'object' || Array.isArray(inspect))
    throw new UnsafeCliContextError('grok inspect --json did not return an object')
  return inspect
}

export function parseGrokModelInventory(value) {
  const models = []
  let defaultModel = null
  for (const rawLine of String(value || '').split(/\r?\n/)) {
    const line = rawLine.trim()
    const declaredDefault = /^Default model:\s*(grok-[A-Za-z0-9._-]+)\s*$/i.exec(line)
    if (declaredDefault)
      defaultModel = declaredDefault[1]
    const listed = /^(?:[*-]\s*)?(grok-[A-Za-z0-9._-]+)(?:\s+\(default\))?\s*$/i.exec(line)
    if (listed && !models.includes(listed[1]))
      models.push(listed[1])
    if (listed && /\(default\)\s*$/i.test(line))
      defaultModel = listed[1]
  }
  if (defaultModel && !models.includes(defaultModel))
    models.unshift(defaultModel)
  if (models.length === 0)
    throw new UnsafeCliContextError('grok models returned no valid model ids')
  return { models, defaultModel }
}

export async function runGrokDiagnostics({
  command = 'grok',
  prefixArgs = [],
  cwd,
  env,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  runProcess = runBoundedProcess,
} = {}) {
  const commands = [
    ['version', ['--no-auto-update', 'version']],
    ['models', ['--no-auto-update', 'models']],
    ['inspect', ['--no-auto-update', 'inspect', '--json']],
  ]
  const output = {}
  for (const [name, args] of commands) {
    const result = await runProcess(command, [...prefixArgs, ...args], { cwd, env, timeoutMs })
    assertDiagnosticSuccess(name, result)
    output[name] = result.stdout
  }
  let inspect
  try {
    inspect = JSON.parse(String(output.inspect).replace(/^\uFEFF/, '').trim())
  }
  catch {
    throw new UnsafeCliContextError('grok inspect --json returned malformed JSON')
  }
  assertGrokDiagnostics(inspect)
  const inventory = parseGrokModelInventory(output.models)
  return {
    version: String(output.version).trim(),
    models: inventory.models,
    defaultModel: inventory.defaultModel,
    inspect,
  }
}
