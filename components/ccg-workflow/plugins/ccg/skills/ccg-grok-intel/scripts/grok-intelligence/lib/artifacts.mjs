import { createHash, randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { createIntelligenceDecision } from './router.mjs'
import { canonicalizeSourceUrl } from './source-registry.mjs'
import { assertExistingPathWithoutLinks } from './path-safety.mjs'

const LOCAL_RETENTION_DAYS = 7
const EXPORT_RETENTION_DAYS = 30
const MAX_EXPORT_BYTES = 16 * 1024 * 1024
const MAX_CONFIGURED_BUNDLE_BYTES = 64 * 1024 * 1024
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function validateEvidenceId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(value))
    throw new Error('Evidence id is unsafe or contains a path separator/drive prefix')
  if (value === '..' || value.endsWith('.') || value.endsWith(' ') || WINDOWS_RESERVED.test(value))
    throw new Error('Evidence id is unsafe or reserved')
  return value
}

function isWithin(parent, child) {
  const rel = relative(parent, child)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

async function assertPlainDirectory(path, name) {
  return (await assertExistingPathWithoutLinks(resolve(path), { name, expectedType: 'directory' })).canonical
}

async function prepareContainedRoot(projectRoot, requestedRoot) {
  const projectInput = resolve(projectRoot)
  const project = await assertPlainDirectory(projectRoot, 'projectRoot')
  const requested = resolve(requestedRoot || resolve(projectInput, '.codex', 'ccg', 'intelligence'))
  const inputRelative = relative(projectInput, requested)
  const canonicalRelative = relative(project, requested)
  const relativeTarget = isWithin(projectInput, requested)
    ? inputRelative
    : isWithin(project, requested)
      ? canonicalRelative
      : null
  if (relativeTarget == null)
    throw new Error('Artifact root must remain inside the project root')
  const target = resolve(project, relativeTarget)
  await mkdir(target, { recursive: true, mode: 0o700 })
  await chmod(target, 0o700)
  const canonical = await assertPlainDirectory(target, 'artifactRoot')
  if (!isWithin(project, canonical))
    throw new Error('Artifact root escaped the project root')
  return { project, root: canonical }
}

function redactText(value, secrets) {
  let result = String(value)
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret)
      result = result.split(secret).join('[REDACTED]')
  }
  result = result.replace(/https?:\/\/[^\s"'<>\\]+/gi, (candidate) => {
    try {
      return canonicalizeSourceUrl(candidate)
    }
    catch {
      return '[REDACTED_URL]'
    }
  })
  return result
    .replace(/((?:api[_-]?key|token|authorization|secret)\s*[:=]\s*)\S+/gi, '$1[REDACTED]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
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
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    /(?:api[_-]?key|token|authorization|secret|credential)/i.test(key)
      ? '[REDACTED]'
      : redactValue(child, secrets, seen),
  ]))
}

function sanitizeForExport(value, secrets, seen = new WeakSet()) {
  if (typeof value === 'string')
    return redactText(value, secrets)
  if (value == null || typeof value !== 'object')
    return value
  if (seen.has(value))
    return '[REDACTED_CYCLE]'
  seen.add(value)
  if (Array.isArray(value))
    return value.map(item => sanitizeForExport(item, secrets, seen))
  const output = {}
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:raw|rawEvents|raw_stream|notifications|stderr|prompt|task|snapshot|events|unknownEvents|finalText)$/i.test(key))
      continue
    output[key] = /(?:api[_-]?key|token|authorization|secret|credential)/i.test(key)
      ? '[REDACTED]'
      : sanitizeForExport(child, secrets, seen)
  }
  return output
}

function rawJsonl(rawEvents, secrets) {
  if (Array.isArray(rawEvents))
    return rawEvents.map(event => JSON.stringify(redactValue(event, secrets))).join('\n') + (rawEvents.length ? '\n' : '')
  if (typeof rawEvents === 'string')
    return rawEvents.split(/\r?\n/).filter(Boolean).map(line => redactText(line, secrets)).join('\n') + (rawEvents.trim() ? '\n' : '')
  throw new Error('rawEvents must be an array or JSONL string')
}

function encodeJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function assertNoLinksRecursively(path) {
  const metadata = await lstat(path)
  if (metadata.isSymbolicLink())
    throw new Error(`Artifact operation refuses link or reparse entry: ${path}`)
  if (!metadata.isDirectory())
    return
  for (const entry of await readdir(path))
    await assertNoLinksRecursively(resolve(path, entry))
}

async function safeRemoveDirectory(parent, target) {
  const canonicalParent = await realpath(parent)
  const canonicalTarget = await realpath(target)
  if (!isWithin(canonicalParent, canonicalTarget))
    throw new Error('Artifact cleanup target escaped its intended parent')
  await assertNoLinksRecursively(canonicalTarget)
  await rm(canonicalTarget, { recursive: true, force: true })
}

