import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
// @ts-expect-error Runtime template modules intentionally ship as plain ESM.
import { parseAcpJsonl, normalizeAcpEvents } from '../../../templates/engine/tools/grok-intelligence/lib/events.mjs'
// @ts-expect-error Runtime template modules intentionally ship as plain ESM.
import { bindClaims, bindClaimsFromObservedUrls, buildSourceRegistry, canonicalizeSourceUrl, createSynthesisInput, extractClaimsEnvelope } from '../../../templates/engine/tools/grok-intelligence/lib/source-registry.mjs'
// @ts-expect-error Runtime template modules intentionally ship as plain ESM.
import { assertValidEvidencePackage, resolveEffectiveXPolicy, validateEvidencePackage } from '../../../templates/engine/tools/grok-intelligence/lib/validator.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const fixtureRoot = join(repoRoot, 'templates', 'engine', 'tools', 'grok-intelligence', 'fixtures')
const retrievedAt = '2026-07-21T12:00:00.000Z'

async function readFixture(name: string) {
  return readFile(join(fixtureRoot, name), 'utf8')
}

function registryOptions() {
  return {
    retrievedAt,
    officialDomains: ['docs.x.ai', 'x.ai'],
    officialXAccounts: ['xai', 'grok'],
    domainTiers: {
      'github.com': 'B',
      'ai-sdk.dev': 'B',
      'example-a.test': 'B',
      'example-b.test': 'B',
    },
  }
}

