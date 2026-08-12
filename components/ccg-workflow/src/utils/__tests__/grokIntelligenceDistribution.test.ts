import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, describe, expect, it, vi } from 'vitest'
import fs from 'fs-extra'
import { getCoreCommandIds, installWorkflows } from '../installer'
// @ts-expect-error Runtime is intentionally shipped as dependency-free ESM.
import { defaultGitState, parseIntelligenceToml, runManualCommand } from '../../../templates/engine/tools/grok-intelligence/command.mjs'
// @ts-expect-error Runtime is intentionally shipped as dependency-free ESM.
import * as grokManage from '../../../templates/engine/tools/grok-intelligence/manage.mjs'
// @ts-expect-error Runtime is intentionally shipped as dependency-free ESM.
import { createGrokAcpClient } from '../../../templates/engine/tools/grok-intelligence/lib/acp-client.mjs'
// @ts-expect-error Runtime is intentionally shipped as dependency-free ESM.
import { createPrivateRunRoots } from '../../../templates/engine/tools/grok-intelligence/lib/private-temp.mjs'
// @ts-expect-error Runtime is intentionally shipped as dependency-free ESM.
import { resolveGrokExecutable } from '../../../templates/engine/tools/grok-intelligence/lib/process.mjs'
// @ts-expect-error Runtime is intentionally shipped as dependency-free ESM.
import { computeSourceId } from '../../../templates/engine/tools/grok-intelligence/lib/source-registry.mjs'

const { ensureDedicatedGrokHome, getDefaultGrokIntelligencePaths, resolveDoctorAuthentication } = grokManage

const ROOT = process.cwd()
const TEMPLATE_RUNTIME = join(ROOT, 'templates', 'engine', 'tools', 'grok-intelligence')
const PLUGIN_RUNTIME = join(ROOT, 'plugins', 'ccg', 'skills', 'ccg-grok-intel', 'scripts', 'grok-intelligence')

function collectFiles(root: string): string[] {
  if (!fs.existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name)
    return entry.isDirectory() ? collectFiles(path) : [path]
  })
}

