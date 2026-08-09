import { createGrokAcpClient, withCredentialHomeLease, withCredentialHomeVolatileSnapshot } from './lib/acp-client.mjs'
import { buildExactGrokEnvironment } from './lib/exact-env.mjs'
import { normalizeAcpEvents } from './lib/events.mjs'
import { createPrivateRunRoots } from './lib/private-temp.mjs'
import { runGrokDiagnostics } from './lib/process.mjs'
import { bindClaimsFromObservedUrls, buildSourceRegistry, canonicalizeSourceUrl, extractClaimsEnvelope } from './lib/source-registry.mjs'
import { createFocusedSnapshot } from './lib/snapshot.mjs'
import { validateEvidencePackage } from './lib/validator.mjs'

const EXIT = Object.freeze({ OK: 0, REQUIRED_UNAVAILABLE: 2, UNSAFE: 3, CONFIG: 4 })
export const GROK_PROMPT_TEMPLATE_VERSION = 'ccg-grok-intelligence-prompt-v11-advisory-verification'

function failureText(error, secrets = []) {
  let text = error instanceof Error ? error.message : String(error)
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret)
      text = text.split(secret).join('[REDACTED]')
  }
  text = text.replace(/https?:\/\/[^\s"'<>\\]+/gi, (candidate) => {
    try { return canonicalizeSourceUrl(candidate) }
    catch { return '[REDACTED_URL]' }
  })
  return text
    .replace(/((?:api[_-]?key|token|authorization)\s*[:=]\s*)\S+/gi, '$1[REDACTED]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\bxai-[A-Za-z0-9_-]+/g, '[REDACTED]')
}

function isUnsafe(error) {
  return error?.code === 'unsafe_cli_context' || /unsafe_cli_context|policy violation/i.test(failureText(error))
}

function isTransient(error) {
  return /(?:429|rate.?limit|temporar|timed?\s*out|timeout|ECONNRESET|ECONNREFUSED|EAI_AGAIN|503|502|network)/i.test(failureText(error))
}

function observedModelProvenance(notifications, requested) {
  const sessionModels = new Set()
  const usageModels = new Set()
  for (const notification of notifications || []) {
    const update = notification?.params?.update
    const modelId = update?._meta?.modelId
    if (typeof modelId === 'string' && modelId.trim())
      sessionModels.add(modelId.trim())
    const modelUsage = update?.usage?.modelUsage
    if (modelUsage && typeof modelUsage === 'object' && !Array.isArray(modelUsage)) {
      for (const model of Object.keys(modelUsage)) {
        if (model.trim()) usageModels.add(model.trim())
      }
    }
  }
  if (sessionModels.size !== 1)
    throw new Error(`ACP model provenance must expose exactly one session model, observed ${sessionModels.size}`)
  const actual = [...sessionModels][0]
  if (actual !== requested)
    throw new Error(`ACP session model ${actual} does not match requested model ${requested}`)
  return {
    requested,
    actual,
    provenance: 'ACP session/update user_message_chunk _meta.modelId',
    usage_models: [...usageModels].sort(),
  }
}

function validateTopLevel(options) {
  if (!options || typeof options !== 'object')
    throw new Error('Runner options are required')
  if (!['required', 'preferred', 'disabled'].includes(options.requirement))
    throw new Error('requirement must be required, preferred, or disabled')
  if (!['intel', 'verify'].includes(options.action || 'intel'))
    throw new Error('action must be intel or verify')
  if (options.requirement === 'disabled')
    return
  if (options.consent !== true || options.config?.enabled !== true)
    throw new Error('External intelligence requires explicit user consent and enabled configuration')
  if (!['browser_oauth', 'api_key'].includes(options.config.auth_mode))
    throw new Error('External intelligence authentication is not configured')
  if (options.config.auth_mode === 'api_key' && (typeof options.apiKey !== 'string' || !options.apiKey.trim()))
    throw new Error('External intelligence API key authentication is missing its key')
  if (typeof options.task !== 'string' || !options.task.trim())
    throw new Error('External intelligence task must be non-empty')
}

