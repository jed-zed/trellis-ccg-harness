import type { ProductManagerWorkspaceSnapshot } from './contracts'
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chmod, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { canonicalJson } from './canonical-json'
import { PACKAGE_ROOT } from '../utils/installer-template'

interface SnapshotFile {
  path: string
  bytes: number
  sha256: string
}

export interface PreparedProductManagerWorkspaceSnapshot {
  protocol_version: '1'
  snapshot_root: string
  manifest_path: string
  workspace_snapshot: ProductManagerWorkspaceSnapshot
}

const HEX_64 = /^[a-f0-9]{64}$/
const MANIFEST_FIELDS = [
  'policy_version',
  'sha256',
  'file_count',
  'total_bytes',
  'git_head',
  'dirty',
  'files',
] as const

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

function assertExactFields(value: Record<string, unknown>, fields: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const expected = [...fields].sort()
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index]))
    throw new TypeError(`${label} has missing or unknown fields`)
}

function validateFileEntry(value: unknown, index: number): SnapshotFile {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError(`workspace snapshot files[${index}] must be an object`)
  const entry = value as Record<string, unknown>
  assertExactFields(entry, ['path', 'bytes', 'sha256'], `workspace snapshot files[${index}]`)
  if (typeof entry.path !== 'string'
    || !entry.path
    || entry.path.includes('\\')
    || entry.path.includes('\0')
    || entry.path.includes(':')
    || entry.path.startsWith('/')
    || entry.path.split('/').some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new TypeError(`workspace snapshot files[${index}].path is invalid`)
  }
  if (!Number.isSafeInteger(entry.bytes) || (entry.bytes as number) < 0 || (entry.bytes as number) > 2 * 1024 * 1024)
    throw new TypeError(`workspace snapshot files[${index}].bytes is invalid`)
  if (typeof entry.sha256 !== 'string' || !HEX_64.test(entry.sha256))
    throw new TypeError(`workspace snapshot files[${index}].sha256 is invalid`)
  return entry as unknown as SnapshotFile
}

export function createWorkspaceSnapshotDigest(value: {
  policy_version: string
  git_head: string
  dirty: boolean
  files: SnapshotFile[]
}): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
}

function gitOutput(workdir: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: workdir,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

export async function prepareProductManagerWorkspaceSnapshot(options: {
  workdir: string
  taskDir: string
}): Promise<PreparedProductManagerWorkspaceSnapshot> {
  if (!isAbsolute(options.workdir) || !isAbsolute(options.taskDir))
    throw new TypeError('product-manager snapshot paths must be absolute')
  const workdir = await realpath(options.workdir)
  const taskDir = await realpath(options.taskDir)
  if (!isInside(workdir, taskDir))
    throw new Error('product-manager snapshot task directory must stay inside the workdir')

  const selectedPaths = gitOutput(workdir, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
    .split('\0')
    .filter(Boolean)
  const existingPaths: string[] = []
  for (const path of selectedPaths) {
    try {
      await lstat(resolve(workdir, ...path.replace(/\\/g, '/').split('/')))
      existingPaths.push(path)
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw error
    }
  }
  const gitHead = (() => {
    try {
      return gitOutput(workdir, ['rev-parse', 'HEAD']).trim() || 'unversioned'
    }
    catch {
      return 'unversioned'
    }
  })()
  const dirty = Boolean(gitOutput(workdir, ['status', '--porcelain=v1', '-z', '--untracked-files=all']))
  const snapshotBase = join(
    taskDir,
    '.ccg-evidence',
    'product-manager',
    'snapshots',
    randomUUID(),
  )
  const snapshotRoot = join(snapshotBase, 'root')
  const manifestPath = join(snapshotBase, 'manifest.json')
  await mkdir(snapshotRoot, { recursive: true, mode: 0o700 })
  try {
    const corePath = join(
      PACKAGE_ROOT,
      'templates',
      'engine',
      'tools',
      'grok-intelligence',
      'lib',
      'focused-snapshot.mjs',
    )
    const core = await import(pathToFileURL(corePath).href) as {
      createFocusedSnapshot: (options: Record<string, unknown>) => Promise<{
        files: SnapshotFile[]
        totalBytes: number
      }>
    }
    const snapshot = await core.createFocusedSnapshot({
      repoRoot: workdir,
      snapshotRoot,
      selectedPaths: existingPaths,
      dirtyDiffs: null,
      limits: {
        maxFiles: 2000,
        maxFileBytes: 2 * 1024 * 1024,
        maxTotalBytes: 64 * 1024 * 1024,
      },
      allowEmpty: true,
      allowDestinationInsideSource: true,
      skipExcludedSelectedPaths: true,
    })
    const files = [...snapshot.files].sort((left, right) => left.path.localeCompare(right.path))
    const workspaceSnapshot: ProductManagerWorkspaceSnapshot = {
      policy_version: '1',
      sha256: createWorkspaceSnapshotDigest({
        policy_version: '1',
        git_head: gitHead,
        dirty,
        files,
      }),
      file_count: files.length,
      total_bytes: snapshot.totalBytes,
      git_head: gitHead,
      dirty,
    }
    await writeFile(
      manifestPath,
      `${JSON.stringify({ ...workspaceSnapshot, files })}\n`,
      { encoding: 'utf8', flag: 'wx', mode: 0o400 },
    )
    await chmod(manifestPath, 0o400)
    return {
      protocol_version: '1',
      snapshot_root: snapshotRoot,
      manifest_path: manifestPath,
      workspace_snapshot: workspaceSnapshot,
    }
  }
  catch (error) {
    await rm(snapshotBase, { recursive: true, force: true })
    throw error
  }
}

async function listSnapshotFiles(root: string, directory = root): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = resolve(directory, entry.name)
    const metadata = await lstat(absolute)
    if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile()))
      throw new Error('workspace snapshot contains a link or non-regular entry')
    if (metadata.isDirectory())
      files.push(...await listSnapshotFiles(root, absolute))
    else
      files.push(relative(root, absolute).split(sep).join('/'))
  }
  return files.sort()
}

