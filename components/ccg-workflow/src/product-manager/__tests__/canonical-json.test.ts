import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { canonicalJson } from '../canonical-json'
import { createInvocationKey } from '../invocation'

describe('product-manager canonical JSON', () => {
  it('sorts object keys, preserves array order, and normalizes strings to NFC', () => {
    expect(canonicalJson({
      z: ['e\u0301', null],
      a: { b: true, a: 1 },
    })).toBe('{"a":{"a":1,"b":true},"z":["é",null]}')
  })

  it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, -0])(
    'rejects unsupported value %s',
    (value) => {
      expect(() => canonicalJson({ value })).toThrow()
    },
  )

  it('rejects object keys that collide after NFC normalization', () => {
    expect(() => canonicalJson({
      é: 1,
      'e\u0301': 2,
    })).toThrow(/duplicate keys/i)
  })

  it('implements the exact PRD 15.3 invocation-key field set', () => {
    const input = {
      contract_version: '1',
      task_id: 'task-1',
      trigger_type: 'PLAN_REVIEW' as const,
      checkpoint_id: 'plan',
      plan_revision: 2,
      input_digest: 'a'.repeat(64),
      evidence_digest: 'b'.repeat(64),
    }
    const expected = createHash('sha256')
      .update('{"checkpoint_id":"plan","contract_version":"1","evidence_digest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","input_digest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","plan_revision":2,"task_id":"task-1","trigger_type":"PLAN_REVIEW"}', 'utf8')
      .digest('hex')

    expect(createInvocationKey(input)).toBe(expected)
  })
})