function buildManifest({ evidenceId, createdAt, files, exported = false, retentionDays, model, provenance = {} }) {
  const manifestFiles = {}
  for (const [name, bytes] of Object.entries(files))
    manifestFiles[name] = { sha256: sha256(bytes), bytes: bytes.length }
  return {
    ...provenance,
    schemaVersion: 1,
    evidenceId,
    createdAt,
    localOnly: !exported,
    exported,
    retentionDays,
    files: manifestFiles,
    ...(model ? { model } : {}),
  }
}

async function atomicBundleWrite({ root, evidenceId, files, manifest, randomName = randomUUID }) {
  const destination = resolve(root, evidenceId)
  const staging = resolve(root, `.${evidenceId}.tmp-${randomName()}`)
  if (!isWithin(root, destination) || !isWithin(root, staging))
    throw new Error('Bundle path escaped its root')
  await mkdir(staging, { mode: 0o700 })
  try {
    const canonicalStaging = await assertPlainDirectory(staging, 'bundle staging directory')
    if (!isWithin(root, canonicalStaging))
      throw new Error('Bundle staging directory escaped its root')
    for (const [name, bytes] of Object.entries(files))
      await writeFile(resolve(staging, name), bytes, { flag: 'wx', mode: 0o600 })
    const manifestBytes = encodeJson(manifest)
    await writeFile(resolve(staging, 'manifest.json'), manifestBytes, { flag: 'wx', mode: 0o600 })
    await rename(staging, destination)
    return { destination, manifestBytes }
  }
  catch (error) {
    await safeRemoveDirectory(root, staging).catch(() => {})
    let destinationExists = false
    try {
      destinationExists = (await lstat(destination)).isDirectory()
    }
    catch {}
    const message = destinationExists || error?.code === 'EEXIST' || error?.code === 'ENOTEMPTY'
      ? `Evidence bundle already exists: ${evidenceId}`
      : error instanceof Error ? error.message : String(error)
    throw new Error(message)
  }
}

export async function writeIntelligenceBundle({
  projectRoot,
  artifactRoot,
  evidenceId,
  decision,
  evidence,
  report,
  rawEvents,
  secrets = [],
  clock = () => new Date(),
  randomName,
  model,
  retentionDays = LOCAL_RETENTION_DAYS,
  maxBytes = MAX_EXPORT_BYTES,
  provenance = {},
}) {
  const id = validateEvidenceId(evidenceId)
  if (!Number.isInteger(retentionDays) || retentionDays < 1)
    throw new Error('retentionDays must be a positive integer')
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_CONFIGURED_BUNDLE_BYTES)
    throw new Error(`Evidence maximum byte cap must be between 1 and ${MAX_CONFIGURED_BUNDLE_BYTES}`)
  const normalizedDecision = createIntelligenceDecision(decision)
  if (typeof report !== 'string')
    throw new Error('Evidence report must be text')
  const { project, root } = await prepareContainedRoot(projectRoot, artifactRoot)
  const createdAt = clock().toISOString()
  const files = {
    'evidence.json': encodeJson({ schemaVersion: 2, decision: normalizedDecision, evidence: redactValue(evidence || {}, secrets) }),
    'report.md': Buffer.from(redactText(report, secrets), 'utf8'),
    'raw-stream.jsonl': Buffer.from(rawJsonl(rawEvents, secrets), 'utf8'),
  }
  const manifest = buildManifest({
    evidenceId: id,
    createdAt,
    files,
    retentionDays,
    model,
    provenance,
  })
  const totalBytes = Object.values(files).reduce((total, bytes) => total + bytes.length, 0)
    + encodeJson(manifest).length
  if (totalBytes > maxBytes)
    throw new Error('Evidence bundle exceeds the configured maximum byte cap')
  const { destination, manifestBytes } = await atomicBundleWrite({ root, evidenceId: id, files, manifest, randomName })
  const relativeDirectory = relative(project, destination).replace(/\\/g, '/')
  return {
    evidenceId: id,
    directory: destination,
    artifactPath: resolve(destination, 'evidence.json'),
    artifactRelativePath: `${relativeDirectory}/evidence.json`,
    artifactSha256: manifest.files['evidence.json'].sha256,
    manifestPath: resolve(destination, 'manifest.json'),
    manifestRelativePath: `${relativeDirectory}/manifest.json`,
    manifestSha256: sha256(manifestBytes),
    reportPath: resolve(destination, 'report.md'),
    rawPath: resolve(destination, 'raw-stream.jsonl'),
  }
}

