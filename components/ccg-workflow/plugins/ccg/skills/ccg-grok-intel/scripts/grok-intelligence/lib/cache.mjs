import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { assertExistingPathWithoutLinks } from './path-safety.mjs'

const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/
const REQUIRED_VERSION_FIELDS = Object.freeze([
  ['runnerVersion', 'runner_version'],
  ['wrapperProtocolVersion', 'wrapper_protocol_version'],
  ['cliVersion', 'cli_version'],
  ['promptTemplateSha256', 'prompt_template_sha256'],
  ['evidenceSchemaVersion', 'evidence_schema_version'],
  ['routerPolicyVersion', 'router_policy_version'],
  ['sourceTierPolicyVersion', 'source_tier_policy_version'],
  ['eventNormalizerVersion', 'event_normalizer_version'],
  ['snapshotPolicyVersion', 'snapshot_policy_version'],
])

function requireString(value, name) {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`${name} must be a non-empty string`)
  return value.trim()
}

function validateFingerprint(value) {
  if (typeof value !== 'string' || !FINGERPRINT_PATTERN.test(value))
    throw new Error('Cache fingerprint must be a lowercase SHA-256 hex string')
  return value
}

function stableValue(value) {
  if (Array.isArray(value))
    return value.map(stableValue)
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]))
  return value
}

function stableJson(value) {
  return JSON.stringify(stableValue(value))
}

function normalizeLockfiles(value) {
  if (!Array.isArray(value))
    throw new Error('lockfiles must be an array')
  return value.map((entry) => {
    const path = requireString(entry?.path, 'lockfile.path').replace(/\\/g, '/')
    if (isAbsolute(path) || path.split('/').includes('..'))
      throw new Error('lockfile.path must remain project-relative')
    return { path, sha256: requireString(entry?.sha256, 'lockfile.sha256') }
  }).sort((left, right) => left.path.localeCompare(right.path))
}

export function createCacheFingerprint(input) {
  if (!input || typeof input !== 'object')
    throw new Error('Cache fingerprint input is required')
  const versions = {}
  for (const [source, target] of REQUIRED_VERSION_FIELDS)
    versions[target] = requireString(input[source], source)
  const normalized = {
    task: requireString(input.task, 'task').replace(/\s+/g, ' '),
    mode: requireString(input.mode, 'mode'),
    search_policy: stableValue(input.searchPolicy || {}),
    model: requireString(input.model, 'model'),
    git_head: requireString(input.gitHead, 'gitHead'),
    dirty_digest: requireString(input.dirtyDigest, 'dirtyDigest'),
    plan_digest: requireString(input.planDigest, 'planDigest'),
    diff_digest: requireString(input.diffDigest, 'diffDigest'),
    lockfiles: normalizeLockfiles(input.lockfiles),
    target_versions: stableValue(input.targetVersions || {}),
    target_domains: [...new Set((input.targetDomains || []).map(domain => requireString(domain, 'targetDomain').toLowerCase()))].sort(),
    ...versions,
  }
  const serialized = stableJson(normalized)
  return {
    key: createHash('sha256').update(serialized).digest('hex'),
    input: normalized,
    serialized,
  }
}

