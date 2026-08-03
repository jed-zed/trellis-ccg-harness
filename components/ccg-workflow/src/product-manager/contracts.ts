import { createHash } from 'node:crypto'
import { canonicalJson } from './canonical-json'

export const PRODUCT_MANAGER_CONTRACT_VERSION = '2' as const

export const PRODUCT_MANAGER_TRIGGERS = [
  'INTAKE_REVIEW',
  'PLAN_REVIEW',
  'DRIFT_REVIEW',
  'MILESTONE_REVIEW',
  'FINAL_REVIEW',
] as const

export const PRODUCT_MANAGER_VERDICTS = [
  'accepted',
  'rejected',
  'needs_user_decision',
  'reopen_request',
  'unavailable',
] as const

export type ProductManagerTrigger = typeof PRODUCT_MANAGER_TRIGGERS[number]
export type ProductManagerVerdict = typeof PRODUCT_MANAGER_VERDICTS[number]
export type ProductManagerProvider = string
export type ClaudeTransport = 'local' | 'ssh'
export type MilestoneStatus
  = | 'not_started'
    | 'in_progress'
    | 'blocked'
    | 'awaiting_user_acceptance'
    | 'completed'
    | 'user_overridden'

export interface InvocationIdentity {
  contract_version: string
  task_id: string
  trigger_type: ProductManagerTrigger
  checkpoint_id: string
  plan_revision: number
  input_digest: string
  evidence_digest: string
}

export interface ProductManagerWorkspaceSnapshot {
  policy_version: string
  sha256: string
  file_count: number
  total_bytes: number
  git_head: string
  dirty: boolean
}

export interface ProductManagerInput extends InvocationIdentity {
  workspace_snapshot: ProductManagerWorkspaceSnapshot
  claude_transport: ClaudeTransport
  user_request: string
  product_brief: Record<string, unknown> | null
  grill_handoff: Record<string, unknown> | null
  approved_plan: Record<string, unknown>
  current_milestone: Record<string, unknown> | null
  repository_facts: unknown[]
  evidence_refs: string[]
  risks: unknown[]
  drift: unknown[]
  user_feedback: unknown[]
  historical_overrides: unknown[]
  previous_review: Record<string, unknown> | null
}

const INPUT_FIELDS = [
  'contract_version',
  'task_id',
  'trigger_type',
  'checkpoint_id',
  'plan_revision',
  'input_digest',
  'evidence_digest',
  'workspace_snapshot',
  'claude_transport',
  'user_request',
  'product_brief',
  'grill_handoff',
  'approved_plan',
  'current_milestone',
  'repository_facts',
  'evidence_refs',
  'risks',
  'drift',
  'user_feedback',
  'historical_overrides',
  'previous_review',
] as const

export interface ProductManagerProgress {
  implementation: number
  product_acceptance: number
  health: 'green' | 'yellow' | 'red'
  reasons: string[]
}

export interface ProductManagerOutput extends InvocationIdentity {
  invocation_key: string
  verdict: ProductManagerVerdict
  facts: unknown[]
  hypotheses: unknown[]
  findings: unknown[]
  evidence_refs: string[]
  progress: ProductManagerProgress
  risks: unknown[]
  recommended_next_action: string
  process_adjustments: unknown[]
  material_change_proposal: Record<string, unknown> | null
  reopen_request: Record<string, unknown> | null
  user_acceptance_summary: string
  provider_identity: {
    provider: ProductManagerProvider
    model: string
    cli_version: string
  }
  generated_at: string
}

export const PRODUCT_MANAGER_OUTPUT_FIELDS = [
  'trigger_type',
  'task_id',
  'checkpoint_id',
  'plan_revision',
  'invocation_key',
  'input_digest',
  'evidence_digest',
  'verdict',
  'facts',
  'hypotheses',
  'findings',
  'evidence_refs',
  'progress',
  'risks',
  'recommended_next_action',
  'process_adjustments',
  'material_change_proposal',
  'reopen_request',
  'user_acceptance_summary',
  'provider_identity',
  'contract_version',
  'generated_at',
] as const

