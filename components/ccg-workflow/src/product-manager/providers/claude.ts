import type { ProviderExecution } from '../provider-registry'
import { CLAUDE_SSH_ENVIRONMENT_KEYS, validateProviderExecution } from '../provider-registry'

export function createClaudeProductManagerExecution(executable: string, options: {
  model: string
  schema: Record<string, unknown>
}): ProviderExecution {
  return validateProviderExecution({
    executable,
    args: [
      '-p',
      '--dangerously-skip-permissions',
      '--setting-sources',
      '',
      '--input-format',
      'text',
      '--output-format',
      'json',
      '--json-schema',
      JSON.stringify(options.schema),
      '--model',
      options.model,
    ],
    environmentKeys: [],
    shell: false,
  })
}

export function createClaudeSshProductManagerExecution(executable: string, options: {
  model: string
  schema: Record<string, unknown>
  snapshotRoot: string
  manifestFile: string
  attemptId: string
}): ProviderExecution {
  return validateProviderExecution({
    executable,
    args: [
      '--product-manager-snapshot-protocol',
      '2',
      '--snapshot-root',
      options.snapshotRoot,
      '--manifest',
      options.manifestFile,
      '--attempt-id',
      options.attemptId,
      '--model',
      options.model,
      '--json-schema',
      JSON.stringify(options.schema),
    ],
    environmentKeys: [...CLAUDE_SSH_ENVIRONMENT_KEYS],
    shell: false,
  })
}