describe('Grok intelligence distribution', () => {
  const installDir = join(tmpdir(), `ccg-grok-distribution-${Date.now()}`)

  afterAll(async () => fs.remove(installDir), 60_000)

  it('registers both manual commands as core workflows', () => {
    expect(getCoreCommandIds()).toEqual(expect.arrayContaining(['grok-intel', 'grok-verify']))
  })

  it('parses only the intelligence config and isolates the Windows credential home', () => {
    expect(parseIntelligenceToml('[general]\nversion="1"\n\n[intelligence]\nenabled = true\ntransport = "acp"\nmax_retries = 2\n'))
      .toMatchObject({ enabled: true, transport: 'acp', max_retries: 2 })
    expect(getDefaultGrokIntelligencePaths({
      platform: 'win32',
      env: { LOCALAPPDATA: 'C:\\PrivateData' },
      userHome: 'C:\\Users\\test',
    }).grokHome).toBe('C:\\PrivateData\\CCG\\grok-intelligence\\grok-home')
  })

  it('rejects invalid pinned runtime configuration instead of silently falling back', () => {
    expect(() => parseIntelligenceToml('[intelligence]\ntransport = "stdio"\n')).toThrow(/transport/i)
    expect(() => parseIntelligenceToml('[intelligence]\nauth_mode = "typo"\n')).toThrow(/auth_mode/i)
    expect(() => parseIntelligenceToml('[intelligence]\nallow_provider_fallback = true\n')).toThrow(/fallback/i)
    expect(() => parseIntelligenceToml('[intelligence]\ncleanup_credential_artifacts = false\n')).toThrow(/cleanup_credential_artifacts/i)
    expect(() => parseIntelligenceToml('[intelligence]\ndeep_research_enabled = true\ndeep_research_model = ""\n')).toThrow(/deep_research_model/i)
  })

  it('uses an explicit API key for headless doctor runs and preserves browser OAuth otherwise', () => {
    expect(resolveDoctorAuthentication({
      env: { XAI_API_KEY: 'xai-ci-secret' },
      loggedIn: false,
    })).toEqual({ authMode: 'api_key', apiKey: 'xai-ci-secret' })
    expect(resolveDoctorAuthentication({ env: {}, loggedIn: true }))
      .toEqual({ authMode: 'browser_oauth', apiKey: undefined })
    expect(() => resolveDoctorAuthentication({ env: {}, loggedIn: false }))
      .toThrow(/login|XAI_API_KEY/i)
  })

  it('resolves the default Windows Grok command to its native executable without a shell', () => {
    const dedicatedHome = 'C:\\PrivateData\\CCG\\grok-intelligence\\grok-home'
    const nativeExecutable = `${dedicatedHome}\\bin\\grok.exe`
    expect(resolveGrokExecutable('grok', {
      platform: 'win32',
      env: { GROK_HOME: dedicatedHome },
      pathExists: (path: string) => path === nativeExecutable,
    })).toBe(nativeExecutable)
    const userHome = 'C:\\Users\\Boss'
    const userExecutable = `${userHome}\\.grok\\bin\\grok.exe`
    expect(resolveGrokExecutable('grok', {
      platform: 'win32',
      env: {},
      userHome,
      pathExists: (path: string) => path === userExecutable,
    })).toBe(userExecutable)
    expect(resolveGrokExecutable('grok', {
      platform: 'win32',
      env: {},
      userHome,
      pathExists: () => false,
    })).toBe('grok')
    expect(resolveGrokExecutable(process.execPath, { platform: 'win32' })).toBe(process.execPath)
    expect(resolveGrokExecutable('grok', { platform: 'linux' })).toBe('grok')
  })

  it('ships strict command and skill surfaces without legacy MCP or unresolved variables', () => {
    const surfaces = [
      'templates/commands/grok-intel.md',
      'templates/commands/grok-verify.md',
      'plugins/ccg/commands/grok-intel.md',
      'plugins/ccg/commands/grok-verify.md',
      'plugins/ccg/skills/ccg-grok-intel/SKILL.md',
      'plugins/ccg/skills/ccg-grok-verify/SKILL.md',
    ]
    for (const surface of surfaces) {
      const content = readFileSync(join(ROOT, surface), 'utf8')
      expect(content, surface).not.toMatch(/mcp__grok[-_]search/i)
      expect(content, surface).not.toMatch(/\{\{[^}]+\}\}/)
    }
    const intel = readFileSync(join(ROOT, surfaces[0]), 'utf8')
    expect(intel).toMatch(/--mode/)
    expect(intel).toMatch(/--depth/)
    expect(intel).toMatch(/--force-refresh/)
    expect(intel).toMatch(/--export/)
    expect(intel).toMatch(/single-agent/i)
    const verify = readFileSync(join(ROOT, surfaces[1]), 'utf8')
    expect(verify).toMatch(/plan.*digest|digest.*plan/i)
    expect(verify).toMatch(/diff.*digest|digest.*diff/i)
    expect(verify).toMatch(/dependenc.*digest|digest.*dependenc/i)
    for (const code of [2, 3, 4]) {
      expect(`${intel}\n${verify}`).toContain(`exit ${code}`)
    }
  })

  it('keeps every shared runtime and fixture byte-identical', () => {
    const templateFiles = collectFiles(TEMPLATE_RUNTIME).map(path => relative(TEMPLATE_RUNTIME, path)).sort()
    const pluginFiles = collectFiles(PLUGIN_RUNTIME).map(path => relative(PLUGIN_RUNTIME, path)).sort()
    expect(pluginFiles).toEqual(templateFiles)
    for (const file of templateFiles)
      expect(readFileSync(join(PLUGIN_RUNTIME, file)), file).toEqual(readFileSync(join(TEMPLATE_RUNTIME, file)))
    expect(readFileSync(join(TEMPLATE_RUNTIME, 'command.mjs'), 'utf8'))
      .toContain("eventNormalizerVersion: '2'")
  })

  it('installs an executable Node runtime with both manual commands', async () => {
    const result = await installWorkflows(getCoreCommandIds(), installDir, true, {
      mcpProvider: 'skip',
      skipBinary: true,
    })
    expect(result.success).toBe(true)
    for (const command of ['grok-intel', 'grok-verify'])
      expect(statSync(join(installDir, 'commands', 'ccg', `${command}.md`)).isFile()).toBe(true)
    const manager = join(installDir, '.ccg', 'engine', 'tools', 'grok-intelligence', 'manage.mjs')
    expect(execFileSync(process.execPath, [manager, '--help'], { encoding: 'utf8' })).toContain('login')
  }, 20_000)

  it('binds verify inputs and persists canonical output through the shared runner', async () => {
    const root = join(tmpdir(), `ccg-grok-manual-${Date.now()}`)
    await fs.ensureDir(root)
    await fs.ensureDir(join(root, '.codex', 'ccg', 'plans'))
    await Promise.all([
      fs.writeFile(join(root, 'config.toml'), '[intelligence]\nenabled = true\nauth_mode = "browser_oauth"\nartifact_root = ".codex/ccg/intelligence"\n'),
      fs.writeFile(join(root, 'package.json'), '{}\n'),
      fs.writeFile(join(root, '.codex', 'ccg', 'plans', 'plan.md'), '# Plan\n'),
      fs.writeFile(join(root, 'change.diff'), '+current contract\n'),
      fs.writeFile(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n'),
    ])
    try {
      let runnerOptions: any
      const result = await runManualCommand('verify', {
        task: 'Verify current API support.',
        config: join(root, 'config.toml'),
        plan: '.codex/ccg/plans/plan.md',
        diff: 'change.diff',
        dependencies: ['pnpm-lock.yaml'],
        files: ['package.json'],
        officialDomains: ['docs.x.ai'],
      }, {
        repoRoot: root,
        paths: { grokHome: join(root, 'grok'), tempParent: join(root, 'runs') },
        runDiagnostics: async () => ({ version: 'grok 0.2.106', models: ['grok-4.5'] }),
        gitState: async () => ({ head: '0123456789abcdef', dirtyDigest: 'selected-files-digest' }),
        runner: async (options: any) => {
          runnerOptions = options
          return ({
            exitCode: 0,
            status: 'verified',
            evidence: {
              normalized: { searches: [
                { tool: 'web_search', status: 'completed' },
                { tool: 'x_search', status: 'completed' },
              ] },
              registry: { sources: [{ id: 'source-1', canonical_url: 'https://docs.x.ai/build/cli/reference' }] },
              claims: [{ id: 'verified', claim: 'Applicable CLI contract.', status: 'verified', source_ids: ['source-1'], applies_to: ['change.diff'] }],
              validation: { valid: true, package_status: 'valid', verification_outcome: 'verified', qualifying_claims: ['verified'], effective_x_policy: 'preferred' },
            },
            raw: { notifications: [] },
          })
        },
      })
      expect(result).toMatchObject({ exitCode: 0, status: 'verified', webSearches: 1, xSearches: 1 })
      expect(result.bindings.map((binding: any) => binding.kind)).toEqual(['plan', 'diff', 'dependency'])
      expect(await fs.pathExists(join(root, result.manifestPath))).toBe(true)
      expect(result.manifestSha256).toMatch(/^[a-f0-9]{64}$/)
      expect(runnerOptions.model).toBe('grok-4.5')
      expect(runnerOptions.allowedCcgPlanPaths).toEqual(['.codex/ccg/plans/plan.md'])
      expect(await fs.readJson(join(root, result.manifestPath))).toMatchObject({ model: 'grok-4.5' })
      expect((await fs.readJson(join(root, result.manifestPath))).prompt_sha256).toBe(
        createHash('sha256').update('ccg-grok-intelligence-prompt-v11-advisory-verification').digest('hex'),
      )
    }
    finally {
      await fs.remove(root)
    }
  })

  it('requires a non-empty verify diff unless empty-diff semantics are explicit', async () => {
    const root = join(tmpdir(), `ccg-grok-required-diff-${Date.now()}`)
    await fs.ensureDir(root)
    await Promise.all([
      fs.writeFile(join(root, 'config.toml'), '[intelligence]\nenabled = true\nauth_mode = "browser_oauth"\n'),
      fs.writeFile(join(root, 'package.json'), '{}\n'),
      fs.writeFile(join(root, 'empty.diff'), ''),
      fs.writeFile(join(root, 'change.diff'), '+change\n'),
    ])
    try {
      await expect(runManualCommand('verify', { task: 'Verify current API.', config: join(root, 'config.toml'), files: ['package.json'] }, { repoRoot: root }))
        .rejects
        .toThrow(/--diff/i)
      await expect(runManualCommand('verify', { task: 'Verify current API.', config: join(root, 'config.toml'), diff: 'empty.diff', files: ['package.json'] }, { repoRoot: root }))
        .rejects
        .toThrow(/empty diff/i)
      const runner = vi.fn(async () => ({
        exitCode: 0,
        status: 'received_unverified',
        evidence: {
          normalized: { searches: [] },
          registry: { sources: [], searches: [] },
          claims: [],
          validation: { valid: false, package_status: 'invalid', verification_outcome: 'unresolved', qualifying_claims: [] },
        },
        raw: { notifications: [] },
      }))
      const result = await runManualCommand('verify', {
        task: 'Verify current API.',
        config: join(root, 'config.toml'),
        diff: 'change.diff',
        files: ['package.json'],
      }, {
        repoRoot: root,
        paths: { grokHome: join(root, 'grok'), tempParent: join(root, 'runs') },
        runDiagnostics: async () => ({ version: 'grok 0.2.106', models: ['grok-4.5'] }),
        gitState: async () => ({ head: '0123456789abcdef', dirtyDigest: 'repo-digest' }),
        runner,
      })
      expect(result).toMatchObject({ exitCode: 0, status: 'received_unverified' })
      expect(runner).toHaveBeenCalledOnce()
    }
    finally {
      await fs.remove(root)
    }
  })

  it('persists an unresolved verify response as received but unverified', async () => {
    const root = join(tmpdir(), `ccg-grok-unresolved-verify-${Date.now()}`)
    await fs.ensureDir(root)
    await Promise.all([
      fs.writeFile(join(root, 'config.toml'), '[intelligence]\nenabled = true\nauth_mode = "browser_oauth"\nartifact_root = ".codex/ccg/intelligence"\n'),
      fs.writeFile(join(root, 'package.json'), '{}\n'),
      fs.writeFile(join(root, 'change.diff'), '+change\n'),
    ])
    try {
      const result = await runManualCommand('verify', {
        task: 'Verify the current API change.',
        config: join(root, 'config.toml'),
        diff: 'change.diff',
        files: ['package.json'],
        officialDomains: ['docs.x.ai'],
      }, {
        repoRoot: root,
        paths: { grokHome: join(root, 'grok'), tempParent: join(root, 'runs') },
        runDiagnostics: async () => ({ safe: true, version: 'grok 0.2.106', models: ['grok-4.5'] }),
        gitState: async () => ({ head: '0123456789abcdef', dirtyDigest: 'repo-digest' }),
        runner: async () => ({
          exitCode: 0,
          status: 'received_unverified',
          evidence: {
            normalized: { searches: [{ tool: 'web_search', status: 'completed' }] },
            registry: { sources: [] },
            claims: [{ id: 'unresolved', claim: 'No applicable fact.', status: 'unresolved', source_ids: [] }],
            validation: { valid: true, package_status: 'valid', verification_outcome: 'unresolved', qualifying_claims: [] },
          },
          raw: { notifications: [] },
        }),
      })
      expect(result).toMatchObject({
        exitCode: 0,
        status: 'received_unverified',
        package_status: 'valid',
        verification_outcome: 'unresolved',
      })
      expect(await fs.pathExists(join(root, '.codex', 'ccg', 'intelligence'))).toBe(true)
      expect((await fs.readdir(join(root, '.codex', 'ccg', 'intelligence'))).filter(name => !name.startsWith('.'))).toHaveLength(1)
    }
    finally {
      await fs.remove(root)
    }
  })

  it('hashes repository-wide tracked changes instead of only selected snapshot files', async () => {
    const root = join(tmpdir(), `ccg-grok-git-state-${Date.now()}`)
    await fs.ensureDir(join(root, 'src'))
    await fs.writeFile(join(root, 'package.json'), '{}\n')
    await fs.writeFile(join(root, 'src', 'feature.ts'), 'export const value = 1\n')
    execFileSync('git', ['init'], { cwd: root })
    execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root })
    execFileSync('git', ['config', 'user.name', 'CCG Test'], { cwd: root })
    execFileSync('git', ['add', 'package.json', 'src/feature.ts'], { cwd: root })
    execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root })
    try {
      const before = await defaultGitState(root, ['package.json'])
      await fs.writeFile(join(root, 'src', 'feature.ts'), 'export const value = 2\n')
      const after = await defaultGitState(root, ['package.json'])
      expect(after.head).toBe(before.head)
      expect(after.dirtyDigest).not.toBe(before.dirtyDigest)

      await fs.writeFile(join(root, 'src', 'untracked.ts'), 'export const draft = 1\n')
      const untrackedBefore = await defaultGitState(root, ['package.json'])
      await fs.writeFile(join(root, 'src', 'untracked.ts'), 'export const draft = 2\n')
      const untrackedAfter = await defaultGitState(root, ['package.json'])
      expect(untrackedAfter.dirtyDigest).not.toBe(untrackedBefore.dirtyDigest)
    }
    finally {
      await fs.remove(root)
    }
  }, 30_000)

  it('uses and fingerprints the configured deep research model', async () => {
    const root = join(tmpdir(), `ccg-grok-deep-model-${Date.now()}`)
    await fs.ensureDir(root)
    await Promise.all([
      fs.writeFile(join(root, 'config.toml'), '[intelligence]\nenabled = true\nauth_mode = "browser_oauth"\ndeep_research_enabled = true\ndefault_model = "grok-4.5"\ndeep_research_model = "grok-4.5-deep"\nartifact_root = ".codex/ccg/intelligence"\n'),
      fs.writeFile(join(root, 'package.json'), '{}\n'),
    ])
    let seen: any
    try {
      const result = await runManualCommand('intel', {
        task: 'Research the latest contract.',
        config: join(root, 'config.toml'),
        depth: 'deep',
        files: ['package.json'],
        officialDomains: ['vendor.example'],
      }, {
        repoRoot: root,
        paths: { grokHome: join(root, 'grok'), tempParent: join(root, 'runs') },
        runDiagnostics: async () => ({ safe: true, version: 'grok 0.2.106', models: ['grok-4.5', 'grok-4.5-deep'] }),
        gitState: async () => ({ head: '0123456789abcdef', dirtyDigest: 'repo-digest' }),
        runner: async (options: any) => {
          seen = options
          return {
            exitCode: 0,
            status: 'received_unverified',
            evidence: { normalized: { searches: [{ tool: 'web_search', status: 'completed' }] }, registry: { sources: [] }, claims: [{ id: 'u', claim: 'Unresolved', status: 'unresolved', source_ids: [] }] },
            raw: { notifications: [] },
          }
        },
      })
      expect(result).toMatchObject({ exitCode: 0, model: 'grok-4.5-deep' })
      expect(seen.model).toBe('grok-4.5-deep')
      expect(seen.officialDomains).toEqual(['vendor.example'])
      expect(await fs.readJson(join(root, result.manifestPath))).toMatchObject({ model: 'grok-4.5-deep' })
    }
    finally {
      await fs.remove(root)
    }
  })

  it('keeps verify action, incident investigation mode, and deep depth independent', async () => {
    const root = join(tmpdir(), `ccg-grok-verify-incident-deep-${Date.now()}`)
    await fs.ensureDir(root)
    await Promise.all([
      fs.writeFile(join(root, 'config.toml'), '[intelligence]\nenabled = true\nauth_mode = "browser_oauth"\nx_search_policy = "preferred"\ndeep_research_enabled = true\ndefault_model = "grok-4.5"\ndeep_research_model = "grok-4.5-deep"\nartifact_root = ".codex/ccg/intelligence"\n'),
      fs.writeFile(join(root, 'package.json'), '{}\n'),
      fs.writeFile(join(root, 'change.diff'), '+incident mitigation\n'),
    ])
    let seen: any
    try {
      const result = await runManualCommand('verify', {
        task: 'Verify the current incident mitigation.',
        config: join(root, 'config.toml'),
        mode: 'incident',
        depth: 'deep',
        diff: 'change.diff',
        files: ['package.json'],
        officialDomains: ['docs.x.ai'],
      }, {
        repoRoot: root,
        paths: { grokHome: join(root, 'grok'), tempParent: join(root, 'runs') },
        runDiagnostics: async () => ({ safe: true, version: 'grok 0.2.106', models: ['grok-4.5-deep'] }),
        gitState: async () => ({ head: '0123456789abcdef', dirtyDigest: 'repo-digest' }),
        runner: async (options: any) => {
          seen = options
          return {
            exitCode: 0,
            status: 'verified',
            evidence: {
              normalized: { searches: [{ tool: 'web_search', status: 'completed' }, { tool: 'x_search', status: 'completed' }] },
              registry: { sources: [{ id: 'source-1', canonical_url: 'https://docs.x.ai/build/cli/reference', source_tier: 'A' }] },
              claims: [{ id: 'verified', claim: 'Applicable mitigation.', status: 'verified', source_ids: ['source-1'], applies_to: ['change.diff'] }],
              validation: { valid: true, package_status: 'valid', verification_outcome: 'verified', qualifying_claims: ['verified'], effective_x_policy: 'preferred' },
            },
            raw: { notifications: [] },
          }
        },
      })
      expect(seen).toMatchObject({ action: 'verify', mode: 'incident', depth: 'deep', model: 'grok-4.5-deep' })
      expect(result).toMatchObject({
        exitCode: 0,
        action: 'verify',
        investigation_mode: 'incident',
        mode: 'incident',
        depth: 'deep',
        effective_x_policy: 'preferred',
        verification_outcome: 'verified',
      })
      expect(await fs.readJson(join(root, result.manifestPath))).toMatchObject({
        action: 'verify',
        investigation_mode: 'incident',
        depth: 'deep',
        requirement: 'required',
        effective_x_policy: 'preferred',
        cli_version: 'grok 0.2.106',
        model: 'grok-4.5-deep',
        prompt_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        git_head: '0123456789abcdef',
        dirty_digest: 'repo-digest',
        bindings: [expect.objectContaining({ kind: 'diff', path: 'change.diff', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) })],
        official_domains: ['docs.x.ai'],
        search_counts: { web: 1, x: 1 },
        attempts: 1,
        package_status: 'valid',
        validation_outcome: 'verified',
        verification_outcome: 'verified',
        cache_fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        cache_contract_versions: expect.objectContaining({ runnerVersion: '2', evidenceSchemaVersion: '2' }),
      })
    }
    finally {
      await fs.remove(root)
    }
  })

  it('reuses identical manual evidence while invalidating changed and force-refreshed requests', async () => {
    const root = join(tmpdir(), `ccg-grok-manual-cache-${Date.now()}`)
    const alias = `${root}-alias`
    await fs.ensureDir(root)
    await Promise.all([
      fs.writeFile(join(root, 'config.toml'), '[intelligence]\nenabled = true\nauth_mode = "browser_oauth"\ndefault_model = "grok-4.5"\nartifact_root = ".codex/ccg/intelligence"\n'),
      fs.writeFile(join(root, 'package.json'), '{}\n'),
      fs.writeFile(join(root, 'change.diff'), '+current contract\n'),
    ])
    await fs.symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const sourceUrl = 'https://docs.x.ai/build/cli/reference'
    const sourceId = computeSourceId('web_search', sourceUrl)
    const runner = vi.fn(async () => {
      await new Promise(resolvePromise => setTimeout(resolvePromise, 5))
      return {
        exitCode: 0,
        status: 'verified',
        evidence: {
          normalized: { searches: [{ tool: 'web_search', status: 'completed' }] },
          registry: { sources: [{ id: sourceId, tool: 'web_search', observed_tool: 'web_search', canonical_url: sourceUrl, source_tier: 'A', independence_key: 'x.ai' }] },
          claims: [{ id: 'verified', claim: 'Applicable contract.', status: 'verified', severity: 'info', source_ids: [sourceId], applies_to: ['change.diff'] }],
          validation: { valid: true, package_status: 'valid', verification_outcome: 'verified', qualifying_claims: ['verified'], effective_x_policy: 'preferred' },
        },
        raw: { notifications: [] },
      }
    })
    const runtime = {
      repoRoot: alias,
      paths: { grokHome: join(root, 'grok'), neutralHome: join(root, 'neutral'), tempParent: join(root, 'runs') },
      runner,
      runDiagnostics: async () => ({ safe: true, version: 'grok 0.2.106', models: ['grok-4.5'] }),
      gitState: async () => ({ head: '0123456789abcdef', dirtyDigest: 'selected-files-digest' }),
    }
    const options = {
      task: 'Verify current API support.',
      config: join(alias, 'config.toml'),
      diff: 'change.diff',
      files: ['package.json'],
      officialDomains: ['docs.x.ai'],
    }
    try {
      const first = await runManualCommand('verify', options, runtime)
      const second = await runManualCommand('verify', options, runtime)
      expect(runner).toHaveBeenCalledTimes(1)
      expect(first.cache).toMatchObject({ hit: false, reason: 'missing' })
      expect(second.cache).toMatchObject({ hit: true, reason: 'usable' })
      expect(second.manifestPath).toBe(first.manifestPath)
      expect(second.manifestSha256).toBe(first.manifestSha256)

      await fs.appendFile(join(root, first.manifestPath, '..', 'raw-stream.jsonl'), '{"tampered":true}\n')
      const repaired = await runManualCommand('verify', options, runtime)
      expect(runner).toHaveBeenCalledTimes(2)
      expect(repaired.cache).toMatchObject({ hit: false, reason: 'artifact_mismatch' })
      expect(repaired.manifestPath).not.toBe(first.manifestPath)

      await fs.writeFile(join(root, 'change.diff'), '+changed contract\n')
      const changed = await runManualCommand('verify', options, runtime)
      expect(runner).toHaveBeenCalledTimes(3)
      expect(changed.cache).toMatchObject({ hit: false })
      expect(changed.manifestPath).not.toBe(first.manifestPath)

      const refreshed = await runManualCommand('verify', { ...options, forceRefresh: true }, runtime)
      expect(runner).toHaveBeenCalledTimes(4)
      expect(refreshed.cache).toMatchObject({ hit: false, reason: 'force_refresh' })
      expect(refreshed.manifestPath).not.toBe(changed.manifestPath)
    }
    finally {
      await fs.remove(alias)
      await fs.remove(root)
    }
  })

  it('runs doctor diagnostics in a disposable credential-home copy', async () => {
    const root = join(tmpdir(), `ccg-grok-doctor-isolation-${Date.now()}`)
    const paths = {
      root,
      grokHome: join(root, 'grok-home'),
      neutralHome: join(root, 'neutral-home'),
      tempParent: join(root, 'runs'),
    }
    await ensureDedicatedGrokHome({
      paths,
      platform: 'linux',
      validateDirectory: async (path: string) => path,
    })
    await fs.ensureDir(join(paths.grokHome, 'logs'))
    const realLog = join(paths.grokHome, 'logs', 'unified.jsonl')
    await fs.writeFile(realLog, 'baseline\n')
    const runProcess = vi.fn(async (_command: string, args: string[], options: any) => {
      const isolatedLog = join(options.env.GROK_HOME, 'logs', 'unified.jsonl')
      await fs.ensureDir(join(options.env.GROK_HOME, 'logs'))
      await fs.appendFile(isolatedLog, '{"key_prefix":"must-not-persist"}\n')
      if (args.includes('--help'))
        return { stdout: 'agent models inspect', stderr: '', exitCode: 0 }
      if (args.includes('inspect'))
        return { stdout: '{"externalCompat":{"remoteSettingsLoaded":false,"cells":[]}}', stderr: '', exitCode: 0 }
      return { stdout: args.includes('version') ? 'grok 0.2.106' : args.includes('models') ? 'grok-4.5' : 'none configured', stderr: '', exitCode: 0 }
    })
    try {
      const isolate = (grokManage as any).runIsolatedGrokDiagnostics
      expect(isolate).toBeTypeOf('function')
      const result = await isolate({
        paths,
        authentication: { authMode: 'browser_oauth' },
        command: 'grok',
        sourceEnv: { PATH: process.env.PATH },
        runProcess,
        createRoots: (options: any) => createPrivateRunRoots({
          ...options,
          platform: 'linux',
          validateDirectory: async (path: string) => path,
        }),
      })
      expect(result.diagnostics).toMatchObject({ version: 'grok 0.2.106' })
      expect(runProcess).toHaveBeenCalledTimes(4)
      expect(runProcess.mock.calls.every(([, args]) => !args.includes('--no-auto-update'))).toBe(true)
      expect(await fs.readFile(realLog, 'utf8')).toBe('baseline\n')
      expect(await fs.readdir(paths.tempParent)).toEqual([])
    }
    finally {
      await fs.remove(root)
    }
  }, 60_000)

  it('routes local doctor help and inventory through isolated diagnostics', async () => {
    const root = join(tmpdir(), `ccg-grok-local-doctor-${Date.now()}`)
    const paths = {
      root,
      grokHome: join(root, 'grok-home'),
      neutralHome: join(root, 'neutral-home'),
      tempParent: join(root, 'runs'),
    }
    try {
      await ensureDedicatedGrokHome({
        paths,
        platform: 'linux',
        validateDirectory: async (path: string) => path,
      })
      await fs.writeFile(join(paths.grokHome, 'auth.json'), '{"cached":"token"}\n')
      await fs.ensureDir(join(paths.grokHome, 'logs'))
      const historicalLog = join(paths.grokHome, 'logs', 'unified.jsonl')
      await fs.writeFile(historicalLog, '{"key_prefix":"historical-prefix"}\n')
      let leaseHeld = false
      const leaseEvents: string[] = []
      const withCredentialLease = vi.fn(async (_grokHome: string, action: () => Promise<any>) => {
        expect(leaseHeld).toBe(false)
        leaseHeld = true
        leaseEvents.push('lease:start')
        try {
          return await action()
        }
        finally {
          leaseEvents.push('lease:end')
          leaseHeld = false
        }
      })
      const isolatedDiagnostics = vi.fn(async (options: any) => {
        expect(leaseHeld).toBe(true)
        expect(options.credentialLeaseHeld).toBe(true)
        return {
          help: { stdout: 'agent models inspect', stderr: '', exitCode: 0 },
          diagnostics: { version: 'grok 0.2.106', models: ['grok-4.5'] },
        }
      })
      const localDoctor = (grokManage as any).localDoctor
      const createPrivateRoots = vi.fn((options: any) => createPrivateRunRoots({
        ...options,
        platform: 'linux',
        validateDirectory: async (path: string) => path,
      }))
      const createAcpClient = vi.fn((options: any) => {
        const client = createGrokAcpClient({
          ...options,
          validatePrivateDirectory: async (path: string) => path,
        })
        return {
          run: async (runOptions: any) => {
            expect(leaseHeld).toBe(true)
            expect(runOptions.credentialLeaseHeld).toBe(true)
            return client.run(runOptions)
          },
        }
      })
      const clearCredentialState = vi.fn(async (grokHome: string) => {
        expect(leaseHeld).toBe(true)
        for (const name of ['sessions', 'logs', 'memtrace'])
          await fs.remove(join(grokHome, name))
        for (const name of ['active_sessions.json', 'active_sessions.lock', 'session_search.sqlite'])
          await fs.remove(join(grokHome, name))
      })
      expect(localDoctor).toBeTypeOf('function')
      expect((grokManage as any).LOCAL_DOCTOR_ACP_TIMEOUT_MS).toBe(120_000)
      expect((grokManage as any).LIVE_DOCTOR_ACP_TIMEOUT_MS).toBe(300_000)
      const result = await localDoctor({
        paths,
        projectRoot: root,
        command: process.execPath,
        prefixArgs: [join(ROOT, 'templates', 'engine', 'tools', 'grok-intelligence', 'fake-wrapper.mjs')],
        sourceEnv: { PATH: process.env.PATH },
        runIsolatedDiagnostics: isolatedDiagnostics,
        createPrivateRoots,
        createAcpClient,
        clearCredentialState,
        withCredentialLease,
      })
      expect(isolatedDiagnostics).toHaveBeenCalledTimes(1)
      expect(createPrivateRoots).toHaveBeenCalledTimes(1)
      expect(createAcpClient).toHaveBeenCalledTimes(1)
      expect(clearCredentialState).toHaveBeenCalledTimes(2)
      expect(withCredentialLease).toHaveBeenCalledTimes(1)
      expect(leaseEvents).toEqual(['lease:start', 'lease:end'])
      expect(result).toMatchObject({ ok: true, paidModelPromptSent: false, version: 'grok 0.2.106' })
      expect(await fs.pathExists(historicalLog)).toBe(false)
    }
    finally {
      await fs.remove(root)
    }
  }, 60_000)

  it('makes the paid live doctor a required verify flow with auditable model and claim semantics', async () => {
    const root = join(tmpdir(), `ccg-grok-live-doctor-${Date.now()}`)
    const paths = {
      root,
      grokHome: join(root, 'grok-home'),
      neutralHome: join(root, 'neutral-home'),
      tempParent: join(root, 'runs'),
    }
    await fs.ensureDir(root)
    let runnerOptions: any
    try {
      const result = await (grokManage as any).liveDoctor({
        paths,
        sourceEnv: { XAI_API_KEY: 'live-test-key' },
        secureDirectory: async (path: string) => {
          await fs.ensureDir(path)
          return path
        },
        runLocalDoctor: async () => ({ ok: true, status: { loggedIn: false } }),
        runner: async (options: any) => {
          runnerOptions = options
          return {
            exitCode: 0,
            status: 'verified',
            evidence: {
              normalized: { searches: [
                { tool: 'web_search', status: 'completed' },
                { tool: 'x_search', status: 'completed' },
              ] },
              claims: [{ id: 'claim-1', status: 'verified', applies_to: ['probe.txt'] }],
              validation: {
                package_status: 'valid',
                verification_outcome: 'verified',
                qualifying_claims: ['claim-1'],
              },
              model: { requested: 'grok-4.5', actual: 'grok-4.5' },
            },
          }
        },
      })
      expect(runnerOptions).toMatchObject({
        action: 'verify',
        mode: 'incident',
        depth: 'normal',
        requirement: 'required',
        officialDomains: ['x.ai'],
        officialXAccounts: ['xai'],
      })
      expect(result.live).toMatchObject({
        action: 'verify',
        investigationMode: 'incident',
        depth: 'normal',
        packageStatus: 'valid',
        verificationOutcome: 'verified',
        requestedModel: 'grok-4.5',
        actualModel: 'grok-4.5',
        claimCount: 1,
        qualifyingClaimCount: 1,
        webSearches: 1,
        xSearches: 1,
      })
    }
    finally {
      await fs.remove(root)
    }
  }, 20_000)
})
