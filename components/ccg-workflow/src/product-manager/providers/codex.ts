import type { ProviderExecution } from '../provider-registry'
import { validateProviderExecution } from '../provider-registry'

export function createCodexProductManagerExecution(executable: string, options: {
  model: string
  workspace: string
  schemaFile: string
}): ProviderExecution {
  return validateProviderExecution({
    executable,
    args: [
      'exec',
      '--dangerously-bypass-approvals-and-sandbox',
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
    shell: false,
  })
}
