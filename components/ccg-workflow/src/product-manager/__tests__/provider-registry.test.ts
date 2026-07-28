import { describe, expect, it } from 'vitest'
import {
  resolveEffectiveProductManagerProvider,
  validateProviderExecution,
} from '../provider-registry'
import { createCodexProductManagerExecution } from '../providers/codex'
import { createGeminiProductManagerExecution } from '../providers/gemini'

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

  it('disables Codex tools and applies a Gemini deny-all policy', () => {
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
  })
})
