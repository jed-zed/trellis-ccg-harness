import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createProductManagerProviderPrompt,
  invokeValidatedProductManagerProvider,
  productManagerStatus,
  reviewProductManager,
  resolveClaudeExecutable,
  resolveClaudeProductManagerModel,
  resolveClaudeSshConfiguration,
  snapshotProductManager,
  unwrapProviderOutput,
} from '../../commands/product-manager'
import { canonicalJson } from '../canonical-json'
import { createInvocationKey } from '../invocation'
import {
  createWorkspaceSnapshotDigest,
  validateProductManagerWorkspaceSnapshot,
} from '../workspace-snapshot'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ccg-pm-command-'))
  const taskDir = join(root, '.trellis', 'tasks', 'pm')
  await mkdir(taskDir, { recursive: true })
  await writeFile(join(taskDir, 'task.json'), '{"id":"pm"}\n', 'utf8')
  const config = join(root, 'config.toml')
  await writeFile(config, [
    '[routing.product-manager]',
    'models = ["codex"]',
    'primary = "codex"',
    'strategy = "fallback"',
    '',
    '[product_manager]',
    'enabled = true',
    'contract_version = "1"',
    'max_retries = 1',
    'timeout_ms = 5000',
    'max_output_bytes = 1048576',
    '',
  ].join('\n'), 'utf8')
  const snapshotRoot = join(taskDir, '.ccg-evidence', 'product-manager', 'snapshots', 'fixture', 'root')
  await mkdir(snapshotRoot, { recursive: true })
  const snapshotData = Buffer.from('# Snapshot\n', 'utf8')
  const snapshotFile = join(snapshotRoot, 'README.md')
  await writeFile(snapshotFile, snapshotData)
  await chmod(snapshotFile, 0o400)
  const files = [{
    path: 'README.md',
    bytes: snapshotData.length,
    sha256: createHash('sha256').update(snapshotData).digest('hex'),
  }]
  const workspaceSnapshot = {
    policy_version: '1',
    sha256: createWorkspaceSnapshotDigest({
      policy_version: '1',
      git_head: '4'.repeat(40),
      dirty: false,
      files,
    }),
    file_count: files.length,
    total_bytes: snapshotData.length,
    git_head: '4'.repeat(40),
    dirty: false,
  }
  const manifestFile = join(taskDir, '.ccg-evidence', 'product-manager', 'snapshots', 'fixture', 'manifest.json')
  await writeFile(manifestFile, `${JSON.stringify({ ...workspaceSnapshot, files })}\n`, 'utf8')
  const base = {
    contract_version: '1',
    task_id: 'pm',
    trigger_type: 'MILESTONE_REVIEW' as const,
    checkpoint_id: 'M1',
    plan_revision: 1,
    evidence_digest: '2'.repeat(64),
    workspace_snapshot: workspaceSnapshot,
    claude_transport: 'local' as const,
    user_request: 'Implement M1',
    product_brief: null,
    grill_handoff: null,
    approved_plan: {},
    current_milestone: null,
    repository_facts: [],
    evidence_refs: ['test:focused'],
    risks: [],
    drift: [],
    user_feedback: [],
    historical_overrides: [],
    previous_review: null,
  }
  const input = {
    ...base,
    input_digest: createHash('sha256').update(canonicalJson(base), 'utf8').digest('hex'),
  }
  const inputFile = join(taskDir, 'input.json')
  await writeFile(inputFile, `${JSON.stringify(input)}\n`, 'utf8')
  return { root, taskDir, config, input, inputFile, snapshotRoot, manifestFile }
}

function workspaceOptions(value: Awaited<ReturnType<typeof fixture>>) {
  return {
    workspaceSnapshot: value.snapshotRoot,
    workspaceManifest: value.manifestFile,
    claudeTransport: 'local' as const,
  }
}

