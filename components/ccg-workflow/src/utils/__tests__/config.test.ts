import { describe, expect, it } from 'vitest'
import { createDefaultConfig, createDefaultRouting, normalizeIntelligenceConfig, normalizeProductManagerConfig, resolveCliIntelligenceFlag, resolveNonInteractiveIntelligenceConsent } from '../config'

describe('createDefaultRouting', () => {
  it('returns gemini as frontend primary', () => {
    const routing = createDefaultRouting()
    expect(routing.frontend.primary).toBe('gemini')
    expect(routing.frontend.models).toEqual(['gemini'])
  })

  it('returns codex as backend primary', () => {
    const routing = createDefaultRouting()
    expect(routing.backend.primary).toBe('codex')
    expect(routing.backend.models).toEqual(['codex'])
  })

  it('returns grok as search primary', () => {
    const routing = createDefaultRouting()
    expect(routing.search.primary).toBe('grok')
    expect(routing.search.models).toEqual(['grok'])
  })

  it('defaults to smart mode', () => {
    const routing = createDefaultRouting()
    expect(routing.mode).toBe('smart')
  })
})

describe('createDefaultConfig', () => {
  const baseOptions = {
    language: 'zh-CN' as const,
    routing: createDefaultRouting(),
    installedWorkflows: ['workflow', 'plan'],
  }

  it('sets version from package.json', () => {
    const config = createDefaultConfig(baseOptions)
    // version should be a semver string
    expect(config.general.version).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('sets language correctly', () => {
    const config = createDefaultConfig(baseOptions)
    expect(config.general.language).toBe('zh-CN')
  })

  it('sets createdAt as ISO string', () => {
    const config = createDefaultConfig(baseOptions)
    // Should parse without error
    expect(() => new Date(config.general.createdAt)).not.toThrow()
    expect(new Date(config.general.createdAt).toISOString()).toBe(config.general.createdAt)
  })

  it('stores installed workflows', () => {
    const config = createDefaultConfig(baseOptions)
    expect(config.workflows.installed).toEqual(['workflow', 'plan'])
  })

  it('defaults mcpProvider to fast-context', () => {
    const config = createDefaultConfig(baseOptions)
    expect(config.mcp.provider).toBe('fast-context')
  })

  it('respects custom mcpProvider', () => {
    const config = createDefaultConfig({ ...baseOptions, mcpProvider: 'contextweaver' })
    expect(config.mcp.provider).toBe('contextweaver')
  })

  it('defaults liteMode to false', () => {
    const config = createDefaultConfig(baseOptions)
    expect(config.performance?.liteMode).toBe(false)
  })

  it('respects liteMode = true', () => {
    const config = createDefaultConfig({ ...baseOptions, liteMode: true })
    expect(config.performance?.liteMode).toBe(true)
  })

  it('sets paths with home directory', () => {
    const config = createDefaultConfig(baseOptions)
    expect(config.paths.commands).toContain('.claude')
    expect(config.paths.prompts).toContain('.ccg')
    expect(config.paths.backup).toContain('.ccg')
  })

  it('preserves routing config exactly', () => {
    const routing = createDefaultRouting()
    const config = createDefaultConfig({ ...baseOptions, routing })
    expect(config.routing).toEqual(routing)
  })

  it('keeps external intelligence disabled without explicit consent', () => {
    const config = createDefaultConfig(baseOptions)

    expect(config.intelligence).toMatchObject({
      enabled: false,
      auto_route: false,
      provider: 'grok-cli',
      transport: 'acp',
      auth_mode: 'browser_oauth',
      legacy_search_provider: 'grok-search-mcp',
      allow_provider_fallback: false,
      live_checks_on_init: false,
    })
  })

  it('enables auto routing only after explicit consent', () => {
    const config = createDefaultConfig({ ...baseOptions, intelligenceConsent: true })

    expect(config.intelligence).toMatchObject({
      enabled: true,
      auto_route: true,
      transport: 'acp',
      auth_mode: 'browser_oauth',
    })
  })
})

describe('normalizeIntelligenceConfig', () => {
  it('defaults old and missing config to disabled', () => {
    expect(normalizeIntelligenceConfig(undefined, { existingInstall: true })).toMatchObject({
      enabled: false,
      auto_route: false,
      deep_research_enabled: false,
      live_checks_on_init: false,
      provider: 'grok-cli',
      transport: 'acp',
      auth_mode: 'browser_oauth',
      legacy_search_provider: 'grok-search-mcp',
      allow_provider_fallback: false,
      cleanup_credential_artifacts: true,
      require_web_search: true,
      x_search_policy: 'preferred',
    })
  })

  it('preserves an explicitly enabled existing install', () => {
    expect(normalizeIntelligenceConfig({
      enabled: true,
      auto_route: true,
      auth_mode: 'api_key',
      x_search_policy: 'disabled',
    }, { existingInstall: true })).toMatchObject({
      enabled: true,
      auto_route: true,
      auth_mode: 'api_key',
      x_search_policy: 'disabled',
    })
  })

  it('lets explicit opt-out override an enabled existing install', () => {
    expect(normalizeIntelligenceConfig({
      enabled: true,
      auto_route: true,
    }, { existingInstall: true, explicitConsent: false })).toMatchObject({
      enabled: false,
      auto_route: false,
    })
  })

  it('never enables auto routing while intelligence is disabled', () => {
    expect(normalizeIntelligenceConfig({
      enabled: false,
      auto_route: true,
    }, { existingInstall: true })).toMatchObject({
      enabled: false,
      auto_route: false,
    })
  })

  it('round-trips every supported intelligence field without silently resetting it', () => {
    expect(normalizeIntelligenceConfig({
      enabled: true,
      auto_route: true,
      provider: 'grok-cli',
      transport: 'acp',
      auth_mode: 'api_key',
      legacy_search_provider: 'grok-search-mcp',
      allow_provider_fallback: false,
      default_model: 'grok-4.5',
      deep_research_model: 'grok-4.5-deep',
      deep_research_enabled: true,
      live_checks_on_init: true as any,
      artifact_root: '.private/intelligence',
      max_retries: 1,
      max_bundle_bytes: 1024,
      retention_days: 3,
      exported_retention_days: 9,
      cleanup_credential_artifacts: true,
      require_web_search: false,
      x_search_policy: 'required',
    }, { existingInstall: true })).toMatchObject({
      deep_research_enabled: true,
      live_checks_on_init: true,
      artifact_root: '.private/intelligence',
      cleanup_credential_artifacts: true,
    })
  })

  it('rejects invalid pinned transports and out-of-range numeric policy', () => {
    expect(() => normalizeIntelligenceConfig({ provider: 'other' as any }, { existingInstall: true })).toThrow(/provider/i)
    expect(() => normalizeIntelligenceConfig({ transport: 'stdio' as any }, { existingInstall: true })).toThrow(/transport/i)
    expect(() => normalizeIntelligenceConfig({ max_retries: 99 }, { existingInstall: true })).toThrow(/max_retries/i)
    expect(() => normalizeIntelligenceConfig({ artifact_root: '../escape' }, { existingInstall: true })).toThrow(/artifact_root/i)
    expect(() => normalizeIntelligenceConfig({ cleanup_credential_artifacts: false }, { existingInstall: true })).toThrow(/cleanup_credential_artifacts/i)
  })
})

describe('resolveNonInteractiveIntelligenceConsent', () => {
  it('keeps --skip-prompt disabled for an old config without an explicit flag', () => {
    expect(resolveNonInteractiveIntelligenceConsent(undefined, undefined)).toBe(false)
  })

  it('only opts in through --intelligence and honors --no-intelligence', () => {
    expect(resolveNonInteractiveIntelligenceConsent(undefined, true)).toBe(true)
    expect(resolveNonInteractiveIntelligenceConsent({ enabled: true }, false)).toBe(false)
  })

  it('preserves an existing explicit opt-in when no flag is supplied', () => {
    expect(resolveNonInteractiveIntelligenceConsent({ enabled: true }, undefined)).toBe(true)
  })
})

describe('resolveCliIntelligenceFlag', () => {
  it('keeps an absent flag tri-state instead of inheriting CAC negation defaults', () => {
    expect(resolveCliIntelligenceFlag(['init', '--skip-prompt'])).toBeUndefined()
  })

  it('recognizes explicit opt-in and opt-out with the last flag winning', () => {
    expect(resolveCliIntelligenceFlag(['init', '--intelligence'])).toBe(true)
    expect(resolveCliIntelligenceFlag(['init', '--no-intelligence'])).toBe(false)
    expect(resolveCliIntelligenceFlag(['init', '--intelligence', '--no-intelligence'])).toBe(false)
  })
})

describe('product-manager configuration', () => {
  it('keeps existing installs disabled when the section is absent', () => {
    expect(normalizeProductManagerConfig(undefined, { existingInstall: true })).toEqual({
      enabled: false,
      provider: '',
      contract_version: '1',
      max_retries: 1,
      timeout_ms: 180000,
      max_output_bytes: 1048576,
    })
  })

  it('requires explicit consent for a fresh enabled selection', () => {
    expect(normalizeProductManagerConfig(
      { provider: 'codex' },
      { existingInstall: false, explicitConsent: true },
    ).enabled).toBe(true)
  })

  it('preserves unknown product-manager fields during migration', () => {
    expect(normalizeProductManagerConfig(
      {
        enabled: true,
        provider: 'codex',
        future_asset: { keep: true },
      } as any,
      { existingInstall: true },
    )).toMatchObject({
      enabled: true,
      provider: 'codex',
      future_asset: { keep: true },
    })
  })

  it('rejects unsupported providers and never selects Claude or Grok', () => {
    expect(() => normalizeProductManagerConfig(
      { enabled: true, provider: 'claude' as never },
      { existingInstall: true },
    )).toThrow(/provider/)
  })
})
