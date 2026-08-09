import type { ChildProcess, spawn as nodeSpawn } from 'node:child_process'
import type { ModelType } from '../types'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'fs-extra'
import { join } from 'pathe'
import { resolveCodexHome } from '../utils/codex-mode'
import { verifyBinaryVersion } from '../utils/installer'
import { assertManagedPath } from '../utils/managed-path'
import { isRegisteredModel } from '../utils/model-routing'
import { resolveClaudeExecutable } from './product-manager'

type Spawn = typeof nodeSpawn

export function parseWrapperBackend(args: readonly string[]): ModelType {
  const providers: string[] = []
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--backend') {
      if (!args[index + 1] || args[index + 1].startsWith('-'))
        throw new Error('--backend requires one provider value.')
      providers.push(args[++index])
    }
    else if (args[index].startsWith('--backend=')) {
      providers.push(args[index].slice('--backend='.length))
    }
  }
  if (providers.length !== 1)
    throw new Error('ccg wrapper requires exactly one explicit --backend provider.')
  const provider = providers[0]
  if (!isRegisteredModel(provider))
    throw new Error(`Unknown wrapper backend: ${provider}`)
  if (provider === 'claude' && !args.includes('--read-only'))
    throw new Error('Managed Claude wrapper calls require --read-only.')
  return provider
}

async function resolveVerifiedWrapper(codexHome: string): Promise<string> {
  const wrapperName = process.platform === 'win32' ? 'codeagent-wrapper.exe' : 'codeagent-wrapper'
  const relativePath = `ccg/bin/${wrapperName}`
  const wrapperPath = await assertManagedPath(codexHome, relativePath, 'file')
  const ownershipPath = await assertManagedPath(codexHome, '.ccg/ownership.json', 'file')
  const ownership = await fs.readJSON(ownershipPath)
  const owned = Array.isArray(ownership?.files)
    ? ownership.files.find((file: unknown) => (
      typeof file === 'object'
      && file !== null
      && (file as Record<string, unknown>).relativePath === relativePath
      && typeof (file as Record<string, unknown>).installedSha256 === 'string'
    )) as { installedSha256: string } | undefined
    : undefined
  const digest = createHash('sha256').update(await fs.readFile(wrapperPath)).digest('hex')
  if (!owned || owned.installedSha256 !== digest || !(await verifyBinaryVersion(join(codexHome, 'ccg')))) {
    throw new Error(
      'Managed codeagent-wrapper is missing or invalid. Run `ccg codex-mode install` to repair it.',
    )
  }
  return wrapperPath
}

export function spawnWrapperProcess(
  executable: string,
  args: readonly string[],
  spawnImpl: Spawn = spawn,
  environment: NodeJS.ProcessEnv = {},
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawnImpl(executable, [...args], {
      env: { ...process.env, ...environment, CCG_CODEX_MANAGED_WRAPPER: '1' },
      shell: false,
      stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (signal)
        process.kill(process.pid, signal)
      resolve(code ?? 1)
    })
  })
}

export async function runWrapper(args: readonly string[]): Promise<number> {
  const backend = parseWrapperBackend(args)
  const wrapperPath = await resolveVerifiedWrapper(resolveCodexHome())
  if (backend !== 'claude')
    return spawnWrapperProcess(wrapperPath, args)
  const claudeExecutable = resolveClaudeExecutable()
  if (!claudeExecutable)
    throw new Error(
      'Trusted native Claude executable not found. Set CCG_PRODUCT_MANAGER_CLAUDE_EXECUTABLE to its canonical path.',
    )
  return spawnWrapperProcess(wrapperPath, args, spawn, { CCG_CLAUDE_EXECUTABLE: claudeExecutable })
}
