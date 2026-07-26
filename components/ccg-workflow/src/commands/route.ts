import { spawnSync } from 'node:child_process'
import { join } from 'pathe'
import { PACKAGE_ROOT } from '../utils/installer-template'

export function runCodexRoute(args: string[]): number {
  const routePath = join(
    PACKAGE_ROOT,
    'templates',
    'engine',
    'tools',
    'grok-intelligence',
    'route.mjs',
  )
  const result = spawnSync(process.execPath, [routePath, ...args], {
    stdio: 'inherit',
    windowsHide: true,
  })
  if (result.error)
    throw result.error
  return result.status ?? 1
}
