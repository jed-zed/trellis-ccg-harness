import type { ProductManagerTrigger } from './contracts'

export type ProductManagerCommandEffect
  = | 'new_product_task'
    | 'plan_draft_ready'
    | 'material_drift'
    | 'candidate_milestone'
    | 'evidence_only'
    | 'implicit_user_deliverable'
    | 'blocking_failure'
    | 'delegated_workflow'

export const PRODUCT_MANAGER_COMMAND_GROUPS = {
  product_entry: [
    'go',
    'workflow',
    'feat',
    'plan',
    'spec-research',
    'spec-plan',
    'team',
    'team-research',
    'team-plan',
    'gptpro-plan',
  ],
  implementation: [
    'backend',
    'frontend',
    'debug',
    'optimize',
    'test',
    'execute',
    'excute',
    'codex-exec',
    'spec-impl',
    'team-exec',
    'gptpro-exc',
  ],
  review_evidence: [
    'review',
    'spec-review',
    'team-review',
    'gptpro-review',
    'verify-change',
    'verify-module',
    'verify-quality',
    'verify-security',
    'grok-verify',
  ],
  analysis_evidence: [
    'analyze',
    'enhance',
    'grok-intel',
    'gemini-preview',
    'gen-docs',
  ],
  lifecycle_tooling: [
    'ccg',
    'doctor',
    'init',
    'spec-init',
    'context',
    'commit',
    'rollback',
    'clean-branches',
    'worktree',
  ],
} as const

export type ProductManagerCommandGroup = keyof typeof PRODUCT_MANAGER_COMMAND_GROUPS

const GROUP_BY_COMMAND = new Map<string, ProductManagerCommandGroup>(
  Object.entries(PRODUCT_MANAGER_COMMAND_GROUPS)
    .flatMap(([group, commands]) => commands.map(command => [
      command,
      group as ProductManagerCommandGroup,
    ] as const)),
)

export function classifyProductManagerCommand(command: string): ProductManagerCommandGroup | null {
  return GROUP_BY_COMMAND.get(command) ?? null
}

export function productManagerTriggerCandidates(
  command: string,
  effect: ProductManagerCommandEffect,
): ProductManagerTrigger[] {
  const group = classifyProductManagerCommand(command)
  if (!group)
    return []
  if (effect === 'new_product_task' && group === 'product_entry' && command !== 'enhance')
    return ['INTAKE_REVIEW']
  if (effect === 'plan_draft_ready' && group === 'product_entry')
    return ['PLAN_REVIEW']
  if (effect === 'material_drift')
    return ['DRIFT_REVIEW']
  if (effect === 'blocking_failure' && group === 'lifecycle_tooling')
    return ['DRIFT_REVIEW']
  if (effect === 'candidate_milestone' && ['implementation', 'review_evidence'].includes(group))
    return ['MILESTONE_REVIEW']
  if (effect === 'implicit_user_deliverable' && ['analysis_evidence', 'review_evidence'].includes(group))
    return ['MILESTONE_REVIEW']
  return []
}
