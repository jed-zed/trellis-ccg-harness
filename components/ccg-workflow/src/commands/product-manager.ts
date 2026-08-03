import type { ModelType, ProductManagerConfig } from '../types'
import type { ClaudeTransport, ProductManagerOutput, ProductManagerProvider } from '../product-manager/contracts'
import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, realpathSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'node:path'
import {
  PRODUCT_MANAGER_CONTRACT_VERSION,
  PRODUCT_MANAGER_OUTPUT_JSON_SCHEMA,
  createBoundProductManagerOutputJsonSchema,
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
  cleanupProductManagerWorkspaceSnapshot,
  prepareProductManagerWorkspaceSnapshot,
  validateProductManagerWorkspaceSnapshot,
} from '../product-manager/workspace-snapshot'
import {
  CLAUDE_SSH_ENVIRONMENT_KEYS,
  IMPLEMENTED_PRODUCT_MANAGER_PROVIDERS,
  resolveEffectiveProductManagerProvider,
  validateProviderExecution,
} from '../product-manager/provider-registry'
import { buildProductManagerProviderEnvironment, executeReadOnlyProvider } from '../product-manager/provider-runner'
import { createCodexProductManagerExecution } from '../product-manager/providers/codex'
import {
  createClaudeProductManagerExecution,
  createClaudeSshProductManagerExecution,
} from '../product-manager/providers/claude'
import { createGeminiProductManagerExecution } from '../product-manager/providers/gemini'
import { normalizeProductManagerConfig, readCcgConfigAt } from '../utils/config'
import { normalizeModelRouting } from '../utils/model-routing'

export interface ProductManagerCommandOptions {
  json?: boolean
  input?: string
  taskDir?: string
  workdir?: string
  response?: string
  allowedProviders?: string
  allowProviderCall?: boolean
  workspaceSnapshot?: string
  workspaceManifest?: string
  claudeTransport?: ClaudeTransport
  config?: string
}

function resolveCodexProductManagerConfigPath(explicit?: string): string {
  return resolve(explicit || join(homedir(), '.codex', 'ccg', 'config.toml'))
}

export interface ProductManagerRuntimeConfig {
  behavior: ProductManagerConfig
  selectedProvider: ModelType
}

export const DEFAULT_CLAUDE_PRODUCT_MANAGER_MODEL = 'opus'

export function resolveClaudeProductManagerModel(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return environment.CCG_PRODUCT_MANAGER_CLAUDE_MODEL
    || DEFAULT_CLAUDE_PRODUCT_MANAGER_MODEL
}

export async function readCodexProductManagerConfig(configPath?: string): Promise<ProductManagerRuntimeConfig> {
  const file = resolveCodexProductManagerConfigPath(configPath)
  const parsed = existsSync(file) ? await readCcgConfigAt(file) : null
  const routing = normalizeModelRouting(parsed?.routing)
  return {
    behavior: normalizeProductManagerConfig(parsed?.product_manager, { existingInstall: true }),
    selectedProvider: routing['product-manager'].primary,
  }
}

function parseAllowedProviders(value: string | undefined): ProductManagerProvider[] {
  if (!value)
    return [...IMPLEMENTED_PRODUCT_MANAGER_PROVIDERS]
  const providers = value.split(',').map(item => item.trim()).filter(Boolean)
  if (providers.some(provider => !IMPLEMENTED_PRODUCT_MANAGER_PROVIDERS.includes(provider as ProductManagerProvider)))
    throw new TypeError('allowed providers must contain only codex, gemini, or claude')
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

export function resolveGeminiEntrypoint(): string | null {
  const explicit = process.env.CCG_PRODUCT_MANAGER_GEMINI_ENTRYPOINT
  if (explicit) {
    try {
      return validateTrustedRegularFile(explicit, 'Gemini product-manager entrypoint')
    }
    catch {
      return null
    }
  }
  const shim = findExecutable(process.platform === 'win32' ? ['gemini.cmd'] : ['gemini'])
  if (!shim)
    return null
  const adjacent = resolve(shim, '..', 'node_modules', '@google', 'gemini-cli', 'dist', 'index.js')
  try {
    return validateTrustedRegularFile(adjacent, 'Gemini product-manager entrypoint')
  }
  catch {
    return null
  }
}

function validateNativeClaudeExecutable(candidate: string): string | null {
  if (!isAbsolute(candidate) || !existsSync(candidate))
    return null
  try {
    const metadata = lstatSync(candidate)
    const expectedName = process.platform === 'win32' ? 'claude.exe' : 'claude'
    if (!metadata.isFile() || metadata.isSymbolicLink() || basename(candidate).toLowerCase() !== expectedName)
      return null
    const canonical = realpathSync(candidate)
    const normalize = (value: string) => process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value)
    return normalize(canonical) === normalize(candidate) ? canonical : null
  }
  catch {
    return null
  }
}

