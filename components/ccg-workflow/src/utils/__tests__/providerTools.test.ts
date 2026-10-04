import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import fs from 'fs-extra'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { doctorProviderTool, installProviderTool, PROVIDER_PACKAGES, providerNativePackage, providerToolEnvironment } from '../provider-tools'

const roots: string[] = []
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ccg-provider-test-'))
  roots.push(root)
  const npmCli = join(root, 'npm-cli.js')
  writeFileSync(npmCli, '// npm installation is simulated; local fixture startup uses real Node')
  const prefix = join(root, 'owned')
  const run = vi.fn((command: string, args: string[], options: any) => {
    if (args[1] !== 'install')
      return spawnSync(command, args, options)
    const stage = args[args.indexOf('--prefix') + 1]
    const pkg = join(stage, 'node_modules', '@moonshot-ai', 'kimi-code')
    mkdirSync(join(pkg, 'dist'), { recursive: true })
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@moonshot-ai/kimi-code', version: '2.1.1', repository: { url: 'git+https://github.com/MoonshotAI/kimi-code.git' }, bin: { kimi: 'dist/main.mjs' } }))
    writeFileSync(join(stage, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/@moonshot-ai/kimi-code': { version: '2.1.1', integrity: PROVIDER_PACKAGES.kimi.integrity, resolved: 'https://registry.npmjs.org/@moonshot-ai/kimi-code/-/kimi-code-2.1.1.tgz' } } }))
    writeFileSync(join(pkg, 'dist', 'main.mjs'), "import ws from 'ws'; import qrcode from 'qrcode'; console.log('fixture Kimi help', ws, qrcode)\n")
    for (const name of ['ws', 'qrcode']) {
      const dep = join(stage, 'node_modules', name)
      mkdirSync(dep, { recursive: true })
      writeFileSync(join(dep, 'package.json'), JSON.stringify({ name, main: 'index.cjs' }))
      writeFileSync(join(dep, 'index.cjs'), 'module.exports = true')
    }
    return { status: 0, stdout: '', stderr: '', error: undefined }
  }) as unknown as typeof spawnSync
  return { root, prefix, context: { npmCli, run, platform: 'linux' as const, arch: 'x64' } }
}

afterEach(async () => {
  for (const root of roots.splice(0))
    await fs.remove(root)
})

describe('optional provider private software installation', () => {
  it('installs only in a staged prefix with scripts disabled and regular dependencies available', async () => {
    const { prefix, context } = fixture()
    const result = await installProviderTool({ backend: 'kimi', prefix }, context)
    expect(result).toMatchObject({ ok: true, version: '2.1.1', authentication: 'not-checked' })
    const args = (context.run as any).mock.calls[0][1]
    expect(args).toContain('@moonshot-ai/kimi-code@2.1.1')
    expect(args).toContain('--ignore-scripts')
    expect(args).toContain('--omit=optional')
    expect(args).not.toContain('-g')
    expect(args[args.indexOf('--prefix') + 1]).not.toBe(prefix)
    expect(await fs.pathExists(join(prefix, 'kimi.cmd'))).toBe(true)
  })

  it('reuses a verified owned installation without another npm install', async () => {
    const { prefix, context } = fixture()
    await installProviderTool({ backend: 'kimi', prefix }, context)
    await installProviderTool({ backend: 'kimi', prefix }, context)
    expect((context.run as any).mock.calls.filter((call: any) => call[1][1] === 'install')).toHaveLength(1)
  })

  it('reports a missing installation without treating config or credentials as readiness', async () => {
    const { prefix, context } = fixture()
    const report = await doctorProviderTool({ backend: 'kimi', prefix }, context)
    expect(report.ok).toBe(false)
    expect(report.authentication).toBe('not-checked')
    expect(report.manualSetup).toContain('moonshotai')
    expect(context.run).not.toHaveBeenCalled()
  })

  it('rejects old Node before attempting npm', async () => {
    const { prefix, context } = fixture()
    await expect(installProviderTool({ backend: 'kimi', prefix }, { ...context, nodeVersion: '22.18.0' })).rejects.toThrow('Node >=22.19.0')
    expect(context.run).not.toHaveBeenCalled()
  })

  it('requires Windows Git Bash without starting WSL', async () => {
    const { prefix, context } = fixture()
    await expect(installProviderTool({ backend: 'kimi', prefix, shellPath: join(dirname(prefix), 'missing.exe') }, { ...context, platform: 'win32', env: { KIMI_SHELL_PATH: '', ProgramFiles: 'Z:\\missing' } })).rejects.toThrow('Git Bash')
    expect(context.run).not.toHaveBeenCalled()
  })

  it('refuses unrelated files and keeps their bytes', async () => {
    const { prefix, context } = fixture()
    await fs.outputFile(join(prefix, 'user.txt'), 'keep')
    await expect(installProviderTool({ backend: 'kimi', prefix }, context)).rejects.toThrow('refusing to overwrite')
    expect(await fs.readFile(join(prefix, 'user.txt'), 'utf8')).toBe('keep')
    expect(context.run).not.toHaveBeenCalled()
  })

  it('refuses user drift in a previously managed tree', async () => {
    const { prefix, context } = fixture()
    await installProviderTool({ backend: 'kimi', prefix }, context)
    await fs.writeFile(join(prefix, 'kimi.cmd'), 'user custom launcher')
    await expect(installProviderTool({ backend: 'kimi', prefix }, context)).rejects.toThrow('user changes')
    expect(await fs.readFile(join(prefix, 'kimi.cmd'), 'utf8')).toBe('user custom launcher')
  })

  it('rolls back a failed staged npm install and preserves an empty target', async () => {
    const { root, prefix, context } = fixture()
    await fs.mkdir(prefix)
    const failed = vi.fn(() => ({ status: 9, stdout: '', stderr: 'failure' })) as unknown as typeof spawnSync
    await expect(installProviderTool({ backend: 'kimi', prefix }, { ...context, run: failed })).rejects.toThrow('private npm installation failed')
    expect(await fs.readdir(prefix)).toEqual([])
    expect((await fs.readdir(root)).filter(name => name.startsWith('.ccg-'))).toEqual([])
  })

  it('reports missing regular Kimi dependencies before local startup', async () => {
    const { prefix, context } = fixture()
    const original = context.run
    context.run = vi.fn((command: string, args: string[], options: any) => {
      const result = original(command, args, options)
      if (args[1] === 'install')
        fs.removeSync(join(args[args.indexOf('--prefix') + 1], 'node_modules', 'qrcode'))
      return result
    }) as unknown as typeof spawnSync
    await expect(installProviderTool({ backend: 'kimi', prefix }, context)).rejects.toThrow('qrcode')
    expect(await fs.pathExists(prefix)).toBe(false)
  })

  it('rejects incorrect official package integrity before executing a local entry', async () => {
    const { prefix, context } = fixture()
    const original = context.run
    context.run = vi.fn((command: string, args: string[], options: any) => {
      const result = original(command, args, options)
      if (args[1] === 'install') {
        const path = join(args[args.indexOf('--prefix') + 1], 'package-lock.json')
        const lock = fs.readJSONSync(path)
        lock.packages['node_modules/@moonshot-ai/kimi-code'].integrity = 'sha512-invalid'
        fs.writeJSONSync(path, lock)
      }
      return result
    }) as unknown as typeof spawnSync
    await expect(installProviderTool({ backend: 'kimi', prefix }, context)).rejects.toThrow('fixed official integrity')
    expect((context.run as any).mock.calls).toHaveLength(1)
  })

  it('installs the explicit OpenCode native payload instead of executing its npm placeholder', async () => {
    const { prefix, context } = fixture()
    const native = 'opencode-windows-x64-baseline'
    context.platform = 'win32' as any
    context.run = vi.fn((_command: string, args: string[]) => {
      if (args[1] !== 'install')
        return { status: 0, stdout: '1.18.34\n', stderr: '' }
      const stage = args[args.indexOf('--prefix') + 1]
      const pkg = join(stage, 'node_modules', 'opencode-ai')
      const nativeDir = join(stage, 'node_modules', native)
      fs.ensureDirSync(join(pkg, 'bin'))
      fs.ensureDirSync(join(nativeDir, 'bin'))
      fs.writeJSONSync(join(pkg, 'package.json'), { name: 'opencode-ai', version: '1.18.34' })
      fs.writeFileSync(join(pkg, 'bin', 'opencode.exe'), 'npm placeholder')
      fs.writeJSONSync(join(nativeDir, 'package.json'), { name: native, version: '1.18.34' })
      fs.writeFileSync(join(nativeDir, 'bin', 'opencode.exe'), Buffer.alloc(65_536, 0x41))
      fs.writeJSONSync(join(stage, 'package-lock.json'), { packages: { 'node_modules/opencode-ai': { version: '1.18.34', integrity: PROVIDER_PACKAGES.opencode.integrity, resolved: 'https://registry.npmjs.org/opencode-ai/-/opencode-ai-1.18.34.tgz' } } })
      return { status: 0, stdout: '', stderr: '' }
    }) as unknown as typeof spawnSync
    const report = await installProviderTool({ backend: 'opencode', prefix }, context)
    expect(report.ok).toBe(true)
    expect(report.command).toContain(native)
    expect((context.run as any).mock.calls[0][1]).toContain(`${native}@1.18.34`)
    expect(await fs.readFile(join(prefix, 'bin', 'opencode.exe'))).toEqual(await fs.readFile(join(prefix, 'node_modules', native, 'bin', 'opencode.exe')))
    expect((context.run as any).mock.calls.slice(1).every((call: any) => call[1][0] === '--version')).toBe(true)
  })

  it('rejects relative paths and global roots', async () => {
    await expect(installProviderTool({ backend: 'kimi', prefix: 'relative' })).rejects.toThrow('absolute private')
    await expect(installProviderTool({ backend: 'kimi', prefix: dirname(process.execPath) })).rejects.toThrow('global and home roots')
  })

  it('selects fixed baseline native packages and makes libc selection explicit', () => {
    expect(providerNativePackage('win32', 'x64')).toBe('opencode-windows-x64-baseline')
    expect(providerNativePackage('linux', 'x64', { CCG_OPENCODE_LIBC: 'musl' })).toBe('opencode-linux-x64-baseline-musl')
    expect(providerNativePackage('darwin', 'arm64')).toBe('opencode-darwin-arm64')
    expect(() => providerNativePackage('win32', 'arm64')).toThrow('does not support')
    expect(() => providerNativePackage('linux', 'arm64', { CCG_OPENCODE_LIBC: 'guess' })).toThrow('glibc or musl')
  })

  it('binds only an explicit private provider prefix without removing unrelated environment', async () => {
    const { prefix, context } = fixture()
    await installProviderTool({ backend: 'kimi', prefix }, context)
    const env = providerToolEnvironment('kimi', prefix, { PATH: 'keep', KEEP: 'value' })
    expect(env.KEEP).toBe('value')
    expect(env.PATH).toContain('keep')
    expect(env.PATH).toContain(prefix)
    expect(env.CCG_KIMI_ENTRY).toBeUndefined()
  })
})
