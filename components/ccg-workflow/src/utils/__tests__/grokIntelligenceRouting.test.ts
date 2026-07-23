import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import fs from 'fs-extra'
// @ts-expect-error Runtime template modules intentionally ship as plain ESM.
import * as routeRuntime from '../../../templates/engine/tools/grok-intelligence/route.mjs'

const root = join(tmpdir(), `ccg-grok-route-${Date.now()}`)

function enabledConfig(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    auto_route: true,
    auth_mode: 'browser_oauth',
    require_web_search: true,
    x_search_policy: 'preferred',
    ...overrides,
  }
}

let evidenceCounter = 0

function statePath(id: string) {
  return join(root, '.codex', 'ccg', id, 'status.json')
}

function validRunnerResult(
  mode = 'contract',
  createdAt = new Date().toISOString(),
  model = 'grok-4.5',
  artifactRoot = '.codex/ccg/intelligence',
  action = 'intel',
  depth = 'normal',
  effectiveXPolicy = mode === 'incident' ? 'required' : 'preferred',
  bindings: any[] = [],
  officialDomains: string[] = [],
  bundleRoot = root,
) {
  const evidenceId = `route-evidence-${++evidenceCounter}`
  const bundleDir = join(bundleRoot, ...artifactRoot.split('/'), evidenceId)
  fs.ensureDirSync(bundleDir)
  const sourceUrl = 'https://docs.x.ai/build/cli/reference'
  const sourceId = `src-${hash(`web_search\n${sourceUrl}`).slice(0, 16)}`
  const xSourceUrl = 'https://x.com/xai/status/1'
  const xSourceId = `src-${hash(`x_search\n${xSourceUrl}`).slice(0, 16)}`
  const artifact = `${JSON.stringify({
    schemaVersion: 2,
    decision: {
      requirement: 'required',
      status: 'valid',
      action,
      investigation_mode: mode,
      mode,
      depth,
      package_status: 'valid',
      verification_outcome: 'verified',
      reason: 'Verified fixture.',
      created_at: createdAt,
    },
    evidence: {
      model: { requested: model, actual: model, provenance: 'grok agent --model' },
      action,
      investigation_mode: mode,
      depth,
      effective_x_policy: effectiveXPolicy,
      bindings,
      normalized: { searches: [{ tool: 'web_search', status: 'completed' }, { tool: 'x_search', status: 'completed' }] },
      registry: { sources: [
        { id: sourceId, tool: 'web_search', observed_tool: 'web_search', canonical_url: sourceUrl, official: true, source_tier: 'A', independence_key: 'x.ai' },
        { id: xSourceId, tool: 'x_search', observed_tool: 'web_search', canonical_url: xSourceUrl, official: true, source_tier: 'D', independence_key: 'x.com' },
      ] },
      claims: [{ id: 'claim-verified', claim: 'Applicable current contract.', status: 'verified', severity: 'info', source_ids: [sourceId], applies_to: ['package.json'] }],
    },
  }, null, 2)}\n`
  const raw = ''
  const report = '# Fixture\n'
  fs.writeFileSync(join(bundleDir, 'evidence.json'), artifact)
  fs.writeFileSync(join(bundleDir, 'raw-stream.jsonl'), raw)
  fs.writeFileSync(join(bundleDir, 'report.md'), report)
  const files = {
    'evidence.json': { sha256: hash(artifact), bytes: Buffer.byteLength(artifact) },
    'raw-stream.jsonl': { sha256: hash(raw), bytes: Buffer.byteLength(raw) },
    'report.md': { sha256: hash(report), bytes: Buffer.byteLength(report) },
  }
  const manifest = `${JSON.stringify({
    schemaVersion: 1,
    evidenceId,
    createdAt,
    localOnly: true,
    exported: false,
    retentionDays: 7,
    model,
    action,
    investigation_mode: mode,
    depth,
    requirement: 'required',
    effective_x_policy: effectiveXPolicy,
    cli_version: 'grok 0.2.106',
    prompt_sha256: 'a'.repeat(64),
    git_head: 'unversioned',
    dirty_digest: 'b'.repeat(64),
    bindings,
    official_domains: officialDomains,
    search_counts: { web: 1, x: 1 },
    attempts: 1,
    package_status: 'valid',
    validation_outcome: 'verified',
    verification_outcome: 'verified',
    cache_fingerprint: 'c'.repeat(64),
    cache_contract_versions: { runnerVersion: '2', evidenceSchemaVersion: '2' },
    files,
  }, null, 2)}\n`
  fs.writeFileSync(join(bundleDir, 'manifest.json'), manifest)
  return {
    exitCode: 0,
    status: 'valid',
    model,
    evidencePath: `${artifactRoot}/${evidenceId}/evidence.json`,
    evidenceSha256: hash(artifact),
    manifestPath: `${artifactRoot}/${evidenceId}/manifest.json`,
    manifestSha256: hash(manifest),
  }
}