export const PRODUCT_MANAGER_OUTPUT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: PRODUCT_MANAGER_OUTPUT_FIELDS,
  properties: {
    contract_version: { const: PRODUCT_MANAGER_CONTRACT_VERSION },
    task_id: { type: 'string', minLength: 1 },
    trigger_type: { enum: PRODUCT_MANAGER_TRIGGERS },
    checkpoint_id: { type: 'string', minLength: 1 },
    plan_revision: { type: 'integer', minimum: 0 },
    invocation_key: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    input_digest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    evidence_digest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    verdict: { enum: PRODUCT_MANAGER_VERDICTS },
    facts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['statement', 'evidence_refs'],
        properties: {
          statement: { type: 'string', minLength: 1 },
          evidence_refs: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    hypotheses: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['statement', 'confidence', 'validation_method', 'evidence_refs'],
        properties: {
          statement: { type: 'string', minLength: 1 },
          confidence: { enum: ['low', 'medium', 'high'] },
          validation_method: { type: 'string', minLength: 1 },
          evidence_refs: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    findings: { type: 'array' },
    evidence_refs: { type: 'array', items: { type: 'string' } },
    progress: {
      type: 'object',
      additionalProperties: false,
      required: ['implementation', 'product_acceptance', 'health', 'reasons'],
      properties: {
        implementation: { type: 'number', minimum: 0, maximum: 100 },
        product_acceptance: { type: 'number', minimum: 0, maximum: 100 },
        health: { enum: ['green', 'yellow', 'red'] },
        reasons: { type: 'array', items: { type: 'string' } },
      },
    },
    risks: { type: 'array' },
    recommended_next_action: { type: 'string', minLength: 1 },
    process_adjustments: { type: 'array' },
    material_change_proposal: { type: ['object', 'null'] },
    reopen_request: { type: ['object', 'null'] },
    user_acceptance_summary: { type: 'string', minLength: 1 },
    provider_identity: {
      type: 'object',
      additionalProperties: false,
      required: ['provider', 'model', 'cli_version'],
      properties: {
        provider: {
          type: 'string',
          minLength: 1,
          maxLength: 64,
          pattern: '^[a-z0-9][a-z0-9._-]*$',
        },
        model: { type: 'string', minLength: 1 },
        cli_version: { type: 'string', minLength: 1 },
      },
    },
    generated_at: { type: 'string', format: 'date-time' },
  },
} as const

export function createBoundProductManagerOutputJsonSchema(
  expected: InvocationIdentity & { invocation_key: string },
  providerIdentity: ProductManagerOutput['provider_identity'],
): Record<string, unknown> {
  return {
    ...PRODUCT_MANAGER_OUTPUT_JSON_SCHEMA,
    properties: {
      ...PRODUCT_MANAGER_OUTPUT_JSON_SCHEMA.properties,
      contract_version: { const: expected.contract_version },
      task_id: { const: expected.task_id },
      trigger_type: { const: expected.trigger_type },
      checkpoint_id: { const: expected.checkpoint_id },
      plan_revision: { const: expected.plan_revision },
      invocation_key: { const: expected.invocation_key },
      input_digest: { const: expected.input_digest },
      evidence_digest: { const: expected.evidence_digest },
      provider_identity: {
        ...PRODUCT_MANAGER_OUTPUT_JSON_SCHEMA.properties.provider_identity,
        properties: {
          provider: { const: providerIdentity.provider },
          model: { const: providerIdentity.model },
          cli_version: { const: providerIdentity.cli_version },
        },
      },
    },
  }
}

const HEX_64 = /^[a-f0-9]{64}$/
const SINGLE_LINE = /^[^\u0000-\u001F\u007F]+$/
const PROVIDER_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError(`${label} must be an object`)
}

function assertExactFields(value: Record<string, unknown>, fields: readonly string[], label: string): void {
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field))
      throw new TypeError(`${label}.${field} is required`)
  }
  for (const field of Object.keys(value)) {
    if (!fields.includes(field))
      throw new TypeError(`${label} contains unknown field ${field}`)
  }
}

function assertString(value: unknown, label: string, pattern = SINGLE_LINE): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || !pattern.test(value))
    throw new TypeError(`${label} must be a non-empty single-line string`)
}

function assertArray(value: unknown, label: string): asserts value is unknown[] {
  if (!Array.isArray(value))
    throw new TypeError(`${label} must be an array`)
}

function assertEvidenceStatements(value: unknown[], label: string): void {
  for (const [index, item] of value.entries()) {
    assertRecord(item, `${label}[${index}]`)
    assertExactFields(item, ['statement', 'evidence_refs'], `${label}[${index}]`)
    assertString(item.statement, `${label}[${index}].statement`)
    assertArray(item.evidence_refs, `${label}[${index}].evidence_refs`)
    if (!item.evidence_refs.every(reference => typeof reference === 'string' && SINGLE_LINE.test(reference)))
      throw new TypeError(`${label}[${index}].evidence_refs must contain single-line strings`)
  }
}

