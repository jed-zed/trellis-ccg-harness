import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  appendInvocationAudit,
  readInvocationEvidence,
  resolveProductManagerEvidenceRoot,
  withInvocationLock,
  writeInvocationEvidence,
  writeInvocationRawResponse,
} from '../evidence-store'

async function fixture(): Promise<{ root: string, taskDir: string }> {
  const root = await mkdtemp(join(tmpdir(), 'ccg-pm-evidence-'))
  const taskDir = join(root, '.trellis', 'tasks', 'pm')
  await mkdir(taskDir, { recursive: true })
  await writeFile(join(taskDir, 'task.json'), '{"id":"pm"}\n', 'utf8')
  return { root, taskDir }
}

describe('product-manager evidence and locking', () => {
  it('requires a canonical Trellis task and reuses readable evidence', async () => {
    const value = await fixture()
    try {
      const key = 'a'.repeat(64)
      await writeInvocationEvidence({
        taskDir: value.taskDir,
        invocationKey: key,
        kind: 'result',
        value: { token: 'secret', verdict: 'accepted' },
      })
      expect(await readInvocationEvidence({
        taskDir: value.taskDir,
        invocationKey: key,
        kind: 'result',
      })).toEqual({ token: '[REDACTED]', verdict: 'accepted' })
      await writeInvocationEvidence({
        taskDir: value.taskDir,
        invocationKey: key,
        kind: 'input',
        value: { input_digest: key },
      })
      await writeInvocationEvidence({
        taskDir: value.taskDir,
        invocationKey: key,
        kind: 'provider-request',
        value: { provider: 'codex' },
      })
      await writeInvocationEvidence({
        taskDir: value.taskDir,
        invocationKey: key,
        kind: 'status',
        value: { status: 'completed' },
      })
      await writeInvocationRawResponse({
        taskDir: value.taskDir,
        invocationKey: key,
        value: { token: 'secret', verdict: 'accepted' },
      })
      const callRoot = join(
        resolveProductManagerEvidenceRoot(value.taskDir),
        'calls',
        key,
      )
      for (const file of [
        'input.json',
        'provider-request.json',
        'response.raw',
        'result.json',
        'status.json',
      ])
        expect(await readFile(join(callRoot, file), 'utf8')).not.toBe('')
      expect(() => resolveProductManagerEvidenceRoot(value.root)).toThrow(/Trellis task/i)
    }
    finally {
      await rm(value.root, { recursive: true, force: true })
    }
  })

  it('heartbeats a live lock and never removes a replacement owner lock', async () => {
    const value = await fixture()
    try {
      const key = 'b'.repeat(64)
      const root = resolveProductManagerEvidenceRoot(value.taskDir)
      const lock = join(root, 'locks', `${key}.lock`)
      let releaseAction!: () => void
      const actionGate = new Promise<void>((resolve) => {
        releaseAction = resolve
      })
      const running = withInvocationLock({
        taskDir: value.taskDir,
        invocationKey: key,
        staleAfterMs: 60,
        action: async () => {
          await new Promise(resolve => setTimeout(resolve, 90))
          const first = JSON.parse(await readFile(lock, 'utf8'))
          expect(first.nonce).toBeTypeOf('string')
          await writeFile(lock, `${JSON.stringify({ ...first, nonce: 'replacement-owner' })}\n`, 'utf8')
          await actionGate
          return 'done'
        },
      })
      await new Promise(resolve => setTimeout(resolve, 110))
      releaseAction()
      await expect(running).resolves.toBe('done')
      expect(JSON.parse(await readFile(lock, 'utf8')).nonce).toBe('replacement-owner')
    }
    finally {
      await rm(value.root, { recursive: true, force: true })
    }
  })

  it('waits for the active invocation and reuses its completed evidence', async () => {
    const value = await fixture()
    try {
      const key = 'c'.repeat(64)
      let executions = 0
      const run = () => withInvocationLock({
        taskDir: value.taskDir,
        invocationKey: key,
        staleAfterMs: 500,
        waitTimeoutMs: 2_000,
        action: async () => {
          const reusable = await readInvocationEvidence({
            taskDir: value.taskDir,
            invocationKey: key,
            kind: 'result',
          })
          if (reusable !== null)
            return reusable
          executions++
          await new Promise(resolve => setTimeout(resolve, 80))
          const response = { verdict: 'accepted' }
          await writeInvocationEvidence({
            taskDir: value.taskDir,
            invocationKey: key,
            kind: 'result',
            value: response,
          })
          return response
        },
      })
      const [first, duplicate] = await Promise.all([run(), run()])
      expect(first).toEqual({ verdict: 'accepted' })
      expect(duplicate).toEqual(first)
      expect(executions).toBe(1)
    }
    finally {
      await rm(value.root, { recursive: true, force: true })
    }
  })

  it('does not stale-steal a live owner and recovers a dead owner residue', async () => {
    const value = await fixture()
    try {
      const key = 'd'.repeat(64)
      const root = resolveProductManagerEvidenceRoot(value.taskDir)
      const lock = join(root, 'locks', `${key}.lock`)
      let releaseAction!: () => void
      const actionGate = new Promise<void>((resolve) => {
        releaseAction = resolve
      })
      const running = withInvocationLock({
        taskDir: value.taskDir,
        invocationKey: key,
        staleAfterMs: 10_000,
        action: async () => {
          await actionGate
        },
      })
      while (true) {
        try {
          await readFile(lock, 'utf8')
          break
        }
        catch {
          await new Promise(resolve => setTimeout(resolve, 5))
        }
      }
      const staleAt = new Date(Date.now() - 20_000)
      await utimes(lock, staleAt, staleAt)
      await expect(withInvocationLock({
        taskDir: value.taskDir,
        invocationKey: key,
        staleAfterMs: 10,
        waitTimeoutMs: 40,
        action: async () => 'stolen',
      })).rejects.toThrow(/timed out/i)
      releaseAction()
      await running

      await mkdir(join(root, 'locks'), { recursive: true })
      await writeFile(lock, `${JSON.stringify({
        invocation_key: key,
        nonce: 'dead-owner',
        pid: 2147483647,
        acquired_at: new Date(0).toISOString(),
      })}\n`, 'utf8')
      await utimes(lock, staleAt, staleAt)
      await expect(withInvocationLock({
        taskDir: value.taskDir,
        invocationKey: key,
        staleAfterMs: 10,
        waitTimeoutMs: 500,
        action: async () => 'recovered',
      })).resolves.toBe('recovered')
    }
    finally {
      await rm(value.root, { recursive: true, force: true })
    }
  })

  it('appends concurrent audit records without read-modify-write loss', async () => {
    const value = await fixture()
    try {
      const key = 'e'.repeat(64)
      const files = await Promise.all(Array.from({ length: 32 }, (_, sequence) =>
        appendInvocationAudit({
          taskDir: value.taskDir,
          invocationKey: key,
          entry: { sequence, token: `secret-${sequence}` },
        })))
      expect(new Set(files).size).toBe(1)
      const records = (await readFile(files[0], 'utf8'))
        .trim()
        .split('\n')
        .map(line => JSON.parse(line))
      expect(records).toHaveLength(32)
      expect(new Set(records.map(record => record.sequence)).size).toBe(32)
      expect(records.every(record => record.token === '[REDACTED]')).toBe(true)
    }
    finally {
      await rm(value.root, { recursive: true, force: true })
    }
  })
})