function outputFor(input: Awaited<ReturnType<typeof fixture>>['input']) {
  return {
    contract_version: input.contract_version,
    task_id: input.task_id,
    trigger_type: input.trigger_type,
    checkpoint_id: input.checkpoint_id,
    plan_revision: input.plan_revision,
    input_digest: input.input_digest,
    evidence_digest: input.evidence_digest,
    invocation_key: createInvocationKey(input),
    verdict: 'accepted',
    facts: [],
    hypotheses: [],
    findings: [],
    evidence_refs: input.evidence_refs,
    progress: { implementation: 15, product_acceptance: 15, health: 'green', reasons: [] },
    risks: [],
    recommended_next_action: 'Request user acceptance.',
    process_adjustments: [],
    material_change_proposal: null,
    reopen_request: null,
    user_acceptance_summary: 'M1 is ready.',
    provider_identity: { provider: 'codex', model: 'test', cli_version: 'test' },
    generated_at: '2026-07-27T00:00:00.000Z',
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('product-manager command', () => {
  it('defaults Claude product-manager calls to the explicit opus model alias', () => {
    vi.stubEnv('CCG_PRODUCT_MANAGER_CLAUDE_MODEL', '')
    expect(resolveClaudeProductManagerModel()).toBe('opus')

    vi.stubEnv('CCG_PRODUCT_MANAGER_CLAUDE_MODEL', 'claude-opus-5')
    expect(resolveClaudeProductManagerModel()).toBe('claude-opus-5')
  })

  it('rejects the legacy SSH bridge as a local Claude executable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ccg-pm-claude-'))
    try {
      const bridge = join(root, process.platform === 'win32' ? 'claude-ssh-bridge.exe' : 'claude-ssh-bridge')
      await writeFile(bridge, '')
      vi.stubEnv('CCG_PRODUCT_MANAGER_CLAUDE_EXECUTABLE', bridge)
      expect(resolveClaudeExecutable()).toBeNull()
    }
    finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('validates the explicit SSH transport environment without using the local override', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ccg-pm-ssh-'))
    try {
      const bridge = join(root, process.platform === 'win32' ? 'bridge.exe' : 'bridge')
      const identity = join(root, 'identity')
      const knownHosts = join(root, 'known-hosts')
      await writeFile(bridge, '')
      await writeFile(identity, '')
      await writeFile(knownHosts, '')
      const configuration = resolveClaudeSshConfiguration({
        CCG_PRODUCT_MANAGER_CLAUDE_EXECUTABLE: join(root, 'local-claude-must-not-be-used.exe'),
        CCG_PRODUCT_MANAGER_CLAUDE_SSH_EXECUTABLE: bridge,
        CCG_PRODUCT_MANAGER_CLAUDE_SSH_HOST: 'review.example.test',
        CCG_PRODUCT_MANAGER_CLAUDE_SSH_USER: 'reviewer',
        CCG_PRODUCT_MANAGER_CLAUDE_SSH_PORT: '22',
        CCG_PRODUCT_MANAGER_CLAUDE_SSH_IDENTITY_FILE: identity,
        CCG_PRODUCT_MANAGER_CLAUDE_SSH_KNOWN_HOSTS_FILE: knownHosts,
        CCG_PRODUCT_MANAGER_CLAUDE_SSH_REMOTE_EXECUTABLE: '/usr/local/bin/claude',
      })
      expect(configuration.executable).toBe(bridge)
      expect(configuration.remoteExecutable).toBe('/usr/local/bin/claude')
      expect(() => resolveClaudeSshConfiguration({
        ...process.env,
        CCG_PRODUCT_MANAGER_CLAUDE_SSH_EXECUTABLE: bridge,
      })).toThrow(/host|user|port|identity|known-hosts/i)
    }
    finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('prepares one bounded offline snapshot from tracked, dirty, and untracked files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ccg-pm-snapshot-'))
    const taskDir = join(root, '.trellis', 'tasks', 'pm')
    try {
      await mkdir(taskDir, { recursive: true })
      await writeFile(join(taskDir, 'task.json'), '{"id":"pm"}\n')
      await writeFile(join(root, '.gitignore'), '.ccg-evidence/\nignored.txt\n')
      await writeFile(join(root, 'tracked.txt'), 'before\n')
      await writeFile(join(root, '.env'), 'SECRET=excluded\n')
      execFileSync('git', ['init'], { cwd: root, shell: false, stdio: 'ignore' })
      execFileSync('git', ['add', '.'], { cwd: root, shell: false, stdio: 'ignore' })
      await writeFile(join(root, 'tracked.txt'), 'after\n')
      await writeFile(join(root, 'untracked.txt'), 'visible\n')
      await writeFile(join(root, 'ignored.txt'), 'excluded\n')

      const prepared = await snapshotProductManager({ workdir: root, taskDir })
      const manifest = JSON.parse(await readFile(prepared.manifest_path, 'utf8'))
      expect(manifest.files.map((file: { path: string }) => file.path)).toEqual(expect.arrayContaining([
        '.gitignore',
        '.trellis/tasks/pm/task.json',
        'tracked.txt',
        'untracked.txt',
      ]))
      expect(manifest.files.map((file: { path: string }) => file.path)).not.toContain('.env')
      expect(manifest.files.map((file: { path: string }) => file.path)).not.toContain('ignored.txt')
      expect(prepared.workspace_snapshot.dirty).toBe(true)
      await expect(validateProductManagerWorkspaceSnapshot({
        snapshotRoot: prepared.snapshot_root,
        manifestFile: prepared.manifest_path,
        taskDir,
        expected: prepared.workspace_snapshot,
      })).resolves.toBe(prepared.snapshot_root)
    }
    finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reports the provider resolved from unified routing', async () => {
    const value = await fixture()
    try {
      const status = await productManagerStatus({ config: value.config })
      expect(status.routing).toEqual({
        authority: 'unified-ccg-routing',
        role: 'product-manager',
        provider: 'codex',
      })
      expect(status.configured).not.toHaveProperty('provider')
      expect(status.effective).toMatchObject({ status: 'ready', provider: 'codex' })
    }
    finally {
      await rm(value.root, { recursive: true, force: true })
    }
  })

  it('fails closed when the unified route is not implemented or not allowed', async () => {
    const value = await fixture()
    try {
      await writeFile(value.config, [
        '[routing.product-manager]',
        'models = ["antigravity"]',
        'primary = "antigravity"',
        'strategy = "fallback"',
        '',
        '[product_manager]',
        'enabled = true',
        'contract_version = "1"',
        '',
      ].join('\n'), 'utf8')
      const unimplemented = await productManagerStatus({ config: value.config })
      expect(unimplemented.effective).toEqual({
        status: 'unavailable',
        reason: 'selected_provider_not_implemented',
        selected: 'antigravity',
      })

      await writeFile(value.config, [
        '[routing.product-manager]',
        'models = ["gemini"]',
        'primary = "gemini"',
        'strategy = "fallback"',
        '',
        '[product_manager]',
        'enabled = true',
        'contract_version = "1"',
        '',
      ].join('\n'), 'utf8')
      const disallowed = await productManagerStatus({
        config: value.config,
        allowedProviders: 'claude',
      })
      expect(disallowed.effective).toEqual({
        status: 'unavailable',
        reason: 'selected_provider_not_allowed',
        selected: 'gemini',
      })
    }
    finally {
      await rm(value.root, { recursive: true, force: true })
    }
  })

  it('redacts credentials before constructing the provider payload', () => {
    const prompt = createProductManagerProviderPrompt({
      api_key: 'sk_abcdefghijklmnop',
      authorization: 'Bearer abcdefghijklmnop',
      safe: 'keep',
    })
    expect(prompt).toContain('"safe":"keep"')
    expect(prompt).not.toContain('sk_abcdefghijklmnop')
    expect(prompt).not.toContain('Bearer abcdefghijklmnop')
    expect(prompt).toContain('[REDACTED]')
  })

  it('unwraps Claude structured output without accepting envelope commentary', () => {
    const structured = { provider_identity: { provider: 'claude' } }
    expect(unwrapProviderOutput(JSON.stringify({
      type: 'result',
      result: 'ignored presentation text',
      structured_output: structured,
    }), 'claude')).toEqual(structured)
  })

  it('reuses the completed result for the same invocation key without another provider call', async () => {
    const value = await fixture()
    try {
      const response = join(value.taskDir, 'response.json')
      await writeFile(response, `${JSON.stringify(outputFor(value.input))}\n`, 'utf8')
      const first = await reviewProductManager({
        ...workspaceOptions(value),
        input: value.inputFile,
        taskDir: value.taskDir,
        response,
        config: value.config,
      })
      const reused = await reviewProductManager({
        ...workspaceOptions(value),
        input: value.inputFile,
        taskDir: value.taskDir,
        config: value.config,
      })
      expect(reused).toEqual(first)
    }
    finally {
      await rm(value.root, { recursive: true, force: true })
    }
  })

  it('returns an explicit unavailable verdict when the selected provider cannot start', async () => {
    const value = await fixture()
    try {
      vi.stubEnv('CCG_PRODUCT_MANAGER_CODEX_EXECUTABLE', process.execPath)
      const result = await reviewProductManager({
        ...workspaceOptions(value),
        input: value.inputFile,
        taskDir: value.taskDir,
        config: value.config,
        allowProviderCall: true,
      })
      expect(result.verdict).toBe('unavailable')
      expect(result.provider_identity.provider).toBe('codex')
      const auditFile = join(
        value.taskDir,
        '.ccg-evidence',
        'product-manager',
        'calls',
        createInvocationKey(value.input),
        'audit.ndjson',
      )
      const attempts = (await readFile(auditFile, 'utf8'))
        .trim()
        .split('\n')
        .map(line => JSON.parse(line))
        .filter(entry => entry.status === 'attempt_failed')
      expect(attempts).toHaveLength(2)
      expect(attempts.map(entry => [entry.attempt, entry.max_attempts, entry.provider])).toEqual([
        [1, 2, 'codex'],
        [2, 2, 'codex'],
      ])
      expect(attempts.every(entry => typeof entry.error === 'string' && entry.error.length > 0)).toBe(true)
    }
    finally {
      await rm(value.root, { recursive: true, force: true })
    }
  })

  it('retries invalid provider output and validates the successful response', async () => {
    const value = await fixture()
    try {
      let calls = 0
      const failures: Array<{ attempt: number, maxAttempts: number, error: unknown }> = []
      const result = await invokeValidatedProductManagerProvider({
        input: value.input,
        invocationKey: createInvocationKey(value.input),
        provider: 'codex',
        maxRetries: 1,
        invoke: async () => {
          calls++
          return calls === 1 ? { malformed: true } : outputFor(value.input)
        },
        onAttemptFailure: (failure) => {
          failures.push(failure)
        },
      })
      expect(calls).toBe(2)
      expect(failures).toHaveLength(1)
      expect(failures[0]).toMatchObject({ attempt: 1, maxAttempts: 2 })
      expect(failures[0].error).toBeInstanceOf(Error)
      expect(result.verdict).toBe('accepted')
    }
    finally {
      await rm(value.root, { recursive: true, force: true })
    }
  })

  it('returns unavailable after every provider response fails validation', async () => {
    const value = await fixture()
    try {
      let calls = 0
      const failures: Array<{ attempt: number, maxAttempts: number }> = []
      const result = await invokeValidatedProductManagerProvider({
        input: value.input,
        invocationKey: createInvocationKey(value.input),
        provider: 'codex',
        maxRetries: 1,
        invoke: async () => {
          calls++
          return { malformed: true }
        },
        onAttemptFailure: ({ attempt, maxAttempts }) => {
          failures.push({ attempt, maxAttempts })
        },
      })
      expect(calls).toBe(2)
      expect(failures).toEqual([
        { attempt: 1, maxAttempts: 2 },
        { attempt: 2, maxAttempts: 2 },
      ])
      expect(result.verdict).toBe('unavailable')
    }
    finally {
      await rm(value.root, { recursive: true, force: true })
    }
  })
})
