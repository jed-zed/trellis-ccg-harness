import { describe, expect, it } from 'vitest'
import { smokeMcpServer } from '../mcp-smoke'

const successServer = String.raw`
let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  buffer += chunk
  for (;;) {
    const newline = buffer.indexOf('\n')
    if (newline < 0) break
    const line = buffer.slice(0, newline)
    buffer = buffer.slice(newline + 1)
    if (!line.trim()) continue
    const message = JSON.parse(line)
    if (message.method === 'initialize') {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: message.params.protocolVersion,
          capabilities: {},
          serverInfo: { name: 'fake-mcp', version: '1.0.0' }
        }
      }) + '\n')
    }
    if (message.method === 'notifications/initialized') process.exit(0)
  }
})
setInterval(() => {}, 1000)
`

describe('bounded opt-in MCP smoke', () => {
  it('performs the official newline-delimited initialize handshake', async () => {
    const report = await smokeMcpServer(
      'fake',
      {
        type: 'stdio',
        command: process.execPath,
        args: ['-e', successServer],
      },
      { timeoutMs: 2_000 },
    )

    expect(report.status).toBe('passed')
    expect(report.protocolVersion).toBe('2025-11-25')
    expect(report.serverInfo).toEqual({ name: 'fake-mcp', version: '1.0.0' })
    expect(report.transport).toBe('stdio')
  })

  it('times out, terminates the process tree, and reports no command arguments', async () => {
    let pid: number | undefined
    const report = await smokeMcpServer(
      'timeout',
      {
        type: 'stdio',
        command: process.execPath,
        args: ['-e', 'setInterval(() => {}, 1000)', 'sensitive-argument'],
      },
      {
        timeoutMs: 100,
        onSpawn(childPid) {
          pid = childPid
        },
      },
    )

    expect(report.status).toBe('failed')
    expect(report.error).toMatch(/timed out/i)
    expect(report.error).not.toContain('sensitive-argument')
    if (pid)
      expect(() => process.kill(pid!, 0)).toThrow()
  })

  it('redacts environment secrets and bounded stderr on failure', async () => {
    const secret = 'smoke-secret-value'
    const report = await smokeMcpServer(
      'failure',
      {
        type: 'stdio',
        command: process.execPath,
        args: [
          '-e',
          'process.stderr.write(process.env.SMOKE_SECRET); process.exit(2)',
        ],
        env: { SMOKE_SECRET: secret },
      },
      // Keep the production default unchanged while allowing the spawned Node
      // fixture to start on a saturated Windows test worker.
      { timeoutMs: 8_000 },
    )

    expect(report.status).toBe('failed')
    expect(report.error).not.toContain(secret)
    expect(report.error).toContain('[REDACTED]')
  }, 15_000)

  it('redacts legacy credential arguments if a child echoes them', async () => {
    const secret = 'legacy-argv-secret-value'
    const report = await smokeMcpServer(
      'legacy-argv',
      {
        type: 'stdio',
        command: process.execPath,
        args: [
          '-e',
          'process.stderr.write(process.argv[1]); process.exit(2)',
          secret,
        ],
      },
      { timeoutMs: 8_000 },
    )

    expect(report.status).toBe('failed')
    expect(report.error).not.toContain(secret)
    expect(report.error).toContain('[REDACTED]')
  }, 15_000)

  it('skips non-stdio transports without making a network request', async () => {
    const report = await smokeMcpServer('remote', {
      type: 'sse',
      url: 'https://example.invalid/mcp',
    })

    expect(report).toMatchObject({
      name: 'remote',
      transport: 'sse',
      status: 'skipped',
    })
  })
})