export function resolveClaudeExecutable(): string | null {
  const explicit = process.env.CCG_PRODUCT_MANAGER_CLAUDE_EXECUTABLE
  if (explicit)
    return validateNativeClaudeExecutable(explicit)
  const direct = findExecutable(process.platform === 'win32' ? ['claude.exe'] : ['claude'])
  if (direct)
    return validateNativeClaudeExecutable(direct)
  if (process.platform !== 'win32')
    return null
  const shim = findExecutable(['claude.cmd', 'claude.ps1', 'claude'])
  if (!shim)
    return null
  const native = join(dirname(shim), 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
  return validateNativeClaudeExecutable(native)
}

export interface ClaudeSshConfiguration {
  executable: string
  host: string
  user: string
  port: string
  identityFile: string
  knownHostsFile: string
  remoteExecutable: string
}

function validateTrustedRegularFile(candidate: string, label: string): string {
  if (!isAbsolute(candidate) || !existsSync(candidate))
    throw new Error(`${label} must be an existing absolute path`)
  const metadata = lstatSync(candidate)
  const canonical = realpathSync(candidate)
  const normalize = (value: string) => process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value)
  if (!metadata.isFile() || metadata.isSymbolicLink() || normalize(canonical) !== normalize(candidate))
    throw new Error(`${label} must be a canonical non-link regular file`)
  return canonical
}

export function resolveClaudeSshConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): ClaudeSshConfiguration {
  const executable = validateTrustedRegularFile(
    environment.CCG_PRODUCT_MANAGER_CLAUDE_SSH_EXECUTABLE || '',
    'Claude SSH bridge executable',
  )
  if (process.platform === 'win32' && !executable.toLowerCase().endsWith('.exe'))
    throw new Error('Claude SSH bridge executable must be a native .exe on Windows')
  const host = environment.CCG_PRODUCT_MANAGER_CLAUDE_SSH_HOST || ''
  const user = environment.CCG_PRODUCT_MANAGER_CLAUDE_SSH_USER || ''
  const port = environment.CCG_PRODUCT_MANAGER_CLAUDE_SSH_PORT || ''
  if (!/^[a-z0-9][a-z0-9.:-]{0,252}$/i.test(host))
    throw new Error('Claude SSH host is missing or invalid')
  if (!/^[a-z0-9_][a-z0-9._-]{0,63}$/i.test(user))
    throw new Error('Claude SSH user is missing or invalid')
  if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535)
    throw new Error('Claude SSH port is missing or invalid')
  const identityFile = validateTrustedRegularFile(
    environment.CCG_PRODUCT_MANAGER_CLAUDE_SSH_IDENTITY_FILE || '',
    'Claude SSH identity file',
  )
  const knownHostsFile = validateTrustedRegularFile(
    environment.CCG_PRODUCT_MANAGER_CLAUDE_SSH_KNOWN_HOSTS_FILE || '',
    'Claude SSH known-hosts file',
  )
  const remoteExecutable = environment.CCG_PRODUCT_MANAGER_CLAUDE_SSH_REMOTE_EXECUTABLE || ''
  if (/[\0\r\n]/.test(remoteExecutable)
    || (!remoteExecutable.startsWith('/') && !/^[a-z]:[\\/]/i.test(remoteExecutable))) {
    throw new Error('Claude SSH remote executable must be an absolute path')
  }
  return { executable, host, user, port, identityFile, knownHostsFile, remoteExecutable }
}

