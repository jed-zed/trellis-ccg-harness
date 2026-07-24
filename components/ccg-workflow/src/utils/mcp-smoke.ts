import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { McpServerConfig } from './mcp'
import { spawn, spawnSync } from 'node:child_process'

export const MCP_SMOKE_PROTOCOL_VERSION = '2025-11-25'
const DEFAULT_TIMEOUT_MS = 3_000
const MAX_TIMEOUT_MS = 15_000
const MAX_STDOUT_BYTES = 256 * 1024
const MAX_STDERR_BYTES = 64 * 1024

export interface McpSmokeReport {
  name: string
  transport: 'stdio' | 'sse'
  status: 'passed' | 'failed' | 'skipped'
  protocolVersion?: string
  serverInfo?: {
    name?: string
    version?: string
  }
  durationMs?: number
  error?: string
}

export interface McpSmokeOptions {
  timeoutMs?: number
  onSpawn?: (pid: number | undefined) => void
}

type SmokeCompletion = Omit<McpSmokeReport, 'name' | 'transport' | 'durationMs'>

function sanitizeDiagnostic(value: string, secrets: string[]): string {
  let output = value
  for (const secret of secrets) {
    if (secret.length >= 4)
      output = output.replaceAll(secret, '[REDACTED]')
  }
  return output
    .replace(/(?:bearer|token|api[_-]?key|secret|password)\s*[:=]\s*[^\s,;]+/gi, '[REDACTED]')
    .replace(/https?:\/\/[^/\s:@]+:[^@\s/]+@/gi, 'https://[REDACTED]@')
    .replace(/([?&](?:api[_-]?key|access[_-]?token|token|secret|password)=)[^&#\s]+/gi, '$1[REDACTED]')
}

function boundedAppend(current: string, chunk: Buffer, maxBytes: number): string {
  const next = current + chunk.toString('utf8')
  if (Buffer.byteLength(next, 'utf8') > maxBytes)
    throw new Error(`MCP diagnostic output exceeded ${maxBytes} bytes`)
  return next
}

function hasExited(child: ChildProcessWithoutNullStreams): boolean {
  return child.exitCode !== null || child.signalCode !== null
}

async function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
  if (hasExited(child))
    return true
  return await new Promise((resolve) => {
    let timer: NodeJS.Timeout
    const onExit = () => {
      clearTimeout(timer)
      resolve(true)
    }
    timer = setTimeout(() => {
      child.off('exit', onExit)
      resolve(false)
    }, timeoutMs)
    child.once('exit', onExit)
  })
}

function terminateUnixTree(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
  if (!child.pid) {
    child.kill(signal)
    return
  }
  try {
    process.kill(-child.pid, signal)
  }
  catch {
    child.kill(signal)
  }
}

function terminateWindowsTree(child: ChildProcessWithoutNullStreams): void {
  if (!child.pid) {
    child.kill('SIGTERM')
    return
  }
  spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
    stdio: 'ignore',
    windowsHide: true,
  })
}

async function terminateProcessTree(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (hasExited(child))
    return
  child.stdin.end()
  if (await waitForExit(child, 100))
    return

  if (process.platform === 'win32')
    terminateWindowsTree(child)
  else
    terminateUnixTree(child, 'SIGTERM')
  if (await waitForExit(child, 300))
    return

  if (process.platform === 'win32')
    child.kill('SIGKILL')
  else
    terminateUnixTree(child, 'SIGKILL')
  await waitForExit(child, 300)
}

function resolveTimeout(value: number | undefined): number {
  const timeoutMs = value ?? DEFAULT_TIMEOUT_MS
  if (!Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > MAX_TIMEOUT_MS)
    throw new Error(`MCP smoke timeout must be between 50 and ${MAX_TIMEOUT_MS} ms.`)
  return timeoutMs
}

function initializeRequest(): string {
  return `${JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: MCP_SMOKE_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: 'ccg-mcp-diagnostic',
        version: '1.0.0',
      },
    },
  })}\n`
}

function initializedNotification(): string {
  return `${JSON.stringify({
    jsonrpc: '2.0',
    method: 'notifications/initialized',
  })}\n`
}

function extractServerInfo(message: any): McpSmokeReport['serverInfo'] {
  return {
    ...(typeof message.result?.serverInfo?.name === 'string'
      ? { name: message.result.serverInfo.name }
      : {}),
    ...(typeof message.result?.serverInfo?.version === 'string'
      ? { version: message.result.serverInfo.version }
      : {}),
  }
}

