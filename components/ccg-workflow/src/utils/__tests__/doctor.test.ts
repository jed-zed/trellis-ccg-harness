import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import fs from 'fs-extra'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { version as packageVersion } from '../../../package.json'
import type { ModelRouting } from '../../types'
import {
  buildGrokDoctorArguments,
  collectRoutingModels,
  doctor,
  execFileSafe,
  formatGrokDoctorFailure,
  getGrokDoctorTimeout,
  providerCliCommand,
  routingStatusRows,
  validateIntelligenceDoctorConfig,
} from '../../commands/doctor'
import { isCodexNativeRequest } from '../../cli-setup'
import { installCodexModeAt, resolveCodexHome } from '../codex-mode'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

async function makeCodexFixture(): Promise<{ root: string, codexHome: string }> {
  const root = await mkdtemp(join(tmpdir(), 'ccg codex doctor '))
  const codexHome = join(root, 'custom codex home')
  const agentsBlock = '<!-- CCG:START v1 -->\nCodex-only instructions\n<!-- CCG:END -->'
  const hookGroup = {
    matcher: '*',
    hooks: [{ type: 'command', command: 'python fixture.py' }],
  }
  const wrapperName = process.platform === 'win32' ? 'codeagent-wrapper.exe' : 'codeagent-wrapper'
  const managedFiles = new Map([
    ['.ccg-version', packageVersion],
    ['agents/ccg-review.toml', 'name = "ccg-review"\n'],
    [`ccg/bin/${wrapperName}`, 'test wrapper\n'],
    ['ccg/config.toml', [
      '[routing.frontend]',
      'models = ["codex"]',
      'primary = "codex"',
      'strategy = "fallback"',
      '[routing.backend]',
      'models = ["codex"]',
      'primary = "codex"',
      'strategy = "fallback"',
      '[routing.search]',
      'models = ["codex"]',
      'primary = "codex"',
      'strategy = "fallback"',
      '[routing.product-manager]',
      'models = ["codex"]',
      'primary = "codex"',
      'strategy = "fallback"',
      '[intelligence]',
      'enabled = false',
      '',
    ].join('\n')],
    ['hooks/ccg-workflow.py', 'print("ok")\n'],
  ])
  roots.push(root)
  await fs.ensureDir(join(codexHome, '.ccg'))
  await fs.ensureDir(join(codexHome, 'agents'))
  await fs.ensureDir(join(codexHome, 'ccg'))
  await fs.ensureDir(join(codexHome, 'ccg', 'bin'))
  await fs.ensureDir(join(codexHome, 'hooks'))
  await writeFile(join(codexHome, 'AGENTS.md'), `${agentsBlock}\n`)
  await writeFile(
    join(codexHome, 'hooks.json'),
    `${JSON.stringify({ hooks: { UserPromptSubmit: [hookGroup] } }, null, 2)}\n`,
  )
  for (const [relativePath, content] of managedFiles)
    await writeFile(join(codexHome, relativePath), content)
  await writeFile(
    join(codexHome, '.ccg', 'ownership.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      version: packageVersion,
      installedAt: '2026-01-01T00:00:00.000Z',
      files: [...managedFiles].map(([relativePath, content]) => ({
        relativePath,
        installedSha256: sha256(content),
      })),
      agentsBlock: { sha256: sha256(agentsBlock) },
      hookGroup: {
        event: 'UserPromptSubmit',
        value: hookGroup,
        sha256: sha256(JSON.stringify(hookGroup)),
        fileCreated: true,
      },
    }, null, 2)}\n`,
  )
  return { root, codexHome }
}

async function selectCodexOnlyRouting(codexHome: string): Promise<void> {
  const configPath = join(codexHome, 'ccg', 'config.toml')
  let config = await fs.readFile(configPath, 'utf8')
  for (const role of ['frontend', 'backend', 'search', 'product-manager']) {
    config = config.replace(
      new RegExp(`(\\[routing\\.${role}\\][\\s\\S]*?models\\s*=\\s*)\\[[^\\]]+\\]([\\s\\S]*?primary\\s*=\\s*)"[^"]+"`),
      '$1["codex"]$2"codex"',
    )
  }
  await writeFile(configPath, config)
}

