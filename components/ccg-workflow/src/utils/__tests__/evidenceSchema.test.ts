import { createHash } from 'node:crypto'
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'fs-extra'

function findPackageRoot(): string {
  let dir = import.meta.dirname
  for (let i = 0; i < 10; i++) {
    try {
      readFileSync(join(dir, 'package.json'))
      return dir
    }
    catch {
      dir = join(dir, '..')
    }
  }
  throw new Error('Could not find package root')
}

const PACKAGE_ROOT = findPackageRoot()
const TMP_ROOT = join(tmpdir(), `ccg-evidence-${Date.now()}`)
let taskUtils: any

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function makeTask(name: string): { root: string, taskDir: string } {
  const root = join(TMP_ROOT, name)
  const taskDir = join(root, '.ccg', 'tasks', 'demo')
  fs.ensureDirSync(taskDir)
  fs.writeJsonSync(join(taskDir, 'task.json'), {
    id: 'demo',
    status: 'in_progress',
    currentPhase: 'review',
    nextAction: 'review',
  })
  return { root, taskDir }
}

beforeAll(() => {
  fs.ensureDirSync(TMP_ROOT)
  const modulePath = join(TMP_ROOT, 'task-utils.cjs')
  copyFileSync(join(PACKAGE_ROOT, 'templates', 'hooks', 'task-utils.js'), modulePath)
  taskUtils = createRequire(import.meta.url)(modulePath)
})

afterAll(async () => {
  await fs.remove(TMP_ROOT)
})

