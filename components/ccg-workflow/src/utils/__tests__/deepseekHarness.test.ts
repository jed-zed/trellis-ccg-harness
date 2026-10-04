import { execFile } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import fs from 'fs-extra'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DeepseekHarnessOptions } from '../deepseek-harness'
import {
  DEEPSEEK_PLUGIN_NAME,
  doctorDeepseekHarness,
  installDeepseekHarness,
  planDeepseekHarness,
  rollbackDeepseekHarness,
} from '../deepseek-harness'
import { PACKAGE_ROOT } from '../installer-template'

const execFileAsync = promisify(execFile)
let root: string
let options: DeepseekHarnessOptions
let manifest: string
let original: Buffer
let target: string

// Real subprocess, filesystem linking and Node module resolution; never a
// model/backend fixture. This emulates only DSH's package-manager CLI seam.
const FIXTURE_CLI = `
import fs from 'node:fs/promises'
import path from 'node:path'
const args = process.argv.slice(2)
if (args[0] === '--help') {
  console.log('DSH fixture: plugin --profile NAME install')
} else {
  if (args.join(' ') !== 'plugin --profile web install') throw new Error('wrong argv ' + JSON.stringify(args))
  if (!process.env.DSH_HOME || process.cwd() !== path.join(process.env.DSH_HOME, 'profiles', 'web')) throw new Error('wrong DSH_HOME/cwd')
  const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'))
  const name = 'ccg-deepseek-compat'
  const source = pkg.dependencies[name].slice(5)
  const dest = path.join(process.cwd(), 'node_modules', name)
  for (const file of ['package.json', 'src/index.js', 'src/core.js', 'README.md', 'route.json', 'cordis.patch.yml']) {
    await fs.mkdir(path.dirname(path.join(dest, file)), { recursive: true })
    await fs.copyFile(path.join(source, file), path.join(dest, file))
  }
  for (const peer of ['@deepseek-ai/schemastery', '@deepseek-ai/dsh-tool-subagent']) {
    const dir = path.join(process.cwd(), 'node_modules', peer)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: peer, version: peer.endsWith('schemastery') ? '3.18.1' : '0.1.0-rc.6', type: 'module', exports: './index.js' }))
    await fs.writeFile(path.join(dir, 'index.js'), peer.endsWith('schemastery')
      ? 'export default { object: value => value, string: () => ({}) }'
      : 'export const name = "fixture-official-tool-subagent"')
  }
}
`

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ccg-dsh-compat-'))
  options = {
    dshHome: join(root, 'dsh-home'),
    profile: 'web',
    prefix: join(root, 'isolated-prefix'),
    provider: 'existing-gateway',
    model: 'explicit-model',
    dshCli: join(root, 'dsh-fixture.mjs'),
  }
  manifest = join(options.dshHome, 'profiles', 'web', 'package.json')
  target = join(options.prefix, DEEPSEEK_PLUGIN_NAME, options.profile)
  original = Buffer.from('{"name":"existing-profile","dependencies":{"existing":"file:existing"},"dsh":{"profile":{"bundles":["existing"]}},"custom":{"preserved":true}}\n')
  await fs.ensureDir(join(options.dshHome, 'profiles', 'web'))
  await fs.writeFile(manifest, original)
  await fs.writeFile(options.dshCli!, FIXTURE_CLI)
  await fs.writeFile(join(options.dshHome, 'settings.yaml'), 'provider credentials stay here unchanged\n')
  await fs.ensureDir(join(options.dshHome, 'profiles', 'other'))
  await fs.writeFile(join(options.dshHome, 'profiles', 'other', 'package.json'), original)
})

afterEach(async () => {
  // Every fixture root is an absolute mkdtemp child of the OS temporary dir.
  if (root?.startsWith(join(tmpdir(), 'ccg-dsh-compat-'))) await fs.remove(root)
})