function validRunnerResultForRequest(request: any, overrides: { createdAt?: string, model?: string, artifactRoot?: string, pathRoot?: string } = {}) {
  const canonicalRepoRoot = fs.realpathSync(request.repoRoot)
  const bindingInputs = [
    request.options.plan ? ['plan', request.options.plan] : null,
    request.options.diff ? ['diff', request.options.diff] : null,
    ...(request.options.dependencies || []).map((path: string) => ['dependency', path]),
  ].filter(Boolean) as string[][]
  const bindings = bindingInputs.map(([kind, path]) => {
    const absolute = resolve(request.repoRoot, path)
    const canonical = fs.realpathSync(absolute)
    const bytes = readFileSync(canonical)
    return {
      kind,
      path: isAbsolute(path)
        ? relative(overrides.pathRoot || canonicalRepoRoot, overrides.pathRoot ? path : canonical).replace(/\\/g, '/')
        : path.replace(/\\/g, '/'),
      sha256: hash(bytes),
      bytes: bytes.length,
      empty: bytes.length === 0,
    }
  })
  const mode = request.options.mode || 'contract'
  const configuredX = request.options.config.x_search_policy || 'preferred'
  const effectiveX = configuredX === 'disabled' ? 'disabled' : configuredX === 'required' || mode === 'incident' ? 'required' : 'preferred'
  return validRunnerResult(
    mode,
    overrides.createdAt || new Date().toISOString(),
    overrides.model || String(request.options.depth === 'deep'
      ? request.options.config.deep_research_model
      : (request.options.config.default_model || 'grok-4.5')),
    overrides.artifactRoot || String(request.options.config.artifact_root || '.codex/ccg/intelligence'),
    request.action,
    request.options.depth || 'normal',
    effectiveX,
    bindings,
    request.options.officialDomains || [],
    request.repoRoot,
  )
}