class StdioSmokeSession {
  private readonly startedAt = Date.now()
  private stderr = ''
  private stdout = ''
  private settled = false
  private timer: NodeJS.Timeout | undefined
  private resolveReport: ((report: McpSmokeReport) => void) | undefined

  constructor(
    private readonly name: string,
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly timeoutMs: number,
    private readonly secrets: string[],
  ) {}

  run(): Promise<McpSmokeReport> {
    return new Promise((resolve) => {
      this.resolveReport = resolve
      this.timer = setTimeout(
        () => this.fail(new Error(`MCP initialize timed out after ${this.timeoutMs}ms`)),
        this.timeoutMs,
      )
      this.child.once('error', error => this.fail(error))
      this.child.once('exit', (code, signal) => this.handleExit(code, signal))
      this.child.stderr.on('data', chunk => this.handleStderr(chunk))
      this.child.stdout.on('data', chunk => this.handleStdout(chunk))
      this.child.stdin.write(initializeRequest())
    })
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.settled)
      return
    this.fail(new Error(
      `MCP server exited before initialize completed (code=${code ?? 'null'}, signal=${signal ?? 'null'})`,
    ))
  }

  private handleStderr(chunk: Buffer): void {
    try {
      this.stderr = boundedAppend(this.stderr, chunk, MAX_STDERR_BYTES)
    }
    catch (error) {
      this.fail(error)
    }
  }

  private handleStdout(chunk: Buffer): void {
    try {
      this.stdout = boundedAppend(this.stdout, chunk, MAX_STDOUT_BYTES)
      this.consumeLines()
    }
    catch (error) {
      this.fail(error)
    }
  }

  private consumeLines(): void {
    for (;;) {
      const newline = this.stdout.indexOf('\n')
      if (newline < 0)
        return
      const line = this.stdout.slice(0, newline).trim()
      this.stdout = this.stdout.slice(newline + 1)
      if (line)
        this.handleLine(line)
      if (this.settled)
        return
    }
  }

  private handleLine(line: string): void {
    const message = JSON.parse(line)
    if (message.id !== 1)
      return
    if (message.error)
      throw new Error(`MCP initialize returned JSON-RPC error ${message.error.code ?? 'unknown'}`)
    const protocolVersion = message.result?.protocolVersion
    if (typeof protocolVersion !== 'string' || !protocolVersion)
      throw new Error('MCP initialize response has no protocolVersion')
    this.child.stdin.write(initializedNotification())
    void this.finish({
      status: 'passed',
      protocolVersion,
      serverInfo: extractServerInfo(message),
    })
  }

  private fail(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    void this.finish({
      status: 'failed',
      error: this.stderr.trim() ? `${message}: ${this.stderr.trim()}` : message,
    })
  }

  private async finish(completion: SmokeCompletion): Promise<void> {
    if (this.settled)
      return
    this.settled = true
    if (this.timer)
      clearTimeout(this.timer)
    await terminateProcessTree(this.child)
    this.resolveReport?.({
      name: this.name,
      transport: 'stdio',
      durationMs: Date.now() - this.startedAt,
      ...completion,
      ...(completion.error
        ? { error: sanitizeDiagnostic(completion.error, this.secrets) }
        : {}),
    })
  }
}

export async function smokeMcpServer(
  name: string,
  config: McpServerConfig,
  options: McpSmokeOptions = {},
): Promise<McpSmokeReport> {
  const transport = config.type === 'sse' || config.url ? 'sse' : 'stdio'
  if (transport !== 'stdio') {
    return {
      name,
      transport,
      status: 'skipped',
      error: 'Bounded smoke currently supports stdio servers only.',
    }
  }
  if (!config.command) {
    return {
      name,
      transport,
      status: 'failed',
      error: 'No stdio command is configured.',
    }
  }

  const timeoutMs = resolveTimeout(options.timeoutMs)
  const secrets = [
    ...Object.values(config.env ?? {}),
    ...(config.args ?? []).filter(arg => arg.length >= 4),
  ]
  try {
    const child = spawn(config.command, config.args ?? [], {
      cwd: process.cwd(),
      env: { ...process.env, ...(config.env ?? {}) },
      detached: process.platform !== 'win32',
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    options.onSpawn?.(child.pid)
    return await new StdioSmokeSession(name, child, timeoutMs, secrets).run()
  }
  catch (error) {
    return {
      name,
      transport,
      status: 'failed',
      error: sanitizeDiagnostic(
        error instanceof Error ? error.message : String(error),
        secrets,
      ),
    }
  }
}