describe('explicit DeepSeek Harness profile installation', () => {
  it('plans and dry-runs without writes, dependency commands, credentials or profile creation', async () => {
    const run = async () => {
      throw new Error('must not execute')
    }
    const plan = await planDeepseekHarness({ ...options, run })
    expect(plan).toMatchObject({ success: true, state: 'planned', runtimeVerified: false, target })
    expect(await installDeepseekHarness({ ...options, dryRun: true, run })).toMatchObject({ state: 'planned' })
    expect(await fs.pathExists(options.prefix)).toBe(false)
    expect(await fs.readFile(manifest)).toEqual(original)
  })

  it('requires explicit single profile, absolute home/prefix and complete provider/model', async () => {
    for (const change of [{ profile: '' }, { profile: '../web' }, { profile: 'web;echo secret' }, { dshHome: 'relative' }, { prefix: 'relative' }, { provider: '' }, { model: '  ' }, { model: 'line\nsecret' }]) {
      expect(await planDeepseekHarness({ ...options, ...change })).toMatchObject({ success: false, state: 'error' })
    }
    expect(await planDeepseekHarness({ ...options, prefix: join(options.dshHome, 'profiles', 'plugin') })).toMatchObject({ state: 'error' })
    expect(await planDeepseekHarness({ ...options, prefix: join(options.dshHome, 'profiles', '..plugin') })).toMatchObject({ state: 'error' })
    expect(await fs.readFile(manifest)).toEqual(original)
  })

  it('fails on missing profile without creating or selecting any other profile', async () => {
    expect(await installDeepseekHarness({ ...options, profile: 'missing' })).toMatchObject({ success: false, state: 'error' })
    expect(await fs.pathExists(join(options.dshHome, 'profiles', 'missing'))).toBe(false)
    expect(await fs.readFile(manifest)).toEqual(original)
  })

  it('reports missing native launcher before staging or declaring the plugin', async () => {
    const installed = await installDeepseekHarness({ ...options, dshCli: join(root, 'missing-cli.mjs') })
    expect(installed).toMatchObject({ success: false, state: 'error' })
    expect(await fs.pathExists(target)).toBe(false)
    expect(await fs.readFile(manifest)).toEqual(original)
  })

  it('preserves a concurrent profile change and removes only this invocation\'s staging payload', async () => {
    const run = async () => {
      await fs.appendFile(manifest, ' ')
    }
    expect(await installDeepseekHarness({ ...options, run })).toMatchObject({ state: 'error', message: expect.stringContaining('profile changed while staging') })
    expect(await fs.readFile(manifest)).toEqual(Buffer.concat([original, Buffer.from(' ')]))
    expect(await fs.pathExists(target)).toBe(false)
    expect(await fs.readdir(join(options.prefix, DEEPSEEK_PLUGIN_NAME))).toEqual([])
  })

  it('rejects shell/batch launcher arguments instead of constructing shell text', async () => {
    const batch = join(root, 'dsh.cmd')
    await fs.writeFile(batch, '@echo secret')
    expect(await installDeepseekHarness({ ...options, dshCli: batch })).toMatchObject({ state: 'error', message: expect.stringContaining('Shell/batch') })
    expect(await fs.pathExists(target)).toBe(false)
  })

  it('installs and resolves a copied file dependency through a real Node subprocess', async () => {
    expect(await installDeepseekHarness(options)).toMatchObject({ success: true, state: 'ready', runtimeVerified: false })
    const pkg = await fs.readJson(manifest)
    expect(pkg.dependencies.existing).toBe('file:existing')
    expect(pkg.dependencies[DEEPSEEK_PLUGIN_NAME]).toBe(`file:${target.replaceAll('\\', '/')}`)
    expect(pkg.dsh.profile.bundles).toEqual(['existing', DEEPSEEK_PLUGIN_NAME])
    expect(pkg.custom).toEqual({ preserved: true })
    expect(await doctorDeepseekHarness(options)).toMatchObject({ state: 'ready', missingDependencies: [], runtimeVerified: false })
    expect(await fs.readFile(join(options.dshHome, 'profiles', 'other', 'package.json'))).toEqual(original)
    expect(await fs.readFile(join(options.dshHome, 'settings.yaml'), 'utf8')).toBe('provider credentials stay here unchanged\n')
    expect(await fs.pathExists(join(root, '.codex'))).toBe(false)
    expect(await fs.pathExists(join(root, '.trellis'))).toBe(false)
  })

  it('repeats idempotently and refuses an in-place route switch', async () => {
    expect((await installDeepseekHarness(options)).state).toBe('ready')
    const after = await fs.readFile(manifest)
    expect((await installDeepseekHarness(options)).state).toBe('ready')
    expect(await fs.readFile(manifest)).toEqual(after)
    expect(await installDeepseekHarness({ ...options, model: 'different-model' })).toMatchObject({ state: 'error', message: expect.stringContaining('requires rolling back') })
    expect(await planDeepseekHarness({ ...options, model: 'different-model' })).toMatchObject({ state: 'error' })
  })

  it('does not claim an existing declaration or unowned target', async () => {
    const pkg = await fs.readJson(manifest)
    pkg.dsh.profile.bundles.push(DEEPSEEK_PLUGIN_NAME)
    await fs.writeJson(manifest, pkg)
    expect(await planDeepseekHarness(options)).toMatchObject({ state: 'error' })
    expect(await installDeepseekHarness(options)).toMatchObject({ state: 'error' })
    expect(await fs.pathExists(target)).toBe(false)
    await fs.writeFile(manifest, original)
    await fs.ensureDir(target)
    await fs.writeFile(join(target, 'user.txt'), 'preserve')
    expect(await installDeepseekHarness(options)).toMatchObject({ state: 'error' })
    expect(await fs.readFile(join(target, 'user.txt'), 'utf8')).toBe('preserve')
  })

  it('reports linker failure as declared-but-unlinked and supports exact rollback', async () => {
    const run = async (_launcher: unknown, args: string[]) => {
      if (args[0] !== '--help') throw new Error('fixture package manager failed')
    }
    const installed = await installDeepseekHarness({ ...options, run })
    expect(installed).toMatchObject({ success: false, state: 'declared-but-unlinked', message: expect.stringContaining('fixture package manager failed') })
    expect(await doctorDeepseekHarness(options)).toMatchObject({ success: false, state: 'declared-but-unlinked', missingDependencies: expect.arrayContaining([DEEPSEEK_PLUGIN_NAME, '@deepseek-ai/dsh-tool-subagent']) })
    expect(await rollbackDeepseekHarness(options)).toMatchObject({ success: true, state: 'rolled-back' })
    expect(await fs.readFile(manifest)).toEqual(original)
    expect(await fs.pathExists(target)).toBe(false)
  })

  it('does not trust a successful linker return when modules are missing', async () => {
    const installed = await installDeepseekHarness({ ...options, run: async () => {} })
    expect(installed).toMatchObject({ success: false, state: 'declared-but-unlinked', missingDependencies: expect.arrayContaining([DEEPSEEK_PLUGIN_NAME]) })
  })

  it('diagnoses a linked payload from another version and a missing peer', async () => {
    expect((await installDeepseekHarness(options)).state).toBe('ready')
    const linked = join(options.dshHome, 'profiles', 'web', 'node_modules', DEEPSEEK_PLUGIN_NAME)
    await fs.writeFile(join(linked, 'src', 'core.js'), 'export const wrong = true')
    expect(await doctorDeepseekHarness(options)).toMatchObject({ state: 'declared-but-unlinked', missingDependencies: expect.arrayContaining([expect.stringContaining('linked payload differs')]) })
    await fs.copyFile(join(target, 'src', 'core.js'), join(linked, 'src', 'core.js'))
    await fs.remove(join(options.dshHome, 'profiles', 'web', 'node_modules', '@deepseek-ai', 'dsh-tool-subagent'))
    expect(await doctorDeepseekHarness(options)).toMatchObject({ state: 'declared-but-unlinked', missingDependencies: expect.arrayContaining(['@deepseek-ai/dsh-tool-subagent']) })
  })

  it('detects a broken transitive peer even when every top-level module resolves', async () => {
    expect((await installDeepseekHarness(options)).state).toBe('ready')
    const peer = join(options.dshHome, 'profiles', 'web', 'node_modules', '@deepseek-ai', 'dsh-tool-subagent', 'index.js')
    await fs.writeFile(peer, 'import "missing-transitive-peer"; export const name = "broken"')
    expect(await doctorDeepseekHarness(options)).toMatchObject({ state: 'declared-but-unlinked', missingDependencies: expect.arrayContaining([expect.stringContaining('module import failed')]) })
  })

  it('does not call an unverified ToolSubagent release compatible merely because it imports', async () => {
    expect((await installDeepseekHarness(options)).state).toBe('ready')
    const peer = join(options.dshHome, 'profiles', 'web', 'node_modules', '@deepseek-ai', 'dsh-tool-subagent', 'package.json')
    const pkg = await fs.readJson(peer)
    pkg.version = '0.2.0'
    await fs.writeJson(peer, pkg)
    expect(await doctorDeepseekHarness(options)).toMatchObject({ state: 'declared-but-unlinked', missingDependencies: expect.arrayContaining(['@deepseek-ai/dsh-tool-subagent: unsupported version 0.2.0']) })
  })

  it('restores exact original manifest bytes but preserves package-manager artifacts', async () => {
    expect((await installDeepseekHarness(options)).state).toBe('ready')
    const lock = join(options.dshHome, 'profiles', 'web', 'pnpm-lock.yaml')
    await fs.writeFile(lock, 'package manager owns this')
    expect(await rollbackDeepseekHarness({ ...options, dryRun: true })).toMatchObject({ state: 'planned' })
    expect(await fs.pathExists(target)).toBe(true)
    expect(await rollbackDeepseekHarness(options)).toMatchObject({ state: 'rolled-back' })
    expect(await fs.readFile(manifest)).toEqual(original)
    expect(await fs.readFile(lock, 'utf8')).toBe('package manager owns this')
    expect(await doctorDeepseekHarness(options)).toMatchObject({ state: 'not-installed' })
  })

  it.each(['profile', 'asset', 'additional-directory'])('preserves user changes to %s on install and rollback', async (change) => {
    expect((await installDeepseekHarness(options)).state).toBe('ready')
    if (change === 'profile') await fs.appendFile(manifest, ' ')
    if (change === 'asset') await fs.appendFile(join(target, 'src', 'core.js'), '\n// user change\n')
    if (change === 'additional-directory') await fs.mkdir(join(target, 'user-directory'))
    const bytes = await fs.readFile(manifest)
    expect(await installDeepseekHarness(options)).toMatchObject({ state: 'error', message: expect.stringContaining('User change detected') })
    expect(await rollbackDeepseekHarness(options)).toMatchObject({ state: 'error', message: expect.stringContaining('User change detected') })
    expect(await fs.readFile(manifest)).toEqual(bytes)
    expect(await fs.pathExists(target)).toBe(true)
  })

  it('refuses a linked prefix without touching its destination', async () => {
    const other = join(root, 'outside-prefix')
    await fs.ensureDir(other)
    await fs.symlink(other, options.prefix, process.platform === 'win32' ? 'junction' : 'dir')
    expect(await installDeepseekHarness(options)).toMatchObject({ state: 'error', message: expect.stringContaining('symbolic link or junction') })
    expect(await fs.readdir(other)).toEqual([])
  })
})