describe('task evidence helpers', () => {
  it('returns an empty canonical shape when evidence is missing', () => {
    const { taskDir } = makeTask('missing')
    expect(taskUtils.readEvidence(taskDir)).toEqual({ schemaVersion: 1, items: [] })
  })

  it('writes and validates required Gemini evidence', () => {
    const { taskDir } = makeTask('valid-gemini')
    const response = 'Gemini gate review'
    fs.ensureDirSync(join(taskDir, 'evidence'))
    writeFileSync(join(taskDir, 'evidence', 'gemini.md'), response, 'utf-8')

    taskUtils.writeEvidence(taskDir, {
      schemaVersion: 1,
      items: [{
        id: 'gemini-gate-1',
        provider: 'gemini',
        role: 'gate',
        policy: 'required',
        available: true,
        artifactFile: 'evidence/gemini.md',
        artifactSha256: sha256(response),
        artifactChars: response.length,
        summary: 'Gemini found one risk.',
      }],
    })

    const result = taskUtils.validateEvidence(taskDir, {
      provider: 'gemini',
      role: 'gate',
      policy: 'required',
    })
    expect(result.ok).toBe(true)
    expect(result.item.provider).toBe('gemini')
  })

  it('preserves UTF-8 byte counts across evidence read and write normalization', () => {
    const { taskDir } = makeTask('utf8-byte-count')
    const response = 'GPT Pro 响应'
    const artifactBytes = Buffer.byteLength(response, 'utf-8')

    taskUtils.writeEvidence(taskDir, {
      schemaVersion: 1,
      items: [{
        id: 'gptpro-review-byte-count',
        provider: 'gptpro',
        role: 'review',
        policy: 'manual',
        available: true,
        artifactFile: 'gptpro/response.md',
        artifactSha256: sha256(response),
        artifactChars: response.length,
        artifactBytes,
        summary: 'UTF-8 byte-count round trip.',
      }],
    })

    const firstRead = taskUtils.readEvidence(taskDir)
    expect(firstRead.items[0].artifactBytes).toBe(artifactBytes)
    expect(firstRead.items[0].artifactBytes).toBeGreaterThan(firstRead.items[0].artifactChars)

    taskUtils.writeEvidence(taskDir, firstRead)
    const secondRead = taskUtils.readEvidence(taskDir)
    expect(secondRead.items[0].artifactBytes).toBe(artifactBytes)
  })

  it('normalizes legacy task.json Gemini evidence for reads', () => {
    const { taskDir } = makeTask('legacy')
    const response = 'Legacy Gemini response'
    fs.ensureDirSync(join(taskDir, 'evidence'))
    writeFileSync(join(taskDir, 'evidence', 'gemini.md'), response, 'utf-8')
    fs.writeJsonSync(join(taskDir, 'task.json'), {
      id: 'demo',
      status: 'in_progress',
      gemini_evidence: {
        required: true,
        role: 'gate',
        available: true,
        response_file: 'evidence/gemini.md',
        response_sha256: sha256(response),
        response_chars: response.length,
        summary: 'legacy summary',
      },
    })

    const evidence = taskUtils.readEvidence(taskDir)
    expect(evidence.items).toHaveLength(1)
    expect(evidence.items[0].provider).toBe('gemini')
    expect(evidence.items[0].role).toBe('gate')
    expect(taskUtils.validateEvidence(taskDir, { provider: 'gemini', role: 'gate' }).ok).toBe(true)
  })

  it('deduplicates appended GPT Pro items by session and round', () => {
    const { taskDir } = makeTask('dedupe')
    fs.ensureDirSync(join(taskDir, 'gptpro', 's1', 'round-1'))
    writeFileSync(join(taskDir, 'gptpro', 's1', 'round-1', 'response.md'), 'Manual response', 'utf-8')

    const item = {
      id: 'gptpro-review-s1-round-1',
      provider: 'gptpro',
      role: 'review',
      policy: 'manual',
      available: true,
      artifactFile: 'gptpro/s1/round-1/response.md',
      sessionId: 's1',
      round: 1,
    }
    taskUtils.appendEvidenceItem(taskDir, item)
    taskUtils.appendEvidenceItem(taskDir, { ...item, summary: 'updated' })

    const evidence = taskUtils.readEvidence(taskDir)
    expect(evidence.items).toHaveLength(1)
    expect(evidence.items[0].summary).toBe('updated')
  })

  it('does not block when optional evidence is missing', () => {
    const { taskDir } = makeTask('optional')
    const result = taskUtils.validateEvidence(taskDir, {
      provider: 'gptpro',
      role: 'review',
      policy: 'optional',
    })
    expect(result).toMatchObject({ ok: true, reason: 'optional_evidence_missing' })
  })

  it('rejects a hash mismatch for available evidence', () => {
    const { taskDir } = makeTask('hash-mismatch')
    fs.ensureDirSync(join(taskDir, 'evidence'))
    writeFileSync(join(taskDir, 'evidence', 'gemini.md'), 'changed bytes', 'utf-8')
    taskUtils.writeEvidence(taskDir, {
      schemaVersion: 1,
      items: [{
        id: 'gemini-gate-1',
        provider: 'gemini',
        role: 'gate',
        policy: 'required',
        available: true,
        artifactFile: 'evidence/gemini.md',
        artifactSha256: sha256('original bytes'),
      }],
    })

    expect(taskUtils.validateEvidence(taskDir, { provider: 'gemini', role: 'gate' }))
      .toMatchObject({ ok: false, reason: 'artifact_hash_mismatch' })
  })

  it('resolves project-root .codex artifacts and validates artifact plus manifest hashes', () => {
    const { root, taskDir } = makeTask('grok-manifest')
    const bundleDir = join(root, '.codex', 'ccg', 'intelligence', 'contract-1')
    fs.ensureDirSync(bundleDir)
    const evidence = '{"status":"valid"}\n'
    const manifest = '{"files":{}}\n'
    writeFileSync(join(bundleDir, 'evidence.json'), evidence, 'utf-8')
    writeFileSync(join(bundleDir, 'manifest.json'), manifest, 'utf-8')
    taskUtils.appendEvidenceItem(taskDir, {
      id: 'grok-external-intelligence-contract-1',
      provider: 'grok',
      role: 'external-intelligence',
      policy: 'required',
      available: true,
      artifactFile: '.codex/ccg/intelligence/contract-1/evidence.json',
      artifactSha256: sha256(evidence),
      manifestFile: '.codex/ccg/intelligence/contract-1/manifest.json',
      manifestSha256: sha256(manifest),
      localOnly: true,
      exported: false,
    })
    expect(taskUtils.validateEvidence(taskDir, { provider: 'grok', role: 'external-intelligence' }))
      .toMatchObject({ ok: true, item: { manifestFile: expect.stringContaining('manifest.json') } })

    writeFileSync(join(bundleDir, 'manifest.json'), 'tampered', 'utf-8')
    expect(taskUtils.validateEvidence(taskDir, { provider: 'grok', role: 'external-intelligence' }))
      .toMatchObject({ ok: false, reason: 'manifest_hash_mismatch' })
  })

  it('rejects artifact paths that escape the project root', () => {
    const { taskDir } = makeTask('path-escape')
    expect(taskUtils.resolveArtifactPath(taskDir, '../../../../outside.txt')).toBeNull()
    expect(taskUtils.resolveArtifactPath(taskDir, 'C:\\outside.txt')).toBeNull()
  })

  it('validates a matching evidence item instead of the lexicographic last item', () => {
    const { taskDir } = makeTask('valid-before-bad')
    fs.ensureDirSync(join(taskDir, 'evidence'))
    const response = 'valid gate response'
    writeFileSync(join(taskDir, 'evidence', 'gemini-valid.md'), response, 'utf-8')
    writeFileSync(join(taskDir, 'evidence', 'gemini-bad.md'), 'changed bytes', 'utf-8')
    taskUtils.writeEvidence(taskDir, {
      schemaVersion: 1,
      items: [
        {
          id: 'a-valid-gate',
          provider: 'gemini',
          role: 'gate',
          policy: 'required',
          available: true,
          artifactFile: 'evidence/gemini-valid.md',
          artifactSha256: sha256(response),
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'z-bad-gate',
          provider: 'gemini',
          role: 'gate',
          policy: 'required',
          available: true,
          artifactFile: 'evidence/gemini-bad.md',
          artifactSha256: sha256('original bytes'),
          createdAt: '2026-01-02T00:00:00.000Z',
        },
      ],
    })

    expect(taskUtils.validateEvidence(taskDir, { provider: 'gemini', role: 'gate' }))
      .toMatchObject({ ok: true, item: { id: 'a-valid-gate' } })
  })
})