async function readVerifiedBundle(bundleDir) {
  const root = await assertPlainDirectory(bundleDir, 'bundleDir')
  const manifestPath = resolve(root, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const expectedFiles = ['evidence.json', 'raw-stream.jsonl', 'report.md']
  const actualFiles = (await readdir(root)).sort()
  if (JSON.stringify(actualFiles) !== JSON.stringify([...expectedFiles, 'manifest.json'].sort()))
    throw new Error('Source bundle must contain exactly the canonical four files')
  if (JSON.stringify(Object.keys(manifest.files || {}).sort()) !== JSON.stringify(expectedFiles))
    throw new Error('Source manifest must hash exactly evidence, report, and raw files')
  for (const name of expectedFiles) {
    const bytes = await readFile(resolve(root, name))
    const expected = manifest.files?.[name]
    if (!expected || expected.sha256 !== sha256(bytes) || expected.bytes !== bytes.length)
      throw new Error(`Source bundle hash mismatch: ${name}`)
  }
  return { root, manifest }
}

export async function exportIntelligenceBundle({
  bundleDir,
  exportRoot,
  evidenceId,
  includeRaw = false,
  maxBytes = MAX_EXPORT_BYTES,
  retentionDays = EXPORT_RETENTION_DAYS,
  secrets = [],
  clock = () => new Date(),
  randomName,
}) {
  const id = validateEvidenceId(evidenceId)
  if (!Number.isInteger(retentionDays) || retentionDays < 1)
    throw new Error('retentionDays must be a positive integer')
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_CONFIGURED_BUNDLE_BYTES)
    throw new Error(`Export maximum byte cap must be between 1 and ${MAX_CONFIGURED_BUNDLE_BYTES}`)
  const source = await readVerifiedBundle(bundleDir)
  await mkdir(exportRoot, { recursive: true, mode: 0o700 })
  await chmod(exportRoot, 0o700)
  const root = await assertPlainDirectory(exportRoot, 'exportRoot')
  const evidence = sanitizeForExport(JSON.parse(await readFile(resolve(source.root, 'evidence.json'), 'utf8')), secrets)
  const files = {
    'evidence.json': encodeJson({ ...evidence, exported: true, localOnly: false }),
    'report.md': Buffer.from(redactText(await readFile(resolve(source.root, 'report.md'), 'utf8'), secrets), 'utf8'),
  }
  if (includeRaw)
    files['raw-stream.jsonl'] = Buffer.from(redactText(await readFile(resolve(source.root, 'raw-stream.jsonl'), 'utf8'), secrets), 'utf8')
  const manifest = buildManifest({
    evidenceId: id,
    createdAt: clock().toISOString(),
    files,
    exported: true,
    retentionDays,
  })
  const totalBytes = Object.values(files).reduce((total, bytes) => total + bytes.length, 0)
    + encodeJson(manifest).length
  if (totalBytes > maxBytes)
    throw new Error('Sanitized export exceeds the maximum byte cap')
  const { destination, manifestBytes } = await atomicBundleWrite({ root, evidenceId: id, files, manifest, randomName })
  return {
    directory: destination,
    manifestPath: resolve(destination, 'manifest.json'),
    manifestSha256: sha256(manifestBytes),
    exported: true,
  }
}

function ageExceeded(timestamp, now, days) {
  const parsed = new Date(timestamp)
  return Number.isFinite(parsed.getTime()) && now.getTime() - parsed.getTime() > days * 24 * 60 * 60 * 1000
}

export async function cleanupIntelligenceArtifacts({
  artifactRoot,
  activeEvidenceIds = [],
  retentionDays = LOCAL_RETENTION_DAYS,
  tempParent,
  activePrivateRoots = [],
  now = new Date(),
}) {
  if (!Number.isInteger(retentionDays) || retentionDays < 1)
    throw new Error('retentionDays must be a positive integer')
  const root = await assertPlainDirectory(artifactRoot, 'artifactRoot')
  const activeEvidence = new Set(activeEvidenceIds.map(validateEvidenceId))
  const removedEvidenceIds = []
  const removedStagingDirectories = []
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory())
      continue
    if (/^\.[A-Za-z0-9][A-Za-z0-9._-]{0,95}\.tmp-[A-Za-z0-9-]+$/.test(entry.name)) {
      const stagingPath = resolve(root, entry.name)
      const metadata = await stat(stagingPath)
      if (ageExceeded(metadata.mtime.toISOString(), now, retentionDays)) {
        await safeRemoveDirectory(root, stagingPath)
        removedStagingDirectories.push(entry.name)
      }
      continue
    }
    if (entry.name.startsWith('.') || activeEvidence.has(entry.name))
      continue
    let manifest
    try {
      manifest = JSON.parse(await readFile(resolve(root, entry.name, 'manifest.json'), 'utf8'))
    }
    catch {
      continue
    }
    if (ageExceeded(manifest.createdAt, now, retentionDays)) {
      await safeRemoveDirectory(root, resolve(root, entry.name))
      removedEvidenceIds.push(entry.name)
    }
  }

  const removedPrivateRoots = []
  if (tempParent) {
    const parent = await assertPlainDirectory(tempParent, 'tempParent')
    const activeRoots = new Set(activePrivateRoots.map(path => resolve(path).toLowerCase()))
    for (const entry of (await readdir(parent, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || !/^ccg-grok-run-[^\\/]+$/i.test(entry.name))
        continue
      const path = resolve(parent, entry.name)
      if (activeRoots.has(path.toLowerCase()))
        continue
      const metadata = await stat(path)
      if (ageExceeded(metadata.mtime.toISOString(), now, retentionDays)) {
        await safeRemoveDirectory(parent, path)
        removedPrivateRoots.push(entry.name)
      }
    }
  }
  return { removedEvidenceIds, removedStagingDirectories, removedPrivateRoots }
}

export { validateEvidenceId }
