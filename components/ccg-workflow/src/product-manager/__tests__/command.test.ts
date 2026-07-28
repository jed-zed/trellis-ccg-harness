import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createProductManagerProviderPrompt,
  invokeValidatedProductManagerProvider,
  reviewProductManager,
} from '../../commands/product-manager'
import { canonicalJson } from '../canonical-json'
import { createInvocationKey } from '../invocation'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ccg-pm-command-'))
  const taskDir = join(root, '.trellis', 'tasks', 'pm')
  await mkdir(taskDir, { recursive: true })
  await writeFile(join(taskDir, 'task.json'), '{"id":"pm"}\n', 'utf8')
  const config = join(root, 'config.toml')
  await writeFile(config, [
    '[product_manager]',
    'enabled = true',
    'provider = "codex"',
    'contract_version = "1"',
    'max_retries = 1',
    'timeout_ms = 5000',
    'max_output_bytes = 1048576',
    '',
  ].join('\n'), 'utf8')
  const base = {
    contract_version: '1',
    task_id: 'pm',
    trigger_type: 'MILESTONE_REVIEW' as const,
    checkpoint_id: 'M1',
    plan_revision: 1,
    evidence_digest: '2'.repeat(64),
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
  return { root, taskDir, config, input, inputFile }
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

  it('reuses the completed result for the same invocation key without another provider call', async () => {
    const value = await fixture()
    try {
      const response = join(value.taskDir, 'response.json')
      await writeFile(response, `${JSON.stringify(outputFor(value.input))}\n`, 'utf8')
      const first = await reviewProductManager({
        input: value.inputFile,
        taskDir: value.taskDir,
        response,
        config: value.config,
      })
      const reused = await reviewProductManager({
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
        input: value.inputFile,
        taskDir: value.taskDir,
        config: value.config,
        allowProviderCall: true,
      })
      expect(result.verdict).toBe('unavailable')
      expect(result.provider_identity.provider).toBe('codex')
    }
    finally {
      await rm(value.root, { recursive: true, force: true })
    }
  })

  it('retries invalid provider output and validates the successful response', async () => {
    const value = await fixture()
    try {
      let calls = 0
      const result = await invokeValidatedProductManagerProvider({
        input: value.input,
        invocationKey: createInvocationKey(value.input),
        provider: 'codex',
        maxRetries: 1,
        invoke: async () => {
          calls++
          return calls === 1 ? { malformed: true } : outputFor(value.input)
        },
      })
      expect(calls).toBe(2)
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
      const result = await invokeValidatedProductManagerProvider({
        input: value.input,
        invocationKey: createInvocationKey(value.input),
        provider: 'codex',
        maxRetries: 1,
        invoke: async () => {
          calls++
          return { malformed: true }
        },
      })
      expect(calls).toBe(2)
      expect(result.verdict).toBe('unavailable')
    }
    finally {
      await rm(value.root, { recursive: true, force: true })
    }
  })
})
