import { resolve } from 'node:path'
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

  it('disables Codex tools and applies a Gemini deny-all policy', () => {
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
  })
})
