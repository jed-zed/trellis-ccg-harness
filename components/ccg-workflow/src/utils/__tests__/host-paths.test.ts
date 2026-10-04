import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { configRouting, configureProviderRouting, readCodexRoutingConfig } from '../../commands/config-routing'
import { readCodexProductManagerConfig } from '../../commands/product-manager'
import { prepareCodexRouteArgs } from '../../commands/route'
import { installCodexModeAt, recoverCodexModeAt, uninstallCodexModeAt } from '../codex-mode'
import { createDefaultConfig, createDefaultRouting, ensureCcgDir, getCcgDir, getConfigPath, readCcgConfig, readCcgConfigAt, writeCcgConfig } from '../config'
import { assertCodexHostPath, resolveCodexHome } from '../host-boundary'

const roots: string[] = []
const LEGACY_PM = '[product_manager]\nenabled = true\nprovider = "gemini"\ncontract_version = "1"\n'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ccg-host-paths-'))
  roots.push(root)
  const userHome = join(root, 'user')
  const claudeHome = join(userHome, '.claude')
  const codexHome = join(root, 'external-codex')
  await mkdir(claudeHome, { recursive: true })
  vi.stubEnv('CLAUDE_CONFIG_DIR', claudeHome)
  vi.stubEnv('CODEX_HOME', codexHome)
  return { root, userHome, claudeHome, codexHome }
}

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })))
})