function runCli(home: string, args: string[], codexHome?: string) {
  const tsxImport = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href
  return spawnSync(
    process.execPath,
    ['--import', tsxImport, join(process.cwd(), 'src', 'cli.ts'), ...args],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        NO_COLOR: '1',
        ...(codexHome ? { CODEX_HOME: codexHome } : {}),
      },
      timeout: 30_000,
      windowsHide: true,
    },
  )
}

describe('doctor command helpers', () => {
  it('recognizes Codex-native requests before legacy config loading', () => {
    expect(isCodexNativeRequest(['codex-mode', 'install'])).toBe(true)
    expect(isCodexNativeRequest(['wrapper', '--backend', 'antigravity'])).toBe(true)
    expect(isCodexNativeRequest(['doctor', '--platform', 'codex'])).toBe(true)
    expect(isCodexNativeRequest(['doctor', '--platform=codex'])).toBe(true)
    expect(isCodexNativeRequest(['doctor'])).toBe(false)
    expect(isCodexNativeRequest(['doctor', '--platform', 'claude'])).toBe(false)
  })

  it('executes child commands from the ESM CLI', () => {
    expect(execFileSafe(process.execPath, ['--version'])).toBe(process.version)
  })

  it('keeps local and paid Grok doctor modes explicitly split', () => {
    expect(buildGrokDoctorArguments({ grok: true })).toEqual(['doctor', '--json'])
    expect(buildGrokDoctorArguments({ grokLive: true })).toEqual(['doctor', '--json', '--live'])
    expect(buildGrokDoctorArguments({ grok: true, grokCleanup: true })).toEqual(['doctor', '--json', '--cleanup'])
    expect(buildGrokDoctorArguments({ grok: true }, {
      artifact_root: '.private/intelligence',
      retention_days: 3,
      max_bundle_bytes: 4096,
    } as any)).toEqual([
      'doctor',
      '--json',
      '--artifact-root',
      '.private/intelligence',
      '--retention-days',
      '3',
      '--max-bundle-bytes',
      '4096',
    ])
  })

  it('does not require the Grok manager to report an empty MCP surface', async () => {
    const pluginDoctor = await fs.readFile(join(process.cwd(), 'plugins', 'ccg', 'scripts', 'doctor.ps1'), 'utf8')
    expect(pluginDoctor).toContain('if ($grokResult.ok)')
    expect(pluginDoctor).not.toContain('mcpServersEmpty')
    expect(pluginDoctor).not.toContain('mcpToolCount -eq 0')
  })

  it('includes all four role providers in health checks and status rows', () => {
    const routing: ModelRouting = {
      frontend: { primary: 'gemini', models: ['gemini'], strategy: 'fallback' },
      backend: { primary: 'codex', models: ['codex'], strategy: 'fallback' },
      search: { primary: 'grok', models: ['grok'], strategy: 'fallback' },
      'product-manager': { primary: 'claude', models: ['claude'], strategy: 'fallback' },
      mode: 'smart',
    }

    expect(collectRoutingModels(routing)).toEqual([
      'gemini',
      'gemini',
      'codex',
      'codex',
      'grok',
      'grok',
      'claude',
      'claude',
    ])
    expect(routingStatusRows(routing)).toEqual([
      { role: 'frontend', provider: 'gemini' },
      { role: 'backend', provider: 'codex' },
      { role: 'search', provider: 'grok' },
      { role: 'product-manager', provider: 'claude' },
    ])
  })

  it('maps only external wrapper providers to their executable names', () => {
    expect(providerCliCommand('codex')).toBeNull()
    expect(providerCliCommand('claude')).toBeNull()
    expect(providerCliCommand('gemini')).toBe('gemini')
    expect(providerCliCommand('antigravity')).toBe('agy')
    expect(providerCliCommand('grok')).toBe('grok')
    expect(providerCliCommand('pi')).toBe('pi')
  })

  it('allows enough time for model discovery plus the bounded ACP handshake', () => {
    expect(getGrokDoctorTimeout({ grok: true })).toBe(180_000)
    expect(getGrokDoctorTimeout({ grokLive: true })).toBe(600_000)
  })

  it('rejects provider fallback and incompatible intelligence config', () => {
    expect(validateIntelligenceDoctorConfig({
      provider: 'grok-cli',
      transport: 'acp',
      auth_mode: 'browser_oauth',
      legacy_search_provider: 'grok-search-mcp',
      allow_provider_fallback: false,
    })).toEqual([])
    expect(validateIntelligenceDoctorConfig({
      provider: 'other',
      transport: 'headless',
      auth_mode: 'cookie',
      legacy_search_provider: 'other',
      allow_provider_fallback: true,
    })).toHaveLength(5)
  })

  it('shows a bounded redacted Grok failure instead of a misleading login instruction', () => {
    const detail = formatGrokDoctorFailure('Required X evidence failed; token=xai-secret-value\n')
    expect(detail).toContain('Required X evidence failed')
    expect(detail).not.toContain('xai-secret-value')
    expect(detail.length).toBeLessThanOrEqual(400)
  })

  it('resolves CODEX_HOME explicitly and falls back to ~/.codex', () => {
    expect(resolveCodexHome(' C:\\custom\\codex ', 'C:\\users\\fixture')).toBe('C:\\custom\\codex')
    expect(resolveCodexHome('', 'C:\\users\\fixture')).toBe('C:/users/fixture/.codex')
  })
})

