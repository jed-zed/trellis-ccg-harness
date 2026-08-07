import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import fs from 'fs-extra'
import { parse } from 'smol-toml'
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

  it('changes one Codex role without changing the others', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ccg routing home '))
    roots.push(home)
    const configDir = join(home, '.codex', 'ccg')
    const configPath = join(configDir, 'config.toml')
    await fs.ensureDir(configDir)
    await writeFile(configPath, [
      '[general]',
      'version = "3.4.2"',
      '',
      '[routing.frontend]',
      'models = ["gemini"]',
      'primary = "gemini"',
      'strategy = "fallback"',
      '',
      '[routing.backend]',
      'models = ["claude"]',
      'primary = "claude"',
      'strategy = "fallback"',
      '',
      '[routing.search]',
      'models = ["antigravity"]',
      'primary = "antigravity"',
      'strategy = "fallback"',
      '',
      '[routing.product-manager]',
      'models = ["claude"]',
      'primary = "claude"',
      'strategy = "fallback"',
      '',
      '[intelligence]',
      'enabled = false',
      'auto_route = false',
      '',
    ].join('\n'))

    const tsxImport = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href
    const run = (args: string[]) => spawnSync(
      process.execPath,
      ['--import', tsxImport, join(process.cwd(), 'src', 'cli.ts'), ...args],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          NO_COLOR: '1',
        },
        timeout: 30_000,
        windowsHide: true,
      },
    )

    const repaired = run(['routing', 'set', 'search', 'grok'])
    expect(repaired.status, repaired.stderr).toBe(0)
    let document = parse(await readFile(configPath, 'utf8')) as any
    expect(document.routing.search.primary).toBe('grok')
    expect(document.routing.backend.primary).toBe('claude')

    const repairedBackend = run(['routing', 'set', 'backend', 'codex'])
    expect(repairedBackend.status, repairedBackend.stderr).toBe(0)

    const changed = run(['routing', 'set', 'frontend', 'antigravity'])
    expect(changed.status, changed.stderr).toBe(0)
    document = parse(await readFile(configPath, 'utf8')) as any
    expect(document.routing.frontend.primary).toBe('antigravity')
    expect(document.routing.backend.primary).toBe('codex')
    expect(document.routing.search.primary).toBe('grok')
    expect(document.routing['product-manager'].primary).toBe('claude')
    expect(document.routing).not.toHaveProperty('analysis')
    expect(document.routing).not.toHaveProperty('planning')
    expect(document.routing).not.toHaveProperty('review')

    const getResult = run(['routing', 'get', 'frontend', '--json'])
    expect(getResult.status, getResult.stderr).toBe(0)
    expect(JSON.parse(getResult.stdout)).toEqual({
      role: 'frontend',
      provider: 'antigravity',
    })
    expect(await fs.pathExists(join(home, '.claude'))).toBe(false)
  })

  it('migrates legacy product-manager selection and switches only the fourth role', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ccg product manager routing home '))
    roots.push(home)
    const configDir = join(home, '.codex', 'ccg')
    const configPath = join(configDir, 'config.toml')
    await fs.ensureDir(configDir)
    await writeFile(configPath, [
      '[routing.frontend]',
      'models = ["gemini"]',
      'primary = "gemini"',
      'strategy = "fallback"',
      '',
      '[routing.backend]',
      'models = ["codex"]',
      'primary = "codex"',
      'strategy = "fallback"',
      '',
      '[routing.search]',
      'models = ["grok"]',
      'primary = "grok"',
      'strategy = "fallback"',
      '',
      '[product_manager]',
      'enabled = true',
      'provider = "gemini"',
      'contract_version = "1"',
      '',
    ].join('\n'))

    const tsxImport = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href
    const cliEnvironment: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      NO_COLOR: '1',
      NODE_ENV: 'production',
    }
    delete cliEnvironment.I18NEXT_NO_SUPPORT_NOTICE
    delete cliEnvironment.CI
    const run = (args: string[]) => spawnSync(
      process.execPath,
      ['--import', tsxImport, join(process.cwd(), 'src', 'cli.ts'), ...args],
      {
        encoding: 'utf8',
        env: cliEnvironment,
        timeout: 30_000,
        windowsHide: true,
      },
    )

    const migrated = run(['routing', 'get', 'product-manager', '--json'])
    expect(migrated.status, migrated.stderr).toBe(0)
    expect(JSON.parse(migrated.stdout)).toEqual({
      role: 'product-manager',
      provider: 'gemini',
    })
    let document = parse(await readFile(configPath, 'utf8')) as any
    expect(document.product_manager).not.toHaveProperty('provider')

    for (const provider of ['claude', 'codex', 'gemini']) {
      const changed = run(['routing', 'set', 'product-manager', provider])
      expect(changed.status, changed.stderr).toBe(0)
      document = parse(await readFile(configPath, 'utf8')) as any
      expect(document.routing['product-manager'].primary).toBe(provider)
      expect(document.routing.frontend.primary).toBe('gemini')
      expect(document.routing.backend.primary).toBe('codex')
      expect(document.routing.search.primary).toBe('grok')
    }

    expect(await fs.pathExists(join(home, '.claude'))).toBe(false)
  })
})
