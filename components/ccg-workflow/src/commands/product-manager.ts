import type { ProductManagerConfig } from '../types'
import type { ProductManagerOutput, ProductManagerProvider } from '../product-manager/contracts'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { delimiter, isAbsolute, join, resolve } from 'node:path'
import { parse } from 'smol-toml'
import {
  PRODUCT_MANAGER_CONTRACT_VERSION,
  PRODUCT_MANAGER_OUTPUT_JSON_SCHEMA,
  validateProductManagerInput,
  validateProductManagerOutput,
} from '../product-manager/contracts'
import {
  appendInvocationAudit,
  readInvocationEvidence,
  redactProductManagerValue,
  withInvocationLock,
  writeInvocationEvidence,
  writeInvocationRawResponse,
} from '../product-manager/evidence-store'
import { createInvocationKey } from '../product-manager/invocation'
import {
  IMPLEMENTED_PRODUCT_MANAGER_PROVIDERS,
  resolveEffectiveProductManagerProvider,
} from '../product-manager/provider-registry'
import { executeReadOnlyProvider } from '../product-manager/provider-runner'
import { createCodexProductManagerExecution } from '../product-manager/providers/codex'
import { createGeminiProductManagerExecution } from '../product-manager/providers/gemini'
import { normalizeProductManagerConfig } from '../utils/config'

export interface ProductManagerCommandOptions {
  json?: boolean
  input?: string
  taskDir?: string
  response?: string
  allowedProviders?: string
  allowProviderCall?: boolean
  config?: string
}

function resolveCodexProductManagerConfigPath(explicit?: string): string {
  return resolve(explicit || join(homedir(), '.codex', 'ccg', 'config.toml'))
}

export async function readCodexProductManagerConfig(configPath?: string): Promise<ProductManagerConfig> {
  const file = resolveCodexProductManagerConfigPath(configPath)
  if (!existsSync(file))
    return normalizeProductManagerConfig(undefined, { existingInstall: true })
  const parsed = parse(await readFile(file, 'utf8')) as Record<string, any>
  return normalizeProductManagerConfig(parsed.product_manager, { existingInstall: true })
}

function parseAllowedProviders(value: string | undefined): ProductManagerProvider[] {
  if (!value)
    return [...IMPLEMENTED_PRODUCT_MANAGER_PROVIDERS]
  const providers = value.split(',').map(item => item.trim()).filter(Boolean)
  if (providers.some(provider => !IMPLEMENTED_PRODUCT_MANAGER_PROVIDERS.includes(provider as ProductManagerProvider)))
    throw new TypeError('allowed providers must contain only codex or gemini')
  return [...new Set(providers)] as ProductManagerProvider[]
}

function findExecutable(names: string[]): string | null {
  const pathValue = process.env.PATH || process.env.Path || ''
  for (const directory of pathValue.split(delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = resolve(directory, name)
      if (isAbsolute(candidate) && existsSync(candidate))
        return candidate
    }
  }
  return null
}

function resolveGeminiEntrypoint(): string | null {
  const explicit = process.env.CCG_PRODUCT_MANAGER_GEMINI_ENTRYPOINT
  if (explicit && isAbsolute(explicit) && existsSync(explicit))
    return explicit
  const shim = findExecutable(process.platform === 'win32' ? ['gemini.cmd'] : ['gemini'])
  if (!shim)
    return null
  const adjacent = resolve(shim, '..', 'node_modules', '@google', 'gemini-cli', 'dist', 'index.js')
  return existsSync(adjacent) ? adjacent : null
}

export function createProductManagerProviderPrompt(input: unknown): string {
  return [
    'You are the read-only product-manager reviewer.',
    'Do not use tools, execute commands, modify files, or control subagents.',
    'Return exactly one JSON object matching the supplied contract.',
    'Do not include markdown, hidden reasoning, credentials, or commentary.',
    `Output JSON Schema:\n${JSON.stringify(PRODUCT_MANAGER_OUTPUT_JSON_SCHEMA)}`,
    JSON.stringify(redactProductManagerValue(input)),
  ].join('\n\n')
}

