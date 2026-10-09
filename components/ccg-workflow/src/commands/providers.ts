import { configureProviderRouting } from './config-routing'
import { assertOptionalProvider, doctorProviderTool, installProviderTool, PROVIDER_PACKAGES } from '../utils/provider-tools'

export interface ProvidersCommandOptions {
  backend?: string
  prefix?: string
  shellPath?: string
  model?: string
  role?: string
  json?: boolean
}

export async function providers(action: string, options: ProvidersCommandOptions): Promise<void> {
  if (!['doctor', 'install', 'configure'].includes(action))
    throw new Error('providers action must be doctor, install, or configure')
  if (!options.backend)
    throw new Error('providers requires an explicit --backend kimi or opencode')
  assertOptionalProvider(options.backend)
  if (!options.prefix)
    throw new Error('providers requires an explicit --prefix <absolute private directory>')
  const toolOptions = { backend: options.backend, prefix: options.prefix, shellPath: options.shellPath }
  const report = action === 'install' ? await installProviderTool(toolOptions) : await doctorProviderTool(toolOptions)
  if (!report.ok) {
    if (options.json)
      console.log(JSON.stringify(report, null, 2))
    throw new Error(`${options.backend} is not ready: ${report.issues.join('; ')}. Official setup: ${PROVIDER_PACKAGES[options.backend].docs}`)
  }
  if (action === 'configure') {
    const routing = await configureProviderRouting(options.backend, { model: options.model, role: options.role })
    console.log(options.json ? JSON.stringify({ ...report, routing }, null, 2) : `${options.backend} routing saved. Authentication was not checked; execute only with explicit native approval acknowledgement.`)
    return
  }
  const bin = options.backend === 'kimi' ? report.prefix : `${report.prefix}/bin`
  console.log(options.json ? JSON.stringify(report, null, 2) : `${options.backend}@${report.version}: local startup OK; authentication not checked. Private commands: ${bin}. Use CCG_${options.backend.toUpperCase()}_PREFIX=${report.prefix} for this process.`)
}
