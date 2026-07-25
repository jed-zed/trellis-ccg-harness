import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

  it('does not pass unrelated parent credentials to an MCP child', async () => {
    const key = `CCG_UNRELATED_SECRET_${Date.now()}`
    const secret = 'unrelated-parent-secret-value'
    process.env[key] = secret
    try {
      const report = await smokeMcpServer(
        'environment-isolation',
        {
          type: 'stdio',
          command: process.execPath,
          args: [
            '-e',
            `if (process.env.${key}) { process.stderr.write(process.env.${key}); process.exit(2) }\n${successServer}`,
          ],
        },
        { timeoutMs: 8_000 },
      )

      expect(report.status).toBe('passed')
      expect(JSON.stringify(report)).not.toContain(secret)
    }
    finally {
      delete process.env[key]
    }
  }, 15_000)

  it('redacts launcher-backed secrets loaded from the private specification', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'ccg launcher smoke '))
    const secret = 'launcher-private-secret-value'
    try {
      const secretsDir = join(homeDir, '.claude', '.ccg', 'secrets')
      const launcherDir = join(homeDir, '.claude', '.ccg', 'engine', 'tools')
      const launcherPath = join(launcherDir, 'mcp-secret-launcher.mjs')
      const secretPath = join(secretsDir, 'launcher-smoke.json')
      await mkdir(secretsDir, { recursive: true, mode: 0o700 })
      await mkdir(launcherDir, { recursive: true, mode: 0o700 })
      await writeFile(launcherPath, '// smoke fixture\n', { mode: 0o700 })
      await writeFile(secretPath, `${JSON.stringify({
        schemaVersion: 1,
        serverId: 'launcher-smoke',
        command: process.execPath,
        args: [
          '-e',
          'process.stderr.write(process.env.LAUNCHER_PRIVATE_KEY); process.exit(2)',
        ],
        env: { LAUNCHER_PRIVATE_KEY: secret },
      }, null, 2)}\n`, { mode: 0o600 })

      const report = await smokeMcpServer(
        'launcher-backed',
        {
          type: 'stdio',
          command: 'node',
          args: [launcherPath, secretPath],
        },
        { timeoutMs: 8_000, secretHomeDir: homeDir },
      )

      expect(report.status).toBe('failed')
      expect(report.error).not.toContain(secret)
      expect(report.error).toContain('[REDACTED]')
    }
    finally {
      await rm(homeDir, { recursive: true, force: true })
    }
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
