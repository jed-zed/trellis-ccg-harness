import type { ProviderExecution } from '../provider-registry'
import { validateProviderExecution } from '../provider-registry'

export function createGeminiProductManagerExecution(nodeExecutable: string, options: {
  entrypoint: string
  model: string
}): ProviderExecution {
  return validateProviderExecution({
    executable: nodeExecutable,
    args: [
      options.entrypoint,
      '-y',
      '--output-format',
      'json',
      '--model',
      options.model,
      '--prompt',
      'Read the complete product-manager request from stdin and return only the requested JSON object.',
    ],
    environmentKeys: ['GEMINI_CLI_HOME'],
    shell: false,
  })
}
