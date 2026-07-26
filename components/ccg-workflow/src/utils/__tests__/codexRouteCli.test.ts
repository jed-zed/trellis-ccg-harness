import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import fs from 'fs-extra'
import { afterEach, describe, expect, it } from 'vitest'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Codex-native CCG route CLI', () => {
  it.each([
    ['codex-mode --help', ['codex-mode', '--help']],
    ['codex-mode help', ['codex-mode', 'help']],
  ])('prints Codex-only help for %s without creating ~/.claude', async (_label, args) => {
    const home = await mkdtemp(join(tmpdir(), 'ccg codex mode help '))
    roots.push(home)
    const tsxImport = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href
    const result = spawnSync(
      process.execPath,
      ['--import', tsxImport, join(process.cwd(), 'src', 'cli.ts'), ...args],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
        },
        timeout: 30_000,
        windowsHide: true,
      },
    )

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('Usage:\n  ccg codex-mode <install|uninstall|recover>')
    expect(result.stdout).toContain('only manages Codex-owned paths')
    expect(result.stdout).not.toContain('ccg init')
    expect(await fs.pathExists(join(home, '.claude'))).toBe(false)
  })

  it('uses ~/.codex/ccg/config.toml and never creates ~/.claude', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ccg route home '))
    roots.push(home)
    const repo = join(home, 'repo')
    await fs.ensureDir(join(home, '.codex', 'ccg'))
    await fs.ensureDir(repo)
    await writeFile(
      join(home, '.codex', 'ccg', 'config.toml'),
      '[intelligence]\nenabled = false\nauto_route = false\n',
    )

    const tsxImport = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        tsxImport,
        join(process.cwd(), 'src', 'cli.ts'),
        'route',
        '--repo-root',
        repo,
        '--workflow',
        'execute',
        '--phase',
        'intake',
        '--task',
        'local-only task',
        '--state-file',
        '.codex/ccg/route/status.json',
      ],
      {
        cwd: repo,
        encoding: 'utf8',
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
        },
        timeout: 30_000,
        windowsHide: true,
      },
    )

    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ invoked: false, exitCode: 0 })
    expect(await fs.pathExists(join(home, '.claude'))).toBe(false)
  })
})