function unwrapProviderOutput(raw: string, provider: ProductManagerProvider): unknown {
  if (!raw.trim())
    throw new Error('product-manager provider returned empty output')
  const parsed = JSON.parse(raw)
  if (provider === 'gemini' && parsed && typeof parsed === 'object' && typeof parsed.response === 'string')
    return JSON.parse(parsed.response)
  return parsed
}

function unavailableOutput(options: {
  input: ReturnType<typeof validateProductManagerInput>
  invocationKey: string
  provider: ProductManagerProvider
}): ProductManagerOutput {
  return validateProductManagerOutput({
    contract_version: options.input.contract_version,
    task_id: options.input.task_id,
    trigger_type: options.input.trigger_type,
    checkpoint_id: options.input.checkpoint_id,
    plan_revision: options.input.plan_revision,
    input_digest: options.input.input_digest,
    evidence_digest: options.input.evidence_digest,
    invocation_key: options.invocationKey,
    verdict: 'unavailable',
    facts: [],
    hypotheses: [],
    findings: [],
    evidence_refs: options.input.evidence_refs,
    progress: {
      implementation: 0,
      product_acceptance: 0,
      health: 'red',
      reasons: ['provider_unavailable'],
    },
    risks: [{ kind: 'provider_unavailable' }],
    recommended_next_action: 'Keep the Trellis task paused and retry the same provider or request a user override.',
    process_adjustments: [],
    material_change_proposal: null,
    reopen_request: null,
    user_acceptance_summary: 'The selected product-manager provider was unavailable; no product verdict was produced.',
    provider_identity: {
      provider: options.provider,
      model: options.provider === 'codex'
        ? process.env.CCG_PRODUCT_MANAGER_CODEX_MODEL || 'gpt-5.6-sol'
        : process.env.CCG_PRODUCT_MANAGER_GEMINI_MODEL || 'gemini-3.1-pro-preview',
      cli_version: 'unavailable',
    },
    generated_at: new Date().toISOString(),
  }, options.input)
}

export async function invokeValidatedProductManagerProvider(options: {
  input: ReturnType<typeof validateProductManagerInput>
  invocationKey: string
  provider: ProductManagerProvider
  maxRetries: number
  invoke: () => Promise<unknown>
}): Promise<ProductManagerOutput> {
  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      const output = validateProductManagerOutput(
        await options.invoke(),
        options.input,
      )
      if (output.provider_identity.provider !== options.provider)
        throw new Error('stale product-manager response: provider identity mismatch')
      return output
    }
    catch {
      // The same provider and invocation key are retried; no fallback is allowed.
    }
  }
  return unavailableOutput(options)
}

async function invokeProvider(options: {
  provider: ProductManagerProvider
  input: unknown
  config: ProductManagerConfig
}): Promise<unknown> {
  const workspace = await mkdtemp(join(tmpdir(), 'ccg-product-manager-'))
  try {
    const prompt = createProductManagerProviderPrompt(options.input)
    if (options.provider === 'codex') {
      const executable = process.env.CCG_PRODUCT_MANAGER_CODEX_EXECUTABLE
        || findExecutable(process.platform === 'win32' ? ['codex.exe'] : ['codex'])
      if (!executable)
        throw new Error('Codex product-manager executable is unavailable')
      const schemaFile = join(workspace, 'output.schema.json')
      await writeFile(
        schemaFile,
        `${JSON.stringify(PRODUCT_MANAGER_OUTPUT_JSON_SCHEMA)}\n`,
        { encoding: 'utf8', mode: 0o600 },
      )
      const raw = await executeReadOnlyProvider({
        execution: createCodexProductManagerExecution(executable, {
          model: process.env.CCG_PRODUCT_MANAGER_CODEX_MODEL || 'gpt-5.6-sol',
          workspace,
          schemaFile,
        }),
        cwd: workspace,
        input: prompt,
        timeoutMs: options.config.timeout_ms,
        maxOutputBytes: options.config.max_output_bytes,
      })
      return unwrapProviderOutput(raw, options.provider)
    }
    const entrypoint = resolveGeminiEntrypoint()
    if (!entrypoint)
      throw new Error('Gemini product-manager Node entrypoint is unavailable')
    const policyFile = join(workspace, 'deny-all-tools.toml')
    await writeFile(policyFile, [
      '[[rule]]',
      'toolName = "*"',
      'decision = "deny"',
      'priority = 999',
      'modes = ["plan"]',
      'denyMessage = "Product-manager provider tools are disabled."',
      '',
      '[[rule]]',
      'mcpName = "*"',
      'decision = "deny"',
      'priority = 999',
      'modes = ["plan"]',
      'denyMessage = "Product-manager provider MCP tools are disabled."',
      '',
    ].join('\n'), { encoding: 'utf8', mode: 0o600 })
    const raw = await executeReadOnlyProvider({
      execution: createGeminiProductManagerExecution(process.execPath, {
        entrypoint,
        model: process.env.CCG_PRODUCT_MANAGER_GEMINI_MODEL || 'gemini-3.1-pro-preview',
        policyFile,
      }),
      cwd: workspace,
      input: prompt,
      timeoutMs: options.config.timeout_ms,
      maxOutputBytes: options.config.max_output_bytes,
    })
    return unwrapProviderOutput(raw, options.provider)
  }
  finally {
    await rm(workspace, { recursive: true, force: true })
  }
}