function hash(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

describe('Grok automatic intelligence routing', () => {
  beforeEach(async () => {
    await fs.emptyDir(root)
    evidenceCounter = 0
    await fs.writeJson(join(root, 'package.json'), { name: 'fixture' })
    await fs.writeFile(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    await fs.writeFile(join(root, 'plan.md'), '# Plan\n')
    await fs.writeFile(join(root, 'change.diff'), '+ first external change\n')
  })

  afterAll(async () => {
    await fs.remove(root)
  })

  it('routes a dependency or API contract intake before the workflow and persists call order', async () => {
    const stateFile = join(root, '.ccg', 'tasks', 'route-contract', 'intelligence-route.json')
    const events: string[] = []
    let invocation: any
    const result = await (routeRuntime as any).runWorkflowRoute({
      repoRoot: root,
      config: enabledConfig(),
      workflow: 'go',
      phase: 'intake',
      task: 'Upgrade the Acme SDK and verify its current API contract.',
      dependencies: ['pnpm-lock.yaml'],
      stateFile,
    }, {
      onEvent: (event: string) => events.push(event),
      invoke: async (request: any) => {
        events.push('invoke')
        invocation = request
        expect(fs.readJsonSync(stateFile)).toMatchObject({ execution: { status: 'pending' } })
        return validRunnerResultForRequest(request)
      },
    })

    expect(result).toMatchObject({
      exitCode: 0,
      invoked: true,
      decision: {
        requirement: 'required',
        mode: 'contract',
        trigger: 'dependency_api_contract',
        status: 'valid',
        effective_x_policy: 'preferred',
      },
    })
    expect(invocation).toMatchObject({ action: 'intel', options: { mode: 'contract' } })
    expect(invocation.argv).toEqual([
      'intel',
      '--task',
      'Upgrade the Acme SDK and verify its current API contract.',
      '--mode',
      'contract',
      '--depth',
      'normal',
      '--dependency',
      'pnpm-lock.yaml',
    ])
    expect(events).toEqual(['decision', 'state:pending', 'invoke', 'state:complete'])
    expect(fs.readJsonSync(stateFile)).toMatchObject({
      execution: { status: 'valid', exit_code: 0 },
      bindings: { dependencies: [{ path: 'pnpm-lock.yaml', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }] },
    })
  })

  it('routes a current incident with required Web evidence and policy-derived X evidence', async () => {
    let invocation: any
    const result = await (routeRuntime as any).runWorkflowRoute({
      repoRoot: root,
      config: enabledConfig(),
      workflow: 'debug',
      phase: 'diagnosis',
      task: 'Diagnose the current Acme Cloud outage and recent regional errors.',
      stateFile: statePath('incident-state'),
    }, {
      invoke: async (request: any) => {
        invocation = request
        return validRunnerResultForRequest(request)
      },
    })

    expect(result.decision).toMatchObject({
      requirement: 'required',
      mode: 'incident',
      trigger: 'current_incident',
      require_web_search: true,
      configured_x_policy: 'preferred',
      effective_x_policy: 'required',
    })
    expect(invocation.argv).toEqual([
      'intel',
      '--task',
      'Diagnose the current Acme Cloud outage and recent regional errors.',
      '--mode',
      'incident',
      '--depth',
      'normal',
    ])
  })

  it('inherits the incident investigation mode, required X policy, and depth into final verification', () => {
    const previous = {
      decision: {
        requirement: 'required',
        status: 'valid',
        action: 'intel',
        investigation_mode: 'incident',
        mode: 'incident',
        depth: 'deep',
        effective_x_policy: 'required',
      },
    }
    const input = {
      task: 'Verify the applied mitigation against the bound diff.',
      trigger: 'final_diff_verify',
      diff: 'change.diff',
    }
    const decision = (routeRuntime as any).classifyWorkflowRoute(input, enabledConfig(), previous)
    expect(decision).toMatchObject({
      action: 'verify',
      investigation_mode: 'incident',
      mode: 'incident',
      depth: 'deep',
      effective_x_policy: 'required',
    })
    expect((routeRuntime as any).buildRouteCommandArgv(decision, input)).toEqual([
      'verify',
      '--task',
      input.task,
      '--mode',
      'incident',
      '--depth',
      'deep',
      '--diff',
      'change.diff',
    ])
  })

  it('validates a deep route against the configured deep-research model', async () => {
    const config = enabledConfig({
      default_model: 'grok-4.5',
      deep_research_enabled: true,
      deep_research_model: 'grok-4.5-deep',
    })
    let invocation: any
    const result = await (routeRuntime as any).runWorkflowRoute({
      repoRoot: root,
      config,
      workflow: 'go',
      phase: 'intake',
      task: 'Upgrade the current external SDK API.',
      depth: 'deep',
      stateFile: statePath('deep-model'),
    }, {
      invoke: async (request: any) => {
        invocation = request
        return validRunnerResultForRequest(request)
      },
    })
    expect(invocation).toMatchObject({ action: 'intel', options: { mode: 'contract', depth: 'deep' } })
    expect(result).toMatchObject({ exitCode: 0, execution: { model: 'grok-4.5-deep' } })
  })

  it.each([
    ['missing config', undefined],
    ['disabled config', enabledConfig({ enabled: false })],
    ['disabled auto route', enabledConfig({ auto_route: false })],
  ])('makes zero runner calls for %s and records an auditable reason', async (_label, config) => {
    let calls = 0
    const stateFile = statePath(String(_label).replace(/\s/g, '-'))
    const result = await (routeRuntime as any).runWorkflowRoute({
      repoRoot: root,
      config,
      workflow: 'go',
      phase: 'intake',
      task: 'Upgrade the current SDK API.',
      stateFile,
    }, {
      invoke: async (request: any) => {
        calls++
        return validRunnerResultForRequest(request)
      },
    })

    expect(calls).toBe(0)
    expect(result).toMatchObject({ exitCode: 0, invoked: false, decision: { requirement: 'disabled', status: 'skipped' } })
    expect(result.decision.reason).toMatch(/disabled|explicit opt-in|configuration/i)
    expect(fs.readJsonSync(stateFile).decision.reason).toBe(result.decision.reason)
  })

  it('records a skip reason for task classes outside the initial automatic gates', async () => {
    let calls = 0
    const result = await (routeRuntime as any).runWorkflowRoute({
      repoRoot: root,
      config: enabledConfig(),
      workflow: 'go',
      phase: 'intake',
      task: 'Rename a local helper and reformat its comments.',
      stateFile: statePath('local-skip'),
    }, {
      invoke: async (request: any) => {
        calls++
        return validRunnerResultForRequest(request)
      },
    })

    expect(calls).toBe(0)
    expect(result.decision).toMatchObject({ requirement: 'disabled', status: 'skipped', trigger: 'no_initial_trigger' })
    expect(result.decision.reason).toMatch(/no initial automatic external-intelligence trigger/i)
  })

  it('supports an explicit Codex semantic decision without requiring search words in the task', async () => {
    let invocation: any
    const result = await (routeRuntime as any).runWorkflowRoute({
      repoRoot: root,
      config: enabledConfig(),
      workflow: 'plan',
      phase: 'intake',
      task: 'Assess whether this architecture is defensible.',
      semanticMode: 'contract',
      semanticReason: 'The design materially depends on a current third-party service capability.',
      stateFile: statePath('semantic-contract'),
    }, {
      invoke: async (request: any) => {
        invocation = request
        return validRunnerResultForRequest(request)
      },
    })

    expect(result.decision).toMatchObject({ mode: 'contract', trigger: 'codex_semantic_judgment', requirement: 'required' })
    expect(result.decision.reason).toContain('current third-party service capability')
    expect(invocation.action).toBe('intel')
  })

  it('always delegates final verification to the manual cache boundary', async () => {
    const stateFile = statePath('verify-state')
    let calls = 0
    const invoke = async (request: any) => {
      calls++
      expect(request.action).toBe('verify')
      expect(request.argv).toContain('--diff')
      return validRunnerResultForRequest(request)
    }
    const input = {
      repoRoot: root,
      config: enabledConfig(),
      workflow: 'review',
      phase: 'final-verify',
      task: 'Verify the applied external SDK change.',
      trigger: 'final_diff_verify',
      plan: 'plan.md',
      diff: 'change.diff',
      dependencies: ['pnpm-lock.yaml'],
      stateFile,
    }

    const first = await (routeRuntime as any).runWorkflowRoute(input, { invoke })
    const unchanged = await (routeRuntime as any).runWorkflowRoute(input, { invoke })
    expect(first.decision).toMatchObject({ action: 'verify', investigation_mode: 'contract', mode: 'contract', requirement: 'required', trigger: 'final_diff_verify' })
    expect(unchanged).toMatchObject({ exitCode: 0, invoked: true, reused: false })
    expect(calls).toBe(2)

    await fs.writeFile(join(root, 'change.diff'), '+ changed external behavior\n')
    const diffChanged = await (routeRuntime as any).runWorkflowRoute(input, { invoke })
    expect(diffChanged.invoked).toBe(true)
    expect(calls).toBe(3)

    await fs.writeFile(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\nnew-sdk: 2\n')
    const dependencyChanged = await (routeRuntime as any).runWorkflowRoute(input, { invoke })
    expect(dependencyChanged.invoked).toBe(true)
    expect(calls).toBe(4)
    const state = JSON.parse(readFileSync(stateFile, 'utf8'))
    expect(state.bindings.diff.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(state.bindings.dependencies[0].sha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('does not short-circuit the manual cache for repeated or changed route requests', async () => {
    const stateFile = statePath('execution-profile-reuse')
    let calls = 0
    const input = {
      repoRoot: root,
      config: enabledConfig({ default_model: 'grok-4.5' }),
      workflow: 'go',
      phase: 'intake',
      task: 'Upgrade the current external SDK API.',
      stateFile,
    }
    const invoke = async (request: any) => {
      calls++
      const model = String(request.options.config.default_model || 'grok-4.5')
      const artifactRoot = String(request.options.config.artifact_root || '.codex/ccg/intelligence')
      return validRunnerResultForRequest(request, { model, artifactRoot })
    }

    await (routeRuntime as any).runWorkflowRoute(input, { invoke })
    expect(await (routeRuntime as any).runWorkflowRoute(input, { invoke })).toMatchObject({ invoked: true, reused: false })
    expect(calls).toBe(2)

    await (routeRuntime as any).runWorkflowRoute({ ...input, officialDomains: ['vendor.example'] }, { invoke })
    await (routeRuntime as any).runWorkflowRoute({
      ...input,
      officialDomains: ['vendor.example'],
      config: enabledConfig({ default_model: 'grok-4.5-fast' }),
    }, { invoke })
    await (routeRuntime as any).runWorkflowRoute({
      ...input,
      officialDomains: ['vendor.example'],
      config: enabledConfig({ default_model: 'grok-4.5-fast', artifact_root: '.codex/ccg/alternate-intelligence' }),
    }, { invoke })
    await (routeRuntime as any).runWorkflowRoute({ ...input, forceRefresh: true }, { invoke })
    expect(calls).toBe(6)
  })

  it('propagates required evidence exit 2 and records the blocking result', async () => {
    const stateFile = statePath('blocked-state')
    const result = await (routeRuntime as any).runWorkflowRoute({
      repoRoot: root,
      config: enabledConfig(),
      workflow: 'go',
      phase: 'intake',
      task: 'Upgrade the current dependency API.',
      stateFile,
    }, {
      invoke: async () => ({ exitCode: 2, status: 'required_evidence_unavailable', reason: 'No source-backed Web result.' }),
    })

    expect(result).toMatchObject({ exitCode: 2, invoked: true })
    expect(fs.readJsonSync(stateFile)).toMatchObject({
      execution: { exit_code: 2, status: 'required_evidence_unavailable' },
      decision: { status: 'blocked' },
    })
  })

  it('applies an explicit user waiver only to an existing blocked route without inventing evidence', async () => {
    const routeState = statePath('waiver-state')
    const taskDir = join(root, '.codex', 'ccg', 'waiver-state')
    const evidenceFile = join(taskDir, 'evidence.json')
    await fs.ensureDir(taskDir)
    await fs.writeJson(evidenceFile, { schemaVersion: 1, items: [{ id: 'existing-non-grok-evidence' }] })
    await (routeRuntime as any).runWorkflowRoute({
      repoRoot: root,
      config: enabledConfig(),
      workflow: 'go',
      phase: 'intake',
      task: 'Upgrade the current dependency API.',
      stateFile: routeState,
    }, {
      invoke: async () => ({ exitCode: 2, status: 'verification_unresolved', reason: 'No qualifying current claim.' }),
    })

    const waived = await (routeRuntime as any).waiveWorkflowRoute({
      repoRoot: root,
      stateFile: routeState,
      reason: 'User accepts the unresolved external-contract risk for this task.',
    }, { clock: () => new Date('2026-07-22T12:00:00.000Z') })
    expect(waived).toMatchObject({
      exitCode: 0,
      decision: {
        status: 'waived',
        waiver: {
          actor: 'user',
          reason: 'User accepts the unresolved external-contract risk for this task.',
          created_at: '2026-07-22T12:00:00.000Z',
        },
      },
      execution: { status: 'verification_unresolved', exit_code: 2 },
    })
    expect(await fs.readJson(evidenceFile)).toEqual({ schemaVersion: 1, items: [{ id: 'existing-non-grok-evidence' }] })
    await expect((routeRuntime as any).waiveWorkflowRoute({ repoRoot: root, stateFile: routeState, reason: '' }))
      .rejects
      .toThrow(/reason/i)
  })

  it('fails closed when a successful runner result has no complete bundle', async () => {
    const result = await (routeRuntime as any).runWorkflowRoute({
      repoRoot: root,
      config: enabledConfig(),
      workflow: 'go',
      phase: 'intake',
      task: 'Upgrade the current dependency API.',
      stateFile: statePath('missing-bundle'),
    }, { invoke: async () => ({ exitCode: 0, status: 'valid' }) })
    expect(result).toMatchObject({ exitCode: 3, decision: { status: 'blocked' }, execution: { status: 'unsafe_context' } })
  })

  it('revalidates hashes and freshness before reuse and reruns invalid evidence', async () => {
    const stateFile = statePath('reuse-validation')
    let now = new Date('2026-07-22T00:00:00.000Z')
    let calls = 0
    const input = {
      repoRoot: root,
      config: enabledConfig(),
      workflow: 'go',
      phase: 'intake',
      task: 'Upgrade the current dependency API.',
      stateFile,
    }
    const runtime = {
      clock: () => now,
      invoke: async (request: any) => {
        calls++
        return validRunnerResultForRequest(request, { createdAt: now.toISOString() })
      },
    }
    const first = await (routeRuntime as any).runWorkflowRoute(input, runtime)
    await fs.appendFile(join(root, first.execution.evidence_path), '\ntampered')
    const afterTamper = await (routeRuntime as any).runWorkflowRoute(input, runtime)
    expect(afterTamper).toMatchObject({ invoked: true, reused: false, exitCode: 0 })
    expect(calls).toBe(2)

    now = new Date('2026-07-26T00:00:00.000Z')
    const afterExpiry = await (routeRuntime as any).runWorkflowRoute(input, runtime)
    expect(afterExpiry).toMatchObject({ invoked: true, reused: false, exitCode: 0 })
    expect(calls).toBe(3)
  })

  it('publishes a validated successful bundle into canonical task evidence and pointer state', async () => {
    const taskDir = join(root, '.ccg', 'tasks', 'canonical-route')
    const stateFile = join(taskDir, 'intelligence-route.json')
    await fs.ensureDir(taskDir)
    await fs.writeJson(join(taskDir, 'task.json'), { id: 'canonical-route', status: 'in_progress' })
    const evidenceId = 'route-contract-1'
    const bundleDir = join(root, '.codex', 'ccg', 'intelligence', evidenceId)
    await fs.ensureDir(bundleDir)
    const createdAt = new Date().toISOString()
    const model = 'grok-4.5'
    const sourceUrl = 'https://docs.x.ai/build/cli/reference'
    const sourceId = `src-${hash(`web_search\n${sourceUrl}`).slice(0, 16)}`
    const artifact = `${JSON.stringify({
      schemaVersion: 2,
      decision: {
        requirement: 'required',
        status: 'valid',
        action: 'intel',
        investigation_mode: 'contract',
        mode: 'contract',
        depth: 'normal',
        package_status: 'valid',
        verification_outcome: 'verified',
        reason: 'Current contract verified.',
        created_at: createdAt,
      },
      evidence: {
        model: { requested: model, actual: model, provenance: 'grok agent --model' },
        action: 'intel',
        investigation_mode: 'contract',
        depth: 'normal',
        effective_x_policy: 'preferred',
        bindings: [],
        normalized: { searches: [{ tool: 'web_search', status: 'completed' }] },
        registry: { sources: [{ id: sourceId, tool: 'web_search', observed_tool: 'web_search', canonical_url: sourceUrl, official: true, source_tier: 'A', independence_key: 'x.ai' }] },
        claims: [{ id: 'verified', claim: 'Applicable fixture claim.', status: 'verified', severity: 'info', source_ids: [sourceId], applies_to: ['package.json'] }],
      },
    }, null, 2)}\n`
    const artifactSha256 = hash(artifact)
    const raw = ''
    const report = '# Canonical fixture\n'
    await fs.writeFile(join(bundleDir, 'raw-stream.jsonl'), raw)
    await fs.writeFile(join(bundleDir, 'report.md'), report)
    const manifest = `${JSON.stringify({
      schemaVersion: 1,
      evidenceId,
      createdAt,
      localOnly: true,
      exported: false,
      model,
      action: 'intel',
      investigation_mode: 'contract',
      depth: 'normal',
      requirement: 'required',
      effective_x_policy: 'preferred',
      cli_version: 'grok 0.2.106',
      prompt_sha256: 'a'.repeat(64),
      git_head: 'unversioned',
      dirty_digest: 'b'.repeat(64),
      bindings: [],
      official_domains: [],
      search_counts: { web: 1, x: 0 },
      attempts: 1,
      package_status: 'valid',
      validation_outcome: 'verified',
      verification_outcome: 'verified',
      cache_fingerprint: 'c'.repeat(64),
      cache_contract_versions: { runnerVersion: '2', evidenceSchemaVersion: '2' },
      files: {
        'evidence.json': { sha256: artifactSha256, bytes: Buffer.byteLength(artifact) },
        'raw-stream.jsonl': { sha256: hash(raw), bytes: Buffer.byteLength(raw) },
        'report.md': { sha256: hash(report), bytes: Buffer.byteLength(report) },
      },
    }, null, 2)}\n`
    const manifestSha256 = hash(manifest)
    await fs.writeFile(join(bundleDir, 'evidence.json'), artifact)
    await fs.writeFile(join(bundleDir, 'manifest.json'), manifest)

    await (routeRuntime as any).runWorkflowRoute({
      repoRoot: root,
      config: enabledConfig(),
      workflow: 'gptpro-plan',
      phase: 'intake',
      task: 'Upgrade the Acme SDK API contract.',
      taskDir,
      stateFile,
    }, {
      invoke: async () => ({
        exitCode: 0,
        status: 'valid',
        evidencePath: `.codex/ccg/intelligence/${evidenceId}/evidence.json`,
        evidenceSha256: artifactSha256,
        manifestPath: `.codex/ccg/intelligence/${evidenceId}/manifest.json`,
        manifestSha256,
        model,
      }),
    })

    expect(fs.readJsonSync(join(taskDir, 'evidence.json')).items).toContainEqual(expect.objectContaining({
      id: `grok-external-intelligence-${evidenceId}`,
      provider: 'grok',
      role: 'external-intelligence',
      policy: 'required',
      artifactSha256,
      manifestSha256,
      localOnly: true,
      exported: false,
    }))
    expect(fs.readJsonSync(join(taskDir, 'task.json')).intelligence).toMatchObject({
      requirement: 'required',
      status: 'valid',
      evidence_id: evidenceId,
      manifest_sha256: manifestSha256,
      localOnly: true,
      exported: false,
    })
    expect(fs.readJsonSync(stateFile).canonical_evidence).toMatchObject({
      evidence_id: evidenceId,
      artifact_sha256: artifactSha256,
      manifest_sha256: manifestSha256,
    })
  })

  it('rejects plan and dependency paths that escape through a link or junction', async () => {
    const outside = join(tmpdir(), `ccg-grok-route-outside-${Date.now()}`)
    const linked = join(root, 'linked-outside')
    await fs.ensureDir(outside)
    await fs.writeFile(join(outside, 'plan.md'), '# Outside plan\n')
    try {
      await fs.symlink(outside, linked, process.platform === 'win32' ? 'junction' : 'dir')
    }
    catch (error: any) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code))
        return
      throw error
    }
    let calls = 0
    await expect((routeRuntime as any).runWorkflowRoute({
      repoRoot: root,
      config: enabledConfig(),
      workflow: 'gptpro-plan',
      phase: 'intake',
      task: 'Verify the current SDK API contract.',
      plan: 'linked-outside/plan.md',
      stateFile: statePath('linked-state'),
    }, {
      invoke: async () => {
        calls++
        return validRunnerResult()
      },
    })).rejects.toThrow(/link|junction|repository/i)
    expect(calls).toBe(0)
    await fs.remove(outside)
  })

  it('accepts repository-root path aliases while preserving canonical containment checks', async () => {
    const alias = `${root}-alias`
    const taskDir = join(root, '.ccg', 'tasks', 'alias-route')
    await fs.ensureDir(taskDir)
    await fs.writeJson(join(taskDir, 'task.json'), { id: 'alias-route', status: 'in_progress' })
    try {
      await fs.symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir')
    }
    catch (error: any) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code))
        return
      throw error
    }

    try {
      const result = await (routeRuntime as any).runWorkflowRoute({
        repoRoot: alias,
        config: enabledConfig(),
        workflow: 'gptpro-plan',
        phase: 'intake',
        task: 'Verify the current SDK API contract.',
        plan: join(alias, 'plan.md'),
        dependencies: [join(alias, 'pnpm-lock.yaml')],
        stateFile: join(alias, '.ccg', 'tasks', 'alias-route', 'intelligence-route.json'),
        taskDir: join(alias, '.ccg', 'tasks', 'alias-route'),
      }, {
        // Preserve the caller-visible alias when synthesizing the runner manifest.
        // On Windows, realpath may independently expand the root and child into
        // different long/8.3 spellings even though they identify the same files.
        invoke: async (request: any) => validRunnerResultForRequest(request, { pathRoot: alias }),
      })

      expect(result, JSON.stringify(result, null, 2)).toMatchObject({ exitCode: 0, decision: { status: 'valid' } })
      expect(await fs.pathExists(join(taskDir, 'intelligence-route.json'))).toBe(true)
      expect(await fs.pathExists(join(taskDir, 'evidence.json'))).toBe(true)
    }
    finally {
      await fs.remove(alias)
    }
  })

  it('rejects arbitrary state files before invoking the runner', async () => {
    let calls = 0
    await expect((routeRuntime as any).runWorkflowRoute({
      repoRoot: root,
      config: enabledConfig(),
      workflow: 'go',
      phase: 'intake',
      task: 'Upgrade the current SDK API.',
      stateFile: join(root, 'package.json'),
    }, {
      invoke: async () => {
        calls++
        return validRunnerResult()
      },
    })).rejects.toThrow(/state file must match/i)
    expect(calls).toBe(0)
    expect(await fs.readJson(join(root, 'package.json'))).toEqual({ name: 'fixture' })
  })
})