function buildPrompt({ task, action, mode, requireWebSearch, xSearchPolicy, officialDomains = [] }) {
  const xInstruction = xSearchPolicy === 'disabled'
    ? 'Do not perform an X-domain search.'
    : xSearchPolicy === 'required'
      ? 'Run WebSearch with a site:x.com or site:twitter.com query. Native XSearch may be used for discovery, but it does not provide source URLs for verification.'
      : 'Use an X-domain search only when it is useful for this request. If used, prefer WebSearch with a site:x.com or site:twitter.com query so the result can carry source URLs.'
  return [
    'You are the external intelligence collector for a software engineering workflow.',
    'Use provider-native tools when they help answer the request.',
    'Only state facts supported by URLs returned in WebSearch rawOutput.action.sources. Never invent or copy a URL from prose.',
    officialDomains.length > 0
      ? `Predeclared official domains: ${officialDomains.join(', ')}. Prioritize results from these domains. Do not add a domain to this policy because it appears in search output.`
      : 'No official domain was predeclared. Preserve official_unknown provenance and do not guess an official source.',
    xInstruction,
    `Action: ${action}. Investigation mode: ${mode}. Web-search verification requested: ${requireWebSearch ? 'yes' : 'no'}. X-domain policy: ${xSearchPolicy}.`,
    'End the final response with exactly one compact JSON envelope on a new line using this marker:',
    'CCG_CLAIMS_JSON:{"schemaVersion":1,"claims":[{"id":"claim-1","claim":"fact without URLs","status":"verified|partially_verified|contradicted|unresolved|early_warning","severity":"blocker|warning|info","applies_to":["specific bound file, dependency, platform, or version"],"repo_impact":["concrete impact"],"urls":["only URLs observed in WebSearch sources"]}]}',
    'Every verified or partially_verified claim must include a non-empty applies_to array. Omit applies_to only for unresolved, contradicted, or early_warning claims.',
    'The claims array must never be empty. If no applicable fact can be verified, return one status=unresolved claim with urls=[]. Do not put URLs in claim text or any field other than urls.',
    'Task:',
    task.trim(),
  ].join('\n')
}

function invocationFailedResult(requirement, reason, attempts, runRoot) {
  return {
    exitCode: requirement === 'required' ? EXIT.REQUIRED_UNAVAILABLE : EXIT.OK,
    status: 'invocation_failed',
    reason,
    attempts,
    ...(runRoot ? { runRoot } : {}),
  }
}

