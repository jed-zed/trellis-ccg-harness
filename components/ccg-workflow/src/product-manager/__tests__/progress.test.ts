import { describe, expect, it } from 'vitest'
import {
  calculateProgress,
  determineFinalEligibility,
  shouldMergeFinalAcceptance,
} from '../progress'

describe('product-manager progress', () => {
  const milestones = [
    { id: 'M1', weight: 20, status: 'completed' as const, pm_verdict: 'accepted' as const, evidence_refs: ['test:M1'] },
    { id: 'M2', weight: 30, status: 'awaiting_user_acceptance' as const, pm_verdict: 'accepted' as const, evidence_refs: ['test:M2'] },
    { id: 'M3', weight: 50, status: 'user_overridden' as const, pm_verdict: 'rejected' as const, evidence_refs: ['test:M3'] },
  ]

  it('derives implementation and product acceptance independently', () => {
    expect(calculateProgress(milestones)).toEqual({
      implementation: 100,
      product_acceptance: 50,
      health: 'yellow',
      reasons: ['user_override'],
    })
  })

  it('never reports normal completion with an override or missing gate', () => {
    expect(determineFinalEligibility({
      milestones: milestones.map(milestone => (
        milestone.id === 'M2' ? { ...milestone, status: 'completed' as const } : milestone
      )),
      final_verdict: 'accepted',
      final_user_accepted: true,
      required_gates_passed: true,
      blockers: [],
      final_evidence_refs: ['test:final'],
    })).toEqual({
      eligible: true,
      conclusion: 'completed_with_overrides',
      reasons: ['M3:user_overridden'],
    })
  })

  it('merges final acceptance only for equivalent, fresh checkpoints', () => {
    expect(shouldMergeFinalAcceptance({
      last_milestone_id: 'M6',
      final_checkpoint_id: 'M6',
      plan_revision_equal: true,
      evidence_digest_equal: true,
      no_new_risks_or_decisions: true,
    })).toBe(true)
    expect(shouldMergeFinalAcceptance({
      last_milestone_id: 'M6',
      final_checkpoint_id: 'FINAL',
      plan_revision_equal: true,
      evidence_digest_equal: true,
      no_new_risks_or_decisions: true,
    })).toBe(false)
  })
})
