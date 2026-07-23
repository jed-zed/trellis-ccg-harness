import { createHash } from 'node:crypto'
import {
  CLAIM_STATUSES,
  SOURCE_REGISTRY_SCHEMA_VERSION,
  SOURCE_TIERS,
  cloneJson,
  containsUrl,
  isPlainObject,
  requireIsoTimestamp,
  requireNonEmptyString,
} from './contracts.mjs'

const TRACKING_PARAMETERS = new Set([
  'fbclid',
  'gclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  'msclkid',
])
const SENSITIVE_QUERY_PARAMETERS = new Set([
  'access_token', 'api_key', 'apikey', 'auth', 'authorization', 'code', 'credential',
  'id_token', 'key', 'password', 'passwd', 'refresh_token', 'secret', 'sig', 'signature',
  'token',
  // Azure SAS fields: a signed URL is a credential, so the complete query is removed.
  'se', 'skoid', 'sks', 'skt', 'sktid', 'skv', 'sp', 'spr', 'st', 'sv',
])

const CLAIM_ENVELOPE_MARKER = 'CCG_CLAIMS_JSON:'
const CLAIM_ENVELOPE_KEYS = new Set(['schemaVersion', 'claims'])
const FALLBACK_CLAIM_KEYS = new Set([
  'id', 'claim', 'status', 'severity', 'urls', 'applies_to', 'repo_impact',
  'required_action', 'published_at', 'effective_at', 'notes',
])

const CLAIM_KEYS = new Set([
  'id',
  'claim',
  'status',
  'severity',
  'source_ids',
  'applies_to',
  'repo_impact',
  'required_action',
  'published_at',
  'effective_at',
  'notes',
])

const FORBIDDEN_MODEL_POLICY_KEYS = new Set([
  'source_tier',
  'source_tiers',
  'official',
  'retrieved_at',
  'retrievedAt',
  'blocker_eligible',
  'blockerEligible',
  'cross_verified',
  'observed_applicability',
])

export function canonicalizeSourceUrl(input) {
  const raw = requireNonEmptyString(input, 'source URL')
  let url
  try {
    url = new URL(raw)
  }
  catch {
    throw new Error(`Invalid source URL: ${raw}`)
  }
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error(`Source URL must use HTTP or HTTPS: ${raw}`)
  url.username = ''
  url.password = ''
  url.hash = ''
  const parameterNames = [...url.searchParams.keys()]
  const containsSignedCredential = parameterNames.some((name) => {
    const normalized = name.toLowerCase()
    return SENSITIVE_QUERY_PARAMETERS.has(normalized)
      || normalized.startsWith('x-amz-')
      || normalized.startsWith('x-goog-')
  })
  if (containsSignedCredential)
    url.search = ''
  for (const name of parameterNames) {
    const normalized = name.toLowerCase()
    if (normalized.startsWith('utm_') || TRACKING_PARAMETERS.has(normalized))
      url.searchParams.delete(name)
  }
  url.searchParams.sort()
  return url.toString()
}

export function extractClaimsEnvelope(finalText) {
  const text = requireNonEmptyString(finalText, 'finalText')
  const markerIndex = text.lastIndexOf(CLAIM_ENVELOPE_MARKER)
  if (markerIndex < 0)
    throw new Error('Final Grok response is missing the required claim envelope')
  if (text.indexOf(CLAIM_ENVELOPE_MARKER) !== markerIndex)
    throw new Error('Final Grok response contains more than one claim envelope')
  const payloadText = text.slice(markerIndex + CLAIM_ENVELOPE_MARKER.length).trim()
  if (!payloadText || Buffer.byteLength(payloadText, 'utf8') > 256 * 1024)
    throw new Error('Final Grok claim envelope is empty or exceeds its byte cap')
  let payload
  try {
    payload = JSON.parse(payloadText)
  }
  catch {
    throw new Error('Final Grok claim envelope is malformed JSON')
  }
  if (!isPlainObject(payload) || payload.schemaVersion !== 1 || !Array.isArray(payload.claims))
    throw new Error('Final Grok claim envelope has an unsupported schema')
  for (const key of Object.keys(payload)) {
    if (!CLAIM_ENVELOPE_KEYS.has(key))
      throw new Error(`Unsupported claim envelope field: ${key}`)
  }
  if (payload.claims.length < 1 || payload.claims.length > 100)
    throw new Error('Final Grok claim envelope must contain at least one claim and at most 100 claims')
  for (const claim of payload.claims) {
    if (!isPlainObject(claim))
      throw new Error('Fallback claim must be a plain object')
    for (const key of Object.keys(claim)) {
      if (!FALLBACK_CLAIM_KEYS.has(key))
        throw new Error(`Unsupported fallback claim field: ${key}`)
    }
    const status = requireNonEmptyString(claim.status, 'claim.status')
    if (!CLAIM_STATUSES.includes(status))
      throw new Error(`Unsupported claim status: ${status}`)
    if (!Array.isArray(claim.urls))
      throw new Error('Fallback claim urls must be an array')
    if (status !== 'unresolved' && claim.urls.length === 0)
      throw new Error('A resolved fallback claim must contain at least one observed URL')
  }
  return cloneJson(payload.claims)
}

