import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// @ts-expect-error Runtime template modules intentionally ship as plain ESM.
import { cleanupIntelligenceArtifacts, exportIntelligenceBundle, writeIntelligenceBundle } from '../../../templates/engine/tools/grok-intelligence/lib/artifacts.mjs'
// @ts-expect-error Runtime template modules intentionally ship as plain ESM.
import { createCacheFingerprint, readCacheEntry, withCacheLock, writeCacheEntry } from '../../../templates/engine/tools/grok-intelligence/lib/cache.mjs'
// @ts-expect-error Runtime template modules intentionally ship as plain ESM.
import { createCanonicalEvidenceItem, createIntelligenceDecision, createTaskIntelligencePointer } from '../../../templates/engine/tools/grok-intelligence/lib/router.mjs'

const NOW = '2026-07-21T12:00:00.000Z'

function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

function validDecision(overrides: Record<string, unknown> = {}) {
  return createIntelligenceDecision({
    requirement: 'required',
    status: 'valid',
    mode: 'contract',
    reason: 'Current external contract verified.',
    created_at: NOW,
    ...overrides,
  })
}

function fingerprintInput(overrides: Record<string, unknown> = {}) {
  return {
    task: ' Verify   current API contract ',
    mode: 'contract',
    searchPolicy: { web: 'required', x: 'preferred' },
    model: 'grok-4.5',
    gitHead: 'abc123',
    dirtyDigest: 'dirty-sha',
    planDigest: 'plan-sha',
    diffDigest: 'diff-sha',
    lockfiles: [{ path: 'pnpm-lock.yaml', sha256: 'lock-sha' }],
    targetVersions: { node: '24', grok: '0.2.106' },
    targetDomains: ['docs.x.ai', 'github.com'],
    runnerVersion: '1',
    wrapperProtocolVersion: 'acp-1',
    cliVersion: '0.2.106',
    promptTemplateSha256: 'prompt-sha',
    evidenceSchemaVersion: '2',
    routerPolicyVersion: '1',
    sourceTierPolicyVersion: '1',
    eventNormalizerVersion: '1',
    snapshotPolicyVersion: '1',
    ...overrides,
  }
}

