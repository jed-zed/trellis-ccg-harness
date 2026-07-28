import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { open, readFile, utimes } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import fs from 'fs-extra'
import { canonicalJson } from './canonical-json'

const HEX_64 = /^[a-f0-9]{64}$/
const SECRET_KEY = /api[-_]?key|authorization|bearer|credential|password|secret|token/i
const EVIDENCE_FILES = {
  input: 'input.json',
  'provider-request': 'provider-request.json',
  result: 'result.json',
  status: 'status.json',
} as const

export type InvocationEvidenceKind = keyof typeof EVIDENCE_FILES

function assertInside(root: string, target: string, label: string): void {
  const candidate = relative(root, target)
  if (!candidate || candidate === '.' || candidate.startsWith('..') || isAbsolute(candidate))
    throw new Error(`${label} must stay inside the Trellis task directory`)
}

export function resolveProductManagerEvidenceRoot(taskDir: string): string {
  const normalized = resolve(taskDir)
  const portable = normalized.replaceAll('\\', '/').toLowerCase()
  if (portable.includes('/.ccg/tasks/') || !portable.includes('/.trellis/tasks/'))
    throw new Error('product-manager evidence requires the canonical Trellis task; parallel .ccg/tasks authority is forbidden')
  if (!existsSync(resolve(normalized, 'task.json')))
    throw new Error('product-manager evidence requires a Trellis task.json')
  const root = resolve(normalized, '.ccg-evidence', 'product-manager')
  assertInside(normalized, root, 'product-manager evidence')
  return root
}

export function redactProductManagerValue(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map(redactProductManagerValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SECRET_KEY.test(key) ? '[REDACTED]' : redactProductManagerValue(item),
    ]))
  }
  if (typeof value === 'string') {
    return value
      .replace(/\b(?:sk|xai|ghp|github_pat)_[A-Za-z0-9_-]{12,}\b/g, '[REDACTED]')
      .replace(/\bBearer\s+[A-Z0-9._~+/-]+=*\b/gi, 'Bearer [REDACTED]')
  }
  return value
}

async function atomicWrite(file: string, value: unknown): Promise<void> {
  await fs.ensureDir(dirname(file))
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`
  try {
    await fs.writeFile(temporary, `${canonicalJson(value)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
    await fs.rename(temporary, file)
  }
  finally {
    await fs.remove(temporary)
  }
}

export async function writeInvocationEvidence(options: {
  taskDir: string
  invocationKey: string
  kind: InvocationEvidenceKind
  value: unknown
}): Promise<string> {
  if (!HEX_64.test(options.invocationKey))
    throw new TypeError('invocationKey must be a SHA-256 digest')
  const root = resolveProductManagerEvidenceRoot(options.taskDir)
  const file = resolve(root, 'calls', options.invocationKey, EVIDENCE_FILES[options.kind])
  assertInside(root, file, 'product-manager evidence file')
  await atomicWrite(file, redactProductManagerValue(options.value))
  return file
}

export async function readInvocationEvidence(options: {
  taskDir: string
  invocationKey: string
  kind: InvocationEvidenceKind
}): Promise<unknown | null> {
  if (!HEX_64.test(options.invocationKey))
    throw new TypeError('invocationKey must be a SHA-256 digest')
  const root = resolveProductManagerEvidenceRoot(options.taskDir)
  const file = resolve(root, 'calls', options.invocationKey, EVIDENCE_FILES[options.kind])
  assertInside(root, file, 'product-manager evidence file')
  if (!await fs.pathExists(file))
    return null
  return JSON.parse(await readFile(file, 'utf8'))
}

export async function writeInvocationRawResponse(options: {
  taskDir: string
  invocationKey: string
  value: unknown
}): Promise<string> {
  if (!HEX_64.test(options.invocationKey))
    throw new TypeError('invocationKey must be a SHA-256 digest')
  const root = resolveProductManagerEvidenceRoot(options.taskDir)
  const file = resolve(root, 'calls', options.invocationKey, 'response.raw')
  assertInside(root, file, 'product-manager raw response')
  await atomicWrite(file, redactProductManagerValue(options.value))
  return file
}

