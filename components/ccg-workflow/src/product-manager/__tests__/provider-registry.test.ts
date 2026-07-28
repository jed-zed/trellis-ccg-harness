import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  resolveEffectiveProductManagerProvider,
  validateProviderExecution,
} from '../provider-registry'
import { createCodexProductManagerExecution } from '../providers/codex'
import { createClaudeProductManagerExecution } from '../providers/claude'
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
    expect(() => validateProviderExecution({
      executable: 'gemini.cmd',
      args: [],
      readOnly: true,
      shell: false,
    })).toThrow(/absolute/)
    expect(() => validateProviderExecution({
      executable: 'C:\\tools\\codex.exe',
      args: [],
      readOnly: false,
      shell: false,
    })).toThrow(/read-only/)
  })

  it('disables tools for Codex, Gemini, and Claude', () => {
    const codex = createCodexProductManagerExecution('C:\\tools\\codex.exe', {
      model: 'test',
      workspace: 'C:\\empty',
      schemaFile: 'C:\\empty\\schema.json',
    })
    expect(codex.args).toContain('shell_tool')
    expect(codex.args).toContain('multi_agent')
    expect(codex.args).toContain('--strict-config')

    const gemini = createGeminiProductManagerExecution('C:\\node\\node.exe', {
      entrypoint: 'C:\\node\\gemini.js',
      model: 'test',
      policyFile: 'C:\\empty\\deny-all.toml',
    })
    expect(gemini.args).toContain('--policy')
    expect(gemini.args).toContain('C:\\empty\\deny-all.toml')
    expect(gemini.args.join(' ')).toContain('from stdin')

    const claude = createClaudeProductManagerExecution('C:\\tools\\claude.exe', {
      model: 'opus',
      schema: PRODUCT_MANAGER_OUTPUT_JSON_SCHEMA,
    })
    expect(claude.args).toContain('--safe-mode')
    expect(claude.args).toContain('--disable-slash-commands')
    expect(claude.args.slice(claude.args.indexOf('--tools'), claude.args.indexOf('--tools') + 2)).toEqual(['--tools', ''])
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
    vi.stubEnv('CODEX_HOME', 'C:\\codex')
    vi.stubEnv('GEMINI_CLI_HOME', 'C:\\gemini')
    vi.stubEnv('CCG_UNRELATED_SECRET', 'do-not-pass')
    const codex = createCodexProductManagerExecution('C:\\tools\\codex.exe', {
      model: 'test',
      workspace: 'C:\\empty',
      schemaFile: 'C:\\empty\\schema.json',
    })
    const environment = buildProductManagerProviderEnvironment(codex)
    expect(environment.CODEX_HOME).toBe('C:\\codex')
    expect(environment.GEMINI_CLI_HOME).toBeUndefined()
    expect(environment.CCG_UNRELATED_SECRET).toBeUndefined()
  })
})
