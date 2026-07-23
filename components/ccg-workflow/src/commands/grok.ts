import ansis from 'ansis'
import fs from 'fs-extra'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'pathe'
import { PACKAGE_ROOT } from '../utils/installer-template'

export type GrokAccountAction = 'login' | 'status' | 'logout'

async function resolveManagerPath(): Promise<string> {
  const installed = join(homedir(), '.claude', '.ccg', 'engine', 'tools', 'grok-intelligence', 'manage.mjs')
  if (await fs.pathExists(installed)) return installed
  return join(PACKAGE_ROOT, 'templates', 'engine', 'tools', 'grok-intelligence', 'manage.mjs')
}

export async function grokAccount(action: string, options: { json?: boolean } = {}): Promise<void> {
  if (!['login', 'status', 'logout'].includes(action)) {
    console.error(ansis.red(`Unknown Grok action: ${action}. Use login, status, or logout.`))
    process.exitCode = 1
    return
  }
  const manager = await resolveManagerPath()
  const args = [manager, action]
  if (options.json && action === 'status') args.push('--json')
  const exitCode = await new Promise<number>((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: process.env,
      shell: false,
      stdio: 'inherit',
      windowsHide: action !== 'login',
    })
    child.once('error', rejectPromise)
    child.once('close', code => resolvePromise(code ?? 1))
  })
  if (exitCode !== 0) process.exitCode = exitCode
}