describe('Codex-only doctor', () => {
  it('accepts ownership generated by the real Codex mode installer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ccg installed codex doctor '))
    const codexHome = join(root, '.codex')
    roots.push(root)
    const installed = await installCodexModeAt({
      codexHome,
      pythonCommand: 'python',
      wrapperBytes: Buffer.from('test wrapper\n'),
    })
    await selectCodexOnlyRouting(codexHome)
    vi.stubEnv('CODEX_HOME', codexHome)
    vi.spyOn(console, 'log').mockImplementation(() => {})

    const result = await doctor({ platform: 'codex' })

    expect(installed.success, installed.message).toBe(true)
    expect(result.failures.map(failure => failure.label)).toEqual(['Codex wrapper'])
    expect(await fs.pathExists(join(root, '.claude'))).toBe(false)
  })

  it('accepts a complete Codex installation without a Claude home', async () => {
    const { root, codexHome } = await makeCodexFixture()
    vi.stubEnv('CODEX_HOME', codexHome)
    vi.spyOn(console, 'log').mockImplementation(() => {})

    const result = await doctor({ platform: 'codex' })

    expect(result.failures.map(failure => failure.label)).toEqual(['Codex wrapper'])
    expect(result.checks.map(check => check.label)).toEqual([
      'Node.js',
      'Codex AGENTS.md',
      'Codex version',
      'Codex ownership',
      'Codex wrapper',
      'Codex transaction',
      'CCG role routing',
      'Product manager route',
    ])
    expect(await fs.pathExists(join(root, '.claude'))).toBe(false)
  })

  it('rejects an owned wrapper that does not match the pinned binary', async () => {
    const { codexHome } = await makeCodexFixture()
    vi.stubEnv('CODEX_HOME', codexHome)
    vi.spyOn(console, 'log').mockImplementation(() => {})

    const result = await doctor({ platform: 'codex' })
    const wrapper = result.checks.find(check => check.label === 'Codex wrapper')

    expect(result.ok).toBe(false)
    expect(wrapper?.detail).toContain(`expected v`)
  })

  it('preserves invalid routing and recommends an exact routing set command', async () => {
    const { codexHome } = await makeCodexFixture()
    const configPath = join(codexHome, 'ccg', 'config.toml')
    const invalid = (await fs.readFile(configPath, 'utf8'))
      .replace('[routing.search]\nmodels = ["codex"]\nprimary = "codex"', '[routing.search]\nmodels = ["antigravity"]\nprimary = "antigravity"')
    await writeFile(configPath, invalid)
    vi.stubEnv('CODEX_HOME', codexHome)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    const result = await doctor({ platform: 'codex' })
    const output = log.mock.calls.flat().join('\n')

    expect(result.ok).toBe(false)
    expect(output).toContain('ccg routing set search grok')
    expect(output).not.toContain('ccg codex-mode install')
    expect(await fs.readFile(configPath, 'utf8')).toBe(invalid)
  })

  it('detects drift in files tracked by the Codex ownership manifest', async () => {
    const { codexHome } = await makeCodexFixture()
    await writeFile(join(codexHome, 'agents', 'ccg-review.toml'), 'name = "modified"\n')
    vi.stubEnv('CODEX_HOME', codexHome)
    vi.spyOn(console, 'log').mockImplementation(() => {})

    const result = await doctor({ platform: 'codex' })
    const ownership = result.checks.find(check => check.label === 'Codex ownership')

    expect(result.ok).toBe(false)
    expect(ownership?.detail).toContain('managed file digest mismatch: agents/ccg-review.toml')
  })

  it('accepts a valid user-selected Codex CCG config while preserving its ownership boundary', async () => {
    const { codexHome } = await makeCodexFixture()
    const configPath = join(codexHome, 'ccg', 'config.toml')
    const config = (await fs.readFile(configPath, 'utf8')).replace('enabled = false', 'enabled = true')
    await writeFile(
      configPath,
      `${config}${[
        '[product_manager]',
        'enabled = true',
        'provider = "codex"',
        'contract_version = "1"',
        '',
      ].join('\n')}`,
    )
    vi.stubEnv('CODEX_HOME', codexHome)
    vi.spyOn(console, 'log').mockImplementation(() => {})

    const result = await doctor({ platform: 'codex' })
    const ownership = result.checks.find(check => check.label === 'Codex ownership')

    expect(result.failures.map(failure => failure.label)).toEqual(['Codex wrapper'])
    expect(ownership?.detail).toContain('mutable CCG config differs from the installed template')
  })

  it('rejects malformed drift in the user-selectable Codex CCG config', async () => {
    const { codexHome } = await makeCodexFixture()
    await writeFile(join(codexHome, 'ccg', 'config.toml'), '[product_manager\nprovider = "gemini"\n')
    vi.stubEnv('CODEX_HOME', codexHome)
    vi.spyOn(console, 'log').mockImplementation(() => {})

    const result = await doctor({ platform: 'codex' })
    const ownership = result.checks.find(check => check.label === 'Codex ownership')

    expect(result.ok).toBe(false)
    expect(ownership?.detail).toContain('mutable CCG config is malformed')
  })

  it('rejects ownership paths that escape CODEX_HOME', async () => {
    const { root, codexHome } = await makeCodexFixture()
    const victim = 'outside codex home\n'
    await writeFile(join(root, 'victim.txt'), victim)
    const ownershipPath = join(codexHome, '.ccg', 'ownership.json')
    const ownershipManifest = await fs.readJSON(ownershipPath)
    ownershipManifest.files.push({
      relativePath: '../victim.txt',
      installedSha256: sha256(victim),
    })
    await writeFile(ownershipPath, `${JSON.stringify(ownershipManifest, null, 2)}\n`)
    vi.stubEnv('CODEX_HOME', codexHome)
    vi.spyOn(console, 'log').mockImplementation(() => {})

    const result = await doctor({ platform: 'codex' })
    const ownership = result.checks.find(check => check.label === 'Codex ownership')

    expect(result.ok).toBe(false)
    expect(ownership?.detail).toContain('unsafe path: ../victim.txt')
  })

  it('rejects ownership that does not satisfy the canonical lifecycle schema', async () => {
    const { codexHome } = await makeCodexFixture()
    const ownershipPath = join(codexHome, '.ccg', 'ownership.json')
    const ownershipManifest = await fs.readJSON(ownershipPath)
    delete ownershipManifest.installedAt
    await writeFile(ownershipPath, `${JSON.stringify(ownershipManifest, null, 2)}\n`)
    vi.stubEnv('CODEX_HOME', codexHome)
    vi.spyOn(console, 'log').mockImplementation(() => {})

    const result = await doctor({ platform: 'codex' })
    const ownership = result.checks.find(check => check.label === 'Codex ownership')

    expect(result.ok).toBe(false)
    expect(ownership?.detail).toContain('invalid schema')
  })

  it.skipIf(process.platform === 'win32')('rejects a symlinked ownership manifest', async () => {
    const { root, codexHome } = await makeCodexFixture()
    const ownershipPath = join(codexHome, '.ccg', 'ownership.json')
    const externalPath = join(root, 'external-ownership.json')
    await fs.move(ownershipPath, externalPath)
    await symlink(externalPath, ownershipPath)
    vi.stubEnv('CODEX_HOME', codexHome)
    vi.spyOn(console, 'log').mockImplementation(() => {})

    const result = await doctor({ platform: 'codex' })
    const ownership = result.checks.find(check => check.label === 'Codex ownership')

    expect(result.ok).toBe(false)
    expect(ownership?.detail).toContain('symbolic link')
  })

  it('fails stale versions and interrupted transactions with Codex repair guidance', async () => {
    const { codexHome } = await makeCodexFixture()
    await writeFile(join(codexHome, '.ccg-version'), '0.0.0')
    await writeFile(
      join(codexHome, '.ccg', 'transaction.json'),
      '{"schemaVersion":1,"operation":"install"}\n',
    )
    vi.stubEnv('CODEX_HOME', codexHome)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    const result = await doctor({ platform: 'codex' })
    const output = log.mock.calls.flat().join('\n')

    expect(result.ok).toBe(false)
    expect(result.failures.map(check => check.label)).toEqual([
      'Codex version',
      'Codex ownership',
      'Codex wrapper',
      'Codex transaction',
    ])
    expect(output).toContain('ccg codex-mode recover')
    expect(output).not.toContain('ccg init --force')
  })
})