export async function appendInvocationAudit(options: {
  taskDir: string
  invocationKey: string
  entry: Record<string, unknown>
}): Promise<string> {
  if (!HEX_64.test(options.invocationKey))
    throw new TypeError('invocationKey must be a SHA-256 digest')
  const root = resolveProductManagerEvidenceRoot(options.taskDir)
  const file = resolve(root, 'calls', options.invocationKey, 'audit.ndjson')
  assertInside(root, file, 'product-manager audit journal')
  await fs.ensureDir(dirname(file))
  const entry = redactProductManagerValue({
    ...options.entry,
    recorded_at: new Date().toISOString(),
  })
  await fs.appendFile(file, `${canonicalJson(entry)}\n`, {
    encoding: 'utf8',
    flag: 'a',
    mode: 0o600,
  })
  return file
}

function isLiveProcess(pid: unknown): boolean {
  if (!Number.isSafeInteger(pid) || (pid as number) <= 0)
    return false
  try {
    process.kill(pid as number, 0)
    return true
  }
  catch (error: any) {
    return error?.code === 'EPERM'
  }
}

export async function withInvocationLock<T>(options: {
  taskDir: string
  invocationKey: string
  staleAfterMs?: number
  waitTimeoutMs?: number
  action: () => Promise<T>
}): Promise<T> {
  const root = resolveProductManagerEvidenceRoot(options.taskDir)
  const lockRoot = resolve(root, 'locks')
  const lock = resolve(lockRoot, `${options.invocationKey}.lock`)
  assertInside(root, lock, 'product-manager lock')
  await fs.ensureDir(lockRoot)
  const staleAfterMs = options.staleAfterMs ?? 5 * 60_000
  const waitTimeoutMs = options.waitTimeoutMs ?? staleAfterMs * 2
  const waitStartedAt = Date.now()
  while (Date.now() - waitStartedAt <= waitTimeoutMs) {
    try {
      const nonce = randomUUID()
      const handle = await open(lock, 'wx', 0o600)
      await handle.writeFile(`${canonicalJson({
        invocation_key: options.invocationKey,
        nonce,
        pid: process.pid,
        acquired_at: new Date().toISOString(),
      })}\n`, 'utf8')
      await handle.close()
      const heartbeatMs = Math.max(10, Math.min(Math.floor(staleAfterMs / 3), 30_000))
      const heartbeat = setInterval(async () => {
        try {
          const current = JSON.parse(await readFile(lock, 'utf8'))
          if (current.nonce !== nonce)
            return
          const now = new Date()
          await utimes(lock, now, now)
        }
        catch {
          // Ownership is rechecked before release; a missed heartbeat fails closed.
        }
      }, heartbeatMs)
      heartbeat.unref()
      try {
        return await options.action()
      }
      finally {
        clearInterval(heartbeat)
        try {
          const current = JSON.parse(await readFile(lock, 'utf8'))
          if (current.nonce === nonce)
            await fs.remove(lock)
        }
        catch {
          // A failed conditional release leaves the lock in place and fails closed.
        }
      }
    }
    catch (error: any) {
      if (error?.code !== 'EEXIST')
        throw error
      let stat
      try {
        stat = await fs.stat(lock)
      }
      catch (statError: any) {
        if (statError?.code === 'ENOENT')
          continue
        throw statError
      }
      if (Date.now() - stat.mtimeMs <= staleAfterMs) {
        await delay(Math.max(10, Math.min(100, Math.floor(staleAfterMs / 100))))
        continue
      }
      let owner: Record<string, unknown> | null = null
      try {
        owner = JSON.parse(await readFile(lock, 'utf8')) as Record<string, unknown>
      }
      catch {
        // A malformed, expired crash residue has no trusted live owner.
      }
      if (isLiveProcess(owner?.pid)) {
        await delay(Math.max(10, Math.min(100, Math.floor(staleAfterMs / 100))))
        continue
      }
      const stale = `${lock}.stale-${Date.now()}-${randomUUID()}`
      try {
        await fs.rename(lock, stale)
        await fs.remove(stale)
      }
      catch (renameError: any) {
        if (renameError?.code === 'ENOENT')
          continue
        throw renameError
      }
    }
  }
  throw new Error(`timed out waiting for product-manager invocation ${options.invocationKey}`)
}