export async function productManagerStatus(options: ProductManagerCommandOptions = {}): Promise<Record<string, unknown>> {
  const config = await readCodexProductManagerConfig(options.config)
  const allowed = parseAllowedProviders(options.allowedProviders)
  const effective = resolveEffectiveProductManagerProvider({
    enabled: config.enabled,
    selected: config.provider,
    implemented: IMPLEMENTED_PRODUCT_MANAGER_PROVIDERS,
    allowed,
  })
  return {
    schema_version: 1,
    contract_version: PRODUCT_MANAGER_CONTRACT_VERSION,
    config_path: resolveCodexProductManagerConfigPath(options.config),
    configured: config,
    implemented_providers: IMPLEMENTED_PRODUCT_MANAGER_PROVIDERS,
    allowed_providers: allowed,
    effective,
    provider_selection_effects: {
      installs_provider: false,
      logs_in: false,
      reads_credentials: false,
      calls_network: false,
      authorizes_paid_call: false,
    },
  }
}

function invocationStatus(options: {
  input: ReturnType<typeof validateProductManagerInput>
  invocationKey: string
  provider: ProductManagerProvider
  status: 'pending' | 'completed' | 'failed' | 'stale'
  createdAt: string
  output?: ProductManagerOutput
  error?: string
}): Record<string, unknown> {
  const updatedAt = new Date().toISOString()
  return {
    status: options.status,
    task_id: options.input.task_id,
    checkpoint_id: options.input.checkpoint_id,
    plan_revision: options.input.plan_revision,
    invocation_key: options.invocationKey,
    input_digest: options.input.input_digest,
    evidence_digest: options.input.evidence_digest,
    provider: options.provider,
    model: options.output?.provider_identity.model ?? null,
    cli_version: options.output?.provider_identity.cli_version ?? null,
    contract_version: options.input.contract_version,
    created_at: options.createdAt,
    heartbeat_at: updatedAt,
    completed_at: options.status === 'pending' ? null : updatedAt,
    result_summary: options.output
      ? {
          verdict: options.output.verdict,
          recommended_next_action: options.output.recommended_next_action,
        }
      : options.error
        ? { error: options.error }
        : null,
    canonical_projection_revision: null,
  }
}

