import type { InvocationIdentity } from './contracts'
import { createHash } from 'node:crypto'
import { canonicalJson } from './canonical-json'

export function createInvocationKey(identity: InvocationIdentity): string {
  const payload = {
    contract_version: identity.contract_version,
    task_id: identity.task_id,
    trigger_type: identity.trigger_type,
    checkpoint_id: identity.checkpoint_id,
    plan_revision: identity.plan_revision,
    input_digest: identity.input_digest,
    evidence_digest: identity.evidence_digest,
  }
  return createHash('sha256').update(canonicalJson(payload), 'utf8').digest('hex')
}

export function isStaleInvocation(
  response: InvocationIdentity,
  current: InvocationIdentity,
): boolean {
  return createInvocationKey(response) !== createInvocationKey(current)
}