function assertHypotheses(value: unknown[]): void {
  for (const [index, item] of value.entries()) {
    assertRecord(item, `product_manager_output.hypotheses[${index}]`)
    assertExactFields(
      item,
      ['statement', 'confidence', 'validation_method', 'evidence_refs'],
      `product_manager_output.hypotheses[${index}]`,
    )
    assertString(item.statement, `product_manager_output.hypotheses[${index}].statement`)
    if (!['low', 'medium', 'high'].includes(String(item.confidence)))
      throw new TypeError(`product_manager_output.hypotheses[${index}].confidence is invalid`)
    assertString(item.validation_method, `product_manager_output.hypotheses[${index}].validation_method`)
    assertArray(item.evidence_refs, `product_manager_output.hypotheses[${index}].evidence_refs`)
  }
}

function assertWorkspaceSnapshot(value: unknown): asserts value is ProductManagerWorkspaceSnapshot {
  assertRecord(value, 'product_manager_input.workspace_snapshot')
  assertExactFields(
    value,
    ['policy_version', 'sha256', 'file_count', 'total_bytes', 'git_head', 'dirty'],
    'product_manager_input.workspace_snapshot',
  )
  assertString(value.policy_version, 'product_manager_input.workspace_snapshot.policy_version')
  assertString(value.sha256, 'product_manager_input.workspace_snapshot.sha256', HEX_64)
  assertString(value.git_head, 'product_manager_input.workspace_snapshot.git_head')
  if (!Number.isSafeInteger(value.file_count) || (value.file_count as number) < 0 || (value.file_count as number) > 2000)
    throw new TypeError('product_manager_input.workspace_snapshot.file_count must be between 0 and 2000')
  if (!Number.isSafeInteger(value.total_bytes) || (value.total_bytes as number) < 0 || (value.total_bytes as number) > 64 * 1024 * 1024)
    throw new TypeError('product_manager_input.workspace_snapshot.total_bytes must be between 0 and 67108864')
  if (typeof value.dirty !== 'boolean')
    throw new TypeError('product_manager_input.workspace_snapshot.dirty must be a boolean')
}

export function validateInvocationIdentity(value: unknown): InvocationIdentity {
  assertRecord(value, 'invocation')
  assertString(value.contract_version, 'invocation.contract_version')
  if (value.contract_version !== PRODUCT_MANAGER_CONTRACT_VERSION)
    throw new TypeError(`invocation.contract_version must be ${PRODUCT_MANAGER_CONTRACT_VERSION}`)
  assertString(value.task_id, 'invocation.task_id')
  assertString(value.trigger_type, 'invocation.trigger_type')
  if (!PRODUCT_MANAGER_TRIGGERS.includes(value.trigger_type as ProductManagerTrigger))
    throw new TypeError('invocation.trigger_type is invalid')
  assertString(value.checkpoint_id, 'invocation.checkpoint_id')
  if (!Number.isSafeInteger(value.plan_revision) || (value.plan_revision as number) < 0)
    throw new TypeError('invocation.plan_revision must be a non-negative integer')
  assertString(value.input_digest, 'invocation.input_digest', HEX_64)
  assertString(value.evidence_digest, 'invocation.evidence_digest', HEX_64)
  return value as unknown as InvocationIdentity
}

export function validateProductManagerInput(value: unknown): ProductManagerInput {
  assertRecord(value, 'product_manager_input')
  assertExactFields(value, INPUT_FIELDS, 'product_manager_input')
  validateInvocationIdentity(value)
  assertWorkspaceSnapshot(value.workspace_snapshot)
  if (value.claude_transport !== 'local' && value.claude_transport !== 'ssh')
    throw new TypeError('product_manager_input.claude_transport must be local or ssh')
  assertString(value.user_request, 'product_manager_input.user_request')
  for (const field of ['product_brief', 'grill_handoff', 'current_milestone', 'previous_review'] as const) {
    if (value[field] !== null)
      assertRecord(value[field], `product_manager_input.${field}`)
  }
  assertRecord(value.approved_plan, 'product_manager_input.approved_plan')
  for (const field of ['repository_facts', 'evidence_refs', 'risks', 'drift', 'user_feedback', 'historical_overrides'] as const)
    assertArray(value[field], `product_manager_input.${field}`)
  if (!(value.evidence_refs as unknown[]).every(item => typeof item === 'string' && SINGLE_LINE.test(item)))
    throw new TypeError('product_manager_input.evidence_refs must contain single-line strings')
  const { input_digest: suppliedInputDigest, ...digestPayload } = value
  const expectedInputDigest = createHash('sha256')
    .update(canonicalJson(digestPayload), 'utf8')
    .digest('hex')
  if (suppliedInputDigest !== expectedInputDigest)
    throw new Error('product_manager_input.input_digest does not match the canonical input')
  return value as unknown as ProductManagerInput
}