describe('minimal Harness plugin contract in a real Node module runtime', () => {
  it('loads the installed plugin with explicit route, one-shot lifecycle and no child tools', async () => {
    expect((await installDeepseekHarness(options)).state).toBe('ready')
    const plugin = pathToFileURL(join(options.dshHome, 'profiles', 'web', 'node_modules', DEEPSEEK_PLUGIN_NAME, 'src', 'index.js')).href
    const script = `
      const plugin = await import(${JSON.stringify(plugin)});
      let mounted;
      plugin.apply({ get: name => { if (name !== 'llm') throw new Error('unexpected service ' + name); return { listConfigurableProviders: () => [{provider:'existing-gateway'}] } }, plugin: (_record, config) => mounted = config }, { provider:'existing-gateway', model:'explicit-model' });
      console.log(JSON.stringify({ inject: plugin.inject, mounted }));
    `
    const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', script])
    expect(JSON.parse(stdout)).toMatchObject({ inject: ['tools', 'llm'], mounted: { provider: 'spawn', toolName: 'ccg_dsh_review', maxDepth: 1, backgroundMode: 'one-shot', enableRunInBackground: false, agentOptions: { provider: 'existing-gateway', model: 'explicit-model', maxTokens: 2048 }, toolFilter: { allow: [] } } })
    const source = await fs.readFile(join(target, 'src', 'core.js'), 'utf8')
    expect(source).not.toMatch(/storageDomain|startContinuable|systemPrompt|settings\.register|ccg_team|ccg_remember/)
  })

  it('fails closed before mounting for a missing provider/model or catalog API', async () => {
    const core = pathToFileURL(join(PACKAGE_ROOT, 'templates', 'deepseek-harness-compat', 'src', 'core.js')).href
    const script = `
      const { createCompatibilityPlugin } = await import(${JSON.stringify(core)});
      const plugin = createCompatibilityPlugin({ object: v => v, string: () => ({}) }, {});
      const failures = [];
      let mounts = 0;
      for (const [catalog, route] of [[undefined,{provider:'gw',model:'m'}],[{listConfigurableProviders:()=>[]},{provider:'gw',model:'m'}],[{listConfigurableProviders:()=>[{provider:'gw'}]},{provider:'gw'}],[{listConfigurableProviders:()=>[{provider:'gw'}]},{model:'m'}]]) {
        try { plugin.apply({get:()=>catalog,plugin:()=>mounts++},route); } catch (e) { failures.push(e.message); }
      }
      console.log(JSON.stringify({ failures, mounts }));
    `
    const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', script])
    const value = JSON.parse(stdout)
    expect(value.mounts).toBe(0)
    expect(value.failures).toHaveLength(4)
    expect(value.failures[0]).toContain('catalog API is unavailable')
    expect(value.failures[1]).toContain('provider route "gw" is not configured')
    expect(value.failures[2]).toContain('deployment-default fallback is disabled')
  })
})
