import { randomUUID } from 'node:crypto'
import type { Stats } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import { open } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import fs from 'fs-extra'

type ManagedTargetKind = 'directory' | 'file' | 'missing-or-directory' | 'missing-or-file'

async function lstatOrNull(path: string): Promise<Stats | null> {
  try {
    return await fs.lstat(path)
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return null
    throw error
  }
}

function escapes(root: string, target: string): boolean {
  const delta = relative(root, target)
  return delta === '..' || delta.startsWith(`..${sep}`) || isAbsolute(delta)
}

function normalizedSegments(relativePath: string): string[] {
  if (
    !relativePath
    || relativePath.includes('\0')
    || isAbsolute(relativePath)
  ) {
    throw new Error(`Managed path is unsafe: ${relativePath}`)
  }
  const segments = relativePath.replace(/\\/g, '/').split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..'))
    throw new Error(`Managed path is unsafe: ${relativePath}`)
  return segments
}

async function assertRegularDirectory(path: string, label: string): Promise<void> {
  const metadata = await fs.lstat(path)
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(
      `${label} must be a regular directory, not a symbolic link or junction: ${path}`,
    )
  }
}

export async function ensureManagedRoot(root: string): Promise<string> {
  const absoluteRoot = resolve(root)
  if (!(await fs.pathExists(absoluteRoot)))
    await fs.ensureDir(absoluteRoot, 0o700)
  await assertRegularDirectory(absoluteRoot, 'Managed root')
  const canonicalRoot = await fs.realpath(absoluteRoot)
  if (resolve(canonicalRoot) !== absoluteRoot) {
    throw new Error(
      `Managed root resolves through a symbolic link or junction: ${absoluteRoot}`,
    )
  }
  return absoluteRoot
}

export async function assertManagedPath(
  root: string,
  relativePath: string,
  kind: ManagedTargetKind,
  createParents = false,
): Promise<string> {
  const absoluteRoot = await ensureManagedRoot(root)
  const segments = normalizedSegments(relativePath)
  const target = resolve(absoluteRoot, ...segments)
  if (escapes(absoluteRoot, target))
    throw new Error(`Managed path escapes its root: ${relativePath}`)

  let cursor = absoluteRoot
  for (let index = 0; index < segments.length; index += 1) {
    cursor = resolve(cursor, segments[index])
    const isTarget = index === segments.length - 1
    const metadata = await lstatOrNull(cursor)
    if (!metadata) {
      if (!isTarget && createParents) {
        await fs.mkdir(cursor, { mode: 0o700 })
        await assertRegularDirectory(cursor, 'Managed path component')
        continue
      }
      if (!isTarget) {
        throw new Error(`Managed path parent does not exist: ${cursor}`)
      }
      break
    }

    if (metadata.isSymbolicLink()) {
      throw new Error(
        `Managed path contains a symbolic link or junction: ${cursor}`,
      )
    }
    if (!isTarget && !metadata.isDirectory()) {
      throw new Error(`Managed path component is not a directory: ${cursor}`)
    }
    if (isTarget) {
      if (
        (kind === 'file' || kind === 'missing-or-file')
        && !metadata.isFile()
      ) {
        throw new Error(`Managed target is not a regular file: ${cursor}`)
      }
      if (
        (kind === 'directory' || kind === 'missing-or-directory')
        && !metadata.isDirectory()
      ) {
        throw new Error(`Managed target is not a regular directory: ${cursor}`)
      }
    }
  }

  const existing = await lstatOrNull(target) ? target : dirname(target)
  const canonicalExisting = await fs.realpath(existing)
  const canonicalRoot = await fs.realpath(absoluteRoot)
  if (escapes(canonicalRoot, canonicalExisting)) {
    throw new Error(
      `Managed path resolves outside its root through a link or junction: ${relativePath}`,
    )
  }
  return target
}

export async function safeManagedRead(
  root: string,
  relativePath: string,
): Promise<Buffer | null> {
  const path = await assertManagedPath(
    root,
    relativePath,
    'missing-or-file',
    true,
  )
  return await fs.pathExists(path) ? fs.readFile(path) : null
}

export async function safeManagedAtomicWrite(
  root: string,
  relativePath: string,
  value: string | Buffer,
  mode = 0o600,
): Promise<void> {
  const target = await assertManagedPath(
    root,
    relativePath,
    'missing-or-file',
    true,
  )
  const temporaryRelative = `${relativePath}.tmp-${randomUUID()}`
  const temporary = await assertManagedPath(
    root,
    temporaryRelative,
    'missing-or-file',
    true,
  )
  let handle: FileHandle | null = null
  try {
    handle = await open(temporary, 'wx', mode)
    await handle.writeFile(value)
    await handle.sync()
    await handle.close()
    handle = null
    if (process.platform !== 'win32')
      await fs.chmod(temporary, mode)

    await assertManagedPath(root, relativePath, 'missing-or-file', true)
    await fs.move(temporary, target, { overwrite: true })
    const installed = await fs.lstat(target)
    if (installed.isSymbolicLink() || !installed.isFile())
      throw new Error(`Managed write did not produce a regular file: ${target}`)
    if (process.platform !== 'win32')
      await fs.chmod(target, mode)
  }
  finally {
    if (handle)
      await handle.close().catch(() => {})
    await fs.remove(temporary).catch(() => {})
  }
}

export async function safeManagedRemoveFile(
  root: string,
  relativePath: string,
): Promise<void> {
  const target = await assertManagedPath(
    root,
    relativePath,
    'missing-or-file',
    true,
  )
  if (await fs.pathExists(target))
    await fs.remove(target)
}

export async function safeManagedEnsureDirectory(
  root: string,
  relativePath: string,
): Promise<string> {
  const target = await assertManagedPath(
    root,
    relativePath,
    'missing-or-directory',
    true,
  )
  if (!(await fs.pathExists(target)))
    await fs.mkdir(target, { mode: 0o700 })
  await assertRegularDirectory(target, 'Managed directory')
  return target
}

export async function safeManagedRemoveDirectory(
  root: string,
  relativePath: string,
): Promise<void> {
  const target = await assertManagedPath(
    root,
    relativePath,
    'missing-or-directory',
  )
  if (await fs.pathExists(target))
    await fs.remove(target)
}
