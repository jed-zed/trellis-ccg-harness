import { describe, expect, it } from 'vitest'
import {
  classifyProductManagerCommand,
  PRODUCT_MANAGER_COMMAND_GROUPS,
  productManagerTriggerCandidates,
} from '../event-mapping'

describe('product-manager command event mapping', () => {
  it('classifies the exact 44 existing commands once', () => {
    const commands = Object.values(PRODUCT_MANAGER_COMMAND_GROUPS).flat()
    expect(commands).toHaveLength(44)
    expect(new Set(commands).size).toBe(44)
    expect(commands.every(command => classifyProductManagerCommand(command) !== null)).toBe(true)
  })

  it('returns events from actual effects rather than command names alone', () => {
    expect(productManagerTriggerCandidates('plan', 'new_product_task')).toEqual(['INTAKE_REVIEW'])
    expect(productManagerTriggerCandidates('plan', 'plan_draft_ready')).toEqual(['PLAN_REVIEW'])
    expect(productManagerTriggerCandidates('execute', 'evidence_only')).toEqual([])
    expect(productManagerTriggerCandidates('execute', 'material_drift')).toEqual(['DRIFT_REVIEW'])
    expect(productManagerTriggerCandidates('review', 'candidate_milestone')).toEqual(['MILESTONE_REVIEW'])
    expect(productManagerTriggerCandidates('analyze', 'implicit_user_deliverable')).toEqual(['MILESTONE_REVIEW'])
    expect(productManagerTriggerCandidates('commit', 'blocking_failure')).toEqual(['DRIFT_REVIEW'])
  })
})