export async function reviewProductManager(options: ProductManagerCommandOptions): Promise<ProductManagerOutput> {
  if (!options.input || !options.taskDir)
    throw new TypeError('product-manager review requires --input and --task-dir')
  const inputFile = resolve(options.input)
  const taskDir = resolve(options.taskDir)
  const input = validateProductManagerInput(JSON.parse(await readFile(inputFile, 'utf8')))
  const invocationKey = createInvocationKey(input)
  const config = await readCodexProductManagerConfig(options.config)
  const allowed = parseAllowedProviders(options.allowedProviders)
  const effective = resolveEffectiveProductManagerProvider({
    enabled: config.enabled,
    selected: config.provider,
    implemented: IMPLEMENTED_PRODUCT_MANAGER_PROVIDERS,
    allowed,
  })
  if (effective.status !== 'ready')
    throw new Error(`product-manager unavailable: ${effective.status === 'unavailable' ? effective.reason : 'disabled'}`)

  return await withInvocationLock({
    taskDir,
    invocationKey,
    action: async () => {
      const reusable = await readInvocationEvidence({
        taskDir,
        invocationKey,
        kind: 'result',
      })
      if (reusable !== null) {
        const output = validateProductManagerOutput(reusable, input)
        if (output.provider_identity.provider !== effective.provider)
          throw new Error('stale product-manager response: provider identity mismatch')
        await appendInvocationAudit({
          taskDir,
          invocationKey,
          entry: { status: 'reused', provider: effective.provider, verdict: output.verdict },
        })
        return output
      }
      const createdAt = new Date().toISOString()
      await writeInvocationEvidence({ taskDir, invocationKey, kind: 'input', value: input })
      await writeInvocationEvidence({
        taskDir,
        invocationKey,
        kind: 'provider-request',
        value: {
          invocation_key: invocationKey,
          provider: effective.provider,
          contract_version: input.contract_version,
          input_digest: input.input_digest,
          evidence_digest: input.evidence_digest,
          mode: options.response ? 'recorded-response' : 'live-provider-call',
          requested_at: createdAt,
        },
      })
      await writeInvocationEvidence({
        taskDir,
        invocationKey,
        kind: 'status',
        value: invocationStatus({
          input,
          invocationKey,
          provider: effective.provider,
          status: 'pending',
          createdAt,
        }),
      })
      await appendInvocationAudit({
        taskDir,
        invocationKey,
        entry: { status: 'pending', provider: effective.provider },
      })
      try {
        let output: ProductManagerOutput
        if (options.response) {
          output = validateProductManagerOutput(
            JSON.parse(await readFile(resolve(options.response), 'utf8')),
            input,
          )
          if (output.provider_identity.provider !== effective.provider)
            throw new Error('stale product-manager response: provider identity mismatch')
        }
        else {
          if (!options.allowProviderCall)
            throw new Error('provider call requires explicit --allow-provider-call authorization')
          output = await invokeValidatedProductManagerProvider({
            input,
            invocationKey,
            provider: effective.provider,
            maxRetries: config.max_retries,
            invoke: () => invokeProvider({
              provider: effective.provider,
              input,
              config,
            }),
          })
        }
        await writeInvocationRawResponse({
          taskDir,
          invocationKey,
          value: output,
        })
        await writeInvocationEvidence({ taskDir, invocationKey, kind: 'result', value: output })
        await writeInvocationEvidence({
          taskDir,
          invocationKey,
          kind: 'status',
          value: invocationStatus({
            input,
            invocationKey,
            provider: effective.provider,
            status: output.verdict === 'unavailable' ? 'failed' : 'completed',
            createdAt,
            output,
          }),
        })
        await appendInvocationAudit({
          taskDir,
          invocationKey,
          entry: {
            status: output.verdict === 'unavailable' ? 'unavailable' : 'completed',
            provider: output.provider_identity.provider,
            model: output.provider_identity.model,
            cli_version: output.provider_identity.cli_version,
            verdict: output.verdict,
            input_digest: output.input_digest,
            evidence_digest: output.evidence_digest,
          },
        })
        return output
      }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await writeInvocationEvidence({
          taskDir,
          invocationKey,
          kind: 'status',
          value: invocationStatus({
            input,
            invocationKey,
            provider: effective.provider,
            status: /stale/i.test(String(error)) ? 'stale' : 'failed',
            createdAt,
            error: message,
          }),
        })
        await appendInvocationAudit({
          taskDir,
          invocationKey,
          entry: {
            status: /stale/i.test(String(error)) ? 'stale' : 'failed',
            provider: effective.provider,
            error: message,
          },
        })
        throw error
      }
    },
  })
}

export async function productManagerCommand(
  action: string,
  options: ProductManagerCommandOptions,
): Promise<void> {
  try {
    const result = action === 'status'
      ? await productManagerStatus(options)
      : action === 'review'
        ? await reviewProductManager(options)
        : null
    if (!result)
      throw new Error(`unknown product-manager action: ${action}`)
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  }
  catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 2
  }
}