describe('Grok ACP event normalization', () => {
  it('recognizes the probed WebSearch lifecycle and final turn', async () => {
    const messages = parseAcpJsonl(await readFixture('acp-web-success.jsonl'))
    const normalized = normalizeAcpEvents(messages, { requireComplete: true })

    expect(normalized.searches).toHaveLength(1)
    expect(normalized.searches[0]).toMatchObject({
      tool: 'web_search',
      status: 'completed',
      query: 'xAI Grok CLI official reference documentation',
    })
    expect(normalized.searches[0].sources).toHaveLength(9)
    expect(normalized.finalText).toContain('docs.x.ai/build/cli/reference')
    expect(normalized.turnCompleted).toMatchObject({ stop_reason: 'end_turn' })
    expect(normalized.unknownEvents).toEqual([])
  })

  it('classifies X-domain WebSearch but rejects a prose-only X URL', async () => {
    const normalized = normalizeAcpEvents(
      parseAcpJsonl(await readFixture('acp-x-empty-sources.jsonl')),
      { requireComplete: true },
    )
    expect(normalized.searches[0]).toMatchObject({ tool: 'x_search', sources: [] })
    expect(normalized.finalText).toContain('https://x.com/xai/status/')

    const registry = buildSourceRegistry(normalized, registryOptions())
    expect(registry.sources).toEqual([])
    expect(() => bindClaims([{ id: 'claim-x', url: 'https://x.com/xai/status/2004641808615932272' }], registry))
      .toThrow(/unobserved source|URL/i)
  })

  it('rejects malformed, truncated, and uncorrelated required streams', async () => {
    expect(() => parseAcpJsonl('{not-json\n')).toThrow(/line 1|malformed/i)

    const webMessages = parseAcpJsonl(await readFixture('acp-web-success.jsonl'))
    expect(() => normalizeAcpEvents(webMessages.slice(0, -1), { requireComplete: true }))
      .toThrow(/turn_completed|truncated/i)

    const uncorrelated = [{
      method: 'session/update',
      params: {
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'missing',
          status: 'completed',
          rawOutput: { action: { query: 'test', sources: [] } },
        },
      },
    }]
    expect(() => normalizeAcpEvents(uncorrelated, { requireComplete: false })).toThrow(/uncorrelated/i)
  })

  it('uses a correlated prompt response as completion when the optional xAI turn event is absent', async () => {
    const messages = parseAcpJsonl(await readFixture('acp-web-success.jsonl'))
      .filter((message: any) => message.params?.update?.sessionUpdate !== 'turn_completed')
    const normalized = normalizeAcpEvents(messages, { requireComplete: true, promptCompleted: true })
    expect(normalized.turnCompleted).toMatchObject({
      stop_reason: 'prompt_response',
      observed: false,
    })
    expect(normalized.searches).toHaveLength(1)
    expect(normalized.finalText).toContain('docs.x.ai/build/cli/reference')
  })

  it('preserves unknown events for diagnostics without treating them as evidence', () => {
    const normalized = normalizeAcpEvents([{ method: 'future/event', params: { value: 1 } }], {
      requireComplete: false,
    })
    expect(normalized.events).toEqual([])
    expect(normalized.unknownEvents).toEqual([{ method: 'future/event', params: { value: 1 } }])
  })

  it('correlates native XSearch as advisory-only evidence without inventing source URLs', () => {
    const normalized = normalizeAcpEvents([
      {
        method: 'session/update',
        params: {
          update: {
            sessionUpdate: 'tool_call',
            toolCallId: 'x-native-1',
            kind: 'search',
            status: 'in_progress',
            rawInput: { variant: 'XSearch', backend: true },
          },
        },
      },
      {
        method: 'session/update',
        params: {
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'x-native-1',
            status: 'completed',
            rawOutput: {
              call_id: 'xs-call-1',
              input: 'from:xai Grok Build CLI',
              name: 'x_keyword_search',
              id: 'x-native-1',
            },
          },
        },
      },
    ], { requireComplete: false })

    expect(normalized.searches).toEqual([expect.objectContaining({
      kind: 'search_advisory',
      tool: 'x_search',
      observed_tool: 'x_search',
      toolCallId: 'x-native-1',
      query: 'from:xai Grok Build CLI',
      status: 'completed',
      sources: [],
    })])
    const registry = buildSourceRegistry(normalized, registryOptions())
    expect(registry.sources).toEqual([])
    expect(registry.searches).toEqual([expect.objectContaining({
      tool: 'x_search',
      observed_tool: 'x_search',
      source_ids: [],
    })])
  })

  it('distinguishes a failed WebSearch update from a successful result', () => {
    const normalized = normalizeAcpEvents([
      {
        method: 'session/update',
        params: { update: { sessionUpdate: 'tool_call', toolCallId: 'failed', kind: 'search', rawInput: { variant: 'WebSearch', backend: true } } },
      },
      {
        method: 'session/update',
        params: { update: { sessionUpdate: 'tool_call_update', toolCallId: 'failed', status: 'failed', rawOutput: { error: 'rate limited' } } },
      },
    ], { requireComplete: false })
    expect(normalized.searches[0]).toMatchObject({
      kind: 'search_error',
      tool: 'web_search',
      status: 'failed',
      sources: [],
      error: 'rate limited',
    })
  })
})

