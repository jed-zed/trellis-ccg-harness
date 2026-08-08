import {
  X_SEARCH_POLICIES,
  isPlainObject,
  requireNonEmptyString,
} from './contracts.mjs'
import { canonicalizeSourceUrl, computeSourceId } from './source-registry.mjs'

export function resolveEffectiveXPolicy(policy, mode) {
  if (!X_SEARCH_POLICIES.includes(policy))
    throw new Error(`Unsupported X search policy: ${String(policy)}`)
  return policy
}

function validateRegistry(registry, errors) {
  if (!isPlainObject(registry) || !Array.isArray(registry.sources)) {
    errors.push('Source registry is missing or malformed')
    return new Map()
  }
  const sourcesById = new Map()
  for (const source of registry.sources) {
    if (!isPlainObject(source) || typeof source.id !== 'string') {
      errors.push('Source registry contains a malformed source')
      continue
    }
    try {
      const canonicalUrl = canonicalizeSourceUrl(source.canonical_url)
      if (canonicalUrl !== source.canonical_url)
        errors.push(`Source ${source.id} URL is not canonical`)
      if (computeSourceId(source.tool, canonicalUrl) !== source.id)
        errors.push(`Source ${source.id} does not match its runtime-derived ID`)
      if (source.observed_tool !== 'web_search')
        errors.push(`Source ${source.id} did not originate from built-in WebSearch`)
      if (!['A', 'B', 'C', 'D', 'U'].includes(source.source_tier))
        errors.push(`Source ${source.id} has an invalid runtime tier`)
      if (source.tool === 'x_search' && source.source_tier !== 'D')
        errors.push(`X source ${source.id} must remain Tier D radar evidence`)
    }
    catch (error) {
      errors.push(`Source ${source.id} failed integrity validation: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (sourcesById.has(source.id)) {
      errors.push(`Source registry contains duplicate id ${source.id}`)
      continue
    }
    sourcesById.set(source.id, source)
  }
  return sourcesById
}

function hasSourceBackedSearch(sourcesById, tool) {
  return [...sourcesById.values()].some(source => source.tool === tool)
}

function validateSearchRequirements({ sourcesById, requireWebSearch, effectiveXPolicy, errors, warnings }) {
  if (requireWebSearch && !hasSourceBackedSearch(sourcesById, 'web_search'))
    errors.push('Required Web search produced no runtime-observed source')
  if (effectiveXPolicy === 'required' && !hasSourceBackedSearch(sourcesById, 'x_search'))
    errors.push('Required X evidence produced no runtime-observed source')
  if (effectiveXPolicy === 'preferred' && !hasSourceBackedSearch(sourcesById, 'x_search'))
    warnings.push('Preferred X evidence was unavailable')
}

function blockerEligibility(claim, claimSources) {
  if (claimSources.length === 0)
    return { eligible: false, reason: 'blocker claim has no observed source' }
  if (claimSources.every(source => source.tool === 'x_search'))
    return { eligible: false, reason: 'X-only evidence cannot create a blocker' }

  const nonXSources = claimSources.filter(source => source.tool !== 'x_search')
  const authoritativePrimary = nonXSources.some(source => source.official === true && source.source_tier === 'A')
  if (authoritativePrimary && claim.observed_applicability === true)
    return { eligible: true, reason: 'authoritative primary source with observed applicability' }

  const reputableIndependenceKeys = new Set(
    nonXSources
      .filter(source => ['A', 'B'].includes(source.source_tier))
      .map(source => source.independence_key)
      .filter(key => typeof key === 'string' && key.length > 0),
  )
  if (reputableIndependenceKeys.size >= 2)
    return { eligible: true, reason: 'two independent reputable sources' }
  return { eligible: false, reason: 'blocker needs applicable primary evidence or two independent reputable sources' }
}

function validateClaims(claims, sourcesById, errors, warnings) {
  if (!Array.isArray(claims)) {
    errors.push('Claims must be an array')
    return []
  }
  const evaluated = []
  for (const claim of claims) {
    if (!isPlainObject(claim)) {
      errors.push('Evidence package contains a malformed claim')
      continue
    }
    const claimId = typeof claim.id === 'string' ? claim.id : '<unknown>'
    const sourceIds = Array.isArray(claim.source_ids) ? claim.source_ids : []
    const claimSources = []
    for (const sourceId of sourceIds) {
      const source = sourcesById.get(sourceId)
      if (!source)
        errors.push(`Claim ${claimId} references unobserved source ${String(sourceId)}`)
      else
        claimSources.push(source)
    }
    if (claim.status === 'verified' && claimSources.length === 0)
      errors.push(`Verified claim ${claimId} has no observed source`)

    let blocker = null
    if (claim.severity === 'blocker') {
      if (['verified', 'partially_verified'].includes(claim.status)) {
        blocker = blockerEligibility(claim, claimSources)
        if (!blocker.eligible)
          errors.push(`Claim ${claimId} is not blocker-eligible: ${blocker.reason}`)
      }
      else {
        blocker = { eligible: false, reason: 'non-verifying claim cannot create a blocker' }
      }
    }
    if (claim.status === 'verified' && claimSources.some(source => ['C', 'D', 'U'].includes(source.source_tier)))
      warnings.push(`Verified claim ${claimId} includes lower-tier evidence`)
    const reputableIndependenceKeys = new Set(claimSources
      .filter(source => ['A', 'B'].includes(source.source_tier))
      .map(source => source.independence_key)
      .filter(Boolean))
    const applicable = claim.observed_applicability === true
      || (Array.isArray(claim.applies_to)
        && claim.applies_to.some(value => typeof value === 'string' && value.trim()))
    const reputable = claimSources.some(source => ['A', 'B'].includes(source.source_tier))
    const qualifying = ['verified', 'partially_verified'].includes(claim.status)
      && applicable
      && reputable
    evaluated.push({
      id: claimId,
      status: claim.status,
      blocker,
      source_tiers: [...new Set(claimSources.map(source => source.source_tier))].sort(),
      cross_verified: reputableIndependenceKeys.size >= 2,
      applicability: claim.observed_applicability === true ? 'observed' : applicable ? 'declared' : 'unknown',
      qualifying,
    })
  }
  return evaluated
}

function verificationOutcome(evaluatedClaims) {
  const qualifying = evaluatedClaims.filter(claim => claim.qualifying)
  if (qualifying.length > 0) {
    const fullyVerified = evaluatedClaims.length > 0
      && evaluatedClaims.every(claim => claim.status === 'verified' && claim.qualifying)
    return fullyVerified ? 'verified' : 'partially_verified'
  }
  if (evaluatedClaims.some(claim => claim.status === 'contradicted'))
    return 'contradicted'
  return 'unresolved'
}

export function validateEvidencePackage({
  normalized,
  registry,
  claims,
  requireWebSearch = true,
  xSearchPolicy = 'preferred',
  mode = 'discover',
  requireClaims = false,
}) {
  requireNonEmptyString(mode, 'mode')
  const errors = []
  const warnings = []
  if (!isPlainObject(normalized) || !Array.isArray(normalized.searches))
    errors.push('Normalized ACP search events are missing')
  const effectiveXPolicy = resolveEffectiveXPolicy(xSearchPolicy, mode)
  const sourcesById = validateRegistry(registry, errors)
  validateSearchRequirements({ sourcesById, requireWebSearch, effectiveXPolicy, errors, warnings })
  const evaluatedClaims = validateClaims(claims, sourcesById, errors, warnings)
  if (requireClaims && Array.isArray(claims) && claims.length === 0)
    errors.push('Required evidence package must contain at least one claim or an explicit unresolved claim')
  const valid = errors.length === 0
  return {
    valid,
    package_status: valid ? 'valid' : 'invalid',
    verification_outcome: verificationOutcome(evaluatedClaims),
    qualifying_claims: evaluatedClaims.filter(claim => claim.qualifying).map(claim => claim.id),
    errors,
    warnings,
    effective_x_policy: effectiveXPolicy,
    evaluated_claims: evaluatedClaims,
  }
}

export function assertValidEvidencePackage(input) {
  const result = validateEvidencePackage(input)
  if (!result.valid)
    throw new Error(`External intelligence evidence validation failed: ${result.errors.join('; ')}`)
  return result
}
