import { lstat, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, parse, relative, resolve } from 'node:path'

export function pathsShareIdentity(left, right) {
  if (!left || !right)
    return false
  if (Number.isFinite(left.dev) && Number.isFinite(left.ino)
    && Number.isFinite(right.dev) && Number.isFinite(right.ino)
    && (left.dev !== 0 || left.ino !== 0 || right.dev !== 0 || right.ino !== 0))
    return left.dev === right.dev && left.ino === right.ino
  return left.isDirectory?.() === right.isDirectory?.()
    && left.isFile?.() === right.isFile?.()
    && left.size === right.size
    && left.birthtimeMs === right.birthtimeMs
}

export async function assertExistingPathWithoutLinks(input, {
  name = 'path',
  expectedType,
} = {}) {
  if (typeof input !== 'string' || !isAbsolute(input))
    throw new Error(`${name} must be absolute`)
  const absolute = resolve(input)
  const root = parse(absolute).root
  const segments = relative(root, absolute).split(/[\\/]/).filter(Boolean)
  let cursor = root
  let metadata = await lstat(root)
  for (const segment of segments) {
    cursor = join(cursor, segment)
    metadata = await lstat(cursor)
    if (metadata.isSymbolicLink())
      throw new Error(`${name} must not traverse a symbolic link, junction, or reparse point`)
  }
  if (expectedType === 'directory' && !metadata.isDirectory())
    throw new Error(`${name} must be a directory`)
  if (expectedType === 'file' && !metadata.isFile())
    throw new Error(`${name} must be a regular file`)
  const canonical = await realpath(absolute)
  const canonicalMetadata = await stat(canonical)
  if (!pathsShareIdentity(metadata, canonicalMetadata))
    throw new Error(`${name} changed identity while its path was validated`)
  return { absolute, canonical, metadata }
}
