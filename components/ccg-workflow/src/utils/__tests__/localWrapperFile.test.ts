import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import fs from 'fs-extra'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installCodexModeAt } from '../codex-mode'
import { readPinnedLocalWrapper } from '../installer'

const roots: string[] = []
async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ccg-local-wrapper-test-'))
  roots.push(root)
  return root
}
afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
describe('explicit local wrapper production contract', () => {
  it.each(['relative.exe', 'https://example.test/wrapper', 'C:drive-relative.exe'])('rejects nonabsolute input %s', async (input) => {
    await expect(readPinnedLocalWrapper(input)).rejects.toThrow('absolute local file')
  })
  it('rejects a directory and unpinned bytes', async () => {
    const root = await fixture()
    await expect(readPinnedLocalWrapper(root)).rejects.toThrow('regular file')
    const source = join(root, 'wrapper')
    await writeFile(source, '#!/bin/sh\necho malicious\n')
    await expect(readPinnedLocalWrapper(source)).rejects.toThrow('integrity mismatch')
  })
  it('rejects a linked parent directory before reading the artifact', async () => {
    const root = await fixture()
    const real = join(root, 'real')
    const link = join(root, 'link')
    await mkdir(real)
    await writeFile(join(real, 'wrapper'), 'untrusted')
    await symlink(real, link, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(readPinnedLocalWrapper(join(link, 'wrapper'))).rejects.toThrow('regular file under real directories')
  })
  it('fails explicit bad input before any managed-home mutation or download', async () => {
    const root = await fixture()
    const source = join(root, 'bad')
    const home = join(root, 'codex-home')
    await writeFile(source, 'untrusted')
    const result = await installCodexModeAt({ codexHome: home, pythonCommand: 'python', wrapperFile: source })
    expect(result.success).toBe(false)
    expect(result.message).toContain('integrity mismatch')
    expect(await fs.pathExists(home)).toBe(false)
  })
  it.each(['production', 'development'])('rejects raw bytes in %s even with VITEST=true', async (nodeEnv) => {
    const root = await fixture()
    const home = join(root, 'codex-home')
    vi.stubEnv('NODE_ENV', nodeEnv)
    vi.stubEnv('VITEST', 'true')
    const result = await installCodexModeAt({ codexHome: home, pythonCommand: 'python', wrapperBytes: Buffer.from('test') })
    expect(result.success).toBe(false)
    expect(result.message).toContain('only in tests')
    expect(await fs.pathExists(home)).toBe(false)
  })
  it('rejects simultaneous raw bytes and explicit input before any mutation', async () => {
    const root = await fixture()
    const home = join(root, 'codex-home')
    const result = await installCodexModeAt({ codexHome: home, pythonCommand: 'python', wrapperFile: join(root, 'missing'), wrapperBytes: Buffer.from('test') })
    expect(result.success).toBe(false)
    expect(result.message).toContain('cannot be combined')
    expect(await fs.pathExists(home)).toBe(false)
  })
})
