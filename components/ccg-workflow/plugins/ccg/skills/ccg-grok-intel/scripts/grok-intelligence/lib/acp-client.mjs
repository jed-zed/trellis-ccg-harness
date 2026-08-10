import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { buildExactGrokEnvironment } from './exact-env.mjs'
import { assertExistingPathWithoutLinks } from './path-safety.mjs'
import { resolveGrokExecutable } from './process.mjs'
import { signalProcessTree } from './process-tree.mjs'
import { canonicalizeSourceUrl } from './source-registry.mjs'

const MAX_RAW_BYTES = 8 * 1024 * 1024
const MAX_RAW_EVENTS = 20000
const MAX_JSON_RPC_LINE_BYTES = 1024 * 1024
const MAX_PROMPT_BYTES = 256 * 1024
const MAX_TIMEOUT_MS = 10 * 60 * 1000
const MAX_CREDENTIAL_SNAPSHOT_BYTES = 8 * 1024 * 1024
const CREDENTIAL_LEASE_NAME = '.ccg-intelligence-lease'
const CREDENTIAL_RECLAIM_NAME = 'reclaim.json'

export const GROK_INTELLIGENCE_SYSTEM_PROMPT = [
  'You are an external-intelligence collector for a software engineering workflow.',
  'Use the provider capabilities that help complete the current ACP prompt.',
  'Return source-backed findings in the requested output envelope.',
].join(' ')

export function buildGrokAcpArgs({ maxTurns = 6, model = 'grok-4.5' } = {}) {
  if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 6)
    throw new Error('maxTurns must be an integer between 1 and 6')
  if (typeof model !== 'string' || !model.trim() || /[\u0000-\u001f\u007f]/.test(model))
    throw new Error('model must be a non-empty single-line Grok model id')

  const args = [
    '--always-approve',
    '--no-auto-update',
    '--verbatim',
    '--system-prompt-override',
    GROK_INTELLIGENCE_SYSTEM_PROMPT,
    '--max-turns',
    String(maxTurns),
  ]
  args.push('agent', '--model', model.trim(), 'stdio')
  return args
}

export function selectAcpPermissionOption(options) {
  if (!Array.isArray(options))
    throw new Error('ACP permission request is missing options')
  const selected = options.find(option => option?.kind === 'allow_always')
    || options.find(option => option?.kind === 'allow_once')
  if (typeof selected?.optionId !== 'string' || !selected.optionId)
    throw new Error('ACP permission request did not offer an allow option')
  return selected.optionId
}

function normalizeAuthMethodIds(authMethods) {
  if (!Array.isArray(authMethods))
    return []
  return authMethods
    .map(method => typeof method === 'string' ? method : method?.id)
    .filter(method => typeof method === 'string')
}

export function selectAcpAuthMethod(authMethods, { authMode, hasApiKey }) {
  const available = new Set(normalizeAuthMethodIds(authMethods))
  if (authMode === 'browser_oauth') {
    if (!available.has('cached_token'))
      throw new Error('cached_token authentication is unavailable; run the official browser login first')
    return 'cached_token'
  }
  if (authMode === 'api_key') {
    if (!hasApiKey)
      throw new Error('API key authentication requires an explicitly configured API key')
    if (!available.has('xai.api_key'))
      throw new Error('xai.api_key authentication is unavailable')
    return 'xai.api_key'
  }
  throw new Error(`Unsupported intelligence auth mode: ${String(authMode)}`)
}

async function assertDirectoryWithoutLinks(path, { platform = process.platform } = {}) {
  void platform
  const { metadata, canonical } = await assertExistingPathWithoutLinks(path, { name: 'Directory path', expectedType: 'directory' })
  return { metadata, canonical }
}

