import type { ProductManagerProvider } from './contracts'
import { isAbsolute } from 'node:path'

export const IMPLEMENTED_PRODUCT_MANAGER_PROVIDERS: readonly ProductManagerProvider[] = ['codex', 'gemini']

export function resolveEffectiveProductManagerProvider(options: {
  enabled: boolean
  selected: ProductManagerProvider | ''
  implemented: readonly ProductManagerProvider[]
  allowed: readonly ProductManagerProvider[]
}):
  | { status: 'ready', provider: ProductManagerProvider }
  | { status: 'disabled' }
  | { status: 'unavailable', reason: string, selected: ProductManagerProvider | '' } {
  if (!options.enabled)
    return { status: 'disabled' }
  if (!options.selected)
    return { status: 'unavailable', reason: 'provider_not_selected', selected: '' }
  if (!options.implemented.includes(options.selected))
    return { status: 'unavailable', reason: 'selected_provider_not_implemented', selected: options.selected }
  if (!options.allowed.includes(options.selected))
    return { status: 'unavailable', reason: 'selected_provider_not_allowed', selected: options.selected }
  return { status: 'ready', provider: options.selected }
}

export interface ProviderExecution {
  executable: string
  args: string[]
  readOnly: boolean
  shell: false
}

export function validateProviderExecution(value: ProviderExecution): ProviderExecution {
  if (!isAbsolute(value.executable))
    throw new TypeError('provider executable must be an absolute trusted path')
  if (!value.readOnly)
    throw new TypeError('provider execution must be read-only')
  if (value.shell !== false)
    throw new TypeError('provider execution must use shell:false')
  if (value.args.some(argument => /[\0\r\n]/.test(argument)))
    throw new TypeError('provider arguments must not contain control characters')
  return value
}
