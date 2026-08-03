import { describe, expect, it } from 'vitest'
import {
  PRODUCT_MANAGER_CONTRACT_VERSION,
  PRODUCT_MANAGER_OUTPUT_JSON_SCHEMA,
  createBoundProductManagerOutputJsonSchema,
  validateProductManagerInput,
  validateProductManagerOutput,
} from '../contracts'
import { createHash } from 'node:crypto'
import { canonicalJson } from '../canonical-json'
import { createInvocationKey } from '../invocation'

const expected = {
  contract_version: PRODUCT_MANAGER_CONTRACT_VERSION,
  task_id: 'product-manager-role-integration',
  trigger_type: 'MILESTONE_REVIEW' as const,
  checkpoint_id: 'M1',
  plan_revision: 1,
  input_digest: '1'.repeat(64),
  evidence_digest: '2'.repeat(64),
}

function validOutput() {
  return {
    ...expected,
    invocation_key: createInvocationKey(expected),
    verdict: 'accepted',
    facts: [{ statement: 'Tests passed', evidence_refs: ['test:unit'] }],
    hypotheses: [],
    findings: [],
    evidence_refs: ['test:unit'],
    progress: {
      implementation: 15,
      product_acceptance: 15,
      health: 'green',
      reasons: [],
    },
    risks: [],
    recommended_next_action: 'Request user acceptance for M1.',
    process_adjustments: [],
    material_change_proposal: null,
    reopen_request: null,
    user_acceptance_summary: 'M1 is ready for user validation.',
    provider_identity: {
      provider: 'codex',
      model: 'gpt-test',
      cli_version: '1.0.0',
    },
    generated_at: '2026-07-27T00:00:00.000Z',
  }
}

describe('product-manager output validation', () => {
  it('publishes the same strict no-extra-fields schema used for provider output', () => {
    expect(PRODUCT_MANAGER_OUTPUT_JSON_SCHEMA.additionalProperties).toBe(false)
    expect(PRODUCT_MANAGER_OUTPUT_JSON_SCHEMA.required).toContain('invocation_key')
    expect(PRODUCT_MANAGER_OUTPUT_JSON_SCHEMA.properties.provider_identity.additionalProperties).toBe(false)
  })

  it('binds every invocation and provider identity field as a schema constant', () => {
    const output = validOutput()
    const schema = createBoundProductManagerOutputJsonSchema({
      ...expected,
      invocation_key: output.invocation_key,
    }, output.provider_identity) as {
      properties: Record<string, {
        const?: unknown
        properties?: Record<string, { const?: unknown }>
      }>
    }

    for (const field of [
      'contract_version',
      'task_id',
      'trigger_type',
      'checkpoint_id',
      'plan_revision',
      'invocation_key',
      'input_digest',
      'evidence_digest',
    ] as const) {
      expect(schema.properties[field].const).toBe(output[field])
    }
    expect(schema.properties.provider_identity.properties).toEqual({
      provider: { const: 'codex' },
      model: { const: 'gpt-test' },
      cli_version: { const: '1.0.0' },
    })
  })

  it('accepts only an input digest derived from the complete canonical input', () => {
    const base = {
      contract_version: PRODUCT_MANAGER_CONTRACT_VERSION,
      task_id: 'product-manager-role-integration',
      trigger_type: 'MILESTONE_REVIEW' as const,
      checkpoint_id: 'M1',
      plan_revision: 1,
      evidence_digest: '2'.repeat(64),
      workspace_snapshot: {
        policy_version: '1',
        sha256: '3'.repeat(64),
        file_count: 12,
        total_bytes: 4096,
        git_head: '4'.repeat(40),
        dirty: true,
      },
      claude_transport: 'local' as const,
      user_request: 'Implement M1',
      product_brief: null,
      grill_handoff: null,
      approved_plan: {},
      current_milestone: null,
      repository_facts: [],
      evidence_refs: [],
      risks: [],
      drift: [],
      user_feedback: [],
      historical_overrides: [],
      previous_review: null,
    }
    const input = {
      ...base,
      input_digest: createHash('sha256').update(canonicalJson(base), 'utf8').digest('hex'),
    }
    expect(validateProductManagerInput(input).checkpoint_id).toBe('M1')
    expect(() => validateProductManagerInput({
      ...input,
      contract_version: '1',
      input_digest: createHash('sha256')
        .update(canonicalJson({ ...base, contract_version: '1' }), 'utf8')
        .digest('hex'),
    })).toThrow(/contract_version/i)
    expect(() => validateProductManagerInput({
      ...input,
      user_request: 'Changed without updating the digest',
    })).toThrow(/input_digest/i)

    const changedSnapshot = {
      ...base,
      workspace_snapshot: { ...base.workspace_snapshot, sha256: '5'.repeat(64) },
    }
    const changedInput = {
      ...changedSnapshot,
      input_digest: createHash('sha256').update(canonicalJson(changedSnapshot), 'utf8').digest('hex'),
    }
    expect(changedInput.input_digest).not.toBe(input.input_digest)
    expect(createInvocationKey(changedInput)).not.toBe(createInvocationKey(input))

    expect(() => validateProductManagerInput({
      ...input,
      claude_transport: 'automatic',
      input_digest: createHash('sha256')
        .update(canonicalJson({ ...base, claude_transport: 'automatic' }), 'utf8')
        .digest('hex'),
    })).toThrow(/claude_transport/i)
  })

  it('accepts the complete strict contract', () => {
    expect(validateProductManagerOutput(validOutput(), expected).verdict).toBe('accepted')
  })

  it('keeps the role contract provider-neutral while validating provider ids', () => {
    expect(validateProductManagerOutput({
      ...validOutput(),
      provider_identity: {
        ...validOutput().provider_identity,
        provider: 'future-provider',
      },
    }, expected).provider_identity.provider).toBe('future-provider')

    expect(() => validateProductManagerOutput({
      ...validOutput(),
      provider_identity: {
        ...validOutput().provider_identity,
        provider: 'Invalid Provider',
      },
    }, expected)).toThrow(/provider/i)
  })

  it('rejects missing, unknown, malformed, or identity-mismatched fields', () => {
    const missing = validOutput() as Record<string, unknown>
    delete missing.recommended_next_action
    expect(() => validateProductManagerOutput(missing, expected)).toThrow(/recommended_next_action/)

    expect(() => validateProductManagerOutput({
      ...validOutput(),
      unexpected: true,
    }, expected)).toThrow(/unknown field/)

    expect(() => validateProductManagerOutput({
      ...validOutput(),
      task_id: 'other-task',
    }, expected)).toThrow(/stale/)

    expect(() => validateProductManagerOutput('not-json', expected)).toThrow(/object/)
  })

  it('keeps user override out of the provider verdict domain', () => {
    expect(() => validateProductManagerOutput({
      ...validOutput(),
      verdict: 'user_overridden',
    }, expected)).toThrow(/verdict/)
  })

  it('requires evidence, confidence, validation, and a complete reopen request', () => {
    expect(() => validateProductManagerOutput({
      ...validOutput(),
      hypotheses: [{ statement: 'Maybe a hidden pain point exists.' }],
    }, expected)).toThrow(/confidence|unknown|missing/i)

    expect(() => validateProductManagerOutput({
      ...validOutput(),
      verdict: 'reopen_request',
      reopen_request: { new_evidence: 'A new fact.' },
    }, expected)).toThrow(/reopen_request/i)
  })
})