describe('runtime source registry', () => {
  it('extracts one strict claim envelope and permits an explicit unresolved result', () => {
    expect(extractClaimsEnvelope('summary\nCCG_CLAIMS_JSON:{"schemaVersion":1,"claims":[{"id":"claim-1","claim":"Observed contract","status":"verified","urls":["https://docs.x.ai/reference"]}]}')).toEqual([
      expect.objectContaining({ id: 'claim-1', status: 'verified', urls: ['https://docs.x.ai/reference'] }),
    ])
    expect(extractClaimsEnvelope('CCG_CLAIMS_JSON:{"schemaVersion":1,"claims":[{"id":"claim-none","claim":"No applicable fact could be verified","status":"unresolved","urls":[]}]}')).toEqual([
      expect.objectContaining({ id: 'claim-none', status: 'unresolved', urls: [] }),
    ])
    expect(() => extractClaimsEnvelope('Evidence collected without a machine-readable claim.')).toThrow(/claim envelope/i)
    expect(() => extractClaimsEnvelope('CCG_CLAIMS_JSON:{"schemaVersion":1,"claims":[]}')).toThrow(/at least one claim/i)
  })

  it('creates deterministic IDs only from observed tool sources', async () => {
    const normalized = normalizeAcpEvents(
      parseAcpJsonl(await readFixture('acp-web-success.jsonl')),
      { requireComplete: true },
    )
    const registry = buildSourceRegistry(normalized, registryOptions())
    const reference = registry.sources.find((source: any) => source.canonical_url === 'https://docs.x.ai/build/cli/reference')

    expect(reference).toMatchObject({
      id: expect.stringMatching(/^src-[a-f0-9]{16}$/),
      tool: 'web_search',
      canonical_url: 'https://docs.x.ai/build/cli/reference',
      retrieved_at: retrievedAt,
      official: true,
      source_tier: 'A',
    })
    expect(buildSourceRegistry(normalized, registryOptions())).toEqual(registry)
  })

  it('canonicalizes equivalent URLs while preserving semantic query parameters', () => {
    expect(canonicalizeSourceUrl('HTTPS://Example.COM:443/path?b=2&utm_source=x&a=1#fragment'))
      .toBe('https://example.com/path?a=1&b=2')
    expect(canonicalizeSourceUrl('https://user:password@example.com/object?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=top-secret&safe=1'))
      .toBe('https://example.com/object')
    expect(canonicalizeSourceUrl('https://storage.example.com/blob?sv=2024-01-01&sig=sas-secret&sp=r'))
      .toBe('https://storage.example.com/blob')
    expect(canonicalizeSourceUrl('https://storage.googleapis.com/object?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Signature=google-secret'))
      .toBe('https://storage.googleapis.com/object')

    const registry = buildSourceRegistry({
      searches: [{
        tool: 'web_search',
        observed_tool: 'web_search',
        toolCallId: 'call-1',
        query: 'test',
        status: 'completed',
        sources: [
          { url: 'https://example.com/path?a=1&utm_campaign=one' },
          { url: 'https://EXAMPLE.com:443/path?a=1#two' },
        ],
      }],
    }, registryOptions())
    expect(registry.sources).toHaveLength(1)
    expect(registry.sources[0].canonical_url).toBe('https://example.com/path?a=1')
    expect(() => buildSourceRegistry({
      searches: [{
        tool: 'web_search',
        toolCallId: 'forged',
        query: 'forged',
        status: 'completed',
        sources: [{ url: 'https://invented.invalid' }],
      }],
    }, registryOptions())).toThrow(/built-in WebSearch/i)
  })

  it('marks official provenance unknown when no target domains were supplied', () => {
    const registry = buildSourceRegistry({
      searches: [{
        tool: 'web_search',
        observed_tool: 'web_search',
        toolCallId: 'unknown-official',
        query: 'target docs',
        status: 'completed',
        sources: [{ url: 'https://vendor.example/docs?token=secret' }],
      }],
    }, { retrievedAt, officialDomains: [], officialXAccounts: [], domainTiers: {} })
    expect(registry.sources[0]).toMatchObject({
      canonical_url: 'https://vendor.example/docs',
      observed_url: 'https://vendor.example/docs',
      official: false,
      official_status: 'official_unknown',
      source_tier: 'U',
    })
  })

  it('builds a URL-free synthesis input and only accepts registry IDs back', async () => {
    const normalized = normalizeAcpEvents(
      parseAcpJsonl(await readFixture('acp-web-success.jsonl')),
      { requireComplete: true },
    )
    const registry = buildSourceRegistry(normalized, registryOptions())
    const synthesisInput = createSynthesisInput(normalized, registry)
    expect(JSON.stringify(synthesisInput)).not.toMatch(/https?:\/\//i)
    const queryWithUrl = createSynthesisInput(normalized, {
      ...registry,
      searches: registry.searches.map((search: any) => ({ ...search, query: 'check https://secret.invalid/path' })),
    })
    expect(JSON.stringify(queryWithUrl)).not.toContain('https://secret.invalid')

    const sourceId = registry.sources[0].id
    const claims = bindClaims([{
      id: 'claim-1',
      claim: 'The source was observed by the runtime.',
      status: 'verified',
      source_ids: [sourceId],
    }], registry)
    expect(claims[0].source_ids).toEqual([sourceId])

    expect(() => bindClaims([{
      id: 'claim-bad',
      claim: 'Invented source https://invented.invalid',
      status: 'verified',
      source_ids: [sourceId],
    }], registry)).toThrow(/URL/i)
    expect(() => bindClaims([{
      id: 'claim-bad',
      claim: 'Model elevates policy',
      status: 'verified',
      source_ids: [sourceId],
      source_tier: 'A',
    }], registry)).toThrow(/source policy|source_tier/i)
    expect(() => bindClaims([{
      id: 'claim-bad',
      claim: 'Model claims local applicability',
      status: 'verified',
      source_ids: [sourceId],
      observed_applicability: true,
    }], registry)).toThrow(/runtime source policy|observed_applicability/i)
    expect(() => bindClaims([{
      id: 'claim-bad',
      claim: 'Unknown registry ID',
      status: 'verified',
      source_ids: ['src-0000000000000000'],
    }], registry)).toThrow(/unobserved source/i)
  })

  it('supports deterministic fallback binding only for observed URLs', () => {
    const registry = buildSourceRegistry({
      searches: [{
        tool: 'web_search',
        observed_tool: 'web_search',
        toolCallId: 'call-1',
        query: 'contract',
        status: 'completed',
        sources: [{ url: 'https://docs.x.ai/build/cli/reference' }],
      }],
    }, registryOptions())
    expect(bindClaimsFromObservedUrls([{
      id: 'claim-1',
      claim: 'Observed fallback',
      status: 'verified',
      urls: ['https://docs.x.ai/build/cli/reference#fragment'],
    }], registry)[0].source_ids).toEqual([registry.sources[0].id])
    const unboundDiagnostics: any[] = []
    expect(bindClaimsFromObservedUrls([{
      id: 'claim-bad',
      claim: 'Invented fallback',
      status: 'verified',
      urls: ['https://invented.invalid'],
    }], registry, { bindingDiagnostics: unboundDiagnostics })).toEqual([])
    expect(unboundDiagnostics).toEqual(expect.arrayContaining([{
      claim_id: 'claim-bad',
      dropped_claim_reason: 'verified_without_observed_source',
    }]))
    const bindingDiagnostics: any[] = []
    const mixedSources = bindClaimsFromObservedUrls([{
      id: 'claim-mixed-sources',
      claim: 'Only observed sources may confer evidence.',
      status: 'verified',
      urls: ['https://invented.invalid', 'https://docs.x.ai/build/cli/reference'],
    }], registry, { bindingDiagnostics })[0]
    expect(mixedSources.source_ids).toEqual([registry.sources[0].id])
    expect(bindingDiagnostics).toEqual([{
      claim_id: 'claim-mixed-sources',
      url_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    }])
    expect(bindClaimsFromObservedUrls([{
      id: 'claim-unresolved',
      claim: 'No applicable fact could be verified.',
      status: 'unresolved',
      urls: [],
    }], registry)[0]).toMatchObject({ status: 'unresolved', source_ids: [] })

    const repeatedObservedUrl = bindClaimsFromObservedUrls([{
      id: 'claim-repeated-observed-url',
      claim: 'The contract is documented at https://docs.x.ai/build/cli/reference.',
      status: 'verified',
      repo_impact: ['See https://docs.x.ai/build/cli/reference for the current contract.'],
      urls: ['https://docs.x.ai/build/cli/reference'],
    }], registry)[0]
    expect(JSON.stringify(repeatedObservedUrl)).not.toMatch(/https?:\/\//i)
    expect(repeatedObservedUrl.source_ids).toEqual([registry.sources[0].id])
    const unobservedTextUrl = bindClaimsFromObservedUrls([{
      id: 'claim-unobserved-text-url',
      claim: 'Invented prose source https://invented.invalid/path.',
      status: 'verified',
      urls: ['https://docs.x.ai/build/cli/reference'],
    }], registry)[0]
    expect(JSON.stringify(unobservedTextUrl)).not.toMatch(/https?:\/\//i)
    expect(unobservedTextUrl.source_ids).toEqual([registry.sources[0].id])

    const xOnlyRegistry = buildSourceRegistry({
      searches: [{
        tool: 'x_search',
        observed_tool: 'web_search',
        toolCallId: 'call-x',
        query: 'site:x.com/xai incident',
        status: 'completed',
        sources: [{ url: 'https://x.com/xai/status/1' }],
      }],
    }, registryOptions())
    const blockerDiagnostics: any[] = []
    const normalizedBlocker = bindClaimsFromObservedUrls([{
      id: 'x-only-blocker',
      claim: 'X radar found a potentially severe issue.',
      status: 'verified',
      severity: 'blocker',
      urls: ['https://x.com/xai/status/1'],
    }], xOnlyRegistry, { bindingDiagnostics: blockerDiagnostics })[0]
    expect(normalizedBlocker.severity).toBe('warning')
    expect(blockerDiagnostics).toContainEqual({
      claim_id: 'x-only-blocker',
      downgraded_severity_from: 'blocker',
      downgraded_severity_to: 'warning',
      reason: 'ineligible_runtime_blocker',
    })
  })
})

describe('deterministic evidence policy', () => {
  function makePolicyRegistry(sources: Array<{ url: string, tool?: string }>) {
    return buildSourceRegistry({
      searches: sources.map((source, index) => ({
        tool: source.tool || 'web_search',
        observed_tool: 'web_search',
        toolCallId: `call-${index}`,
        query: source.tool === 'x_search' ? 'site:x.com incident' : 'contract',
        status: 'completed',
        sources: [{ url: source.url }],
      })),
    }, registryOptions())
  }

  it('separates package validity from the verification outcome and requires applicable reputable evidence', () => {
    const reputableRegistry = makePolicyRegistry([{ url: 'https://docs.x.ai/build/cli/reference' }])
    const reputableClaim = bindClaims([{
      id: 'applicable-primary',
      claim: 'The current CLI contract applies to this integration.',
      status: 'verified',
      severity: 'info',
      source_ids: [reputableRegistry.sources[0].id],
      applies_to: ['templates/engine/tools/grok-intelligence'],
    }], reputableRegistry)
    expect(validateEvidencePackage({
      normalized: { searches: [{ tool: 'web_search', sources: [{}], status: 'completed' }] },
      registry: reputableRegistry,
      claims: reputableClaim,
      requireWebSearch: true,
      xSearchPolicy: 'disabled',
      mode: 'contract',
    })).toMatchObject({
      valid: true,
      package_status: 'valid',
      verification_outcome: 'verified',
      qualifying_claims: ['applicable-primary'],
    })

    const unresolved = validateEvidencePackage({
      normalized: { searches: [{ tool: 'web_search', sources: [{}], status: 'completed' }] },
      registry: reputableRegistry,
      claims: [{ id: 'unresolved', claim: 'No applicable fact.', status: 'unresolved', severity: 'info', source_ids: [] }],
      requireWebSearch: true,
      xSearchPolicy: 'disabled',
      mode: 'contract',
    })
    expect(unresolved).toMatchObject({
      valid: true,
      package_status: 'valid',
      verification_outcome: 'unresolved',
      qualifying_claims: [],
    })

    const lowTierRegistry = makePolicyRegistry([{ url: 'https://unknown.example.invalid/report' }])
    const lowTierClaim = bindClaims([{
      id: 'low-tier-only',
      claim: 'An untrusted source makes the claim.',
      status: 'verified',
      severity: 'info',
      source_ids: [lowTierRegistry.sources[0].id],
      applies_to: ['src/example.ts'],
    }], lowTierRegistry)
    expect(validateEvidencePackage({
      normalized: { searches: [{ tool: 'web_search', sources: [{}], status: 'completed' }] },
      registry: lowTierRegistry,
      claims: lowTierClaim,
      requireWebSearch: true,
      xSearchPolicy: 'disabled',
      mode: 'contract',
    })).toMatchObject({ package_status: 'valid', verification_outcome: 'unresolved', qualifying_claims: [] })

    const missingApplicability = bindClaims([{
      id: 'missing-applicability',
      claim: 'The source is reputable but applicability is unknown.',
      status: 'verified',
      severity: 'info',
      source_ids: [reputableRegistry.sources[0].id],
    }], reputableRegistry)
    expect(validateEvidencePackage({
      normalized: { searches: [{ tool: 'web_search', sources: [{}], status: 'completed' }] },
      registry: reputableRegistry,
      claims: missingApplicability,
      requireWebSearch: true,
      xSearchPolicy: 'disabled',
      mode: 'contract',
    })).toMatchObject({ package_status: 'valid', verification_outcome: 'unresolved', qualifying_claims: [] })

    const blankApplicability = [{
      id: 'blank-applicability',
      claim: 'Whitespace is not a concrete applicability scope.',
      status: 'verified',
      severity: 'info',
      source_ids: [reputableRegistry.sources[0].id],
      applies_to: ['  '],
    }]
    expect(validateEvidencePackage({
      normalized: { searches: [{ tool: 'web_search', sources: [{}], status: 'completed' }] },
      registry: reputableRegistry,
      claims: blankApplicability,
      requireWebSearch: true,
      xSearchPolicy: 'disabled',
      mode: 'contract',
    })).toMatchObject({ package_status: 'valid', verification_outcome: 'unresolved', qualifying_claims: [] })
  })

  it('allows blocker claims only with primary applicability or two independent reputable sources', () => {
    const primaryRegistry = makePolicyRegistry([{ url: 'https://docs.x.ai/build/cli/reference' }])
    const primaryClaim = bindClaims([{
      id: 'primary',
      claim: 'Authoritative and applicable.',
      status: 'verified',
      severity: 'blocker',
      source_ids: [primaryRegistry.sources[0].id],
    }], primaryRegistry, { observedApplicabilityByClaim: { primary: true } })
    expect(validateEvidencePackage({
      normalized: { searches: [{ tool: 'web_search', sources: [{}], status: 'completed' }] },
      registry: primaryRegistry,
      claims: primaryClaim,
      requireWebSearch: true,
      xSearchPolicy: 'disabled',
      mode: 'contract',
    })).toMatchObject({ valid: true })

    const reputableRegistry = makePolicyRegistry([
      { url: 'https://example-a.test/report' },
      { url: 'https://example-b.test/report' },
    ])
    const reputableClaim = bindClaims([{
      id: 'corroborated',
      claim: 'Independently corroborated.',
      status: 'verified',
      severity: 'blocker',
      source_ids: reputableRegistry.sources.map((source: any) => source.id),
    }], reputableRegistry)
    expect(assertValidEvidencePackage({
      normalized: { searches: [{ tool: 'web_search', sources: [{}, {}], status: 'completed' }] },
      registry: reputableRegistry,
      claims: reputableClaim,
      requireWebSearch: true,
      xSearchPolicy: 'disabled',
      mode: 'contract',
    }).valid).toBe(true)
  })

  it('never activates a blocker label on a non-verifying claim', () => {
    const registry = makePolicyRegistry([{ url: 'https://docs.x.ai/build/cli/reference' }])
    const claims = bindClaims([{
      id: 'unresolved-blocker-label',
      claim: 'A potentially severe issue could not be verified.',
      status: 'unresolved',
      severity: 'blocker',
      source_ids: [],
    }], registry)
    const validation = validateEvidencePackage({
      normalized: { searches: [] },
      registry,
      claims,
      requireWebSearch: false,
      xSearchPolicy: 'disabled',
      mode: 'incident',
      requireClaims: true,
    })
    expect(validation.package_status).toBe('valid')
    expect(validation.verification_outcome).toBe('unresolved')
    expect(validation.evaluated_claims[0].blocker).toMatchObject({
      eligible: false,
      reason: 'non-verifying claim cannot create a blocker',
    })
  })

  it('rejects a one-source Tier B blocker and every X-only blocker', () => {
    const oneSourceRegistry = makePolicyRegistry([{ url: 'https://example-a.test/report' }])
    const oneSourceClaim = bindClaims([{
      id: 'weak',
      claim: 'Only one reputable source.',
      status: 'verified',
      severity: 'blocker',
      source_ids: [oneSourceRegistry.sources[0].id],
    }], oneSourceRegistry)
    expect(validateEvidencePackage({
      normalized: { searches: [{ tool: 'web_search', sources: [{}], status: 'completed' }] },
      registry: oneSourceRegistry,
      claims: oneSourceClaim,
      requireWebSearch: true,
      xSearchPolicy: 'disabled',
      mode: 'contract',
    })).toMatchObject({ valid: false, errors: [expect.stringMatching(/blocker/i)] })

    const xRegistry = makePolicyRegistry([{ url: 'https://x.com/xai/status/1', tool: 'x_search' }])
    const xClaim = bindClaims([{
      id: 'x-only',
      claim: 'X alone cannot block.',
      status: 'verified',
      severity: 'blocker',
      source_ids: [xRegistry.sources[0].id],
    }], xRegistry)
    expect(validateEvidencePackage({
      normalized: { searches: [{ tool: 'x_search', sources: [{}], status: 'completed' }] },
      registry: xRegistry,
      claims: xClaim,
      requireWebSearch: false,
      xSearchPolicy: 'preferred',
      mode: 'landscape',
    })).toMatchObject({ valid: false, errors: [expect.stringMatching(/X-only/i)] })
  })

  it('elevates preferred X only for incidents and never elevates disabled', () => {
    expect(resolveEffectiveXPolicy('preferred', 'incident')).toBe('required')
    expect(resolveEffectiveXPolicy('preferred', 'landscape')).toBe('preferred')
    expect(resolveEffectiveXPolicy('disabled', 'incident')).toBe('disabled')
  })

  it('fails required Web/X gates when the runtime registry has no source-backed event', async () => {
    const xNormalized = normalizeAcpEvents(
      parseAcpJsonl(await readFixture('acp-x-empty-sources.jsonl')),
      { requireComplete: true },
    )
    const xRegistry = buildSourceRegistry(xNormalized, registryOptions())
    expect(validateEvidencePackage({
      normalized: xNormalized,
      registry: xRegistry,
      claims: [],
      requireWebSearch: false,
      xSearchPolicy: 'preferred',
      mode: 'incident',
    })).toMatchObject({ valid: false, errors: [expect.stringMatching(/required X/i)] })

    expect(validateEvidencePackage({
      normalized: { searches: [], turnCompleted: {} },
      registry: { sources: [], searches: [] },
      claims: [],
      requireWebSearch: true,
      xSearchPolicy: 'disabled',
      mode: 'contract',
    })).toMatchObject({ valid: false, errors: [expect.stringMatching(/required Web/i)] })
  })

  it('rejects a registry whose runtime-derived source ID was tampered', () => {
    const registry = makePolicyRegistry([{ url: 'https://docs.x.ai/build/cli/reference' }])
    const tampered = JSON.parse(JSON.stringify(registry))
    tampered.sources[0].id = 'src-0000000000000000'
    expect(validateEvidencePackage({
      normalized: { searches: [{ tool: 'web_search', sources: [{}], status: 'completed' }] },
      registry: tampered,
      claims: [],
      requireWebSearch: true,
      xSearchPolicy: 'disabled',
      mode: 'contract',
    })).toMatchObject({ valid: false, errors: [expect.stringMatching(/runtime-derived ID/i)] })
  })
})