function probeClaudeSshBridge(configuration: ClaudeSshConfiguration): {
  bridge_version: string
  remote_cli_version: string
} {
  const execution = validateProviderExecution({
    executable: configuration.executable,
    args: ['--product-manager-snapshot-protocol-version'],
    environmentKeys: [...CLAUDE_SSH_ENVIRONMENT_KEYS],
    readOnly: true,
    shell: false,
  })
  let raw: string
  try {
    raw = execFileSync(execution.executable, execution.args, {
      encoding: 'utf8',
      env: buildProductManagerProviderEnvironment(execution),
      shell: false,
      timeout: 10_000,
      windowsHide: true,
    })
  }
  catch (error) {
    let message = error instanceof Error ? error.message : String(error)
    for (const key of CLAUDE_SSH_ENVIRONMENT_KEYS) {
      const secret = process.env[key]
      if (secret)
        message = message.split(secret).join('[REDACTED]')
    }
    throw new Error(`Claude SSH bridge protocol probe failed: ${message}`)
  }
  const parsed = JSON.parse(raw) as Record<string, unknown>
  if (parsed.protocol_version !== '2'
    || typeof parsed.bridge_version !== 'string' || !parsed.bridge_version.trim()
    || typeof parsed.remote_cli_version !== 'string' || !parsed.remote_cli_version.trim()) {
    throw new Error('Claude SSH bridge does not support product-manager snapshot protocol v2')
  }
  return {
    bridge_version: parsed.bridge_version,
    remote_cli_version: parsed.remote_cli_version,
  }
}

function readProviderCliVersion(executable: string): string {
  try {
    return execFileSync(executable, ['--version'], {
      encoding: 'utf8',
      shell: false,
      timeout: 10_000,
      windowsHide: true,
    }).trim() || 'unknown'
  }
  catch {
    return 'unknown'
  }
}

export function createProductManagerProviderPrompt(input: unknown, identity?: {
  provider: ProductManagerProvider
  model: string
  cliVersion: string
}, schema: Record<string, unknown> = PRODUCT_MANAGER_OUTPUT_JSON_SCHEMA): string {
  return [
    'You are the read-only product-manager reviewer.',
    'Use only the provider file-read and file-search tools inside the supplied workspace snapshot.',
    'Do not execute shell commands, modify files, access the network, or control subagents.',
    'Return exactly one JSON object matching the supplied contract.',
    'Do not include markdown, hidden reasoning, credentials, or commentary.',
    identity
      ? `Set provider_identity exactly to ${JSON.stringify({
        provider: identity.provider,
        model: identity.model,
        cli_version: identity.cliVersion,
      })}.`
      : null,
    `Output JSON Schema:\n${JSON.stringify(schema)}`,
    JSON.stringify(redactProductManagerValue(input)),
  ].filter(value => value !== null).join('\n\n')
}

export function unwrapProviderOutput(raw: string, provider: ProductManagerProvider): unknown {
  if (!raw.trim())
    throw new Error('product-manager provider returned empty output')
  const parsed = JSON.parse(raw)
  if (provider === 'gemini' && parsed && typeof parsed === 'object' && typeof parsed.response === 'string')
    return JSON.parse(parsed.response)
  if (provider === 'claude' && parsed && typeof parsed === 'object') {
    if (parsed.structured_output && typeof parsed.structured_output === 'object')
      return parsed.structured_output
    if (typeof parsed.result === 'string')
      return JSON.parse(parsed.result)
    if (parsed.result && typeof parsed.result === 'object')
      return parsed.result
  }
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
        : options.provider === 'gemini'
          ? process.env.CCG_PRODUCT_MANAGER_GEMINI_MODEL || 'gemini-3.1-pro-preview'
          : resolveClaudeProductManagerModel(),
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
  onAttemptFailure?: (failure: {
    attempt: number
    maxAttempts: number
    error: unknown
  }) => Promise<void> | void
}): Promise<ProductManagerOutput> {
  const maxAttempts = options.maxRetries + 1
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
    catch (error) {
      await options.onAttemptFailure?.({
        attempt: attempt + 1,
        maxAttempts,
        error,
      })
      // The same provider and invocation key are retried; no fallback is allowed.
    }
  }
  return unavailableOutput(options)
}