export async function runGrokIntelligence(options) {
  try {
    validateTopLevel(options)
  }
  catch (error) {
    return { exitCode: EXIT.CONFIG, status: 'configuration_required', reason: failureText(error, [options?.apiKey]) }
  }
  if (options.requirement === 'disabled')
    return { exitCode: EXIT.OK, status: 'skipped', reason: 'External intelligence route is disabled' }

  const dependencies = {
    createRoots: options.createPrivateRoots || createPrivateRunRoots,
    createSnapshot: options.createSnapshot || createFocusedSnapshot,
    diagnostics: options.runDiagnostics || runGrokDiagnostics,
    acp: options.runAcp || createGrokAcpClient({ command: options.command || 'grok', prefixArgs: options.prefixArgs || [] }).run,
    cleanup: options.cleanupRunRoots,
  }
  const secrets = [options.apiKey, options.sourceEnv?.HTTPS_PROXY, options.sourceEnv?.HTTP_PROXY]
  let roots
  let result
  let attempts = 0
  try {
    roots = await dependencies.createRoots({
      parent: options.tempParent,
      grokHome: options.grokHome,
      platform: options.platform || process.platform,
    })
    const snapshot = await dependencies.createSnapshot({
      repoRoot: options.repoRoot,
      snapshotRoot: roots.snapshotRoot,
      selectedPaths: options.selectedPaths,
      allowedCcgPlanPaths: options.allowedCcgPlanPaths,
      dirtyDiffs: options.dirtyDiffs,
      limits: options.snapshotLimits || { maxTotalBytes: options.config.max_bundle_bytes || 16 * 1024 * 1024 },
    })
    const env = buildExactGrokEnvironment({
      sourceEnv: options.sourceEnv || {},
      neutralHome: roots.neutralHome,
      grokHome: roots.grokHome,
      apiKey: options.config.auth_mode === 'api_key' ? options.apiKey : undefined,
      platform: options.platform || process.platform,
    })
    const prompt = buildPrompt({
      task: options.task,
      action: options.action || 'intel',
      mode: options.mode || 'discover',
      requireWebSearch: options.config.require_web_search !== false,
      xSearchPolicy: options.config.x_search_policy || 'preferred',
      officialDomains: options.officialDomains || [],
    })
    const selectedModel = String(options.model || options.config.default_model || 'grok-4.5').trim()
    if (!selectedModel || /[\u0000-\u001f\u007f]/.test(selectedModel))
      throw new Error('Selected Grok model is invalid')
    const maxRetries = Math.min(2, Math.max(0, Number.isInteger(options.config.max_retries) ? options.config.max_retries : 2))
    let lastError
    while (attempts <= maxRetries) {
      attempts++
      try {
        const acpResult = await withCredentialHomeLease(roots.grokHome, async () => {
          await withCredentialHomeVolatileSnapshot(roots.grokHome, () => dependencies.diagnostics({
            command: options.command || 'grok',
            prefixArgs: options.prefixArgs || [],
            cwd: roots.neutralHome,
            env,
            timeoutMs: options.diagnosticTimeoutMs,
          }), { validateDirectory: async path => path })
          const acpOptions = {
          prompt,
          cwd: roots.snapshotRoot,
          allowedCwdRoots: [roots.snapshotRoot],
          neutralHome: roots.neutralHome,
          grokHome: roots.grokHome,
          rawEventsDir: roots.rawEventsDir,
          rawEventsMaxBytes: options.rawEventsMaxBytes ?? 8 * 1024 * 1024,
          rawEventsMaxEvents: options.rawEventsMaxEvents ?? 20000,
          timeoutMs: options.timeoutMs ?? 10 * 60 * 1000,
          maxTurns: options.maxTurns ?? 6,
          model: selectedModel,
          authMode: options.config.auth_mode,
          apiKey: options.config.auth_mode === 'api_key' ? options.apiKey : undefined,
          sourceEnv: options.sourceEnv || {},
          signal: options.signal,
          attempt: attempts,
            credentialLeaseHeld: true,
          }
          return dependencies.acp(acpOptions)
        }, { validateDirectory: async path => path })
        const normalized = normalizeAcpEvents(acpResult.notifications, {
          requireComplete: true,
          requireSearch: false,
          promptCompleted: acpResult.completion?.promptResponse === true,
        })
        const retrievedAt = (options.clock ? options.clock() : new Date()).toISOString()
        let registry = { schemaVersion: 1, retrieved_at: retrievedAt, sources: [], searches: [] }
        const bindingDiagnostics = []
        let claims = []
        let validation
        try {
          registry = buildSourceRegistry(normalized, {
            retrievedAt,
            officialDomains: options.officialDomains || [],
            officialXAccounts: options.officialXAccounts || [],
            domainTiers: options.domainTiers || {},
          })
          claims = bindClaimsFromObservedUrls(extractClaimsEnvelope(normalized.finalText), registry, { bindingDiagnostics })
          validation = validateEvidencePackage({
            normalized,
            registry,
            claims,
            requireWebSearch: options.config.require_web_search !== false,
            xSearchPolicy: options.config.x_search_policy || 'preferred',
            mode: options.mode || 'discover',
            requireClaims: true,
          })
        }
        catch (error) {
          validation = {
            valid: false,
            package_status: 'invalid',
            verification_outcome: 'unresolved',
            qualifying_claims: [],
            errors: [failureText(error, secrets)],
            warnings: [],
            effective_x_policy: options.config.x_search_policy || 'preferred',
            evaluated_claims: [],
          }
        }
        const model = observedModelProvenance(acpResult.notifications, selectedModel)
        const evidence = {
          retrieved_at: retrievedAt,
          model,
          normalized,
          registry,
          claims,
          claim_binding: { dropped_unobserved_urls: bindingDiagnostics },
          validation,
        }
        const verificationSatisfied = validation.valid === true
          && ['verified', 'partially_verified'].includes(validation.verification_outcome)
          && validation.qualifying_claims.length > 0
        result = {
          exitCode: EXIT.OK,
          status: verificationSatisfied ? 'verified' : 'received_unverified',
          attempts,
          runRoot: roots.runRoot,
          snapshot,
          evidence,
          raw: { notifications: acpResult.notifications, stderr: acpResult.stderr || [] },
        }
        break
      }
      catch (error) {
        lastError = error
        if (isUnsafe(error)) {
          result = { exitCode: EXIT.UNSAFE, status: 'unsafe_cli_context', reason: failureText(error, secrets), attempts, runRoot: roots.runRoot }
          break
        }
        if (!isTransient(error) || attempts > maxRetries) {
          result = invocationFailedResult(options.requirement, failureText(error, secrets), attempts, roots.runRoot)
          break
        }
      }
    }
    result ||= invocationFailedResult(options.requirement, failureText(lastError, secrets), attempts, roots.runRoot)
  }
  catch (error) {
    result = isUnsafe(error)
      ? { exitCode: EXIT.UNSAFE, status: 'unsafe_cli_context', reason: failureText(error, secrets), attempts, ...(roots ? { runRoot: roots.runRoot } : {}) }
      : { exitCode: EXIT.UNSAFE, status: 'policy_violation', reason: failureText(error, secrets), attempts, ...(roots ? { runRoot: roots.runRoot } : {}) }
  }

  if (roots) {
    try {
      if (dependencies.cleanup)
        await dependencies.cleanup(roots)
      else
        await roots.cleanup()
    }
    catch (error) {
      return {
        exitCode: EXIT.UNSAFE,
        status: 'cleanup_failed',
        reason: failureText(error, secrets),
        attempts,
        runRoot: roots.runRoot,
      }
    }
  }
  return result
}

export { EXIT as GROK_INTELLIGENCE_EXIT_CODES }