function inspectWindowsAclDefault(path) {
  const shell = process.env.SystemRoot
    ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
    : 'powershell.exe'
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$targetPath = [Console]::In.ReadToEnd()',
    '$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()',
    '$acl = Get-Acl -LiteralPath $targetPath',
    '$sidType = [System.Security.Principal.SecurityIdentifier]',
    '$ownerSid = ([System.Security.Principal.NTAccount]$acl.Owner).Translate($sidType).Value',
    '$currentOwnerSid = if ($identity.Owner) { $identity.Owner.Value } else { $identity.User.Value }',
    '$access = @($acl.Access | ForEach-Object { [pscustomobject]@{ identity = $_.IdentityReference.Value; identitySid = $_.IdentityReference.Translate($sidType).Value; inherited = $_.IsInherited; type = $_.AccessControlType.ToString() } })',
    '[pscustomobject]@{ current = $identity.Name; currentSid = $identity.User.Value; currentOwnerSid = $currentOwnerSid; owner = $acl.Owner; ownerSid = $ownerSid; access = $access } | ConvertTo-Json -Depth 5 -Compress',
  ].join('; ')
  const result = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    input: path,
    windowsHide: true,
    env: Object.fromEntries(Object.entries({
      SystemRoot: process.env.SystemRoot,
      WINDIR: process.env.WINDIR,
      ComSpec: process.env.ComSpec,
      PATH: process.env.PATH,
      PATHEXT: process.env.PATHEXT,
    }).filter(([, value]) => typeof value === 'string' && value.length > 0)),
  })
  if (result.status !== 0)
    throw new Error(`Unable to inspect Windows directory ACL: ${String(result.stderr).trim()}`)
  return JSON.parse(String(result.stdout).replace(/^\uFEFF/, '').trim())
}

export async function validatePrivateDirectory(path, {
  platform = process.platform,
  inspectWindowsAcl = inspectWindowsAclDefault,
} = {}) {
  const { metadata, canonical } = await assertDirectoryWithoutLinks(path, { platform })
  if (platform !== 'win32') {
    if ((metadata.mode & 0o077) !== 0)
      throw new Error(`Private directory must be owner-only (mode 0700): ${path}`)
    return canonical
  }

  const acl = await inspectWindowsAcl(canonical)
  const currentIdentities = new Set([acl?.current, acl?.currentSid].filter(Boolean).map(value => String(value).toLowerCase()))
  const currentOwners = new Set([...currentIdentities, acl?.currentOwnerSid].filter(Boolean).map(value => String(value).toLowerCase()))
  const owner = String(acl?.ownerSid || acl?.owner || '').toLowerCase()
  const access = Array.isArray(acl?.access) ? acl.access : acl?.access ? [acl.access] : []
  const ownerMatches = currentOwners.has(owner)
  const accessIsPrivate = access.length > 0 && access.every((entry) => {
    const identity = String(entry?.identitySid || entry?.identity || '').toLowerCase()
    return currentIdentities.has(identity) && String(entry?.type) === 'Allow'
  })
  if (!ownerMatches || !accessIsPrivate)
    throw new Error(`Private directory must have an owner-only Windows ACL: ${path}`)
  return canonical
}

export async function validateWorkingDirectory(path, allowedRoots, { platform = process.platform } = {}) {
  const { canonical } = await assertDirectoryWithoutLinks(path, { platform })
  if (!Array.isArray(allowedRoots) || allowedRoots.length === 0)
    throw new Error('allowedCwdRoots must contain at least one trusted absolute root')

  let withinRoot = false
  for (const root of allowedRoots) {
    const rootResult = await assertDirectoryWithoutLinks(root, { platform })
    const rel = relative(rootResult.canonical, canonical)
    if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
      withinRoot = true
      break
    }
  }
  if (!withinRoot)
    throw new Error('Working directory is outside the validated neutral/snapshot roots')
  return canonical
}