describe('doctor CLI', () => {
  it('rejects unknown platforms without falling back to legacy checks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ccg invalid doctor platform '))
    roots.push(root)

    const result = runCli(root, ['doctor', '--platform', 'unknown'])

    expect(result.status).toBe(1)
    expect(result.stdout).toContain('Unsupported platform "unknown"')
    expect(result.stdout).toContain('--platform claude')
    expect(result.stdout).toContain('--platform codex')
    expect(result.stdout).not.toContain('CCG config')
    expect(result.stdout).not.toContain('ccg init --force')
    expect(await fs.pathExists(join(root, '.claude'))).toBe(false)
  })

  it('rejects an untrusted Codex wrapper without reading or creating ~/.claude', async () => {
    const { root, codexHome } = await makeCodexFixture()

    const result = runCli(root, ['doctor', '--platform', 'codex'], codexHome)

    expect(result.status, result.stderr).toBe(1)
    expect(result.stdout).toContain('CCG Doctor (Codex)')
    expect(result.stdout).toContain('Codex wrapper')
    expect(result.stdout).toContain('Pinned SHA-256 or version check failed')
    expect(result.stdout).not.toContain('.claude')
    expect(await fs.pathExists(join(root, '.claude'))).toBe(false)
  })

  it('falls back to ~/.codex when CODEX_HOME is unset before checking wrapper trust', async () => {
    const { root, codexHome } = await makeCodexFixture()
    await fs.copy(codexHome, join(root, '.codex'))

    const result = runCli(root, ['doctor', '--platform', 'codex'])

    expect(result.status, result.stderr).toBe(1)
    expect(result.stdout).toContain('Pinned SHA-256 or version check failed')
    expect(await fs.pathExists(join(root, '.claude'))).toBe(false)
  })

  it('returns non-zero for an interrupted Codex installation without legacy repair advice', async () => {
    const { root, codexHome } = await makeCodexFixture()
    await writeFile(
      join(codexHome, '.ccg', 'transaction.json'),
      '{"schemaVersion":1,"operation":"install"}\n',
    )

    const result = runCli(root, ['doctor', '--platform', 'codex'], codexHome)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain('ccg codex-mode recover')
    expect(result.stdout).not.toContain('ccg init --force')
    expect(await fs.pathExists(join(root, '.claude'))).toBe(false)
  })

  it('keeps bare doctor on the legacy Claude installation contract', () => {
    const root = join(tmpdir(), `ccg legacy doctor ${Date.now()}`)
    roots.push(root)

    const result = runCli(root, ['doctor'])

    expect(result.status).toBe(1)
    expect(result.stdout).toContain('CCG config')
    expect(result.stdout).toContain('Commands')
    expect(result.stdout).toContain('Hook registration')
    expect(result.stdout).not.toContain('CCG Doctor (Codex)')
  })

  it('uses the same custom CODEX_HOME for lifecycle repair and doctor', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ccg lifecycle codex home '))
    const codexHome = join(root, 'custom-codex')
    roots.push(root)

    const installed = await installCodexModeAt({
      codexHome,
      pythonCommand: 'python',
      wrapperBytes: Buffer.from('test wrapper\n'),
    })
    expect(installed.success, installed.message).toBe(true)
    await selectCodexOnlyRouting(codexHome)
    expect(await fs.pathExists(join(codexHome, '.ccg', 'ownership.json'))).toBe(true)
    expect(await fs.pathExists(join(root, '.codex'))).toBe(false)

    const checked = runCli(root, ['doctor', '--platform', 'codex'], codexHome)
    expect(checked.status, checked.stderr).toBe(1)
    expect(checked.stdout).toContain('Pinned SHA-256 or version check failed')
    expect(await fs.pathExists(join(root, '.claude'))).toBe(false)
  })
})