describe('Codex configuration path isolation', () => {
  it('uses the supplied user home fallback and preserves an explicit G drive Codex home', async () => {
    const { userHome } = await fixture()
    expect(resolve(resolveCodexHome('', userHome))).toBe(join(userHome, '.codex'))
    expect(resolveCodexHome(' G:\\CodexData\\.codex ', userHome)).toBe('G:\\CodexData\\.codex')
  })

  it('resolves CODEX_HOME on each call and stores only in the selected Codex tree', async () => {
    const { root, claudeHome, codexHome } = await fixture()
    const upstream = join(claudeHome, '.ccg', 'config.toml')
    await mkdir(join(claudeHome, '.ccg'), { recursive: true })
    await writeFile(upstream, LEGACY_PM)
    expect(resolve(getCcgDir())).toBe(join(codexHome, 'ccg'))
    expect(await readCcgConfig()).toBeNull()
    const config = createDefaultConfig({ language: 'zh-CN', routing: createDefaultRouting(), installedWorkflows: [] })
    await writeCcgConfig(config)
    expect((await readCcgConfig())?.general.language).toBe('zh-CN')
    expect(await readFile(upstream, 'utf8')).toBe(LEGACY_PM)
    const otherHome = join(root, 'another-codex')
    vi.stubEnv('CODEX_HOME', otherHome)
    expect(resolve(getConfigPath())).toBe(join(otherHome, 'ccg', 'config.toml'))
    expect(await readCcgConfig()).toBeNull()
    expect(Object.values(createDefaultConfig({ language: 'en', routing: createDefaultRouting(), installedWorkflows: [] }).paths))
      .toEqual([getCcgDir() + '/commands', getCcgDir() + '/prompts', getCcgDir() + '/backup'])
  })

  it('honors CODEX_HOME for PM queries without rewriting a legacy configuration', async () => {
    const { codexHome } = await fixture()
    const configFile = join(codexHome, 'ccg', 'config.toml')
    await mkdir(join(codexHome, 'ccg'), { recursive: true })
    await writeFile(configFile, LEGACY_PM)
    const result = await readCodexProductManagerConfig()
    expect(result.selectedProvider).toBe('gemini')
    expect(result.behavior.enabled).toBe(true)
    expect(result.behavior.contract_version).toBe('2')
    expect(await readFile(configFile, 'utf8')).toBe(LEGACY_PM)
  })

  it('rejects Claude as CODEX_HOME and refuses explicit Claude config migration', async () => {
    const { claudeHome } = await fixture()
    const configFile = join(claudeHome, 'config.toml')
    await writeFile(configFile, LEGACY_PM)
    vi.stubEnv('CODEX_HOME', claudeHome)
    expect(() => getCcgDir()).toThrow(/overlaps Claude/)
    await expect(ensureCcgDir()).rejects.toThrow(/overlaps Claude/)
    await expect(readCcgConfigAt(configFile)).rejects.toThrow(/overlaps Claude/)
    await expect(readCodexProductManagerConfig(configFile)).rejects.toThrow(/overlaps Claude/)
    expect(await readFile(configFile, 'utf8')).toBe(LEGACY_PM)
    expect(await readdir(claudeHome)).toEqual(['config.toml'])
  })

  it('blocks a Codex ccg junction into a custom Claude configuration', async () => {
    const { claudeHome, codexHome } = await fixture()
    await mkdir(codexHome, { recursive: true })
    await symlink(claudeHome, join(codexHome, 'ccg'), process.platform === 'win32' ? 'junction' : 'dir')
    expect(() => getConfigPath()).toThrow(/overlaps Claude/)
    expect(() => prepareCodexRouteArgs(['--workflow', 'test'])).toThrow(/overlaps Claude/)
    await expect(ensureCcgDir()).rejects.toThrow(/overlaps Claude/)
    expect(await readdir(claudeHome)).toEqual([])
  })

  it('passes the selected Codex config to the route engine and validates explicit config arguments', async () => {
    const { root, claudeHome } = await fixture()
    const args = ['--workflow', 'test', '--task', 'synthetic input']
    expect(prepareCodexRouteArgs(args)).toEqual([...args, '--config', getConfigPath()])
    const explicit = join(root, 'explicit-native-config.toml')
    expect(prepareCodexRouteArgs([...args, '--config', explicit])).toEqual([...args, '--config', explicit])
    expect(prepareCodexRouteArgs([...args, `--config=${explicit}`])).toEqual([...args, '--config', explicit])
    const upstream = join(claudeHome, 'config.toml')
    expect(() => prepareCodexRouteArgs([...args, '--config', upstream])).toThrow(/overlaps Claude/)
    expect(() => prepareCodexRouteArgs([...args, `--config=${upstream}`])).toThrow(/overlaps Claude/)
    expect(() => prepareCodexRouteArgs([...args, '--config'])).toThrow(/requires/)
  })

  it('refuses routing reads and changes through a Codex ccg junction into Claude', async () => {
    const { claudeHome, codexHome } = await fixture()
    const upstream = join(claudeHome, 'config.toml')
    await writeFile(upstream, LEGACY_PM)
    await mkdir(codexHome, { recursive: true })
    await symlink(claudeHome, join(codexHome, 'ccg'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(readCodexRoutingConfig()).rejects.toThrow(/overlaps Claude/)
    await expect(configRouting('get', 'product-manager', undefined, { json: true })).rejects.toThrow(/overlaps Claude/)
    await expect(configRouting('set', 'backend', 'gemini')).rejects.toThrow(/overlaps Claude/)
    await expect(configureProviderRouting('kimi', { role: 'backend', configPath: upstream })).rejects.toThrow(/overlaps Claude/)
    expect(await readFile(upstream, 'utf8')).toBe(LEGACY_PM)
  })

  it('queries legacy Codex routing without rewriting it, then persists an explicit native change', async () => {
    const { claudeHome, codexHome } = await fixture()
    const configFile = join(codexHome, 'ccg', 'config.toml')
    const upstream = join(claudeHome, 'config.toml')
    await mkdir(join(codexHome, 'ccg'), { recursive: true })
    await writeFile(configFile, LEGACY_PM)
    await writeFile(upstream, 'upstream config unchanged\r\n')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    expect((await readCodexRoutingConfig())['product-manager'].primary).toBe('gemini')
    await configRouting('get', 'product-manager', undefined, { json: true })
    await configRouting('list', undefined, undefined, { json: true })
    expect(await readFile(configFile, 'utf8')).toBe(LEGACY_PM)
    await configRouting('set', 'backend', 'gemini')
    expect((await readCodexRoutingConfig()).backend.primary).toBe('gemini')
    expect((await readCodexRoutingConfig())['product-manager'].primary).toBe('gemini')
    expect(await readFile(configFile, 'utf8')).not.toBe(LEGACY_PM)
    expect(await readFile(upstream, 'utf8')).toBe('upstream config unchanged\r\n')
  })
})

describe('Codex host boundary and lifecycle', () => {
  it('rejects both Claude roots and their ancestors while allowing an ordinary external home', async () => {
    const { root, userHome, claudeHome, codexHome } = await fixture()
    for (const path of [claudeHome, join(claudeHome, 'new', 'ccg'), userHome])
      expect(() => assertCodexHostPath(path, { userHome })).toThrow(/overlaps Claude/)
    expect(() => assertCodexHostPath(codexHome, { userHome })).not.toThrow()
    expect(() => assertCodexHostPath(join(root, '.claude-safe'), { userHome })).not.toThrow()
  })

  it('protects both the default Claude tree and a custom CLAUDE_CONFIG_DIR', async () => {
    const { root, userHome, claudeHome, codexHome } = await fixture()
    const customClaude = join(root, 'custom-claude-config')
    await mkdir(customClaude)
    vi.stubEnv('CLAUDE_CONFIG_DIR', customClaude)
    expect(() => assertCodexHostPath(join(claudeHome, 'ccg'), { userHome })).toThrow(/overlaps Claude/)
    expect(() => assertCodexHostPath(join(customClaude, 'new', 'config.toml'), { userHome })).toThrow(/overlaps Claude/)
    expect(() => resolveCodexHome(customClaude, userHome)).toThrow(/overlaps Claude/)
    expect(() => assertCodexHostPath(codexHome, { userHome })).not.toThrow()
  })

  it('recognizes the physical target of the default Claude junction, including missing descendants', async () => {
    const { root, userHome, claudeHome } = await fixture()
    await rm(claudeHome, { recursive: true })
    const physicalClaude = join(root, 'relocated-claude')
    await mkdir(physicalClaude)
    await symlink(physicalClaude, claudeHome, process.platform === 'win32' ? 'junction' : 'dir')
    expect(() => assertCodexHostPath(join(physicalClaude, 'missing', 'ccg'), { userHome })).toThrow(/overlaps Claude/)
    const codexAlias = join(root, 'codex-alias')
    await symlink(physicalClaude, codexAlias, process.platform === 'win32' ? 'junction' : 'dir')
    expect(() => assertCodexHostPath(join(codexAlias, 'missing', 'ccg'), { userHome })).toThrow(/overlaps Claude/)
  })

  it('preserves upstream Claude bytes when install, uninstall, and recovery target that host', async () => {
    const { claudeHome } = await fixture()
    const sentinel = 'upstream Claude plugin and user hooks\r\n'
    await writeFile(join(claudeHome, 'CLAUDE.md'), sentinel)
    expect(await installCodexModeAt({ codexHome: claudeHome, pythonCommand: 'python', wrapperBytes: Buffer.from('test wrapper') }))
      .toMatchObject({ success: false, message: expect.stringMatching(/overlaps Claude/) })
    expect((await uninstallCodexModeAt({ codexHome: claudeHome })).success).toBe(false)
    expect(await recoverCodexModeAt({ codexHome: claudeHome }))
      .toMatchObject({ success: false, message: expect.stringMatching(/overlaps Claude/) })
    expect(await readFile(join(claudeHome, 'CLAUDE.md'), 'utf8')).toBe(sentinel)
    expect(await readdir(claudeHome)).toEqual(['CLAUDE.md'])
  })

  it('installs repeatedly and uninstalls in an external Codex home without changing the neighboring Claude host', async () => {
    const { claudeHome, codexHome } = await fixture()
    const sentinel = '{"upstreamPlugin":true,"userModel":"unchanged"}\r\n'
    await writeFile(join(claudeHome, 'settings.json'), sentinel)
    for (let index = 0; index < 2; index++) {
      expect((await installCodexModeAt({ codexHome, pythonCommand: 'python', wrapperBytes: Buffer.from('test wrapper') })).success).toBe(true)
      expect(await readFile(join(claudeHome, 'settings.json'), 'utf8')).toBe(sentinel)
    }
    expect((await uninstallCodexModeAt({ codexHome })).success).toBe(true)
    expect(await readFile(join(claudeHome, 'settings.json'), 'utf8')).toBe(sentinel)
    expect(await readdir(claudeHome)).toEqual(['settings.json'])
    expect(await readdir(codexHome)).not.toContain('AGENTS.md')
    expect(await readdir(codexHome)).not.toContain('hooks.json')
  })
})