export async function createExclusiveCapture(rawEventsDir, {
  randomName = () => `${randomUUID()}.jsonl`,
  validateDirectory = validatePrivateDirectory,
} = {}) {
  const directory = await validateDirectory(rawEventsDir)
  const name = randomName()
  if (typeof name !== 'string' || !/^[a-fA-F0-9-]+\.jsonl$/.test(name))
    throw new Error('Capture name factory returned an invalid random filename')
  const path = resolve(directory, name)
  if (relative(directory, path).startsWith('..'))
    throw new Error('Capture path escaped its private directory')
  let handle
  try {
    handle = await open(path, 'wx', 0o600)
    await chmod(path, 0o600)
    return { path, handle }
  }
  catch (error) {
    if (handle) {
      await handle.close().catch(() => {})
      await rm(path, { force: true }).catch(() => {})
    }
    throw new Error(`Unable to create exclusive capture file: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const VOLATILE_DIRECTORIES = Object.freeze(['sessions', 'logs', 'memtrace'])
const VOLATILE_FILES = Object.freeze(['active_sessions.json', 'active_sessions.lock', 'session_search.sqlite'])

async function snapshotTree(root, relativePath, snapshot, budget) {
  const absolutePath = resolve(root, relativePath)
  const metadata = await lstat(absolutePath)
  if (metadata.isSymbolicLink())
    throw new Error(`Credential-home cleanup refuses link or reparse entry: ${relativePath}`)
  if (metadata.isDirectory()) {
    snapshot.directories.push(relativePath)
    const entries = await readdir(absolutePath)
    for (const entry of entries)
      await snapshotTree(root, `${relativePath}/${entry}`, snapshot, budget)
    return
  }
  if (!metadata.isFile())
    throw new Error(`Credential-home cleanup found unsupported entry: ${relativePath}`)
  budget.bytes += metadata.size
  if (budget.bytes > MAX_CREDENTIAL_SNAPSHOT_BYTES)
    throw new Error('Credential-home volatile state exceeds the safe cleanup snapshot cap')
  snapshot.files.push({ relativePath, data: await readFile(absolutePath), mode: metadata.mode & 0o777 })
}

async function snapshotCredentialHome(grokHome) {
  const snapshot = { directories: [], files: [] }
  const budget = { bytes: 0 }
  for (const name of [...VOLATILE_DIRECTORIES, ...VOLATILE_FILES]) {
    try {
      await snapshotTree(grokHome, name, snapshot, budget)
    }
    catch (error) {
      if (error?.code !== 'ENOENT')
        throw error
    }
  }
  return snapshot
}

export async function withCredentialHomeVolatileSnapshot(grokHome, action, {
  validateDirectory = validatePrivateDirectory,
} = {}) {
  if (typeof action !== 'function')
    throw new Error('Credential-home snapshot action must be a function')
  const root = await validateDirectory(grokHome)
  const snapshot = await snapshotCredentialHome(root)
  try {
    return await action(root)
  }
  finally {
    await restoreCredentialHome(root, snapshot)
  }
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  }
  catch (error) {
    return error?.code === 'EPERM'
  }
}

async function readLeaseOwner(ownerPath) {
  const metadata = await lstat(ownerPath)
  if (!metadata.isFile() || metadata.isSymbolicLink())
    throw new Error('Credential lease owner is not a regular file')
  const value = JSON.parse(await readFile(ownerPath, 'utf8'))
  if (typeof value?.owner !== 'string' || !Number.isInteger(value?.pid) || value.pid < 1)
    throw new Error('Credential lease owner metadata is invalid')
  return value
}

async function reclaimAbandonedCredentialLease(leasePath, ownerPath, isAlive) {
  let observed
  try {
    observed = await readLeaseOwner(ownerPath)
  }
  catch {
    return false
  }
  if (isAlive(observed.pid)) return false

  const reclaimPath = resolve(leasePath, CREDENTIAL_RECLAIM_NAME)
  const claimant = `${process.pid}-${randomUUID()}`
  try {
    await writeFile(reclaimPath, `${JSON.stringify({ claimant, pid: process.pid })}\n`, { flag: 'wx', mode: 0o600 })
  }
  catch (error) {
    if (error?.code === 'EEXIST') return false
    throw error
  }

  try {
    const current = await readLeaseOwner(ownerPath)
    if (current.owner !== observed.owner || isAlive(current.pid)) return false
    await rm(leasePath, { recursive: true, force: true })
    return true
  }
  finally {
    await rm(reclaimPath, { force: true }).catch(() => {})
  }
}

async function acquireCredentialHomeLease(grokHome, {
  validateDirectory = validatePrivateDirectory,
  processIsAlive: isAlive = processIsAlive,
  retryMs = 25,
  timeoutMs = 30000,
} = {}) {
  if (!Number.isInteger(retryMs) || retryMs < 1 || retryMs > 1000)
    throw new Error('Credential lease retryMs is out of range')
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000)
    throw new Error('Credential lease timeoutMs is out of range')
  const root = await validateDirectory(grokHome)
  const leasePath = resolve(root, CREDENTIAL_LEASE_NAME)
  const ownerPath = resolve(leasePath, 'owner.json')
  const owner = `${process.pid}-${randomUUID()}`
  const deadline = Date.now() + timeoutMs
  while (true) {
    try {
      await mkdir(leasePath, { mode: 0o700 })
      try {
        await writeFile(ownerPath, `${JSON.stringify({ owner, pid: process.pid, created_at: new Date().toISOString() })}\n`, { flag: 'wx', mode: 0o600 })
      }
      catch (error) {
        await rm(leasePath, { recursive: true, force: true }).catch(() => {})
        throw error
      }
      let released = false
      return async () => {
        if (released) return
        released = true
        let current
        try { current = await readLeaseOwner(ownerPath) }
        catch (error) { throw new Error(`Credential lease owner cannot be verified: ${error instanceof Error ? error.message : String(error)}`) }
        if (current?.owner !== owner)
          throw new Error('Credential lease ownership changed before release')
        await rm(ownerPath, { force: true })
        await rm(leasePath, { recursive: true, force: true })
      }
    }
    catch (error) {
      if (error?.code !== 'EEXIST') throw error
      let metadata
      try {
        metadata = await lstat(leasePath)
      }
      catch (metadataError) {
        // Another holder can release the directory after mkdir reports EEXIST.
        // Its absence is therefore a normal acquisition race, not a lease fault.
        if (metadataError?.code === 'ENOENT') continue
        throw metadataError
      }
      if (!metadata.isDirectory() || metadata.isSymbolicLink())
        throw new Error('Credential lease path is not a regular directory')
      if (await reclaimAbandonedCredentialLease(leasePath, ownerPath, isAlive))
        continue
      if (Date.now() >= deadline)
        throw new Error('Timed out waiting for the shared Grok credential-home lease')
      await new Promise(resolvePromise => setTimeout(resolvePromise, retryMs))
    }
  }
}

export async function withCredentialHomeLease(grokHome, action, options = {}) {
  if (typeof action !== 'function')
    throw new Error('Credential lease action must be a function')
  const release = await acquireCredentialHomeLease(grokHome, options)
  try {
    return await action()
  }
  finally {
    await release()
  }
}

async function assertNoLinksRecursively(path) {
  let metadata
  try {
    metadata = await lstat(path)
  }
  catch (error) {
    if (error?.code === 'ENOENT')
      return
    throw error
  }
  if (metadata.isSymbolicLink())
    throw new Error(`Cleanup refuses a link or reparse point: ${path}`)
  if (!metadata.isDirectory())
    return
  for (const entry of await readdir(path))
    await assertNoLinksRecursively(resolve(path, entry))
}

function resolveCredentialChild(grokHome, name) {
  const target = resolve(grokHome, name)
  const rel = relative(grokHome, target)
  if (!rel || rel.startsWith('..') || isAbsolute(rel))
    throw new Error(`Credential-home cleanup target escaped its root: ${name}`)
  return target
}

export async function clearCredentialHomeVolatileState(grokHome, {
  validateDirectory = validatePrivateDirectory,
} = {}) {
  const root = await validateDirectory(grokHome)
  for (const name of VOLATILE_DIRECTORIES) {
    const target = resolveCredentialChild(root, name)
    await assertNoLinksRecursively(target)
    await rm(target, { recursive: true, force: true })
  }
  for (const name of VOLATILE_FILES) {
    const target = resolveCredentialChild(root, name)
    await assertNoLinksRecursively(target)
    await rm(target, { force: true })
  }
}

async function restoreCredentialHome(grokHome, snapshot) {
  for (const name of VOLATILE_DIRECTORIES) {
    const target = resolveCredentialChild(grokHome, name)
    await assertNoLinksRecursively(target)
    await rm(target, { recursive: true, force: true })
  }
  for (const name of VOLATILE_FILES)
    await rm(resolveCredentialChild(grokHome, name), { force: true })

  const sortedDirectories = [...snapshot.directories].sort((a, b) => a.length - b.length)
  for (const relativePath of sortedDirectories)
    await mkdir(resolve(grokHome, relativePath), { recursive: true, mode: 0o700 })
  for (const file of snapshot.files) {
    const target = resolve(grokHome, file.relativePath)
    await mkdir(resolve(target, '..'), { recursive: true, mode: 0o700 })
    await writeFile(target, file.data, { mode: file.mode })
    file.data.fill(0)
  }

  for (const name of [...VOLATILE_DIRECTORIES, ...VOLATILE_FILES]) {
    const target = resolveCredentialChild(grokHome, name)
    const expected = snapshot.directories.includes(name) || snapshot.files.some(file => file.relativePath === name)
    try {
      await stat(target)
      if (!expected && VOLATILE_FILES.includes(name))
        throw new Error(`Credential-home cleanup left an unexpected artifact: ${name}`)
    }
    catch (error) {
      if (error?.code !== 'ENOENT')
        throw error
      if (expected)
        throw new Error(`Credential-home cleanup failed to restore: ${name}`)
    }
  }
}

function createDeferred() {
  let resolvePromise
  let rejectPromise
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return { promise, resolve: resolvePromise, reject: rejectPromise }
}

function redactText(value, secrets) {
  let redacted = String(value)
  for (const secret of secrets) {
    if (secret)
      redacted = redacted.split(secret).join('[REDACTED]')
  }
  redacted = redacted.replace(/https?:\/\/[^\s"'<>\\]+/gi, (candidate) => {
    try { return canonicalizeSourceUrl(candidate) }
    catch { return '[REDACTED_URL]' }
  })
  return redacted
    .replace(/((?:api[_-]?key|token|authorization)\s*[:=]\s*)\S+/gi, '$1[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
    .replace(/\bxai-[A-Za-z0-9_-]+/g, '[REDACTED]')
}

function redactValue(value, secrets, seen = new WeakSet()) {
  if (typeof value === 'string')
    return redactText(value, secrets)
  if (value == null || typeof value !== 'object')
    return value
  if (seen.has(value))
    return '[REDACTED_CYCLE]'
  seen.add(value)
  if (Array.isArray(value))
    return value.map(item => redactValue(item, secrets, seen))
  const output = {}
  for (const [key, child] of Object.entries(value)) {
    output[key] = /token|secret|api[_-]?key|authorization|headers?/i.test(key)
      ? '[REDACTED]'
      : redactValue(child, secrets, seen)
  }
  return output
}

function validateRunOptions(options) {
  if (!options || typeof options !== 'object')
    throw new Error('ACP run options are required')
  if (options.handshakeOnly !== true && (typeof options.prompt !== 'string' || options.prompt.trim().length === 0))
    throw new Error('prompt must be a non-empty string')
  if (options.handshakeOnly !== true && Buffer.byteLength(options.prompt, 'utf8') > MAX_PROMPT_BYTES)
    throw new Error('prompt exceeds the bounded ACP prompt size')
  if (!Number.isInteger(options.rawEventsMaxBytes) || options.rawEventsMaxBytes < 1 || options.rawEventsMaxBytes > MAX_RAW_BYTES)
    throw new Error(`rawEventsMaxBytes must be between 1 and ${MAX_RAW_BYTES}`)
  if (!Number.isInteger(options.rawEventsMaxEvents) || options.rawEventsMaxEvents < 1 || options.rawEventsMaxEvents > MAX_RAW_EVENTS)
    throw new Error(`rawEventsMaxEvents must be between 1 and ${MAX_RAW_EVENTS}`)
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > MAX_TIMEOUT_MS)
    throw new Error(`timeoutMs must be between 1 and ${MAX_TIMEOUT_MS}`)
  if (!['browser_oauth', 'api_key'].includes(options.authMode))
    throw new Error('authMode must be browser_oauth or api_key')
  if (options.authMode === 'api_key' && (typeof options.apiKey !== 'string' || options.apiKey.trim().length === 0))
    throw new Error('API key authentication requires an explicitly configured API key')
  buildGrokAcpArgs({ maxTurns: options.maxTurns ?? 6, model: options.model ?? 'grok-4.5' })
}

function supportsSessionClose(initializeResult) {
  return initializeResult?.agentCapabilities?.sessionCapabilities?.close === true
    || initializeResult?.capabilities?.sessionClose === true
}

async function terminateChild(child, graceMs = 250, treeEnabled = false) {
  if (!child || child.exitCode != null || child.signalCode != null)
    return
  await new Promise((resolvePromise, rejectPromise) => {
    let completed = false
    let terminateTimer
    let forceTimer
    const finish = () => {
      if (completed)
        return
      completed = true
      clearTimeout(terminateTimer)
      clearTimeout(forceTimer)
      resolvePromise()
    }
    child.once('close', finish)
    try {
      signalProcessTree(child, 'SIGTERM', { treeEnabled })
    }
    catch {
      finish()
      return
    }
    terminateTimer = setTimeout(() => {
      try {
        signalProcessTree(child, 'SIGKILL', { treeEnabled })
      }
      catch {}
    }, graceMs)
    forceTimer = setTimeout(() => {
      if (completed)
        return
      completed = true
      rejectPromise(new Error('ACP child did not terminate after forced shutdown'))
    }, treeEnabled && process.platform === 'win32' ? Math.max(5000, graceMs * 2) : graceMs * 2)
  })
}

export function createGrokAcpClient({
  command = 'grok',
  prefixArgs = [],
  spawnProcess = spawn,
  validatePrivateDirectory: validatePrivate = validatePrivateDirectory,
  randomName,
  onSpawn,
} = {}) {
  return {
    async run(options) {
      validateRunOptions(options)
      const cwd = await validateWorkingDirectory(options.cwd, options.allowedCwdRoots)
      await validatePrivate(options.neutralHome)
      const grokHome = await validatePrivate(options.grokHome)
      const releaseCredentialLease = options.credentialLeaseHeld === true
        ? async () => {}
        : await acquireCredentialHomeLease(grokHome, { validateDirectory: validatePrivate })
      try {
      const childEnvironment = buildExactGrokEnvironment({
        sourceEnv: options.sourceEnv || {},
        neutralHome: options.neutralHome,
        grokHome,
        apiKey: options.authMode === 'api_key' ? options.apiKey : undefined,
      })
      const acpArgs = buildGrokAcpArgs({ maxTurns: options.maxTurns ?? 6, model: options.model ?? 'grok-4.5' })
      const credentialSnapshot = await snapshotCredentialHome(grokHome)
      const capture = await createExclusiveCapture(options.rawEventsDir, {
        randomName,
        validateDirectory: validatePrivate,
      })
      const args = [...prefixArgs, ...acpArgs]
      let child
      try {
        child = spawnProcess(resolveGrokExecutable(command, { env: childEnvironment }), args, {
          cwd,
          env: childEnvironment,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
          detached: spawnProcess === spawn && process.platform !== 'win32',
        })
      }
      catch (error) {
        await capture.handle.close().catch(() => {})
        await rm(capture.path, { force: true })
        await restoreCredentialHome(grokHome, credentialSnapshot)
        throw error
      }
      onSpawn?.(child)

      const pending = new Map()
      const notifications = []
      const stderrChunks = []
      const secrets = [
        options.apiKey,
        childEnvironment.HTTPS_PROXY,
        childEnvironment.HTTP_PROXY,
      ]
      const fatal = createDeferred()
      fatal.promise.catch(() => {})
      let nextId = 1
      let rawBytes = 0
      let rawEvents = 0
      let stdoutBuffer = ''
      let stdoutQueue = Promise.resolve()
      let fatalError
      let sessionId
      let expectedShutdown = false
      let terminatePromise
      let turnCompletedSeen = false

      const fail = (error) => {
        if (fatalError)
          return
        fatalError = error instanceof Error ? error : new Error(String(error))
        for (const waiter of pending.values()) {
          clearTimeout(waiter.timer)
          waiter.reject(fatalError)
        }
        pending.clear()
        fatal.reject(fatalError)
      }

      const writeMessage = (message) => {
        if (!child.stdin?.writable)
          throw new Error('ACP child stdin is not writable')
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
      }

      const handleMessage = (message) => {
        if (!message || typeof message !== 'object' || Array.isArray(message))
          throw new Error('Malformed JSON-RPC message')
        if (message.jsonrpc != null && message.jsonrpc !== '2.0')
          throw new Error('Malformed JSON-RPC version')

        if (message.method && message.id != null) {
          if (message.method !== 'session/request_permission')
            throw new Error(`Unsupported ACP server request: ${message.method}`)
          writeMessage({
            id: message.id,
            result: { outcome: { outcome: 'selected', optionId: selectAcpPermissionOption(message.params?.options) } },
          })
          notifications.push(message)
          return
        }

        if (message.id != null) {
          const hasResult = Object.prototype.hasOwnProperty.call(message, 'result')
          const hasError = Object.prototype.hasOwnProperty.call(message, 'error')
          if (hasResult === hasError)
            throw new Error('Malformed JSON-RPC response must contain exactly one of result or error')
          const waiter = pending.get(message.id)
          if (!waiter)
            throw new Error(`Unknown response correlation id: ${String(message.id)}`)
          pending.delete(message.id)
          clearTimeout(waiter.timer)
          if (message.error)
            waiter.reject(new Error(`ACP ${waiter.method} failed: ${message.error.message || JSON.stringify(message.error)}`))
          else
            waiter.resolve(message.result ?? {})
          return
        }

        if (typeof message.method !== 'string')
          throw new Error('Malformed JSON-RPC notification')
        notifications.push(message)
        if (
          ['session/update', '_x.ai/session/update'].includes(message.method)
          && message.params?.update?.sessionUpdate === 'turn_completed'
        ) {
          turnCompletedSeen = true
        }
      }

      const captureLine = async (line) => {
        const lineBytes = Buffer.byteLength(line, 'utf8')
        if (lineBytes > MAX_JSON_RPC_LINE_BYTES)
          throw new Error('ACP JSON-RPC line exceeded the line-size cap')
        const storedBytes = lineBytes + 1
        if (rawBytes + storedBytes > options.rawEventsMaxBytes)
          throw new Error('ACP raw event byte cap exceeded')
        if (rawEvents + 1 > options.rawEventsMaxEvents)
          throw new Error('ACP raw event cap exceeded')
        rawBytes += storedBytes
        rawEvents += 1
        await capture.handle.write(`${line}\n`)
        let message
        try {
          message = JSON.parse(line)
        }
        catch {
          throw new Error('Malformed JSON-RPC line from ACP child')
        }
        handleMessage(message)
      }

      const consumeStdout = (chunk) => {
        stdoutBuffer += chunk
        const lines = stdoutBuffer.split(/\r?\n/)
        stdoutBuffer = lines.pop() || ''
        if (Buffer.byteLength(stdoutBuffer, 'utf8') > MAX_JSON_RPC_LINE_BYTES) {
          fail(new Error('ACP JSON-RPC line exceeded the line-size cap'))
          return
        }
        for (const line of lines) {
          if (!line)
            continue
          stdoutQueue = stdoutQueue.then(() => captureLine(line)).catch(fail)
        }
      }

      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', consumeStdout)
      child.stdin?.on('error', (error) => {
        if (!expectedShutdown)
          fail(new Error(`Grok ACP stdin failed: ${error.message}`))
      })
      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', (chunk) => {
        if (stderrChunks.join('').length < 65536)
          stderrChunks.push(redactText(chunk, secrets))
      })
      child.on('error', error => fail(new Error(`Unable to start Grok ACP child: ${error.message}`)))
      child.on('close', (code, signal) => {
        if (stdoutBuffer.trim() && !fatalError)
          fail(new Error('ACP child closed with a truncated JSON-RPC stream'))
        else if (!expectedShutdown && !fatalError)
          fail(new Error(`ACP child exited unexpectedly (code=${String(code)}, signal=${String(signal)})`))
      })

      const request = (method, params, requestTimeoutMs = Math.min(options.timeoutMs, 30000)) => {
        const id = nextId++
        return new Promise((resolvePromise, rejectPromise) => {
          const timer = setTimeout(() => {
            pending.delete(id)
            rejectPromise(new Error(`ACP ${method} timed out`))
          }, requestTimeoutMs)
          pending.set(id, { method, resolve: resolvePromise, reject: rejectPromise, timer })
          try {
            writeMessage({ id, method, params })
          }
          catch (error) {
            clearTimeout(timer)
            pending.delete(id)
            rejectPromise(error)
          }
        })
      }

      const drainOptionalTurnCompleted = async () => {
        const deadline = Date.now() + Math.min(options.timeoutMs, 250)
        while (!turnCompletedSeen) {
          if (fatalError)
            throw fatalError
          if (Date.now() >= deadline)
            return false
          await new Promise(resolvePromise => setTimeout(resolvePromise, 5))
        }
        return true
      }

      const cancelSession = () => {
        if (!sessionId || !child.stdin?.writable)
          return
        try {
          writeMessage({ method: 'session/cancel', params: { sessionId } })
        }
        catch {}
      }

      const stopChild = () => {
        terminatePromise ||= terminateChild(child, 250, spawnProcess === spawn)
        return terminatePromise
      }

      let overallTimer
      let abortHandler
      let result
      try {
        overallTimer = setTimeout(() => {
          cancelSession()
          fail(new Error(`Grok ACP run timed out after ${options.timeoutMs}ms`))
          stopChild().catch(fail)
        }, options.timeoutMs)
        if (options.signal) {
          if (options.signal.aborted)
            throw new Error('Grok ACP run cancelled')
          abortHandler = () => {
            cancelSession()
            fail(new Error('Grok ACP run cancelled'))
            stopChild().catch(fail)
          }
          options.signal.addEventListener('abort', abortHandler, { once: true })
        }

        const initializeResult = await Promise.race([
          request('initialize', {
            protocolVersion: 1,
            clientCapabilities: {
              fs: { readTextFile: false, writeTextFile: false },
              terminal: false,
            },
          }),
          fatal.promise,
        ])
        const authMethod = selectAcpAuthMethod(initializeResult.authMethods, {
          authMode: options.authMode,
          hasApiKey: typeof options.apiKey === 'string' && options.apiKey.length > 0,
        })
        await Promise.race([
          request('authenticate', { methodId: authMethod, _meta: { headless: true } }),
          fatal.promise,
        ])
        const sessionResult = await Promise.race([
          request('session/new', { cwd, mcpServers: [] }),
          fatal.promise,
        ])
        if (typeof sessionResult.sessionId !== 'string' || sessionResult.sessionId.length === 0)
          throw new Error('ACP session/new did not return a sessionId')
        sessionId = sessionResult.sessionId
        const promptResult = options.handshakeOnly === true
          ? null
          : await Promise.race([
              request('session/prompt', {
                sessionId,
                prompt: [{ type: 'text', text: options.prompt }],
              }, options.timeoutMs),
              fatal.promise,
            ])
        await stdoutQueue
        if (fatalError)
          throw fatalError
        if (options.handshakeOnly !== true)
          await Promise.race([drainOptionalTurnCompleted(), fatal.promise])

        if (supportsSessionClose(initializeResult)) {
          expectedShutdown = true
          await Promise.race([
            request('session/close', { sessionId }, Math.min(1000, options.timeoutMs)),
            fatal.promise,
          ])
        }
        else {
          expectedShutdown = true
          cancelSession()
        }

        result = {
          initializeResult: redactValue(initializeResult, secrets),
          authMethod,
          sessionResult: redactValue(sessionResult, secrets),
          promptResult: redactValue(promptResult, secrets),
          completion: {
            promptResponse: promptResult !== null,
            turnCompleted: turnCompletedSeen,
          },
          notifications: redactValue(notifications, secrets),
          stderr: stderrChunks.join('').split(/\r?\n/).filter(Boolean),
          capture: { path: capture.path, bytes: rawBytes, events: rawEvents },
        }
      }
      finally {
        expectedShutdown = true
        clearTimeout(overallTimer)
        if (options.signal && abortHandler)
          options.signal.removeEventListener('abort', abortHandler)
        for (const waiter of pending.values()) {
          clearTimeout(waiter.timer)
          waiter.reject(new Error('ACP transport closed'))
        }
        pending.clear()
        cancelSession()
        await stopChild()
        await stdoutQueue.catch(() => {})
        await capture.handle.close().catch(() => {})
        await rm(capture.path, { force: true })
        await restoreCredentialHome(grokHome, credentialSnapshot)
      }
      return result
      }
      finally {
        await releaseCredentialLease()
      }
    },
  }
}

export const runGrokAcp = createGrokAcpClient().run