export async function validateProductManagerWorkspaceSnapshot(options: {
  snapshotRoot: string
  manifestFile: string
  taskDir: string
  expected: ProductManagerWorkspaceSnapshot
}): Promise<string> {
  if (!isAbsolute(options.snapshotRoot) || !isAbsolute(options.manifestFile) || !isAbsolute(options.taskDir))
    throw new TypeError('workspace snapshot paths must be absolute')
  const taskDir = await realpath(options.taskDir)
  const snapshotRoot = await realpath(options.snapshotRoot)
  const manifestFile = await realpath(options.manifestFile)
  if (!isInside(taskDir, snapshotRoot) || !isInside(taskDir, manifestFile))
    throw new Error('workspace snapshot paths must stay inside the canonical task directory')
  const rootMetadata = await lstat(snapshotRoot)
  const manifestMetadata = await lstat(manifestFile)
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink() || !manifestMetadata.isFile() || manifestMetadata.isSymbolicLink())
    throw new Error('workspace snapshot root or manifest type is invalid')

  const parsed = JSON.parse(await readFile(manifestFile, 'utf8')) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new TypeError('workspace snapshot manifest must be an object')
  const manifest = parsed as Record<string, unknown>
  assertExactFields(manifest, MANIFEST_FIELDS, 'workspace snapshot manifest')
  if (!Array.isArray(manifest.files))
    throw new TypeError('workspace snapshot manifest files must be an array')
  const files = manifest.files.map(validateFileEntry)
  if (files.length > 2000 || new Set(files.map(file => file.path)).size !== files.length)
    throw new Error('workspace snapshot manifest file list is invalid')
  const totalBytes = files.reduce((total, file) => total + file.bytes, 0)
  const summary = {
    policy_version: manifest.policy_version,
    sha256: manifest.sha256,
    file_count: files.length,
    total_bytes: totalBytes,
    git_head: manifest.git_head,
    dirty: manifest.dirty,
  }
  if (canonicalJson(summary) !== canonicalJson(options.expected))
    throw new Error('workspace snapshot manifest does not match the bound input')
  const digest = createWorkspaceSnapshotDigest({
    policy_version: String(manifest.policy_version),
    git_head: String(manifest.git_head),
    dirty: Boolean(manifest.dirty),
    files,
  })
  if (digest !== manifest.sha256)
    throw new Error('workspace snapshot manifest digest is invalid')

  const actualPaths = await listSnapshotFiles(snapshotRoot)
  if (canonicalJson(actualPaths) !== canonicalJson(files.map(file => file.path).sort()))
    throw new Error('workspace snapshot contents do not match the manifest')
  for (const entry of files) {
    const absolute = resolve(snapshotRoot, ...entry.path.split('/'))
    if (!isInside(snapshotRoot, absolute))
      throw new Error('workspace snapshot file escaped its root')
    const before = await lstat(absolute)
    if (!before.isFile() || before.isSymbolicLink() || before.nlink > 1 || (before.mode & 0o222) !== 0)
      throw new Error('workspace snapshot file is not an isolated read-only regular file')
    const data = await readFile(absolute)
    const after = await lstat(absolute)
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs)
      throw new Error('workspace snapshot file changed during validation')
    if (data.length !== entry.bytes || createHash('sha256').update(data).digest('hex') !== entry.sha256)
      throw new Error('workspace snapshot file digest is invalid')
  }
  return snapshotRoot
}
