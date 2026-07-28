import type { ProviderExecution } from './provider-registry'
import { spawn } from 'node:child_process'
import { validateProviderExecution } from './provider-registry'

const ENV_ALLOWLIST = [
  'PATH',
  'Path',
  'SystemRoot',
  'WINDIR',
  'TEMP',
  'TMP',
  'HOME',
  'USERPROFILE',
  'LOCALAPPDATA',
  'APPDATA',
  'CODEX_HOME',
  'GEMINI_CLI_HOME',
] as const

function minimalEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    CCG_PRODUCT_MANAGER_READ_ONLY: '1',
    NO_COLOR: '1',
  }
  for (const key of ENV_ALLOWLIST) {
    if (process.env[key])
      environment[key] = process.env[key]
  }
  return environment
}

export async function executeReadOnlyProvider(options: {
  execution: ProviderExecution
  cwd: string
  input: string
  timeoutMs: number
  maxOutputBytes: number
}): Promise<string> {
  const execution = validateProviderExecution(options.execution)
  return await new Promise((resolve, reject) => {
    const child = spawn(execution.executable, execution.args, {
      cwd: options.cwd,
      env: minimalEnvironment(),
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const stdout: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (error?: Error, value?: string) => {
      if (settled)
        return
      settled = true
      if (timer)
        clearTimeout(timer)
      if (error)
        reject(error)
      else
        resolve(value ?? '')
    }
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length
      if (stdoutBytes > options.maxOutputBytes) {
        child.kill()
        finish(new Error('product-manager provider output exceeded the configured limit'))
        return
      }
      stdout.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length
      if (stderrBytes > options.maxOutputBytes)
        child.kill()
    })
    child.on('error', error => finish(new Error(`product-manager provider failed to start: ${error.message}`)))
    child.on('close', (code) => {
      if (code !== 0)
        finish(new Error(`product-manager provider exited with code ${code}`))
      else
        finish(undefined, Buffer.concat(stdout).toString('utf8').trim())
    })
    timer = setTimeout(() => {
      child.kill()
      finish(new Error('product-manager provider timed out'))
    }, options.timeoutMs)
    child.stdin.end(options.input, 'utf8')
  })
}