async function invokeProvider(options: {
  provider: ProductManagerProvider
  input: ReturnType<typeof validateProductManagerInput>
  config: ProductManagerConfig
  workspace: string
  manifestFile: string
}): Promise<unknown> {
  const controlRoot = await mkdtemp(join(tmpdir(), 'ccg-product-manager-'))
  const invocationKey = createInvocationKey(options.input)
  const bindContract = (identity: {
    provider: ProductManagerProvider
    model: string
    cliVersion: string
  }) => {
    const schema = createBoundProductManagerOutputJsonSchema({
      ...options.input,
      invocation_key: invocationKey,
    }, {
      provider: identity.provider,
      model: identity.model,
      cli_version: identity.cliVersion,
    })
    return {
      schema,
      prompt: createProductManagerProviderPrompt(options.input, identity, schema),
    }
  }
  try {
    if (options.provider === 'codex') {
      const candidate = process.env.CCG_PRODUCT_MANAGER_CODEX_EXECUTABLE
        || findExecutable(process.platform === 'win32' ? ['codex.exe'] : ['codex'])
      if (!candidate)
        throw new Error('Codex product-manager executable is unavailable')
      const executable = validateTrustedRegularFile(candidate, 'Codex product-manager executable')
      const model = process.env.CCG_PRODUCT_MANAGER_CODEX_MODEL || 'gpt-5.6-sol'
      const contract = bindContract({
        provider: 'codex',
        model,
        cliVersion: readProviderCliVersion(executable),
      })
      const schemaFile = join(controlRoot, 'output.schema.json')
      await writeFile(
        schemaFile,
        `${JSON.stringify(contract.schema)}\n`,
        { encoding: 'utf8', mode: 0o600 },
      )
      const raw = await executeReadOnlyProvider({
        execution: createCodexProductManagerExecution(executable, {
          model,
          workspace: options.workspace,
          schemaFile,
        }),
        cwd: options.workspace,
        input: contract.prompt,
        timeoutMs: options.config.timeout_ms,
        maxOutputBytes: options.config.max_output_bytes,
      })
      return unwrapProviderOutput(raw, options.provider)
    }
    if (options.provider === 'claude') {
      const model = resolveClaudeProductManagerModel()
      if (options.input.claude_transport === 'ssh') {
        const configuration = resolveClaudeSshConfiguration()
        const probe = probeClaudeSshBridge(configuration)
        const contract = bindContract({
          provider: 'claude',
          model,
          cliVersion: probe.remote_cli_version,
        })
        const raw = await executeReadOnlyProvider({
          execution: createClaudeSshProductManagerExecution(configuration.executable, {
            model,
            schema: contract.schema,
            snapshotRoot: options.workspace,
            manifestFile: options.manifestFile,
            attemptId: randomUUID(),
          }),
          cwd: options.workspace,
          input: contract.prompt,
          timeoutMs: options.config.timeout_ms,
          maxOutputBytes: options.config.max_output_bytes,
        })
        return unwrapProviderOutput(raw, options.provider)
      }
      const executable = resolveClaudeExecutable()
      if (!executable)
        throw new Error('Claude product-manager native executable is unavailable')
      const contract = bindContract({
        provider: 'claude',
        model,
        cliVersion: readProviderCliVersion(executable),
      })
      const raw = await executeReadOnlyProvider({
        execution: createClaudeProductManagerExecution(executable, {
          model,
          schema: contract.schema,
        }),
        cwd: options.workspace,
        input: contract.prompt,
        timeoutMs: options.config.timeout_ms,
        maxOutputBytes: options.config.max_output_bytes,
      })
      return unwrapProviderOutput(raw, options.provider)
    }
    const entrypoint = resolveGeminiEntrypoint()
    if (!entrypoint)
      throw new Error('Gemini product-manager Node entrypoint is unavailable')
    const model = process.env.CCG_PRODUCT_MANAGER_GEMINI_MODEL || 'gemini-3.1-pro-preview'
    const contract = bindContract({
      provider: 'gemini',
      model,
      cliVersion: 'unknown',
    })
    const policyFile = join(controlRoot, 'read-only-tools.toml')
    await writeFile(policyFile, [
      '[[rule]]',
      'toolName = ["read_file", "read_many_files", "list_directory", "glob", "grep_search"]',
      'decision = "allow"',
      'priority = 1000',
      'modes = ["plan"]',
      '',
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
        model,
        policyFile,
      }),
      cwd: options.workspace,
      input: contract.prompt,
      timeoutMs: options.config.timeout_ms,
      maxOutputBytes: options.config.max_output_bytes,
    })
    return unwrapProviderOutput(raw, options.provider)
  }
  finally {
    await rm(controlRoot, { recursive: true, force: true })
  }
}

