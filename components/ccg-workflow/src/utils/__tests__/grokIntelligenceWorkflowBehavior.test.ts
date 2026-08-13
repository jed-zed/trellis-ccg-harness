import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import fs from 'fs-extra'
// @ts-expect-error Runtime template modules intentionally ship as plain ESM.
import * as routeRuntime from '../../../templates/engine/tools/grok-intelligence/route.mjs'
// @ts-expect-error Runtime template modules intentionally ship as plain ESM.
import { bindClaims, buildSourceRegistry } from '../../../templates/engine/tools/grok-intelligence/lib/source-registry.mjs'
// @ts-expect-error Runtime template modules intentionally ship as plain ESM.
import { resolveEffectiveXPolicy, validateEvidencePackage } from '../../../templates/engine/tools/grok-intelligence/lib/validator.mjs'

const packageRoot = resolve('.')
const tempRoot = join(tmpdir(), `ccg-grok-workflow-${Date.now()}`)
const routeCommand = 'ccg route'
let evidenceCounter = 0

function hash(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

function statePath(repoRoot: string, id: string) {
  return join(repoRoot, '.codex', 'ccg', id, 'status.json')
}

function validRunnerResult(repoRoot: string, mode = 'contract', action = 'intel', depth = 'normal', effectiveXPolicy = 'preferred', bindings: any[] = [], officialDomains: string[] = [], requirement = 'required') {
  const evidenceId = `workflow-evidence-${++evidenceCounter}`
  const bundleDir = join(repoRoot, '.codex', 'ccg', 'intelligence', evidenceId)
  fs.ensureDirSync(bundleDir)
  const createdAt = new Date().toISOString()
  const model = 'grok-4.5'
  const sourceUrl = 'https://docs.x.ai/build/cli/reference'
  const sourceId = `src-${hash(`web_search\n${sourceUrl}`).slice(0, 16)}`
  const xSourceUrl = 'https://x.com/xai/status/1'
  const xSourceId = `src-${hash(`x_search\n${xSourceUrl}`).slice(0, 16)}`
  const artifact = `${JSON.stringify({
    schemaVersion: 2,
    decision: {
      requirement,
      status: 'verified',
      action,
      investigation_mode: mode,
      mode,
      depth,
      package_status: 'valid',
      verification_outcome: 'verified',
      reason: 'Fixture verified.',
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
      claims: [{ id: 'verified', claim: 'Applicable current contract.', status: 'verified', severity: 'info', source_ids: [sourceId], applies_to: ['package.json'] }],
    },
  }, null, 2)}\n`
  const raw = ''
  const report = '# Workflow fixture\n'
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
    requirement,
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
    status: 'verified',
    model,
    evidencePath: `.codex/ccg/intelligence/${evidenceId}/evidence.json`,
    evidenceSha256: hash(artifact),
    manifestPath: `.codex/ccg/intelligence/${evidenceId}/manifest.json`,
    manifestSha256: hash(manifest),
  }
}

function validRunnerResultForRequest(repoRoot: string, request: any) {
  const bindingInputs = [
    request.options.plan ? ['plan', request.options.plan] : null,
    request.options.diff ? ['diff', request.options.diff] : null,
    ...(request.options.dependencies || []).map((path: string) => ['dependency', path]),
  ].filter(Boolean) as string[][]
  const bindings = bindingInputs.map(([kind, path]) => {
    const absolute = resolve(repoRoot, path)
    const bytes = readFileSync(absolute)
    return {
      kind,
      path: isAbsolute(path) ? relative(repoRoot, absolute).replace(/\\/g, '/') : path.replace(/\\/g, '/'),
      sha256: hash(bytes),
      bytes: bytes.length,
      empty: bytes.length === 0,
    }
  })
  const mode = request.options.mode || 'contract'
  const configuredX = request.options.config.x_search_policy || 'preferred'
  const effectiveX = configuredX === 'disabled' ? 'disabled' : configuredX === 'required' ? 'required' : 'preferred'
  return validRunnerResult(repoRoot, mode, request.action, request.options.depth || 'normal', effectiveX, bindings, request.options.officialDomains || [], request.options.requirement || 'required')
}

