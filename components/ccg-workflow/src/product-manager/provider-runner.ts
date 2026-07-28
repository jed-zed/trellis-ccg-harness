import type { ProviderExecution } from './provider-registry'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { validateProviderExecution } from './provider-registry'

const BASE_ENV_ALLOWLIST = [
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
] as const

const TERMINATION_GRACE_MS = 5_000
const STDERR_DIAGNOSTIC_LIMIT_BYTES = 4_096

export function buildProductManagerProviderEnvironment(execution: ProviderExecution): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    CCG_PRODUCT_MANAGER_READ_ONLY: '1',
    I18NEXT_NO_SUPPORT_NOTICE: '1',
    NO_COLOR: '1',
  }
  for (const key of [...BASE_ENV_ALLOWLIST, ...(execution.environmentKeys ?? [])]) {
    if (process.env[key])
      environment[key] = process.env[key]
  }
  return environment
}

function terminateProviderProcessTree(child: ChildProcessWithoutNullStreams): void {
  if (!child.pid)
    return

  if (process.platform === 'win32') {
    const systemRoot = process.env.SystemRoot || process.env.WINDIR
    const taskkill = systemRoot ? join(systemRoot, 'System32', 'taskkill.exe') : ''
    if (taskkill && existsSync(taskkill)) {
      const result = spawnSync(taskkill, ['/PID', String(child.pid), '/T', '/F'], {
        shell: false,
        stdio: 'ignore',
        timeout: TERMINATION_GRACE_MS,
        windowsHide: true,
      })
      if (result.status === 0)
        return
    }
    child.kill('SIGKILL')
    return
  }

  try {
    process.kill(-child.pid, 'SIGKILL')
  }
  catch {
    child.kill('SIGKILL')
  }
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
      env: buildProductManagerProviderEnvironment(execution),
      detached: process.platform !== 'win32',
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const stdout: Buffer[] = []
    const stderrDiagnostic: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let stderrDiagnosticBytes = 0
    let stderrDiagnosticTruncated = false
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let terminationTimer: ReturnType<typeof setTimeout> | undefined
    let terminationError: Error | undefined
    const providerError = (message: string) => {
      const diagnostic = Buffer.concat(stderrDiagnostic)
        .toString('utf8')
        .replace(/\s+/g, ' ')
        .trim()
      if (!diagnostic)
        return new Error(message)
      return new Error(
        `${message}; stderr: ${diagnostic}${stderrDiagnosticTruncated ? ' [truncated]' : ''}`,
      )
    }
    const finish = (error?: Error, value?: string) => {
      if (settled)
        return
      settled = true
      if (timer)
        clearTimeout(timer)
      if (terminationTimer)
        clearTimeout(terminationTimer)
      if (error)
        reject(error)
      else
        resolve(value ?? '')
    }
    const terminate = (error: Error) => {
      if (terminationError)
        return
      terminationError = error
      child.stdin.destroy()
      terminateProviderProcessTree(child)
      terminationTimer = setTimeout(() => {
        child.stdout.destroy()
        child.stderr.destroy()
        child.unref()
        finish(error)
      }, TERMINATION_GRACE_MS)
      terminationTimer.unref()
    }
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length
      if (stdoutBytes > options.maxOutputBytes) {
        terminate(new Error('product-manager provider output exceeded the configured limit'))
        return
      }
      stdout.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length
      const remaining = STDERR_DIAGNOSTIC_LIMIT_BYTES - stderrDiagnosticBytes
      if (remaining > 0) {
        const captured = chunk.subarray(0, remaining)
        stderrDiagnostic.push(captured)
        stderrDiagnosticBytes += captured.length
      }
      if (chunk.length > remaining)
        stderrDiagnosticTruncated = true
      if (stderrBytes > options.maxOutputBytes)
        terminate(providerError('product-manager provider output exceeded the configured limit'))
    })
    child.on('error', error => finish(providerError(`product-manager provider failed to start: ${error.message}`)))
    child.on('close', (code) => {
      if (terminationError)
        finish(terminationError)
      else if (code !== 0)
        finish(providerError(`product-manager provider exited with code ${code}`))
      else
        finish(undefined, Buffer.concat(stdout).toString('utf8').trim())
    })
    timer = setTimeout(() => {
      terminate(providerError('product-manager provider timed out'))
    }, options.timeoutMs)
    child.stdin.on('error', () => {
      // A provider terminated during input delivery is reported by error/close.
    })
    child.stdin.end(options.input, 'utf8')
  })
}
