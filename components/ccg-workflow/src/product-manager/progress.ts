import type { MilestoneStatus, ProductManagerProgress, ProductManagerVerdict } from './contracts'

export interface ProgressMilestone {
  id: string
  weight: number
  status: MilestoneStatus
  pm_verdict: ProductManagerVerdict | null
  blockers?: string[]
  drift?: boolean
  evidence_gap?: boolean
  major_risk?: boolean
  evidence_refs?: string[]
}

function percent(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 10000) / 100
}

export function calculateProgress(milestones: readonly ProgressMilestone[]): ProductManagerProgress {
  const total = milestones.reduce((sum, milestone) => sum + milestone.weight, 0)
  if (milestones.some(milestone => !Number.isFinite(milestone.weight) || milestone.weight <= 0))
    throw new TypeError('milestone weights must be positive finite numbers')
  const implementation = milestones
    .filter(milestone => ['awaiting_user_acceptance', 'completed', 'user_overridden'].includes(milestone.status))
    .reduce((sum, milestone) => sum + milestone.weight, 0)
  const accepted = milestones
    .filter(milestone => milestone.pm_verdict === 'accepted' && milestone.status !== 'user_overridden')
    .reduce((sum, milestone) => sum + milestone.weight, 0)
  const reasons = new Set<string>()
  for (const milestone of milestones) {
    if (milestone.status === 'user_overridden')
      reasons.add('user_override')
    if (milestone.status === 'blocked' || (milestone.blockers?.length ?? 0) > 0)
      reasons.add('blocker')
    if (milestone.drift)
      reasons.add('drift')
    if (milestone.evidence_gap)
      reasons.add('evidence_gap')
    if (milestone.major_risk)
      reasons.add('major_risk')
  }
  const orderedReasons = ['blocker', 'drift', 'user_override', 'evidence_gap', 'major_risk']
    .filter(reason => reasons.has(reason))
  const health = reasons.has('blocker') || reasons.has('major_risk')
    ? 'red'
    : orderedReasons.length > 0
      ? 'yellow'
      : 'green'
  return {
    implementation: percent(implementation, total),
    product_acceptance: percent(accepted, total),
    health,
    reasons: orderedReasons,
  }
}

export function shouldMergeFinalAcceptance(options: {
  last_milestone_id: string
  final_checkpoint_id: string
  plan_revision_equal: boolean
  evidence_digest_equal: boolean
  no_new_risks_or_decisions: boolean
}): boolean {
  return options.last_milestone_id === options.final_checkpoint_id
    && options.plan_revision_equal
    && options.evidence_digest_equal
    && options.no_new_risks_or_decisions
}

export function determineFinalEligibility(options: {
  milestones: readonly ProgressMilestone[]
  final_verdict: ProductManagerVerdict | null
  final_user_accepted: boolean
  required_gates_passed: boolean
  blockers: string[]
  final_evidence_refs: string[]
}): {
  eligible: boolean
  conclusion: 'completed' | 'completed_with_overrides' | 'blocked'
  reasons: string[]
} {
  const reasons: string[] = []
  const incomplete = options.milestones
    .filter(milestone => !['completed', 'user_overridden'].includes(milestone.status))
    .map(milestone => `${milestone.id}:${milestone.status}`)
  const overrides = options.milestones
    .filter(milestone => milestone.status === 'user_overridden')
    .map(milestone => `${milestone.id}:user_overridden`)
  reasons.push(...incomplete, ...options.blockers)
  reasons.push(...options.milestones
    .filter(milestone =>
      ['completed', 'user_overridden'].includes(milestone.status)
      && (milestone.evidence_refs?.length ?? 0) === 0,
    )
    .map(milestone => `${milestone.id}:evidence_missing`))
  if (options.final_verdict !== 'accepted')
    reasons.push(`final_verdict:${options.final_verdict ?? 'missing'}`)
  if (!options.final_user_accepted)
    reasons.push('final_user_acceptance:missing')
  if (!options.required_gates_passed)
    reasons.push('required_gates:failed')
  if (options.final_evidence_refs.length === 0)
    reasons.push('final_evidence:missing')
  if (reasons.length > 0)
    return { eligible: false, conclusion: 'blocked', reasons }
  if (overrides.length > 0)
    return { eligible: true, conclusion: 'completed_with_overrides', reasons: overrides }
  return { eligible: true, conclusion: 'completed', reasons: [] }
}