describe('Grok intelligence artifacts', () => {
  let root: string
  let artifactRoot: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ccg-grok-artifacts-'))
    artifactRoot = join(root, '.codex', 'ccg', 'intelligence')
    await chmod(root, 0o700)
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('atomically writes exactly four files and returns the manifest self-hash', async () => {
    const bundle = await writeIntelligenceBundle({
      projectRoot: root,
      artifactRoot,
      evidenceId: 'contract-abc123',
      decision: validDecision(),
      evidence: { claims: [], registry: { sources: [] } },
      report: '# External intelligence\n\nValidated.\n',
      rawEvents: [{ method: 'session/update', params: {
        token: 'secret-token',
        source: 'https://user:password@example.com/object?X-Amz-Signature=signed-secret&X-Amz-Credential=credential-secret',
      } }],
      secrets: ['secret-token'],
      clock: () => new Date(NOW),
      retentionDays: 3,
      maxBytes: 1024 * 1024,
      provenance: { schemaVersion: 999, evidenceId: 'forged-id', action: 'intel' },
    })
    expect((await readdir(bundle.directory)).sort()).toEqual([
      'evidence.json',
      'manifest.json',
      'raw-stream.jsonl',
      'report.md',
    ])
    const manifestText = await readFile(bundle.manifestPath)
    const manifest = JSON.parse(manifestText.toString('utf8'))
    expect(manifest.retentionDays).toBe(3)
    expect(manifest.schemaVersion).toBe(1)
    expect(manifest.evidenceId).toBe('contract-abc123')
    expect(manifest.action).toBe('intel')
    expect(Object.keys(manifest.files).sort()).toEqual(['evidence.json', 'raw-stream.jsonl', 'report.md'])
    for (const [name, metadata] of Object.entries<any>(manifest.files)) {
      const bytes = await readFile(join(bundle.directory, name))
      expect(metadata.sha256).toBe(sha256(bytes))
      expect(metadata.bytes).toBe(bytes.length)
    }
    expect(bundle.manifestSha256).toBe(sha256(manifestText))
    const payloadBytes = Object.values<any>(manifest.files).reduce((total, metadata) => total + metadata.bytes, 0)
    await expect(writeIntelligenceBundle({
      projectRoot: root,
      artifactRoot,
      evidenceId: 'manifest-cap-check',
      decision: validDecision(),
      evidence: { claims: [], registry: { sources: [] } },
      report: '# External intelligence\n\nValidated.\n',
      rawEvents: [{ method: 'session/update', params: {
        token: 'secret-token',
        source: 'https://user:password@example.com/object?X-Amz-Signature=signed-secret&X-Amz-Credential=credential-secret',
      } }],
      secrets: ['secret-token'],
      clock: () => new Date(NOW),
      retentionDays: 3,
      maxBytes: payloadBytes,
    })).rejects.toThrow(/maximum byte cap/i)
    const rawStream = await readFile(join(bundle.directory, 'raw-stream.jsonl'), 'utf8')
    expect(rawStream).not.toContain('secret-token')
    expect(rawStream).not.toMatch(/password|signed-secret|credential-secret/i)
    expect(rawStream).toContain('https://example.com/object')
  })

  it.each([
    '../escape',
    'nested/id',
    'C:drive',
    '..',
    'CON',
    'aux.txt',
    'trailing.',
    'space ',
  ])('rejects unsafe evidence id %s', async (evidenceId) => {
    await expect(writeIntelligenceBundle({
      projectRoot: root,
      artifactRoot,
      evidenceId,
      decision: validDecision(),
      evidence: {},
      report: 'report',
      rawEvents: [],
    })).rejects.toThrow(/evidence id|reserved|unsafe/i)
  })

  it('allows only one atomic winner for a duplicate evidence id', async () => {
    const options = {
      projectRoot: root,
      artifactRoot,
      evidenceId: 'same-key',
      decision: validDecision(),
      evidence: {},
      report: 'report',
      rawEvents: [],
    }
    const results = await Promise.allSettled([
      writeIntelligenceBundle(options),
      writeIntelligenceBundle(options),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
  })

  it('requires an explicit user-authored waiver and validates deep visibility', () => {
    expect(() => createIntelligenceDecision({
      requirement: 'required',
      status: 'waived',
      mode: 'contract',
      reason: 'Grok unavailable after bounded retries',
      waiver: { reason: 'accept risk', actor: 'user', created_at: NOW },
    })).toThrow(/explicit user/i)

    expect(createIntelligenceDecision({
      requirement: 'required',
      status: 'waived',
      mode: 'contract',
      reason: 'Grok unavailable after bounded retries',
      waiver: { reason: 'User accepts stale external-contract risk', actor: 'user', created_at: NOW },
      explicitUserWaiver: true,
      depth: 'deep',
      deepVisibility: {
        evidence_visibility: 'leader_only',
        observed_web_search_events: 2,
        observed_x_search_events: 1,
        total_server_tool_usage: null,
        advisory_only: true,
      },
    })).toMatchObject({ status: 'waived', waiver: { actor: 'user' }, evidence_visibility: 'leader_only' })

    expect(() => validDecision({
      deepVisibility: {
        evidence_visibility: 'all_agents',
        observed_web_search_events: 2,
        observed_x_search_events: 1,
        total_server_tool_usage: 3,
        advisory_only: false,
      },
    })).toThrow(/leader_only|advisory/i)
  })

  it('persists explicit skipped and waived decisions without inventing availability', async () => {
    const skipped = createIntelligenceDecision({
      requirement: 'disabled',
      status: 'skipped',
      mode: 'contract',
      reason: 'Route disabled by configuration.',
      created_at: NOW,
    })
    const waived = createIntelligenceDecision({
      requirement: 'required',
      status: 'waived',
      mode: 'contract',
      reason: 'Grok unavailable after bounded retries.',
      waiver: { reason: 'User accepts stale contract risk.', actor: 'user', created_at: NOW },
      explicitUserWaiver: true,
    })
    for (const [evidenceId, decision] of [['skipped-route', skipped], ['waived-route', waived]] as const) {
      const bundle = await writeIntelligenceBundle({
        projectRoot: root,
        artifactRoot,
        evidenceId,
        decision,
        evidence: {},
        report: decision.reason,
        rawEvents: [],
      })
      const stored = JSON.parse(await readFile(bundle.artifactPath, 'utf8'))
      expect(stored.decision.status).toBe(decision.status)
      expect((await readdir(bundle.directory)).sort()).toEqual([
        'evidence.json',
        'manifest.json',
        'raw-stream.jsonl',
        'report.md',
      ])
    }
  })

  it('exports a bounded sanitized bundle without raw by default', async () => {
    const bundle = await writeIntelligenceBundle({
      projectRoot: root,
      artifactRoot,
      evidenceId: 'export-source',
      decision: validDecision(),
      evidence: { note: 'safe', events: [{ private: 'drop from export' }] },
      report: 'safe report',
      rawEvents: [{ secret: 'raw only' }],
    })
    const exportRoot = join(root, 'exports')
    const exported = await exportIntelligenceBundle({
      bundleDir: bundle.directory,
      exportRoot,
      evidenceId: 'export-source',
      clock: () => new Date(NOW),
      retentionDays: 9,
      maxBytes: 32 * 1024 * 1024,
    })
    expect((await readdir(exported.directory)).sort()).toEqual(['evidence.json', 'manifest.json', 'report.md'])
    expect(JSON.parse(await readFile(exported.manifestPath, 'utf8'))).toMatchObject({ exported: true, retentionDays: 9 })
    expect(await readFile(join(exported.directory, 'evidence.json'), 'utf8')).not.toContain('drop from export')
    await expect(exportIntelligenceBundle({
      bundleDir: bundle.directory,
      exportRoot: join(root, 'tiny-export'),
      evidenceId: 'too-large',
      maxBytes: 1,
    })).rejects.toThrow(/maximum|byte cap/i)
    await expect(writeIntelligenceBundle({
      projectRoot: root,
      artifactRoot,
      evidenceId: 'too-large-local',
      decision: validDecision(),
      evidence: { note: 'larger than cap' },
      report: 'report',
      rawEvents: [],
      maxBytes: 1,
    })).rejects.toThrow(/maximum|byte cap/i)
    await expect(exportIntelligenceBundle({
      bundleDir: bundle.directory,
      exportRoot: join(root, 'bad-retention-export'),
      evidenceId: 'bad-retention-export',
      retentionDays: 0,
    })).rejects.toThrow(/retentionDays/)
    await expect(writeIntelligenceBundle({
      projectRoot: root,
      artifactRoot,
      evidenceId: 'bad-retention-local',
      decision: validDecision(),
      evidence: {},
      report: 'report',
      rawEvents: [],
      retentionDays: 0,
    })).rejects.toThrow(/retentionDays/)
  })

  it('removes expired bundles and orphan private roots but preserves active evidence', async () => {
    for (const evidenceId of ['active-old', 'expired-old']) {
      await writeIntelligenceBundle({
        projectRoot: root,
        artifactRoot,
        evidenceId,
        decision: validDecision({ created_at: '2026-06-01T00:00:00.000Z' }),
        evidence: {},
        report: 'old',
        rawEvents: [],
        clock: () => new Date('2026-06-01T00:00:00.000Z'),
      })
    }
    const tempParent = join(root, 'private')
    const orphan = join(tempParent, 'ccg-grok-run-orphan')
    await mkdir(orphan, { recursive: true })
    await writeFile(join(orphan, 'old.txt'), 'old')
    const old = new Date('2026-06-01T00:00:00.000Z')
    await import('node:fs/promises').then(({ utimes }) => utimes(orphan, old, old))
    const staging = join(artifactRoot, '.expired.tmp-orphan')
    await mkdir(staging)
    await import('node:fs/promises').then(({ utimes }) => utimes(staging, old, old))

    const result = await cleanupIntelligenceArtifacts({
      artifactRoot,
      activeEvidenceIds: ['active-old'],
      retentionDays: 7,
      tempParent,
      now: new Date(NOW),
    })
    expect(result.removedEvidenceIds).toEqual(['expired-old'])
    expect(result.removedStagingDirectories).toEqual(['.expired.tmp-orphan'])
    expect(result.removedPrivateRoots).toEqual(['ccg-grok-run-orphan'])
    await expect(stat(join(artifactRoot, 'active-old'))).resolves.toBeDefined()
    await expect(stat(join(artifactRoot, 'expired-old'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('versioned Grok evidence cache', () => {
  let root: string
  let cacheRoot: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ccg-grok-cache-'))
    cacheRoot = join(root, 'cache')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('normalizes task text and misses after a CLI policy version change', () => {
    const first = createCacheFingerprint(fingerprintInput())
    const normalized = createCacheFingerprint(fingerprintInput({ task: 'Verify current API contract' }))
    const upgraded = createCacheFingerprint(fingerprintInput({ cliVersion: '0.2.107' }))
    expect(first.key).toMatch(/^[a-f0-9]{64}$/)
    expect(normalized.key).toBe(first.key)
    expect(upgraded.key).not.toBe(first.key)
    expect(first.input).toMatchObject({ runner_version: '1', snapshot_policy_version: '1' })
  })

  it('serializes same-key work with an exclusive lock', async () => {
    const key = createCacheFingerprint(fingerprintInput()).key
    let release!: () => void
    let markLocked!: () => void
    const locked = new Promise<void>((resolve) => {
      markLocked = resolve
    })
    const held = withCacheLock({ cacheRoot, key }, async () => new Promise<void>((resolve) => {
      release = resolve
      markLocked()
    }))
    await locked
    await expect(withCacheLock({ cacheRoot, key }, async () => 'second')).rejects.toThrow(/lock|busy/i)
    release()
    await held
  })

  it('uses atomic entry creation and validates time, quality, TTL, and force refresh', async () => {
    const fingerprint = createCacheFingerprint(fingerprintInput())
    const entry = {
      fingerprint: fingerprint.key,
      created_at: NOW,
      status: 'valid',
      evidence_id: 'cache-hit',
      evidence: { claims: [] },
    }
    await writeCacheEntry({ cacheRoot, fingerprint: fingerprint.key, entry })
    await expect(writeCacheEntry({ cacheRoot, fingerprint: fingerprint.key, entry })).rejects.toThrow(/exists|conflict/i)
    await expect(readCacheEntry({ cacheRoot, fingerprint: fingerprint.key, now: new Date(NOW), ttlMs: 60_000 })).resolves.toMatchObject({ hit: true })
    await expect(readCacheEntry({ cacheRoot, fingerprint: fingerprint.key, now: new Date(NOW), ttlMs: 60_000, forceRefresh: true })).resolves.toMatchObject({ hit: false, reason: 'force_refresh' })
    await expect(readCacheEntry({ cacheRoot, fingerprint: fingerprint.key, now: new Date('2026-07-22T12:00:00.000Z'), ttlMs: 60_000 })).resolves.toMatchObject({ hit: false, reason: 'stale' })

    for (const [name, patch, reason] of [
      ['future', { created_at: '2026-07-22T12:00:00.000Z' }, 'future_timestamp'],
      ['failed', { status: 'failed' }, 'unusable_status'],
      ['degraded', { status: 'degraded' }, 'unusable_status'],
      ['contradicted', { evidence: { claims: [{ status: 'contradicted' }] } }, 'contradicted_evidence'],
      ['early-warning', { evidence: { claims: [{ status: 'early_warning' }] } }, 'early_warning_evidence'],
      ['required-unresolved', { requirement: 'required', evidence: { claims: [{ status: 'unresolved' }] } }, 'unresolved_required_evidence'],
    ] as const) {
      const alternate = createCacheFingerprint(fingerprintInput({ diffDigest: name }))
      await writeCacheEntry({ cacheRoot, fingerprint: alternate.key, entry: { ...entry, fingerprint: alternate.key, ...patch } })
      await expect(readCacheEntry({ cacheRoot, fingerprint: alternate.key, now: new Date(NOW), ttlMs: 60_000 }))
        .resolves
        .toMatchObject({ hit: false, reason })
    }
    await expect(readCacheEntry({ cacheRoot, fingerprint: '../escape', now: new Date(NOW), ttlMs: 60_000 })).rejects.toThrow(/fingerprint/i)
  })
})

describe('canonical task intelligence pointers', () => {
  it('creates a compact canonical evidence item and task pointer', () => {
    const bundle = {
      artifactRelativePath: '.codex/ccg/intelligence/contract-1/evidence.json',
      artifactSha256: 'evidence-sha',
      manifestRelativePath: '.codex/ccg/intelligence/contract-1/manifest.json',
      manifestSha256: 'manifest-sha',
    }
    expect(createCanonicalEvidenceItem({
      evidenceId: 'contract-1',
      decision: validDecision(),
      bundle,
      summary: 'Validated current external contract evidence',
    })).toMatchObject({
      id: 'grok-external-intelligence-contract-1',
      provider: 'grok',
      role: 'external-intelligence',
      artifactFile: bundle.artifactRelativePath,
      manifestFile: bundle.manifestRelativePath,
      manifestSha256: 'manifest-sha',
    })
    expect(createTaskIntelligencePointer({ evidenceId: 'contract-1', decision: validDecision(), bundle }))
      .toEqual({
        requirement: 'required',
        status: 'valid',
        action: 'intel',
        investigation_mode: 'contract',
        depth: 'normal',
        package_status: 'valid',
        verification_outcome: 'unresolved',
        evidence_id: 'contract-1',
        manifest_file: bundle.manifestRelativePath,
        manifest_sha256: 'manifest-sha',
        localOnly: true,
        exported: false,
      })
  })
})