export async function productManagerStatus(options: ProductManagerCommandOptions = {}): Promise<Record<string, unknown>> {
  const config = await readCodexProductManagerConfig(options.config)
  const allowed = parseAllowedProviders(options.allowedProviders)
  const effective = resolveEffectiveProductManagerProvider({
    enabled: config.behavior.enabled,
    selected: config.selectedProvider,
    implemented: IMPLEMENTED_PRODUCT_MANAGER_PROVIDERS,
    allowed,
  })
  return {
    schema_version: 1,
    contract_version: PRODUCT_MANAGER_CONTRACT_VERSION,
    config_path: resolveCodexProductManagerConfigPath(options.config),
    configured: config.behavior,
    routing: {
      authority: 'unified-ccg-routing',
      role: 'product-manager',
      provider: config.selectedProvider,
    },
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

export async function snapshotProductManager(options: ProductManagerCommandOptions) {
  if (!options.workdir || !options.taskDir)
    throw new TypeError('product-manager snapshot requires --workdir and --task-dir')
  return await prepareProductManagerWorkspaceSnapshot({
    workdir: resolve(options.workdir),
    taskDir: resolve(options.taskDir),
  })
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
  if (!options.input || !options.taskDir || !options.workspaceSnapshot || !options.workspaceManifest || !options.claudeTransport)
    throw new TypeError('product-manager review requires --input, --task-dir, --workspace-snapshot, --workspace-manifest, and --claude-transport')
  const inputFile = resolve(options.input)
  const taskDir = resolve(options.taskDir)
  const input = validateProductManagerInput(JSON.parse(await readFile(inputFile, 'utf8')))
  if (options.claudeTransport !== input.claude_transport)
    throw new Error('stale product-manager request: Claude transport mismatch')
  const workspace = await validateProductManagerWorkspaceSnapshot({
    snapshotRoot: resolve(options.workspaceSnapshot),
    manifestFile: resolve(options.workspaceManifest),
    taskDir,
    expected: input.workspace_snapshot,
  })
  const manifestFile = realpathSync(options.workspaceManifest)
  const invocationKey = createInvocationKey(input)
  const config = await readCodexProductManagerConfig(options.config)
  const allowed = parseAllowedProviders(options.allowedProviders)
  const effective = resolveEffectiveProductManagerProvider({
    enabled: config.behavior.enabled,
    selected: config.selectedProvider,
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
          workspace_snapshot: input.workspace_snapshot,
          claude_transport: input.claude_transport,
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
            maxRetries: config.behavior.max_retries,
            invoke: () => invokeProvider({
              provider: effective.provider,
              input,
              config: config.behavior,
              workspace,
              manifestFile,
            }),
            onAttemptFailure: async ({ attempt, maxAttempts, error }) => {
              await appendInvocationAudit({
                taskDir,
                invocationKey,
                entry: {
                  status: 'attempt_failed',
                  provider: effective.provider,
                  attempt,
                  max_attempts: maxAttempts,
                  error: error instanceof Error ? error.message : String(error),
                },
              })
            },
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
  }).finally(async () => {
    await cleanupProductManagerWorkspaceSnapshot({
      snapshotRoot: workspace,
      manifestFile,
      taskDir,
    })
  })
}

export async function productManagerCommand(
  action: string,
  options: ProductManagerCommandOptions,
): Promise<void> {
  try {
    const result = action === 'status'
      ? await productManagerStatus(options)
      : action === 'snapshot'
        ? await snapshotProductManager(options)
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
