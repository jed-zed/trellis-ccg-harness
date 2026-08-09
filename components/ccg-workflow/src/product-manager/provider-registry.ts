import type { ModelType } from '../types'
import type { ProductManagerProvider } from './contracts'
import { isAbsolute } from 'node:path'

export const IMPLEMENTED_PRODUCT_MANAGER_PROVIDERS: readonly ProductManagerProvider[] = ['codex', 'gemini', 'claude']

export const CLAUDE_SSH_ENVIRONMENT_KEYS = [
  'CCG_PRODUCT_MANAGER_CLAUDE_SSH_EXECUTABLE',
  'CCG_PRODUCT_MANAGER_CLAUDE_SSH_HOST',
  'CCG_PRODUCT_MANAGER_CLAUDE_SSH_USER',
  'CCG_PRODUCT_MANAGER_CLAUDE_SSH_PORT',
  'CCG_PRODUCT_MANAGER_CLAUDE_SSH_IDENTITY_FILE',
  'CCG_PRODUCT_MANAGER_CLAUDE_SSH_KNOWN_HOSTS_FILE',
  'CCG_PRODUCT_MANAGER_CLAUDE_SSH_REMOTE_EXECUTABLE',
] as const

export type ProviderEnvironmentKey
  = | 'CODEX_HOME'
    | 'GEMINI_CLI_HOME'
    | typeof CLAUDE_SSH_ENVIRONMENT_KEYS[number]

export function resolveEffectiveProductManagerProvider(options: {
  enabled: boolean
  selected: ModelType | ''
  implemented: readonly ProductManagerProvider[]
  allowed: readonly ProductManagerProvider[]
}):
  | { status: 'ready', provider: ProductManagerProvider }
  | { status: 'disabled' }
  | { status: 'unavailable', reason: string, selected: ModelType | '' } {
  if (!options.enabled)
    return { status: 'disabled' }
  if (!options.selected)
    return { status: 'unavailable', reason: 'provider_not_selected', selected: '' }
  if (!options.implemented.includes(options.selected))
    return { status: 'unavailable', reason: 'selected_provider_not_implemented', selected: options.selected }
  const provider = options.selected as ProductManagerProvider
  if (!options.allowed.includes(provider))
    return { status: 'unavailable', reason: 'selected_provider_not_allowed', selected: options.selected }
  return { status: 'ready', provider }
}

export interface ProviderExecution {
  executable: string
  args: string[]
  environmentKeys?: ProviderEnvironmentKey[]
  shell: false
}

export function validateProviderExecution(value: ProviderExecution): ProviderExecution {
  if (!isAbsolute(value.executable))
    throw new TypeError('provider executable must be an absolute trusted path')
  if (value.shell !== false)
    throw new TypeError('provider execution must use shell:false')
  if (value.args.some(argument => /[\0\r\n]/.test(argument)))
    throw new TypeError('provider arguments must not contain control characters')
  if (value.environmentKeys?.some(key => ![
    'CODEX_HOME',
    'GEMINI_CLI_HOME',
    ...CLAUDE_SSH_ENVIRONMENT_KEYS,
  ].includes(key)))
    throw new TypeError('provider environment contains an unsupported key')
  return value
}
