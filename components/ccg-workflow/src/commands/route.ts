import { spawnSync } from 'node:child_process'
import { join } from 'pathe'
import { PACKAGE_ROOT } from '../utils/installer-template'
import { providerToolEnvironment } from '../utils/provider-tools'
import { getConfigPath } from '../utils/config'
import { assertCodexHostPath } from '../utils/host-boundary'

export function prepareCodexRouteArgs(args: readonly string[]): string[] {
  let selectedConfig: string | undefined
  const forwarded: string[] = []
  for (let index = 0; index < args.length; index++) {
    let configPath: string | undefined
    if (args[index] === '--config') {
      configPath = args[++index]
      if (!configPath || configPath.startsWith('--'))
        throw new Error('--config requires a configuration path.')
    }
    else if (args[index].startsWith('--config=')) {
      configPath = args[index].slice('--config='.length)
    }
    else {
      forwarded.push(args[index])
    }
    if (configPath !== undefined) {
      assertCodexHostPath(configPath)
      selectedConfig = configPath
    }
  }
  // Recovery and waiver operate only on a project state file. Ordinary routes
  // must receive the selected Codex home explicitly; the generic engine's
  // historical fallback does not honor CODEX_HOME or --config=path syntax.
  if (selectedConfig === undefined && ['recover', 'waive'].includes(args[0]))
    return forwarded
  return [...forwarded, '--config', selectedConfig ?? getConfigPath()]
}

export function runCodexRoute(args: string[]): number {
  const routeArgs = prepareCodexRouteArgs(args)
  const routePath = join(
    PACKAGE_ROOT,
    'templates',
    'engine',
    'tools',
    'grok-intelligence',
    'route.mjs',
  )
  let env = { ...process.env }
  for (const backend of ['kimi', 'opencode'] as const) {
    const prefix = env[`CCG_${backend.toUpperCase()}_PREFIX`]
    if (prefix)
      env = providerToolEnvironment(backend, prefix, env)
  }
  const result = spawnSync(process.execPath, [routePath, ...routeArgs], {
    env,
    stdio: 'inherit',
    windowsHide: true,
  })
  if (result.error)
    throw result.error
  return result.status ?? 1
}