describe('Grok workflow routing behavior', () => {
  afterAll(async () => {
    await fs.remove(tempRoot)
  })

  it('declares executable coverage for every automatic-routing family and mirrors every listed surface', () => {
    const coveragePath = join(packageRoot, 'templates', 'engine', 'tools', 'grok-intelligence', 'workflow-coverage.json')
    expect(fs.pathExistsSync(coveragePath)).toBe(true)
    const coverage = fs.readJsonSync(coveragePath)
    expect(coverage).toMatchObject({ schemaVersion: 1, runtime: 'tools/grok-intelligence/route.mjs' })
    const families = new Set(coverage.workflows.flatMap((entry: any) => entry.families))
    expect(families).toEqual(new Set([
      'go-plan',
      'execute-feat',
      'review-verify',
      'team',
      'spec',
      'gptpro',
      'quality-gates',
    ]))
    expect(coverage.defaultSkips).toEqual([
      'commit',
      'rollback',
      'clean-branches',
      'worktree',
      'context',
    ])
    for (const entry of coverage.defaultSkipSurfaces) {
      expect(coverage.defaultSkips).toContain(entry.id)
      for (const relativePath of entry.surfaces) {
        const content = readFileSync(join(packageRoot, ...relativePath.split('/')), 'utf8')
        expect(content, relativePath).not.toContain(routeCommand)
        expect(content, relativePath).toMatch(/does not invoke|不调用.*Grok/i)
      }
    }

    for (const entry of coverage.workflows) {
      expect(entry.surfaces.length).toBeGreaterThan(0)
      for (const relativePath of entry.surfaces) {
        const content = readFileSync(join(packageRoot, ...relativePath.split('/')), 'utf8')
        expect(content, relativePath).toContain(routeCommand)
        expect(content, relativePath).toContain(`--workflow ${entry.id}`)
        expect(content, relativePath).toContain('--state-file')
        expect(content, relativePath).toMatch(/exit (?:code )?`?2(?:`, `3`, or `4|\/3\/4)/i)
      }
    }
  })

  it('runs one shared Team decision through the manual cache boundary for each caller', async () => {
    const repoRoot = join(tempRoot, 'team-family')
    await fs.ensureDir(repoRoot)
    await fs.writeJson(join(repoRoot, 'package.json'), { name: 'fixture' })
    const stateFile = join(repoRoot, '.ccg', 'tasks', 'team-task', 'intelligence-route.json')
    const invocations: any[] = []
    const events: string[] = []
    const input = {
      repoRoot,
      config: { enabled: true, auto_route: true, require_web_search: true, x_search_policy: 'preferred' },
      workflow: 'team',
      phase: 'team-intake',
      task: 'Upgrade the current SDK contract for all builders.',
      stateFile,
    }
    const runtime = {
      invoke: async (request: any) => {
        invocations.push(request)
        return validRunnerResultForRequest(repoRoot, request)
      },
      onEvent: (event: string) => events.push(event),
    }

    const leader = await (routeRuntime as any).runWorkflowRoute(input, runtime)
    const teammate = await (routeRuntime as any).runWorkflowRoute(input, runtime)

    expect(leader).toMatchObject({ invoked: true, reused: false, workflow: 'team', phase: 'team-intake' })
    expect(teammate).toMatchObject({ invoked: true, reused: false })
    expect(invocations).toHaveLength(2)
    expect(events).toEqual(['decision', 'state:pending', 'state:complete', 'decision', 'state:pending', 'state:complete'])
    expect(await fs.readJson(stateFile)).toMatchObject({ decision: { status: 'verified' }, execution: { invoked: true } })
  })

  it.each([
    ['go-plan', 'plan', 'intake', undefined],
    ['execute-feat', 'feat', 'implementation', undefined],
    ['review-verify', 'review', 'final-verify', 'final_diff_verify'],
    ['gptpro', 'gptpro-plan', 'intake', undefined],
  ])('runs the %s family gate before its ordinary workflow', async (_family, workflow, phase, trigger) => {
    const repoRoot = join(tempRoot, `family-${workflow}`)
    await fs.ensureDir(repoRoot)
    const stateFile = statePath(repoRoot, `route-${workflow}`)
    const diff = join(repoRoot, 'change.diff')
    if (trigger === 'final_diff_verify') await fs.writeFile(diff, '+ verified change\n')
    const order: string[] = []
    const result = await (routeRuntime as any).runWorkflowRoute({
      repoRoot,
      config: { enabled: true, auto_route: true, require_web_search: true, x_search_policy: 'disabled' },
      workflow,
      phase,
      trigger,
      ...(trigger === 'final_diff_verify' ? { diff } : {}),
      ...(trigger === 'final_diff_verify' ? { officialDomains: ['docs.x.ai'] } : {}),
      task: 'Use the latest SDK API contract in this workflow.',
      stateFile,
    }, {
      onEvent: (event: string) => order.push(event),
      invoke: async (request: any) => {
        order.push('runner')
        return validRunnerResultForRequest(repoRoot, request)
      },
    })

    expect(result).toMatchObject({ invoked: true, workflow, phase, decision: { status: 'verified' } })
    expect(order).toEqual(['decision', 'state:pending', 'runner', 'state:complete'])
    expect(await fs.readJson(stateFile)).toMatchObject({ workflow, phase, execution: { invoked: true } })
  })

  it('invalidates Spec evidence when proposal, plan, diff, target, or phase bindings change', async () => {
    const repoRoot = join(tempRoot, 'spec-family')
    await fs.ensureDir(repoRoot)
    const proposal = join(repoRoot, 'proposal.md')
    const plan = join(repoRoot, 'plan.md')
    const diff = join(repoRoot, 'change.diff')
    const target = join(repoRoot, 'target.txt')
    await Promise.all([
      fs.writeFile(proposal, 'proposal-v1'),
      fs.writeFile(plan, 'plan-v1'),
      fs.writeFile(diff, 'diff-v1'),
      fs.writeFile(target, 'target-v1'),
    ])
    const stateFile = statePath(repoRoot, 'spec-route')
    const invocations: any[] = []
    const runtime = { invoke: async (request: any) => {
      invocations.push(request)
      return validRunnerResultForRequest(repoRoot, request)
    } }
    const base = {
      repoRoot,
      config: { enabled: true, auto_route: true, require_web_search: true, x_search_policy: 'disabled' },
      workflow: 'spec-plan',
      phase: 'spec-plan',
      task: 'Plan a current SDK API compatibility upgrade.',
      plan,
      target,
      dependencies: [proposal],
      stateFile,
    }

    expect(await (routeRuntime as any).runWorkflowRoute(base, runtime)).toMatchObject({ invoked: true })
    expect(await (routeRuntime as any).runWorkflowRoute(base, runtime)).toMatchObject({ invoked: true, reused: false })
    await fs.writeFile(proposal, 'proposal-v2')
    expect(await (routeRuntime as any).runWorkflowRoute(base, runtime)).toMatchObject({ invoked: true })
    await fs.writeFile(plan, 'plan-v2')
    expect(await (routeRuntime as any).runWorkflowRoute(base, runtime)).toMatchObject({ invoked: true })
    await fs.writeFile(target, 'target-v2')
    expect(await (routeRuntime as any).runWorkflowRoute(base, runtime)).toMatchObject({ invoked: true })
    expect(await (routeRuntime as any).runWorkflowRoute({
      ...base,
      phase: 'final-verify',
      trigger: 'final_diff_verify',
      diff,
      officialDomains: ['docs.x.ai'],
    }, runtime)).toMatchObject({ invoked: true, phase: 'final-verify' })
    await fs.writeFile(diff, 'diff-v2')
    expect(await (routeRuntime as any).runWorkflowRoute({
      ...base,
      phase: 'final-verify',
      trigger: 'final_diff_verify',
      diff,
      officialDomains: ['docs.x.ai'],
    }, runtime)).toMatchObject({ invoked: true })
    expect(invocations).toHaveLength(7)
  })

  it('keeps local quality gates offline and invokes external-contract quality checks in order', async () => {
    const repoRoot = join(tempRoot, 'quality-family')
    await fs.ensureDir(repoRoot)
    const target = join(repoRoot, 'changed.ts')
    await fs.writeFile(target, 'export const value = 1\n')
    const invocations: any[] = []
    const events: string[] = []
    const runtime = {
      invoke: async (request: any) => {
        invocations.push(request)
        return validRunnerResultForRequest(repoRoot, request)
      },
      onEvent: (event: string) => events.push(event),
    }
    const common = {
      repoRoot,
      config: { enabled: true, auto_route: true, require_web_search: true, x_search_policy: 'disabled' },
      workflow: 'verify-quality',
      phase: 'quality-verify',
      target,
      stateFile: statePath(repoRoot, 'quality-route'),
    }

    const local = await (routeRuntime as any).runWorkflowRoute({ ...common, task: 'Check local formatting.' }, runtime)
    expect(local).toMatchObject({ invoked: false, decision: { trigger: 'no_initial_trigger' } })
    const external = await (routeRuntime as any).runWorkflowRoute({
      ...common,
      task: 'Verify compatibility with the latest external SDK API contract.',
    }, runtime)
    expect(external).toMatchObject({ invoked: true, decision: { trigger: 'dependency_api_contract' } })
    expect(invocations).toHaveLength(1)
    expect(events).toEqual(['decision', 'state:complete', 'decision', 'state:pending', 'state:complete'])
  })

  it('places the executable Grok gate before ordinary work on representative entrypoints', () => {
    const surfaces = [
      ['templates/commands/go.md', '## Phase 0: 逃生舱检测'],
      ['templates/commands/gptpro-plan.md', 'Then run ordinary `/ccg:plan`'],
      ['templates/commands/gptpro-exc.md', 'Then run ordinary'],
      ['templates/commands/gptpro-review.md', 'Then run ordinary `/ccg:review`'],
      ['plugins/ccg/skills/ccg-go/SKILL.md', 'Inspect the user'],
      ['plugins/ccg/skills/ccg-gptpro-plan/SKILL.md', 'Run ordinary `/ccg:plan`'],
      ['plugins/ccg/skills/ccg-gptpro-exc/SKILL.md', 'Preserve the current CCG orchestrator'],
      ['plugins/ccg/skills/ccg-gptpro-review/SKILL.md', 'Run ordinary `/ccg:review`'],
    ] as const
    for (const [relativePath, ordinaryMarker] of surfaces) {
      const content = readFileSync(join(packageRoot, ...relativePath.split('/')), 'utf8')
      const routeIndex = content.indexOf(routeCommand)
      expect(routeIndex, relativePath).toBeGreaterThanOrEqual(0)
      expect(routeIndex, relativePath).toBeLessThan(content.indexOf(ordinaryMarker))
    }
  })

  it('bootstraps the bounded /ccg:go request before invoking its external intelligence gate', () => {
    const surfaces = [
      'templates/commands/go.md',
      'plugins/ccg/commands/go.md',
      'plugins/ccg/skills/ccg-go/SKILL.md',
    ]
    for (const relativePath of surfaces) {
      const content = readFileSync(join(packageRoot, ...relativePath.split('/')), 'utf8')
      const bootstrapIndex = content.indexOf('Bootstrap contract:')
      const routeIndex = content.indexOf(routeCommand)
      expect(bootstrapIndex, relativePath).toBeGreaterThanOrEqual(0)
      expect(bootstrapIndex, relativePath).toBeLessThan(routeIndex)
      expect(content.slice(bootstrapIndex, routeIndex), relativePath).toMatch(
        /create or reuse[\s\S]*\.ccg\/tasks\/<task-id>\/[\s\S]*write the original user request[\s\S]*intelligence-request\.md/i,
      )
    }
  })

  it('keeps preferred X optional in every mode', () => {
    expect(resolveEffectiveXPolicy('preferred', 'incident')).toBe('preferred')
    expect(resolveEffectiveXPolicy('preferred', 'landscape')).toBe('preferred')
    expect(resolveEffectiveXPolicy('disabled', 'incident')).toBe('disabled')

    const registry = buildSourceRegistry({
      searches: [{
        tool: 'web_search',
        observed_tool: 'web_search',
        status: 'completed',
        query: 'current market',
        sources: [{ url: 'https://docs.x.ai/overview' }],
        toolCallId: 'web-1',
        backend: true,
      }],
    }, {
      retrievedAt: '2026-07-21T00:00:00.000Z',
      officialDomains: ['docs.x.ai'],
      officialXAccounts: ['xai'],
      domainTiers: {},
    })
    expect(validateEvidencePackage({
      normalized: { searches: [{ tool: 'web_search', status: 'completed', sources: [{}] }] },
      registry,
      claims: [],
      requireWebSearch: true,
      xSearchPolicy: 'preferred',
      mode: 'landscape',
    })).toMatchObject({ valid: true, warnings: [expect.stringMatching(/preferred X/i)] })
  })

  it('keeps X-only material advisory and never elevates it into a blocker', () => {
    const registry = buildSourceRegistry({
      searches: [{
        tool: 'x_search',
        observed_tool: 'web_search',
        status: 'completed',
        query: 'site:x.com from:xai',
        sources: [{ url: 'https://x.com/xai/status/1' }],
        toolCallId: 'x-1',
        backend: true,
      }],
    }, {
      retrievedAt: '2026-07-21T00:00:00.000Z',
      officialDomains: ['docs.x.ai'],
      officialXAccounts: ['xai'],
      domainTiers: {},
    })
    const claims = bindClaims([{
      id: 'x-radar',
      claim: 'A maintainer post may indicate an early rollout.',
      status: 'early_warning',
      severity: 'warning',
      source_ids: [registry.sources[0].id],
    }], registry)
    expect(validateEvidencePackage({
      normalized: { searches: [{ tool: 'x_search', status: 'completed', sources: [{}] }] },
      registry,
      claims,
      requireWebSearch: false,
      xSearchPolicy: 'preferred',
      mode: 'landscape',
    })).toMatchObject({ valid: true, errors: [], evaluated_claims: [{ id: 'x-radar', blocker: null }] })
  })

  it('passes disabled X policy through one Web intelligence route without an X invocation', async () => {
    await fs.emptyDir(tempRoot)
    await fs.writeJson(join(tempRoot, 'package.json'), { name: 'fixture' })
    const invocations: any[] = []
    const result = await (routeRuntime as any).runWorkflowRoute({
      repoRoot: tempRoot,
      config: {
        enabled: true,
        auto_route: true,
        auth_mode: 'browser_oauth',
        require_web_search: true,
        x_search_policy: 'disabled',
      },
      workflow: 'debug',
      phase: 'diagnosis',
      task: 'Diagnose the current hosted API outage.',
      stateFile: statePath(tempRoot, 'disabled-x'),
    }, {
      invoke: async (request: any) => {
        invocations.push(request)
        return validRunnerResultForRequest(tempRoot, request)
      },
    })

    expect(result.decision).toMatchObject({ effective_x_policy: 'disabled' })
    expect(invocations).toHaveLength(1)
    expect(invocations[0].options.config.x_search_policy).toBe('disabled')
    expect(invocations[0].argv.join(' ')).not.toMatch(/x-search|x\.com/i)
  })
})
