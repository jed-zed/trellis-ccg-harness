import type { ProviderExecution } from '../provider-registry'
import { validateProviderExecution } from '../provider-registry'

export function createCodexProductManagerExecution(executable: string, options: {
  model: string
  workspace: string
  schemaFile: string
}): ProviderExecution {
  const disabledFeatures = [
    'apps',
    'browser_use',
    'browser_use_external',
    'computer_use',
    'enable_mcp_apps',
    'goals',
    'hooks',
    'image_generation',
    'in_app_browser',
    'multi_agent',
    'multi_agent_v2',
    'plugins',
    'shell_tool',
    'skill_mcp_dependency_install',
    'standalone_web_search',
    'tool_call_mcp_elicitation',
    'unified_exec',
    'workspace_dependencies',
  ]
  return validateProviderExecution({
    executable,
    args: [
      'exec',
      '--strict-config',
      ...disabledFeatures.flatMap(feature => ['--disable', feature]),
      '--sandbox',
      'read-only',
      '--ephemeral',
      '--ignore-user-config',
      '--ignore-rules',
      '--skip-git-repo-check',
      '--output-schema',
      options.schemaFile,
      '--model',
      options.model,
      '--cd',
      options.workspace,
      '-',
    ],
    environmentKeys: ['CODEX_HOME'],
    readOnly: true,
    shell: false,
  })
}
