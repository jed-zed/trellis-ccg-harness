import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  resolveEffectiveProductManagerProvider,
  validateProviderExecution,
} from '../provider-registry'
import { createCodexProductManagerExecution } from '../providers/codex'
import {
  createClaudeProductManagerExecution,
  createClaudeSshProductManagerExecution,
} from '../providers/claude'
import { createGeminiProductManagerExecution } from '../providers/gemini'
import { PRODUCT_MANAGER_OUTPUT_JSON_SCHEMA } from '../contracts'
import { buildProductManagerProviderEnvironment } from '../provider-runner'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('product-manager provider policy', () => {
  it('uses the intersection without fallback', () => {
    expect(resolveEffectiveProductManagerProvider({
      enabled: true,
      selected: 'gemini',
      implemented: ['codex', 'gemini'],
      allowed: ['codex'],
    })).toEqual({
      status: 'unavailable',
      reason: 'selected_provider_not_allowed',
      selected: 'gemini',
    })
  })

  it('requires an absolute trusted executable and read-only execution', () => {
    const trustedExecutable = resolve('fixtures', 'codex')
    expect(() => validateProviderExecution({
      executable: 'gemini.cmd',
      args: [],
      readOnly: true,
      shell: false,
    })).toThrow(/absolute/)
    expect(() => validateProviderExecution({
      executable: trustedExecutable,
      args: [],
      readOnly: false,
      shell: false,
    })).toThrow(/read-only/)
  })

  it('keeps providers read-only while allowing Claude workspace reads', () => {
    const workspace = resolve('fixtures', 'empty')
    const policyFile = resolve(workspace, 'deny-all.toml')
    const codex = createCodexProductManagerExecution(resolve('fixtures', 'codex'), {
      model: 'test',
      workspace,
      schemaFile: resolve(workspace, 'schema.json'),
    })
    expect(codex.args).toContain('shell_tool')
    expect(codex.args).toContain('multi_agent')
    expect(codex.args).toContain('--strict-config')

    const gemini = createGeminiProductManagerExecution(resolve('fixtures', 'node'), {
      entrypoint: resolve('fixtures', 'gemini.js'),
      model: 'test',
      policyFile,
    })
    expect(gemini.args).toContain('--policy')
    expect(gemini.args).toContain(policyFile)
    expect(gemini.args.join(' ')).toContain('from stdin')

    const claude = createClaudeProductManagerExecution(resolve('fixtures', 'claude'), {
      model: 'opus',
      schema: PRODUCT_MANAGER_OUTPUT_JSON_SCHEMA,
    })
    expect(claude.args).toContain('--safe-mode')
    expect(claude.args).toContain('--disable-slash-commands')
    expect(claude.args.slice(claude.args.indexOf('--tools'), claude.args.indexOf('--tools') + 2)).toEqual(['--tools', 'Read,Glob,Grep'])
    expect(claude.args).toContain('--strict-mcp-config')
    expect(claude.args.slice(
      claude.args.indexOf('--mcp-config'),
      claude.args.indexOf('--mcp-config') + 2,
    )).toEqual(['--mcp-config', '{"mcpServers":{}}'])
    expect(claude.args).toContain('--no-session-persistence')
    expect(claude.args).toContain('--json-schema')
    expect(claude.args.slice(
      claude.args.indexOf('--model'),
      claude.args.indexOf('--model') + 2,
    )).toEqual(['--model', 'opus'])
    expect(claude.args).not.toContain('--fallback-model')
  })

  it('passes only provider-specific configuration roots and never arbitrary secrets', () => {
    const codexHome = resolve('fixtures', 'codex-home')
    const geminiHome = resolve('fixtures', 'gemini-home')
    vi.stubEnv('CODEX_HOME', codexHome)
    vi.stubEnv('GEMINI_CLI_HOME', geminiHome)
    vi.stubEnv('CCG_UNRELATED_SECRET', 'do-not-pass')
    const workspace = resolve('fixtures', 'empty')
    const codex = createCodexProductManagerExecution(resolve('fixtures', 'codex'), {
      model: 'test',
      workspace,
      schemaFile: resolve(workspace, 'schema.json'),
    })
    const environment = buildProductManagerProviderEnvironment(codex)
    expect(environment.CODEX_HOME).toBe(codexHome)
    expect(environment.GEMINI_CLI_HOME).toBeUndefined()
    expect(environment.CCG_UNRELATED_SECRET).toBeUndefined()
  })

  it('keeps SSH details in the exact environment allowlist and out of argv', () => {
    vi.stubEnv('CCG_PRODUCT_MANAGER_CLAUDE_SSH_EXECUTABLE', resolve('fixtures', 'bridge.exe'))
    vi.stubEnv('CCG_PRODUCT_MANAGER_CLAUDE_SSH_HOST', 'review.example.test')
    vi.stubEnv('CCG_PRODUCT_MANAGER_CLAUDE_SSH_USER', 'reviewer')
    vi.stubEnv('CCG_PRODUCT_MANAGER_CLAUDE_SSH_PORT', '22')
    vi.stubEnv('CCG_PRODUCT_MANAGER_CLAUDE_SSH_IDENTITY_FILE', resolve('fixtures', 'identity'))
    vi.stubEnv('CCG_PRODUCT_MANAGER_CLAUDE_SSH_KNOWN_HOSTS_FILE', resolve('fixtures', 'known-hosts'))
    vi.stubEnv('CCG_PRODUCT_MANAGER_CLAUDE_SSH_REMOTE_EXECUTABLE', '/usr/local/bin/claude')
    vi.stubEnv('CCG_PRODUCT_MANAGER_CLAUDE_SSH_PASSWORD', 'must-not-pass')
    const execution = createClaudeSshProductManagerExecution(resolve('fixtures', 'bridge.exe'), {
      model: 'opus',
      schema: PRODUCT_MANAGER_OUTPUT_JSON_SCHEMA,
      snapshotRoot: resolve('fixtures', 'snapshot'),
      manifestFile: resolve('fixtures', 'manifest.json'),
      attemptId: 'attempt-1',
    })
    const environment = buildProductManagerProviderEnvironment(execution)
    expect(environment.CCG_PRODUCT_MANAGER_CLAUDE_SSH_HOST).toBe('review.example.test')
    expect(environment.CCG_PRODUCT_MANAGER_CLAUDE_SSH_REMOTE_EXECUTABLE).toBe('/usr/local/bin/claude')
    expect(environment.CCG_PRODUCT_MANAGER_CLAUDE_SSH_PASSWORD).toBeUndefined()
    const argv = execution.args.join(' ')
    expect(argv).not.toContain('review.example.test')
    expect(argv).not.toContain('reviewer')
    expect(argv).not.toContain('known-hosts')
  })
})