function domainMatches(hostname, configuredDomain) {
  const domain = String(configuredDomain).trim().toLowerCase().replace(/^\.+/, '')
  return domain.length > 0 && (hostname === domain || hostname.endsWith(`.${domain}`))
}

function findConfiguredTier(hostname, domainTiers) {
  for (const [domain, tier] of Object.entries(domainTiers || {})) {
    if (domainMatches(hostname, domain)) {
      if (!SOURCE_TIERS.includes(tier))
        throw new Error(`Invalid configured source tier for ${domain}`)
      return tier
    }
  }
  return null
}

function xAccountFromUrl(url) {
  if (!['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(url.hostname))
    return null
  return url.pathname.split('/').filter(Boolean)[0]?.toLowerCase() || null
}

function effectiveDomain(hostname) {
  const parts = hostname.split('.').filter(Boolean)
  if (parts.length <= 2)
    return hostname
  const publicSuffixPair = parts.slice(-2).join('.')
  if (['co.uk', 'com.au', 'co.jp', 'com.br'].includes(publicSuffixPair))
    return parts.slice(-3).join('.')
  return publicSuffixPair
}

function sourcePolicy(canonicalUrl, tool, options) {
  const url = new URL(canonicalUrl)
  const hostname = url.hostname.toLowerCase()
  const xAccount = xAccountFromUrl(url)
  const officialX = xAccount != null && (options.officialXAccounts || []).some(
    account => String(account).toLowerCase() === xAccount,
  )
  const officialDomain = (options.officialDomains || []).some(domain => domainMatches(hostname, domain))
  const official = officialX || officialDomain
  const configuredTier = findConfiguredTier(hostname, options.domainTiers)
  const hasOfficialDomainPolicy = (options.officialDomains || []).length > 0 || (options.officialXAccounts || []).length > 0
  const sourceTier = tool === 'x_search' ? 'D' : officialDomain ? 'A' : configuredTier || (hasOfficialDomainPolicy ? 'C' : 'U')
  return {
    official,
    official_status: official ? 'official' : hasOfficialDomainPolicy ? 'non_official' : 'official_unknown',
    source_tier: sourceTier,
    publisher: hostname,
    independence_key: effectiveDomain(hostname),
    ...(xAccount ? { x_account: xAccount } : {}),
  }
}

export function computeSourceId(tool, sourceUrl) {
  if (!['web_search', 'x_search'].includes(tool))
    throw new Error(`Unsupported source tool: ${String(tool)}`)
  const canonicalUrl = canonicalizeSourceUrl(sourceUrl)
  const digest = createHash('sha256').update(`${tool}\n${canonicalUrl}`).digest('hex').slice(0, 16)
  return `src-${digest}`
}

export function buildSourceRegistry(normalized, options = {}) {
  if (!isPlainObject(normalized) || !Array.isArray(normalized.searches))
    throw new Error('Normalized search events are required to build the source registry')
  const retrievedAt = requireIsoTimestamp(options.retrievedAt, 'retrievedAt')
  const sourcesById = new Map()
  const searches = []

  for (const search of normalized.searches) {
    if (!isPlainObject(search) || !['web_search', 'x_search'].includes(search.tool))
      throw new Error('Registry input contains an unsupported search kind')
    if (search.status !== 'completed')
      continue
    if (!Array.isArray(search.sources))
      throw new Error('Registry input search sources must be an array')
    if (search.observed_tool === 'x_search') {
      if (search.tool !== 'x_search' || search.sources.length !== 0)
        throw new Error('Native XSearch is advisory-only and cannot provide registry sources')
      searches.push({
        tool_call_id: requireNonEmptyString(search.toolCallId, 'search.toolCallId'),
        tool: 'x_search',
        observed_tool: 'x_search',
        query: requireNonEmptyString(search.query, 'search.query'),
        status: search.status,
        source_ids: [],
      })
      continue
    }
    if (search.observed_tool !== 'web_search')
      throw new Error('Registry input must originate from a built-in WebSearch or advisory XSearch event')
    const sourceIds = []
    for (const observedSource of search.sources) {
      const observedUrl = requireNonEmptyString(observedSource?.url, 'observed source URL')
      const canonicalUrl = canonicalizeSourceUrl(observedUrl)
      const id = computeSourceId(search.tool, canonicalUrl)
      if (!sourcesById.has(id)) {
        sourcesById.set(id, {
          id,
          tool: search.tool,
          observed_tool: 'web_search',
          canonical_url: canonicalUrl,
          observed_url: canonicalUrl,
          retrieved_at: retrievedAt,
          ...sourcePolicy(canonicalUrl, search.tool, options),
        })
      }
      if (!sourceIds.includes(id))
        sourceIds.push(id)
    }
    searches.push({
      tool_call_id: requireNonEmptyString(search.toolCallId, 'search.toolCallId'),
      tool: search.tool,
      observed_tool: 'web_search',
      query: requireNonEmptyString(search.query, 'search.query'),
      status: search.status,
      source_ids: sourceIds,
    })
  }

  return {
    schemaVersion: SOURCE_REGISTRY_SCHEMA_VERSION,
    retrieved_at: retrievedAt,
    sources: [...sourcesById.values()].sort((left, right) => left.id.localeCompare(right.id)),
    searches,
  }
}

function assertClaimKeys(claim) {
  for (const key of Object.keys(claim)) {
    if (FORBIDDEN_MODEL_POLICY_KEYS.has(key))
      throw new Error(`Model claim cannot set runtime source policy field: ${key}`)
    if (!CLAIM_KEYS.has(key))
      throw new Error(`Unsupported model claim field: ${key}`)
  }
}

function normalizeStringArray(value, name) {
  if (value == null)
    return undefined
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.trim().length === 0))
    throw new Error(`${name} must be an array of non-empty strings`)
  return [...new Set(value.map(item => item.trim()))]
}

