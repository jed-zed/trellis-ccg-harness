import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { executeProvider } from '../provider-runner'

const cleanupPids = new Set<number>()

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  }
  catch {
    return false
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate())
      return true
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  return predicate()
}

afterEach(() => {
  for (const pid of cleanupPids) {
    if (processIsAlive(pid)) {
      try {
        process.kill(pid, 'SIGKILL')
      }
      catch {
        // Best-effort cleanup for an already-exited regression-test process.
      }
    }
  }
  cleanupPids.clear()
  vi.unstubAllEnvs()
})

describe('product-manager provider runner', () => {
  it('suppresses provider support notices so stdout remains machine-readable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ccg-provider-runner-'))
    const provider = [
      'if (process.env.I18NEXT_NO_SUPPORT_NOTICE !== "1") process.stdout.write("support notice\\n");',
      'process.stdout.write(JSON.stringify({ verdict: "unavailable" }));',
    ].join('')

    try {
      const output = await executeProvider({
        execution: {
          executable: process.execPath,
          args: ['-e', provider],
          shell: false,
        },
        cwd: root,
        input: '',
        timeoutMs: 5_000,
        maxOutputBytes: 1_024,
      })
      expect(JSON.parse(output)).toEqual({ verdict: 'unavailable' })
      expect(output).not.toContain('support notice')
    }
    finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('includes a bounded stderr diagnostic when the provider exits unsuccessfully', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ccg-provider-runner-'))
    const diagnostic = `provider rejected model ${'x'.repeat(6_000)}`

    try {
      await expect(executeProvider({
        execution: {
          executable: process.execPath,
          args: ['-e', `process.stderr.write(${JSON.stringify(diagnostic)}); process.exit(7)`],
          shell: false,
        },
        cwd: root,
        input: '',
        timeoutMs: 5_000,
        maxOutputBytes: 8_192,
      })).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(Error)
        const message = (error as Error).message
        expect(message).toContain('exited with code 7')
        expect(message).toContain('provider rejected model')
        expect(message).toContain('[truncated]')
        expect(Buffer.byteLength(message, 'utf8')).toBeLessThan(4_300)
        return true
      })
    }
    finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('redacts SSH transport details from provider diagnostics', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ccg-provider-runner-'))
    const host = 'private-review-host.example.test'
    vi.stubEnv('CCG_PRODUCT_MANAGER_CLAUDE_SSH_HOST', host)
    try {
      await expect(executeProvider({
        execution: {
          executable: process.execPath,
          args: ['-e', `process.stderr.write(${JSON.stringify(`host=${host}`)}); process.exit(7)`],
          environmentKeys: ['CCG_PRODUCT_MANAGER_CLAUDE_SSH_HOST'],
          shell: false,
        },
        cwd: root,
        input: '',
        timeoutMs: 5_000,
        maxOutputBytes: 1_024,
      })).rejects.toSatisfy((error: unknown) => {
        const message = (error as Error).message
        expect(message).toContain('[REDACTED]')
        expect(message).not.toContain(host)
        return true
      })
    }
    finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('terminates the provider process tree when the call times out', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ccg-provider-runner-'))
    const descendantPidFile = join(root, 'descendant.pid')
    const descendant = 'setInterval(() => {}, 1000)'
    const parent = [
      'const { spawn } = require("node:child_process");',
      'const { writeFileSync } = require("node:fs");',
      `const child = spawn(${JSON.stringify(process.execPath)}, ["-e", ${JSON.stringify(descendant)}], { stdio: "inherit" });`,
      'writeFileSync(process.argv[1], String(child.pid));',
      'setInterval(() => {}, 1000);',
    ].join('')

    try {
      await expect(executeProvider({
        execution: {
          executable: process.execPath,
          args: ['-e', parent, descendantPidFile],
          shell: false,
        },
        cwd: root,
        input: '',
        timeoutMs: 2_000,
        maxOutputBytes: 1024,
      })).rejects.toThrow(/timed out/i)

      expect(existsSync(descendantPidFile)).toBe(true)
      const descendantPid = Number(readFileSync(descendantPidFile, 'utf8'))
      cleanupPids.add(descendantPid)
      expect(await waitFor(() => !processIsAlive(descendantPid))).toBe(true)
    }
    finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 10_000)
})
