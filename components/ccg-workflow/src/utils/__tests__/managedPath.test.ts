import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import fs from 'fs-extra'
import { afterEach, describe, expect, it } from 'vitest'
import {
  safeManagedAtomicWrite,
  safeManagedRead,
  safeManagedRemoveFile,
} from '../managed-path'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(root => rm(root, { recursive: true, force: true })),
  )
})

async function isolatedRoots(): Promise<{
  managed: string
  external: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'ccg managed path '))
  roots.push(root)
  const managed = join(root, 'managed root')
  const external = join(root, 'external')
  await fs.ensureDir(managed)
  await fs.ensureDir(external)
  return { managed, external }
}

describe('managed path confinement', () => {
  it.each(['agents', '.ccg'])(
    'rejects a %s junction without touching the external target',
    async (component) => {
      const { managed, external } = await isolatedRoots()
      const sentinel = join(external, 'sentinel.txt')
      await writeFile(sentinel, 'outside\n')
      await symlink(
        external,
        join(managed, component),
        process.platform === 'win32' ? 'junction' : 'dir',
      )

      await expect(safeManagedAtomicWrite(
        managed,
        `${component}/candidate.txt`,
        'managed\n',
      )).rejects.toThrow(/symbolic link|junction|managed path/i)

      expect(await readFile(sentinel, 'utf8')).toBe('outside\n')
      expect(await fs.pathExists(join(external, 'candidate.txt'))).toBe(false)
    },
  )

  it('writes, reads, and removes regular files under paths with spaces', async () => {
    const { managed } = await isolatedRoots()
    const relativePath = 'nested with spaces/state.json'

    await safeManagedAtomicWrite(managed, relativePath, '{"ok":true}\n')
    expect((await safeManagedRead(managed, relativePath))?.toString('utf8'))
      .toBe('{"ok":true}\n')
    await safeManagedRemoveFile(managed, relativePath)
    expect(await safeManagedRead(managed, relativePath)).toBeNull()
  })

  it('rejects a dangling directory link instead of treating it as missing', async () => {
    const { managed, external } = await isolatedRoots()
    const linked = join(managed, 'dangling')
    await symlink(
      external,
      linked,
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    await rm(external, { recursive: true, force: true })

    await expect(safeManagedAtomicWrite(
      managed,
      'dangling/candidate.txt',
      'managed\n',
    )).rejects.toThrow(/symbolic link|junction/i)
  })
})
