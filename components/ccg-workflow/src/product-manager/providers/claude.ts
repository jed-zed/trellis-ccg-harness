import type { ProviderExecution } from '../provider-registry'
import { CLAUDE_SSH_ENVIRONMENT_KEYS, validateProviderExecution } from '../provider-registry'

export function createClaudeProductManagerExecution(executable: string, options: {
  model: string
  schema: Record<string, unknown>
}): ProviderExecution {
  return validateProviderExecution({
    executable,
    args: [
      '--safe-mode',
      '--disable-slash-commands',
      '--tools',
      'Read,Glob,Grep',
      '--strict-mcp-config',
      '--mcp-config',
      '{"mcpServers":{}}',
      '--setting-sources',
      '',
      '--settings',
      '{}',
      '--no-session-persistence',
      '--no-chrome',
      '--permission-mode',
      'plan',
      '--input-format',
      'text',
      '--output-format',
      'json',
      '--json-schema',
      JSON.stringify(options.schema),
      '--model',
      options.model,
      '--system-prompt',
      [
        'You are a read-only product-manager reviewer.',
        'Read only the provided workspace snapshot with Read, Glob, and Grep.',
        'Do not write or edit files, run commands, or use MCP servers, hooks, skills, plugins, browsers, sessions, or subagents.',
        'Return only the structured object required by the supplied JSON Schema.',
      ].join(' '),
      '--print',
    ],
    environmentKeys: [],
    readOnly: true,
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
    readOnly: true,
    shell: false,
  })
}