function normalizeClaim(claim, sourceIds, runtimeApplicability) {
  if (!isPlainObject(claim))
    throw new Error('Synthesis claim must be a plain object')
  assertClaimKeys(claim)
  if (containsUrl(claim))
    throw new Error('Synthesis claims must not contain a URL; use observed registry IDs')
  const status = requireNonEmptyString(claim.status, 'claim.status')
  if (!CLAIM_STATUSES.includes(status))
    throw new Error(`Unsupported claim status: ${status}`)
  const severity = claim.severity == null ? 'info' : requireNonEmptyString(claim.severity, 'claim.severity')
  if (!['blocker', 'warning', 'info'].includes(severity))
    throw new Error(`Unsupported claim severity: ${severity}`)
  const ids = normalizeStringArray(claim.source_ids, 'claim.source_ids') || []
  if (status === 'verified' && ids.length === 0)
    throw new Error('Verified claim must reference at least one observed source')
  for (const id of ids) {
    if (!sourceIds.has(id))
      throw new Error(`Claim references an unobserved source: ${id}`)
  }
  const output = {
    id: requireNonEmptyString(claim.id, 'claim.id'),
    claim: requireNonEmptyString(claim.claim, 'claim.claim'),
    status,
    severity,
    source_ids: ids,
  }
  for (const key of ['applies_to', 'repo_impact']) {
    const normalized = normalizeStringArray(claim[key], `claim.${key}`)
    if (normalized)
      output[key] = normalized
  }
  for (const key of ['required_action', 'published_at', 'effective_at', 'notes']) {
    if (claim[key] != null)
      output[key] = requireNonEmptyString(claim[key], `claim.${key}`)
  }
  if (runtimeApplicability === true)
    output.observed_applicability = true
  return output
}

export function bindClaims(claims, registry, { observedApplicabilityByClaim = {} } = {}) {
  if (!Array.isArray(claims))
    throw new Error('Synthesis claims must be an array')
  const sourceIds = new Set((registry?.sources || []).map(source => source.id))
  const bound = claims.map((claim) => {
    const claimId = typeof claim?.id === 'string' ? claim.id : ''
    return normalizeClaim(claim, sourceIds, observedApplicabilityByClaim[claimId] === true)
  })
  const claimIds = new Set()
  for (const claim of bound) {
    if (claimIds.has(claim.id))
      throw new Error(`Duplicate claim id: ${claim.id}`)
    claimIds.add(claim.id)
  }
  return bound
}

