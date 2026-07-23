const REQUIREMENTS = new Set(['required', 'preferred', 'disabled'])
const STATUSES = new Set(['valid', 'skipped', 'waived'])
const ACTIONS = new Set(['intel', 'verify'])
const MODES = new Set(['discover', 'contract', 'incident', 'landscape'])
const DEPTHS = new Set(['normal', 'deep'])
const PACKAGE_STATUSES = new Set(['valid', 'invalid', 'not_collected'])
const VERIFICATION_OUTCOMES = new Set(['verified', 'partially_verified', 'unresolved', 'contradicted', 'not_run'])
const NORMALIZED_DECISION = Symbol('normalized-intelligence-decision')

function requireString(value, name) {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`${name} must be a non-empty string`)
  return value.trim()
}

function requireTimestamp(value, name) {
  const timestamp = requireString(value, name)
  const parsed = new Date(timestamp)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== timestamp)
    throw new Error(`${name} must be an exact ISO-8601 UTC timestamp`)
  return timestamp
}

function normalizeDeepVisibility(value) {
  if (value == null)
    return null
  if (value.evidence_visibility !== 'leader_only' || value.advisory_only !== true || value.total_server_tool_usage !== null)
    throw new Error('Deep evidence must remain leader_only, advisory_only, with unknown total server tool usage')
  for (const name of ['observed_web_search_events', 'observed_x_search_events']) {
    if (!Number.isInteger(value[name]) || value[name] < 0)
      throw new Error(`${name} must be a non-negative integer`)
  }
  return {
    evidence_visibility: 'leader_only',
    observed_web_search_events: value.observed_web_search_events,
    observed_x_search_events: value.observed_x_search_events,
    total_server_tool_usage: null,
    advisory_only: true,
  }
}

export function createIntelligenceDecision(input) {
  if (input?.[NORMALIZED_DECISION] === true)
    return input
  if (!input || typeof input !== 'object')
    throw new Error('Intelligence decision is required')
  const requirement = requireString(input.requirement, 'requirement')
  const status = requireString(input.status, 'status')
  const action = requireString(input.action || 'intel', 'action')
  const legacyMode = requireString(input.mode || input.investigation_mode || input.investigationMode, 'mode')
  const investigationMode = requireString(input.investigation_mode || input.investigationMode || (legacyMode === 'deep' ? 'discover' : legacyMode), 'investigation_mode')
  const depth = requireString(input.depth || (legacyMode === 'deep' ? 'deep' : 'normal'), 'depth')
  const packageStatus = requireString(input.package_status || (status === 'valid' ? 'valid' : 'not_collected'), 'package_status')
  const verificationOutcome = requireString(input.verification_outcome || (status === 'valid' ? 'unresolved' : 'not_run'), 'verification_outcome')
  if (!REQUIREMENTS.has(requirement))
    throw new Error(`Unsupported intelligence requirement: ${requirement}`)
  if (!STATUSES.has(status))
    throw new Error(`Unsupported intelligence status: ${status}`)
  if (!ACTIONS.has(action))
    throw new Error(`Unsupported intelligence action: ${action}`)
  if (!MODES.has(investigationMode))
    throw new Error(`Unsupported intelligence investigation mode: ${investigationMode}`)
  if (!DEPTHS.has(depth))
    throw new Error(`Unsupported intelligence depth: ${depth}`)
  if (!PACKAGE_STATUSES.has(packageStatus))
    throw new Error(`Unsupported intelligence package status: ${packageStatus}`)
  if (!VERIFICATION_OUTCOMES.has(verificationOutcome))
    throw new Error(`Unsupported intelligence verification outcome: ${verificationOutcome}`)
  if (status === 'skipped' && requirement !== 'disabled')
    throw new Error('Only a disabled intelligence route may be skipped')
  if (status === 'valid' && requirement === 'disabled')
    throw new Error('A disabled intelligence route cannot produce valid evidence')

  const decision = {
    requirement,
    status,
    action,
    investigation_mode: investigationMode,
    mode: investigationMode,
    depth,
    package_status: packageStatus,
    verification_outcome: verificationOutcome,
    reason: requireString(input.reason, 'reason'),
    created_at: requireTimestamp(input.created_at || new Date().toISOString(), 'created_at'),
  }
  if (status === 'waived') {
    if (input.explicitUserWaiver !== true)
      throw new Error('A waiver requires explicit user authorization')
    if (input.waiver?.actor !== 'user')
      throw new Error('A waiver actor must be user')
    decision.waiver = {
      reason: requireString(input.waiver.reason, 'waiver.reason'),
      actor: 'user',
      created_at: requireTimestamp(input.waiver.created_at, 'waiver.created_at'),
    }
  }
  else if (input.waiver != null || input.explicitUserWaiver === true) {
    throw new Error('Only waived evidence may carry waiver authorization')
  }
  const visibility = normalizeDeepVisibility(input.deepVisibility)
  if (visibility && depth !== 'deep')
    throw new Error('Deep evidence visibility requires depth=deep')
  if (visibility)
    Object.assign(decision, visibility)
  Object.defineProperty(decision, NORMALIZED_DECISION, { value: true })
  return decision
}

function normalizeDecision(input) {
  return input?.[NORMALIZED_DECISION] === true ? input : createIntelligenceDecision(input)
}

function validateBundlePointer(bundle) {
  const fields = ['artifactRelativePath', 'artifactSha256', 'manifestRelativePath', 'manifestSha256']
  for (const field of fields)
    requireString(bundle?.[field], `bundle.${field}`)
  return bundle
}

export function createCanonicalEvidenceItem({ evidenceId, decision, bundle, summary }) {
  const id = requireString(evidenceId, 'evidenceId')
  const normalizedDecision = normalizeDecision(decision)
  const pointer = validateBundlePointer(bundle)
  return {
    id: `grok-external-intelligence-${id}`,
    provider: 'grok',
    role: 'external-intelligence',
    policy: normalizedDecision.requirement,
    action: normalizedDecision.action,
    investigationMode: normalizedDecision.investigation_mode,
    depth: normalizedDecision.depth,
    packageStatus: normalizedDecision.package_status,
    verificationOutcome: normalizedDecision.verification_outcome,
    available: normalizedDecision.status === 'valid' || normalizedDecision.status === 'waived',
    artifactFile: pointer.artifactRelativePath,
    artifactSha256: pointer.artifactSha256,
    manifestFile: pointer.manifestRelativePath,
    manifestSha256: pointer.manifestSha256,
    summary: requireString(summary, 'summary'),
    createdAt: normalizedDecision.created_at,
    localOnly: true,
    exported: false,
  }
}

export function createTaskIntelligencePointer({ evidenceId, decision, bundle, exported = false }) {
  const id = requireString(evidenceId, 'evidenceId')
  const normalizedDecision = normalizeDecision(decision)
  const pointer = validateBundlePointer(bundle)
  return {
    requirement: normalizedDecision.requirement,
    status: normalizedDecision.status,
    action: normalizedDecision.action,
    investigation_mode: normalizedDecision.investigation_mode,
    depth: normalizedDecision.depth,
    package_status: normalizedDecision.package_status,
    verification_outcome: normalizedDecision.verification_outcome,
    evidence_id: id,
    manifest_file: pointer.manifestRelativePath,
    manifest_sha256: pointer.manifestSha256,
    localOnly: !exported,
    exported: Boolean(exported),
  }
}