export function validateProductManagerOutput(
  value: unknown,
  expected: InvocationIdentity,
): ProductManagerOutput {
  assertRecord(value, 'product_manager_output')
  assertExactFields(value, PRODUCT_MANAGER_OUTPUT_FIELDS, 'product_manager_output')
  const identity = validateInvocationIdentity(value)
  for (const field of [
    'contract_version',
    'task_id',
    'trigger_type',
    'checkpoint_id',
    'plan_revision',
    'input_digest',
    'evidence_digest',
  ] as const) {
    if (identity[field] !== expected[field])
      throw new Error(`stale product-manager response: ${field} mismatch`)
  }
  assertString(value.invocation_key, 'product_manager_output.invocation_key', HEX_64)
  const expectedKey = createInvocationKeyForValidation(expected)
  if (value.invocation_key !== expectedKey)
    throw new Error('stale product-manager response: invocation_key mismatch')
  assertString(value.verdict, 'product_manager_output.verdict')
  if (!PRODUCT_MANAGER_VERDICTS.includes(value.verdict as ProductManagerVerdict))
    throw new TypeError('product_manager_output.verdict is invalid')
  for (const field of ['facts', 'hypotheses', 'findings', 'evidence_refs', 'risks', 'process_adjustments'] as const)
    assertArray(value[field], `product_manager_output.${field}`)
  assertEvidenceStatements(value.facts as unknown[], 'product_manager_output.facts')
  assertHypotheses(value.hypotheses as unknown[])
  if (!(value.evidence_refs as unknown[]).every(item => typeof item === 'string' && SINGLE_LINE.test(item)))
    throw new TypeError('product_manager_output.evidence_refs must contain single-line strings')
  assertString(value.recommended_next_action, 'product_manager_output.recommended_next_action')
  assertString(value.user_acceptance_summary, 'product_manager_output.user_acceptance_summary')
  for (const field of ['material_change_proposal', 'reopen_request'] as const) {
    if (value[field] !== null)
      assertRecord(value[field], `product_manager_output.${field}`)
  }
  if (value.verdict === 'reopen_request') {
    if (value.reopen_request === null)
      throw new TypeError('product_manager_output.reopen_request is required for reopen_request verdict')
    assertExactFields(
      value.reopen_request as Record<string, unknown>,
      ['new_evidence', 'impact', 'confidence', 'recommended_answer'],
      'product_manager_output.reopen_request',
    )
    for (const field of ['new_evidence', 'impact', 'confidence', 'recommended_answer'] as const)
      assertString((value.reopen_request as Record<string, unknown>)[field], `product_manager_output.reopen_request.${field}`)
  }
  assertRecord(value.progress, 'product_manager_output.progress')
  assertExactFields(value.progress, ['implementation', 'product_acceptance', 'health', 'reasons'], 'product_manager_output.progress')
  for (const field of ['implementation', 'product_acceptance'] as const) {
    if (typeof value.progress[field] !== 'number' || value.progress[field] < 0 || value.progress[field] > 100)
      throw new TypeError(`product_manager_output.progress.${field} must be between 0 and 100`)
  }
  if (!['green', 'yellow', 'red'].includes(String(value.progress.health)))
    throw new TypeError('product_manager_output.progress.health is invalid')
  assertArray(value.progress.reasons, 'product_manager_output.progress.reasons')
  assertRecord(value.provider_identity, 'product_manager_output.provider_identity')
  assertExactFields(value.provider_identity, ['provider', 'model', 'cli_version'], 'product_manager_output.provider_identity')
  assertString(
    value.provider_identity.provider,
    'product_manager_output.provider_identity.provider',
    PROVIDER_ID,
  )
  assertString(value.provider_identity.model, 'product_manager_output.provider_identity.model')
  assertString(value.provider_identity.cli_version, 'product_manager_output.provider_identity.cli_version')
  assertString(value.generated_at, 'product_manager_output.generated_at')
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value.generated_at)
    || Number.isNaN(Date.parse(value.generated_at)))
    throw new TypeError('product_manager_output.generated_at must be an ISO timestamp')
  return value as unknown as ProductManagerOutput
}

function createInvocationKeyForValidation(identity: InvocationIdentity): string {
  const payload = {
    contract_version: identity.contract_version,
    task_id: identity.task_id,
    trigger_type: identity.trigger_type,
    checkpoint_id: identity.checkpoint_id,
    plan_revision: identity.plan_revision,
    input_digest: identity.input_digest,
    evidence_digest: identity.evidence_digest,
  }
  const value = canonicalJson(payload)
  // Kept local to avoid a contracts -> invocation -> contracts cycle.
  return createHash('sha256').update(value, 'utf8').digest('hex')
}