const FALLBACK_TEXT_URL_PATTERN = /(?:https?:\/\/|\bwww\.)[^\s"'`<>\\]+/gi
function stripUrlsFromFallbackText(value) {
  if (typeof value === 'string') {
    return value.replace(FALLBACK_TEXT_URL_PATTERN, '[SOURCE_URL_REMOVED]')
  }
  if (Array.isArray(value))
    return value.map(item => stripUrlsFromFallbackText(item))
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, stripUrlsFromFallbackText(child)]),
    )
  }
  return value
}

function normalizeFallbackBlockers(claims, registry, bindingDiagnostics) {
  const sourcesById = new Map((registry?.sources || []).map(source => [source.id, source]))
  return claims.map((claim) => {
    if (claim.severity !== 'blocker')
      return claim
    const sources = claim.source_ids.map(id => sourcesById.get(id)).filter(Boolean)
    const nonXSources = sources.filter(source => source.tool !== 'x_search')
    const authoritativePrimary = nonXSources.some(source => source.official === true && source.source_tier === 'A')
      && claim.observed_applicability === true
    const reputableIndependenceKeys = new Set(nonXSources
      .filter(source => ['A', 'B'].includes(source.source_tier))
      .map(source => source.independence_key)
      .filter(Boolean))
    const eligible = ['verified', 'partially_verified'].includes(claim.status)
      && (authoritativePrimary || reputableIndependenceKeys.size >= 2)
    if (eligible)
      return claim
    if (Array.isArray(bindingDiagnostics)) {
      bindingDiagnostics.push({
        claim_id: claim.id,
        downgraded_severity_from: 'blocker',
        downgraded_severity_to: 'warning',
        reason: 'ineligible_runtime_blocker',
      })
    }
    return { ...claim, severity: 'warning' }
  })
}

export function bindClaimsFromObservedUrls(claims, registry, options = {}) {
  if (!Array.isArray(claims))
    throw new Error('Fallback claims must be an array')
  const observed = new Map()
  for (const source of registry?.sources || []) {
    const existing = observed.get(source.canonical_url) || []
    existing.push(source.id)
    observed.set(source.canonical_url, existing)
  }
  const converted = []
  for (const claim of claims) {
    if (!isPlainObject(claim) || !Array.isArray(claim.urls))
      throw new Error('Fallback claim must contain an observed urls array')
    if (claim.status !== 'unresolved' && claim.urls.length === 0)
      throw new Error('Fallback claim must contain observed urls')
    const sourceIds = []
    for (const rawUrl of claim.urls) {
      const canonicalUrl = canonicalizeSourceUrl(rawUrl)
      const matched = observed.get(canonicalUrl)
      if (!matched) {
        if (Array.isArray(options.bindingDiagnostics)) {
          options.bindingDiagnostics.push({
            claim_id: typeof claim.id === 'string' ? claim.id : '',
            url_sha256: createHash('sha256').update(canonicalUrl).digest('hex'),
          })
        }
        continue
      }
      sourceIds.push(...matched)
    }
    const { urls: _discardedUrls, ...withoutUrls } = claim
    // Only the explicit urls array can confer evidence. Textual URLs are removed
    // before strict claim binding and can never become source IDs.
    const urlFreeClaim = stripUrlsFromFallbackText(withoutUrls)
    const boundSourceIds = [...new Set(sourceIds)]
    if (claim.status === 'verified' && boundSourceIds.length === 0) {
      if (Array.isArray(options.bindingDiagnostics)) {
        options.bindingDiagnostics.push({
          claim_id: typeof claim.id === 'string' ? claim.id : '',
          dropped_claim_reason: 'verified_without_observed_source',
        })
      }
      continue
    }
    converted.push({ ...urlFreeClaim, source_ids: boundSourceIds })
  }
  return normalizeFallbackBlockers(bindClaims(converted, registry, options), registry, options.bindingDiagnostics)
}

function removeUrlsFromExcerpt(value) {
  return String(value).replace(/https?:\/\/\S+/gi, '[URL_REMOVED]')
}

export function createSynthesisInput(normalized, registry) {
  if (!isPlainObject(normalized) || !isPlainObject(registry))
    throw new Error('Normalized events and source registry are required')
  return {
    schemaVersion: 1,
    instruction: 'Return claims using source_ids only. Do not output URLs or source policy fields.',
    sources: (registry.sources || []).map(source => ({
      id: source.id,
      tool: source.tool,
      publisher: source.publisher,
      official: source.official,
      source_tier: source.source_tier,
    })),
    searches: (registry.searches || []).map(search => ({
      tool: search.tool,
      query: removeUrlsFromExcerpt(search.query),
      status: search.status,
      source_ids: cloneJson(search.source_ids),
    })),
  }
}