function isWithin(parent, child) {
  const rel = relative(parent, child)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

async function ensureCacheRoot(cacheRoot) {
  if (!isAbsolute(cacheRoot))
    throw new Error('cacheRoot must be absolute')
  await mkdir(cacheRoot, { recursive: true, mode: 0o700 })
  return (await assertExistingPathWithoutLinks(resolve(cacheRoot), { name: 'cacheRoot', expectedType: 'directory' })).canonical
}

async function assertNoLinksRecursively(path) {
  const metadata = await lstat(path)
  if (metadata.isSymbolicLink())
    throw new Error(`Cache cleanup refuses a link or reparse point: ${path}`)
  if (!metadata.isDirectory())
    return
  for (const entry of await readdir(path))
    await assertNoLinksRecursively(resolve(path, entry))
}

async function removeContainedDirectory(parent, target) {
  const canonicalParent = await realpath(parent)
  const canonicalTarget = await realpath(target)
  if (!isWithin(canonicalParent, canonicalTarget))
    throw new Error('Cache cleanup target escaped its root')
  await assertNoLinksRecursively(canonicalTarget)
  await rm(canonicalTarget, { recursive: true, force: true })
}

async function assertContainedDirectory(parent, target, name) {
  const metadata = await lstat(target)
  if (!metadata.isDirectory() || metadata.isSymbolicLink())
    throw new Error(`${name} must not be a link or reparse point`)
  const canonicalParent = await realpath(parent)
  const canonicalTarget = await realpath(target)
  if (!isWithin(canonicalParent, canonicalTarget))
    throw new Error(`${name} escaped its cache root`)
  return canonicalTarget
}

export async function withCacheLock({ cacheRoot, key, clock = () => new Date() }, action) {
  const fingerprint = validateFingerprint(key)
  if (typeof action !== 'function')
    throw new Error('Cache lock action must be a function')
  const root = await ensureCacheRoot(cacheRoot)
  const lockRoot = resolve(root, '.locks')
  await mkdir(lockRoot, { recursive: true, mode: 0o700 })
  await assertContainedDirectory(root, lockRoot, 'cache lock root')
  const lockPath = resolve(lockRoot, `${fingerprint}.lock`)
  try {
    await mkdir(lockPath, { mode: 0o700 })
    await assertContainedDirectory(lockRoot, lockPath, 'cache lock')
  }
  catch (error) {
    if (error?.code === 'EEXIST')
      throw new Error(`Cache lock is busy for ${fingerprint}`)
    throw error
  }
  try {
    await writeFile(resolve(lockPath, 'owner.json'), `${JSON.stringify({ created_at: clock().toISOString(), pid: process.pid })}\n`, {
      flag: 'wx',
      mode: 0o600,
    })
    return await action()
  }
  finally {
    await removeContainedDirectory(lockRoot, lockPath)
  }
}

export async function writeCacheEntry({ cacheRoot, fingerprint, entry, randomName = randomUUID }) {
  const key = validateFingerprint(fingerprint)
  if (!entry || entry.fingerprint !== key)
    throw new Error('Cache entry fingerprint does not match its key')
  const root = await ensureCacheRoot(cacheRoot)
  const destination = resolve(root, key)
  const staging = resolve(root, `.${key}.tmp-${randomName()}`)
  if (!isWithin(root, destination) || !isWithin(root, staging))
    throw new Error('Cache entry path escaped its root')
  await mkdir(staging, { mode: 0o700 })
  try {
    await assertContainedDirectory(root, staging, 'cache staging directory')
    await writeFile(resolve(staging, 'entry.json'), `${JSON.stringify(entry, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    await rename(staging, destination)
    return { directory: destination, path: resolve(destination, 'entry.json') }
  }
  catch (error) {
    await removeContainedDirectory(root, staging).catch(() => {})
    let destinationExists = false
    try {
      destinationExists = (await lstat(destination)).isDirectory()
    }
    catch {}
    if (destinationExists || error?.code === 'EEXIST' || error?.code === 'ENOTEMPTY')
      throw new Error(`Cache entry conflict: ${key} already exists`)
    throw error
  }
}

export async function removeCacheEntry({ cacheRoot, fingerprint }) {
  const key = validateFingerprint(fingerprint)
  const root = await ensureCacheRoot(cacheRoot)
  const target = resolve(root, key)
  let metadata
  try {
    metadata = await lstat(target)
  }
  catch (error) {
    if (error?.code === 'ENOENT')
      return false
    throw error
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink())
    throw new Error('Cache entry must not be a link or reparse point')
  await removeContainedDirectory(root, target)
  return true
}

function parsedTimestamp(value) {
  if (typeof value !== 'string')
    return null
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value)
    return null
  return parsed
}

function hasContradictedClaim(entry) {
  const claims = entry?.evidence?.claims
  return Array.isArray(claims) && claims.some(claim => claim?.status === 'contradicted')
}

function hasEarlyWarningClaim(entry) {
  const claims = entry?.evidence?.claims
  return Array.isArray(claims) && claims.some(claim => claim?.status === 'early_warning')
}

export async function readCacheEntry({ cacheRoot, fingerprint, now = new Date(), ttlMs, forceRefresh = false }) {
  const key = validateFingerprint(fingerprint)
  if (!Number.isInteger(ttlMs) || ttlMs < 0)
    throw new Error('Cache ttlMs must be a non-negative integer')
  if (forceRefresh)
    return { hit: false, reason: 'force_refresh' }
  const root = await ensureCacheRoot(cacheRoot)
  let entry
  try {
    entry = JSON.parse(await readFile(resolve(root, key, 'entry.json'), 'utf8'))
  }
  catch (error) {
    if (error?.code === 'ENOENT')
      return { hit: false, reason: 'missing' }
    throw new Error('Cache entry is malformed or unreadable')
  }
  if (entry.fingerprint !== key)
    return { hit: false, reason: 'fingerprint_mismatch' }
  const createdAt = parsedTimestamp(entry.created_at)
  if (!createdAt)
    return { hit: false, reason: 'invalid_timestamp' }
  if (createdAt.getTime() > now.getTime())
    return { hit: false, reason: 'future_timestamp' }
  if (now.getTime() - createdAt.getTime() > ttlMs)
    return { hit: false, reason: 'stale' }
  if (!['verified', 'received_unverified'].includes(entry.status) || entry.degraded === true || entry.failed === true)
    return { hit: false, reason: 'unusable_status' }
  if (hasContradictedClaim(entry))
    return { hit: false, reason: 'contradicted_evidence' }
  if (hasEarlyWarningClaim(entry))
    return { hit: false, reason: 'early_warning_evidence' }
  return { hit: true, reason: 'usable', entry }
}

export { validateFingerprint }
