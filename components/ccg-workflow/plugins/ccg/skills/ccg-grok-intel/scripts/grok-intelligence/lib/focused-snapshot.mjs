import { createHash } from 'node:crypto'
import { chmod, lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { assertExistingPathWithoutLinks } from './path-safety.mjs'

const DEFAULT_LIMITS = Object.freeze({
  maxFiles: 200,
  maxFileBytes: 2 * 1024 * 1024,
  maxTotalBytes: 16 * 1024 * 1024,
})

const DENIED_SEGMENTS = new Set([
  '.git', '.hg', '.svn', '.claude', '.codex', '.ccg-evidence', '.gemini', '.grok', '.cursor',
  '.github', '.claude-plugin', '.codex-plugin', '.ssh', '.aws', '.azure', '.gnupg', '.kube',
  'node_modules', 'vendor', '.cache', '.next', '.nuxt', '.turbo',
  'dist', 'build', 'coverage', 'skills', 'hooks', 'plugins',
])

const DENIED_BASENAMES = new Set([
  'agents.md', 'claude.md', 'gemini.md', 'auth.json', 'credentials.json',
  '.ccgignore', '.envrc', '.mcp.json', '.npmrc', '.pypirc', '.netrc', 'known_hosts',
  'marketplace.json',
])

const PRIVATE_SEGMENTS = new Set([
  '.git', '.hg', '.svn', '.ssh', '.aws', '.azure', '.gnupg', '.kube',
  'node_modules', 'vendor', '.cache', '.next', '.nuxt', '.turbo', 'dist', 'build', 'coverage',
])

const PRIVATE_BASENAMES = new Set([
  'auth.json', 'credentials.json', '.ccgignore', '.envrc', '.mcp.json', '.npmrc', '.pypirc', '.netrc', 'known_hosts',
])

function normalizeRelativePath(input) {
  if (typeof input !== 'string' || input.length === 0 || /[\0\r\n]/.test(input) || isAbsolute(input))
    throw new Error('Snapshot paths must be non-empty relative paths')
  const normalized = input.replace(/\\/g, '/').replace(/^\.\//, '')
  const parts = normalized.split('/')
  if (parts.some(part => !part || part === '.' || part === '..'))
    throw new Error(`Snapshot path traversal or empty segment is forbidden: ${input}`)
  return parts.join('/')
}

function normalizeAllowedCcgPlanPaths(paths = []) {
  if (!Array.isArray(paths))
    throw new Error('allowedCcgPlanPaths must be an array')
  return new Set(paths.map((input) => {
    const path = normalizeRelativePath(input)
    if (!/^\.codex\/ccg\/plans\/[^/]+\.md$/i.test(path))
      throw new Error(`Allowed CCG plan must be a top-level Markdown file under .codex/ccg/plans: ${input}`)
    return path.toLowerCase()
  }))
}

function normalizeAllowedSnapshotPaths(paths = []) {
  if (!Array.isArray(paths))
    throw new Error('allowedSnapshotPaths must be an array')
  return new Set(paths.map(input => normalizeRelativePath(input).toLowerCase()))
}

function exclusionReason(relativePath, allowedCcgPlanPaths, allowedSnapshotPaths) {
  const normalized = relativePath.toLowerCase()
  const parts = normalized.split('/')
  const basename = parts.at(-1)
  if (parts.some(part => PRIVATE_SEGMENTS.has(part)))
    return 'private, dependency, VCS, cache, or build directory'
  if (PRIVATE_BASENAMES.has(basename))
    return 'secret or private configuration file'
  if (basename === '.env' || basename.startsWith('.env.'))
    return 'environment secret file'
  if (/\.(?:key|pem|p12|pfx|crt|cer|der|jks|keystore)$/i.test(basename))
    return 'credential or certificate file'
  if (/^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/i.test(basename) || /^service[-_.]?account/i.test(basename))
    return 'credential or private identity file'
  if (/(?:^|[._-])(?:credential|credentials|secret|secrets|token|tokens|auth)(?:[._-]|$)/i.test(basename))
    return 'credential or secret file'
  if (allowedSnapshotPaths.has(normalized))
    return null
  const allowedCcgPlan = allowedCcgPlanPaths.has(normalized)
  if (parts.some(part => DENIED_SEGMENTS.has(part) && !(allowedCcgPlan && part === '.codex')))
    return 'dependency, VCS, cache, instruction, hook, skill, or plugin directory'
  if (DENIED_BASENAMES.has(basename))
    return 'secret or model instruction file'
  if (/^(?:plugin|mcp)(?:[._-].*)?\.(?:json|ya?ml|toml)$/i.test(basename))
    return 'plugin or MCP manifest'
  return null
}

function escapeRegex(value) {
  return value.replace(/[.+^${}()|[\]\\]/g, '\\$&')
}

function compileIgnorePattern(pattern) {
  let normalized = pattern.trim().replace(/\\/g, '/')
  if (!normalized || normalized.startsWith('#') || normalized.startsWith('!'))
    return null
  normalized = normalized.replace(/^\//, '')
  const directory = normalized.endsWith('/')
  if (directory)
    normalized = normalized.slice(0, -1)
  const hasSlash = normalized.includes('/')
  let body = escapeRegex(normalized)
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\u0000/g, '.*')
  body = hasSlash ? `^${body}` : `(?:^|/)${body}`
  return new RegExp(`${body}${directory ? '(?:/|$)' : '$'}`)
}

async function loadIgnoreRules(repoRoot) {
  const ignorePath = resolve(repoRoot, '.ccgignore')
  try {
    const metadata = await lstat(ignorePath)
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > 64 * 1024)
      throw new Error('.ccgignore must be a bounded regular file')
    return (await readFile(ignorePath, 'utf8')).split(/\r?\n/).map(compileIgnorePattern).filter(Boolean)
  }
  catch (error) {
    if (error?.code === 'ENOENT')
      return []
    throw error
  }
}

function isWithin(root, child) {
  const rel = relative(root, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

async function assertPathChainWithoutLinks(root, relativePath) {
  let cursor = root
  for (const segment of relativePath.split('/')) {
    cursor = resolve(cursor, segment)
    const metadata = await lstat(cursor)
    if (metadata.isSymbolicLink())
      throw new Error(`Snapshot refuses symbolic links, junctions, or reparse points: ${relativePath}`)
  }
  const canonical = await realpath(cursor)
  const canonicalRoot = await realpath(root)
  if (!isWithin(canonicalRoot, canonical))
    throw new Error(`Snapshot path escaped through a link or reparse point: ${relativePath}`)
  return { absolutePath: cursor, metadata: await stat(cursor) }
}

async function assertRootWithoutLinks(path, name) {
  return (await assertExistingPathWithoutLinks(resolve(path), { name, expectedType: 'directory' })).canonical
}

function normalizeLimits(limits = {}) {
  const result = { ...DEFAULT_LIMITS, ...limits }
  for (const [name, value] of Object.entries(result)) {
    if (!Number.isInteger(value) || value < 0)
      throw new Error(`Snapshot ${name} must be a non-negative integer`)
  }
  return result
}

async function collectSelectedFiles(repoRoot, selectedPaths, ignoreRules, allowedCcgPlanPaths, allowedSnapshotPaths, skipExcludedSelectedPaths) {
  const files = new Map()
  const visit = async (relativePath, explicitlySelected) => {
    const allowedSnapshot = allowedSnapshotPaths.has(relativePath.toLowerCase())
    const reason = exclusionReason(relativePath, allowedCcgPlanPaths, allowedSnapshotPaths)
    const ignored = !allowedSnapshot && ignoreRules.some(rule => rule.test(relativePath))
    if (reason || ignored) {
      if (allowedSnapshot || (explicitlySelected && !skipExcludedSelectedPaths))
        throw new Error(`Snapshot path is excluded${ignored ? ' by .ccgignore' : ''}: ${relativePath} (${reason || 'ignored'})`)
      return
    }
    const { absolutePath, metadata } = await assertPathChainWithoutLinks(repoRoot, relativePath)
    if (metadata.isDirectory()) {
      const entries = (await readdir(absolutePath)).sort()
      for (const entry of entries)
        await visit(`${relativePath}/${entry}`, false)
      return
    }
    if (!metadata.isFile())
      throw new Error(`Snapshot supports only regular files: ${relativePath}`)
    if (metadata.nlink > 1)
      throw new Error(`Snapshot refuses hard-linked input: ${relativePath}`)
    files.set(relativePath, { absolutePath, metadata })
  }
  for (const selectedPath of selectedPaths)
    await visit(normalizeRelativePath(selectedPath), true)
  return files
}

function scopedDirtyDiff(dirtyDiffs, selectedPaths) {
  if (dirtyDiffs == null)
    return ''
  if (!Array.isArray(dirtyDiffs))
    throw new Error('dirtyDiffs must be an array of path-scoped patches')
  const selected = new Set(selectedPaths)
  const chunks = []
  for (const entry of dirtyDiffs) {
    const path = normalizeRelativePath(entry?.path)
    if (!selected.has(path))
      continue
    if (typeof entry.patch !== 'string' || entry.patch.includes('\0'))
      throw new Error(`Dirty diff for ${path} must be text`)
    chunks.push(`# path: ${path}\n${entry.patch.replace(/\s+$/, '')}\n`)
  }
  return chunks.join('\n')
}

export async function createFocusedSnapshot({
  repoRoot,
  snapshotRoot,
  selectedPaths,
  dirtyDiffs,
  limits,
  allowedCcgPlanPaths,
  allowedSnapshotPaths,
  allowEmpty = false,
  allowDestinationInsideSource = false,
  skipExcludedSelectedPaths = false,
}) {
  if (!isAbsolute(repoRoot) || !isAbsolute(snapshotRoot))
    throw new Error('repoRoot and snapshotRoot must be absolute')
  if (!Array.isArray(selectedPaths) || (!allowEmpty && selectedPaths.length === 0))
    throw new Error('selectedPaths must contain at least one router-selected path')
  const sourceRoot = await assertRootWithoutLinks(repoRoot, 'repoRoot')
  const destinationRoot = await assertRootWithoutLinks(snapshotRoot, 'snapshotRoot')
  const destinationInsideSource = isWithin(sourceRoot, destinationRoot)
  if ((destinationInsideSource && !allowDestinationInsideSource) || isWithin(destinationRoot, sourceRoot))
    throw new Error('Snapshot root must be separate from the source repository')
  if (destinationInsideSource) {
    const destinationPath = normalizeRelativePath(relative(sourceRoot, destinationRoot))
    if (selectedPaths.some((entry) => {
      const selected = normalizeRelativePath(entry)
      return selected === destinationPath || selected.startsWith(`${destinationPath}/`)
    }))
      throw new Error('Snapshot selection must not include its destination root')
  }
  if ((await readdir(destinationRoot)).length !== 0)
    throw new Error('Snapshot root must be empty')

  const effectiveLimits = normalizeLimits(limits)
  const allowedPlans = normalizeAllowedCcgPlanPaths(allowedCcgPlanPaths)
  const allowedSnapshots = normalizeAllowedSnapshotPaths(allowedSnapshotPaths)
  const ignoreRules = await loadIgnoreRules(sourceRoot)
  const files = await collectSelectedFiles(
    sourceRoot,
    selectedPaths,
    ignoreRules,
    allowedPlans,
    allowedSnapshots,
    skipExcludedSelectedPaths,
  )
  if (files.size > effectiveLimits.maxFiles)
    throw new Error(`Snapshot file count exceeds cap (${effectiveLimits.maxFiles})`)

  let totalBytes = 0
  const staged = []
  for (const [path, entry] of [...files.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (entry.metadata.size > effectiveLimits.maxFileBytes)
      throw new Error(`Snapshot per-file cap exceeded: ${path}`)
    totalBytes += entry.metadata.size
    if (totalBytes > effectiveLimits.maxTotalBytes)
      throw new Error('Snapshot total-byte cap exceeded')
    const data = await readFile(entry.absolutePath)
    const after = await stat(entry.absolutePath)
    if (after.ino !== entry.metadata.ino || after.dev !== entry.metadata.dev || after.size !== entry.metadata.size || after.mtimeMs !== entry.metadata.mtimeMs)
      throw new Error(`Snapshot input changed while being read: ${path}`)
    staged.push({ path, data, sha256: createHash('sha256').update(data).digest('hex') })
  }

  const diffText = scopedDirtyDiff(dirtyDiffs, staged.map(entry => entry.path))
  const diffBytes = Buffer.byteLength(diffText, 'utf8')
  if (diffBytes > effectiveLimits.maxFileBytes)
    throw new Error('Snapshot dirty diff exceeds the per-file cap')
  if (totalBytes + diffBytes > effectiveLimits.maxTotalBytes)
    throw new Error('Snapshot dirty diff exceeds the total-byte cap')

  for (const entry of staged) {
    const destination = resolve(destinationRoot, ...entry.path.split('/'))
    if (!isWithin(destinationRoot, destination))
      throw new Error(`Snapshot destination escaped its root: ${entry.path}`)
    await mkdir(resolve(destination, '..'), { recursive: true, mode: 0o700 })
    await writeFile(destination, entry.data, { flag: 'wx', mode: 0o400 })
    await chmod(destination, 0o400)
  }
  if (diffText) {
    const diffPath = resolve(destinationRoot, 'changes.diff')
    await writeFile(diffPath, diffText, { encoding: 'utf8', flag: 'wx', mode: 0o400 })
    await chmod(diffPath, 0o400)
  }
  return {
    root: destinationRoot,
    files: staged.map(({ path, data, sha256 }) => ({ path, bytes: data.length, sha256 })),
    totalBytes: totalBytes + diffBytes,
    dirtyDiffIncluded: Boolean(diffText),
  }
}
