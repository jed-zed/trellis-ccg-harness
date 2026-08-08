#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseIntelligenceToml, runManualCommand } from './command.mjs'
import {
  createCanonicalEvidenceItem,
  createIntelligenceDecision,
  createTaskIntelligencePointer,
} from './lib/router.mjs'
import { resolveEffectiveXPolicy, validateEvidencePackage } from './lib/validator.mjs'

const INITIAL_MODES = new Set(['contract', 'incident'])
const REQUIREMENTS = new Set(['required', 'preferred', 'disabled'])
const CONTRACT_PATTERN = /(?:\b(?:api|sdk|dependency|package|library|protocol|cloud|database|cve|advisory|authentication|cryptograph\w*|regulation|standard|deprecat\w*|compatib\w*|version|upgrade)\b|依赖|接口|协议|升级|弃用|兼容|漏洞|安全公告|认证|加密|法规|标准)/i
const INCIDENT_PATTERN = /(?:\b(?:incident|outage|downtime|service\s+status|regression|regional\s+errors?|production\s+failure)\b|事故|宕机|服务状态|线上故障|区域错误|新回归)/i
const CURRENT_PATTERN = /(?:\b(?:current|latest|recent|today|now|newly)\b|当前|最新|最近|今天|刚刚|新发布)/i
const SAFE_STATE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/
const EVIDENCE_TTL_MS = Object.freeze({
  incident: 30 * 60 * 1000,
  verify: 2 * 60 * 60 * 1000,
  contract: 72 * 60 * 60 * 1000,
  discover: 7 * 24 * 60 * 60 * 1000,
  landscape: 7 * 24 * 60 * 60 * 1000,
  deep: 7 * 24 * 60 * 60 * 1000,
})

function emit(runtime, event) {
  runtime.onEvent?.(event)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function stableJson(value) {
  if (Array.isArray(value))
    return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

function relativeInside(root, target, label) {
  const resolvedRoot = resolve(root)
  const resolvedTarget = resolve(resolvedRoot, target)
  const rel = relative(resolvedRoot, resolvedTarget).replace(/\\/g, '/')
  if (!rel || rel.startsWith('../') || isAbsolute(rel))
    throw new Error(`${label} must stay inside the repository`)
  return { absolute: resolvedTarget, relative: rel }
}

function mapInputPath(repoInput, repoRoot, target, label) {
  const requested = resolve(repoInput, target)
  for (const candidateRoot of new Set([resolve(repoInput), resolve(repoRoot)])) {
    const rel = relative(candidateRoot, requested).replace(/\\/g, '/')
    if (rel && !rel.startsWith('../') && !isAbsolute(rel))
      return relativeInside(repoRoot, resolve(repoRoot, rel), label)
  }
  throw new Error(`${label} must stay inside the repository`)
}

async function assertNoLinkedPath(root, target, label, { allowMissing = false } = {}) {
  if (resolve(root) === resolve(target))
    return { absolute: resolve(root), relative: '' }
  const path = relativeInside(root, target, label)
  let current = resolve(root)
  for (const segment of path.relative.split('/')) {
    current = resolve(current, segment)
    try {
      const metadata = await lstat(current)
      if (metadata.isSymbolicLink())
        throw new Error(`${label} must not traverse a link or junction: ${path.relative}`)
    }
    catch (error) {
      if (allowMissing && error?.code === 'ENOENT')
        break
      throw error
    }
  }
  return path
}

async function digestBinding(repoRoot, repoInput, label, value) {
  if (!value)
    return null
  const mapped = mapInputPath(repoInput, repoRoot, value, label)
  const path = await assertNoLinkedPath(repoRoot, mapped.absolute, label)
  const metadata = await stat(path.absolute)
  if (!metadata.isFile())
    throw new Error(`${label} must be a regular file: ${path.relative}`)
  const bytes = await readFile(path.absolute)
  return { path: path.relative, sha256: sha256(bytes), bytes: bytes.length }
}

async function collectBindings(input, repoRoot, repoInput) {
  return {
    task: { sha256: sha256(input.task.trim()), chars: input.task.trim().length },
    target: await digestBinding(repoRoot, repoInput, 'target', input.target),
    plan: await digestBinding(repoRoot, repoInput, 'plan', input.plan),
    diff: await digestBinding(repoRoot, repoInput, 'diff', input.diff),
    dependencies: await Promise.all((input.dependencies || []).map(file => digestBinding(repoRoot, repoInput, 'dependency', file))),
  }
}

async function readJsonIfPresent(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  }
  catch (error) {
    if (error?.code === 'ENOENT')
      return null
    throw error
  }
}

async function writeState(path, state) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.tmp-${randomUUID()}`
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, path)
}

function assertAllowedStatePath(repoRoot, requested) {
  const path = relativeInside(repoRoot, requested, 'state file')
  const parts = path.relative.split('/')
  const taskState = parts.length === 4
    && parts[0] === '.ccg' && parts[1] === 'tasks'
    && SAFE_STATE_ID.test(parts[2]) && parts[3] === 'intelligence-route.json'
  const codexStatus = parts.length === 4
    && parts[0] === '.codex' && parts[1] === 'ccg'
    && SAFE_STATE_ID.test(parts[2]) && parts[3] === 'status.json'
  if (!taskState && !codexStatus)
    throw new Error('state file must match .ccg/tasks/<id>/intelligence-route.json or .codex/ccg/<id>/status.json')
  return path
}

function validateExistingRouteState(value) {
  if (value == null)
    return null
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.schemaVersion !== 1
    || typeof value.workflow !== 'string'
    || !value.decision || typeof value.decision !== 'object'
    || !value.execution || typeof value.execution !== 'object')
    throw new Error('Existing state file does not contain the Grok intelligence route schema')
  return value
}

async function writeRouteState(context, state) {
  await mkdir(dirname(context.statePath), { recursive: true, mode: 0o700 })
  await assertNoLinkedPath(context.repoRoot, dirname(context.statePath), 'state directory')
  try {
    const metadata = await lstat(context.statePath)
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink > 1)
      throw new Error('Existing route state must be one regular, non-linked file')
  }
  catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  await writeState(context.statePath, state)
}

function resolveActiveTaskDir(input, repoRoot, repoInput, statePath) {
  const candidate = input.taskDir
    ? mapInputPath(repoInput, repoRoot, input.taskDir, 'task directory').absolute
    : dirname(statePath)
  const tasksRoot = resolve(repoRoot, '.ccg', 'tasks')
  const taskRelative = relative(tasksRoot, candidate).replace(/\\/g, '/')
  if (!taskRelative || taskRelative.startsWith('../') || taskRelative.includes('/'))
    return null
  return candidate
}

async function validateSuccessfulBundle(repoRoot, routeDecision, result, { config = {}, clock = () => new Date(), bindings = {}, officialDomains = [] } = {}) {
  if (result?.exitCode !== 0 || result?.status !== 'valid')
    throw new Error('Automatic route result is not a successful evidence bundle')
  const artifactRoot = relativeInside(repoRoot, String(config.artifact_root || '.codex/ccg/intelligence'), 'artifact root')
  await assertNoLinkedPath(repoRoot, artifactRoot.absolute, 'artifact root')
  const artifact = await assertNoLinkedPath(repoRoot, result.evidencePath, 'evidence artifact')
  const manifest = await assertNoLinkedPath(repoRoot, result.manifestPath, 'evidence manifest')
  if (basename(artifact.absolute) !== 'evidence.json' || basename(manifest.absolute) !== 'manifest.json')
    throw new Error('Automatic route bundle must use canonical evidence.json and manifest.json names')
  const artifactMeta = await stat(artifact.absolute)
  const manifestMeta = await stat(manifest.absolute)
  if (!artifactMeta.isFile() || !manifestMeta.isFile() || artifactMeta.nlink > 1 || manifestMeta.nlink > 1)
    throw new Error('Automatic route bundle paths must be non-linked regular files')
  if (dirname(artifact.absolute) !== dirname(manifest.absolute))
    throw new Error('Evidence artifact and manifest must share one bundle directory')
  if (dirname(dirname(artifact.absolute)) !== artifactRoot.absolute)
    throw new Error('Automatic route bundle must be one direct child of the configured artifact root')
  const [artifactBytes, manifestBytes] = await Promise.all([
    readFile(artifact.absolute),
    readFile(manifest.absolute),
  ])
  if (sha256(artifactBytes) !== result.evidenceSha256)
    throw new Error('Automatic route evidence artifact hash mismatch')
  if (sha256(manifestBytes) !== result.manifestSha256)
    throw new Error('Automatic route evidence manifest hash mismatch')
  let artifactJson
  let manifestJson
  try {
    artifactJson = JSON.parse(artifactBytes)
    manifestJson = JSON.parse(manifestBytes)
  }
  catch (error) {
    throw new Error(`Automatic route bundle JSON is malformed: ${error instanceof Error ? error.message : String(error)}`)
  }
  const evidenceId = String(manifestJson.evidenceId || '')
  if (!evidenceId || evidenceId !== dirname(artifact.absolute).split(/[\\/]/).at(-1))
    throw new Error('Automatic route manifest evidenceId does not match its bundle directory')
  if (manifestJson.localOnly !== true || manifestJson.exported !== false)
    throw new Error('Automatic route evidence must remain local-only and unexported')
  const createdAt = new Date(manifestJson.createdAt)
  if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== manifestJson.createdAt)
    throw new Error('Automatic route manifest has no exact creation timestamp')
  const ttl = routeDecision.action === 'verify'
    ? EVIDENCE_TTL_MS.verify
    : (EVIDENCE_TTL_MS[routeDecision.investigation_mode || routeDecision.mode] || EVIDENCE_TTL_MS.contract)
  const age = clock().getTime() - createdAt.getTime()
  if (age < -5 * 60 * 1000 || age > ttl)
    throw new Error('Automatic route evidence is outside its freshness window')
  const configuredModel = routeDecision.depth === 'deep'
    ? config.deep_research_model
    : (config.default_model || 'grok-4.5')
  const expectedModel = String(configuredModel || '').trim()
  if (!expectedModel)
    throw new Error(`Automatic route has no configured ${routeDecision.depth || 'normal'} model`)
  if (typeof result.model !== 'string' || !result.model || result.model !== expectedModel || manifestJson.model !== result.model)
    throw new Error('Automatic route manifest does not bind the executed Grok model')
  const expectedFiles = ['evidence.json', 'raw-stream.jsonl', 'report.md']
  if (JSON.stringify(Object.keys(manifestJson.files || {}).sort()) !== JSON.stringify(expectedFiles))
    throw new Error('Automatic route manifest must bind the canonical evidence, report, and raw stream files')
  for (const name of expectedFiles) {
    const child = await assertNoLinkedPath(repoRoot, resolve(dirname(manifest.absolute), name), `bundle ${name}`)
    const metadata = await stat(child.absolute)
    if (!metadata.isFile() || metadata.nlink > 1)
      throw new Error(`Automatic route bundle ${name} is not a regular file`)
    const bytes = await readFile(child.absolute)
    const binding = manifestJson.files[name]
    if (binding?.sha256 !== sha256(bytes) || binding?.bytes !== bytes.length)
      throw new Error(`Automatic route manifest hash mismatch for ${name}`)
  }
  const boundArtifact = manifestJson.files?.['evidence.json']
  if (boundArtifact?.sha256 !== result.evidenceSha256 || boundArtifact?.bytes !== artifactBytes.length)
    throw new Error('Automatic route manifest does not bind evidence.json bytes')
  const decision = createIntelligenceDecision(artifactJson.decision)
  if (decision.requirement !== routeDecision.requirement || decision.status !== 'valid')
    throw new Error('Automatic route bundle decision does not match the required route')
  const investigationMode = routeDecision.investigation_mode || routeDecision.mode
  const expectedRoute = {
    action: routeDecision.action || 'intel',
    investigation_mode: investigationMode,
    depth: routeDecision.depth || 'normal',
    requirement: routeDecision.requirement,
    effective_x_policy: routeDecision.effective_x_policy,
  }
  for (const [field, expected] of Object.entries(expectedRoute)) {
    if (decision[field] !== expected && field !== 'effective_x_policy')
      throw new Error(`Automatic route evidence decision ${field} drift`)
    if (manifestJson[field] !== expected)
      throw new Error(`Automatic route manifest ${field} drift`)
  }
  if (artifactJson.schemaVersion !== 2 || !Array.isArray(artifactJson.evidence?.claims) || artifactJson.evidence.claims.length === 0)
    throw new Error('Automatic route evidence must contain at least one bound or explicit unresolved claim')
  if (artifactJson.evidence?.model?.actual !== result.model)
    throw new Error('Automatic route evidence provenance does not match the executed Grok model')
  if (artifactJson.evidence?.action !== expectedRoute.action
    || artifactJson.evidence?.investigation_mode !== investigationMode
    || artifactJson.evidence?.depth !== expectedRoute.depth
    || artifactJson.evidence?.effective_x_policy !== expectedRoute.effective_x_policy)
    throw new Error('Automatic route evidence action, mode, depth, or X policy drift')
  const validation = validateEvidencePackage({
    normalized: artifactJson.evidence.normalized,
    registry: artifactJson.evidence.registry,
    claims: artifactJson.evidence.claims,
    requireWebSearch: routeDecision.require_web_search !== false,
    xSearchPolicy: routeDecision.configured_x_policy || 'preferred',
    mode: investigationMode,
    requireClaims: true,
  })
  if (!validation.valid)
    throw new Error(`Automatic route evidence policy validation failed: ${validation.errors.join('; ')}`)
  if (decision.package_status !== validation.package_status
    || decision.verification_outcome !== validation.verification_outcome
    || manifestJson.package_status !== validation.package_status
    || manifestJson.validation_outcome !== validation.verification_outcome
    || manifestJson.verification_outcome !== validation.verification_outcome)
    throw new Error('Automatic route verification outcome drift')
  if (expectedRoute.action === 'verify'
    && (!['verified', 'partially_verified'].includes(validation.verification_outcome)
      || validation.qualifying_claims.length === 0))
    throw new Error('Automatic route required verification has no qualifying claim')
  for (const field of ['prompt_sha256', 'dirty_digest', 'cache_fingerprint']) {
    if (!/^[a-f0-9]{64}$/.test(String(manifestJson[field] || '')))
      throw new Error(`Automatic route manifest ${field} is invalid`)
  }
  for (const field of ['cli_version', 'git_head']) {
    if (typeof manifestJson[field] !== 'string' || !manifestJson[field].trim())
      throw new Error(`Automatic route manifest ${field} is missing`)
  }
  if (!Array.isArray(manifestJson.bindings) || !Array.isArray(manifestJson.official_domains)
    || !manifestJson.cache_contract_versions || typeof manifestJson.cache_contract_versions !== 'object'
    || !Number.isInteger(manifestJson.attempts) || manifestJson.attempts < 1
    || !Number.isInteger(manifestJson.search_counts?.web) || manifestJson.search_counts.web < 0
    || !Number.isInteger(manifestJson.search_counts?.x) || manifestJson.search_counts.x < 0)
    throw new Error('Automatic route manifest provenance is incomplete')
  const manifestBindings = new Map(manifestJson.bindings.map(binding => [`${binding?.path}:${binding?.sha256}`, binding]))
  for (const binding of [bindings?.plan, bindings?.diff, ...(bindings?.dependencies || [])].filter(Boolean)) {
    const manifestBinding = manifestBindings.get(`${binding.path}:${binding.sha256}`)
    if (!manifestBinding || manifestBinding.bytes !== binding.bytes)
      throw new Error(`Automatic route manifest does not bind ${binding.path}`)
  }
  const expectedDomains = [...new Set(officialDomains.map(value => String(value).trim().toLowerCase()))].sort()
  if (JSON.stringify(manifestJson.official_domains) !== JSON.stringify(expectedDomains))
    throw new Error('Automatic route manifest official domain policy drift')
  return {
    evidenceId,
    decision,
    bundle: {
      artifactRelativePath: artifact.relative,
      artifactSha256: result.evidenceSha256,
      manifestRelativePath: manifest.relative,
      manifestSha256: result.manifestSha256,
    },
  }
}

async function publishCanonicalEvidence({ input, repoRoot, repoInput, statePath, validated }) {
  const taskDir = resolveActiveTaskDir(input, repoRoot, repoInput, statePath)
  if (!taskDir)
    return null
  const taskFile = resolve(taskDir, 'task.json')
  const task = await readJsonIfPresent(taskFile)
  if (!task) {
    if (input.taskDir)
      throw new Error('Explicit task directory is missing task.json')
    return null
  }
  const item = createCanonicalEvidenceItem({
    evidenceId: validated.evidenceId,
    decision: validated.decision,
    bundle: validated.bundle,
    summary: validated.decision.reason,
  })
  const evidenceFile = resolve(taskDir, 'evidence.json')
  const existing = await readJsonIfPresent(evidenceFile) || { schemaVersion: 1, items: [] }
  if (!Array.isArray(existing.items))
    throw new Error('Canonical task evidence.json has no items array')
  existing.items = [
    ...existing.items.filter(entry => entry?.provider !== 'grok' || entry?.role !== 'external-intelligence'),
    item,
  ]
  task.intelligence = createTaskIntelligencePointer({
    evidenceId: validated.evidenceId,
    decision: validated.decision,
    bundle: validated.bundle,
  })
  await writeState(evidenceFile, existing)
  await writeState(taskFile, task)
  return {
    evidence_id: validated.evidenceId,
    artifact_file: validated.bundle.artifactRelativePath,
    artifact_sha256: validated.bundle.artifactSha256,
    manifest_file: validated.bundle.manifestRelativePath,
    manifest_sha256: validated.bundle.manifestSha256,
  }
}

async function resolveConfig(input) {
  if (Object.prototype.hasOwnProperty.call(input, 'config'))
    return input.config
  if (!input.configPath)
    return undefined
  try {
    return parseIntelligenceToml(await readFile(resolve(input.configPath), 'utf8'))
  }
  catch (error) {
    if (error?.code === 'ENOENT')
      return undefined
    throw error
  }
}

function skippedDecision(reason, trigger = 'configuration_disabled') {
  return {
    enabled: false,
    requirement: 'disabled',
    action: 'intel',
    investigation_mode: 'contract',
    mode: 'contract',
    depth: 'normal',
    trigger,
    reason,
    status: 'skipped',
    require_web_search: false,
    configured_x_policy: 'disabled',
    effective_x_policy: 'disabled',
  }
}

function inheritedRequirement(input, previous) {
  const value = input.inheritedRequirement || previous?.decision?.requirement
  return REQUIREMENTS.has(value) ? value : null
}

function classifyFinalVerification(input, task, previous) {
  const inherited = inheritedRequirement(input, previous)
  const reEvaluated = INCIDENT_PATTERN.test(task) && CURRENT_PATTERN.test(task)
    ? 'required'
    : (CONTRACT_PATTERN.test(task) ? 'required' : null)
  const requirement = inherited && inherited !== 'disabled' ? inherited : reEvaluated
  if (!requirement)
    return skippedDecision('Final verification found no inherited or re-evaluated external-intelligence requirement.', 'final_verify_not_required')
  const previousMode = previous?.decision?.investigation_mode
    || (INITIAL_MODES.has(previous?.decision?.mode) ? previous.decision.mode : null)
  const reEvaluatedMode = INCIDENT_PATTERN.test(task) && CURRENT_PATTERN.test(task) ? 'incident' : 'contract'
  const investigationMode = previousMode || reEvaluatedMode
  return {
    requirement,
    action: 'verify',
    investigation_mode: investigationMode,
    mode: investigationMode,
    depth: input.depth || previous?.decision?.depth || 'normal',
    trigger: 'final_diff_verify',
    reason: 'Final external verification inherited or re-evaluated the prior intelligence requirement.',
  }
}

function classifySemanticRoute(input) {
  if (!INITIAL_MODES.has(input.semanticMode))
    return null
  const reason = String(input.semanticReason || '').trim()
  if (!reason)
    throw new Error('A semantic intelligence route requires --semantic-reason')
  return { requirement: 'required', action: 'intel', investigation_mode: input.semanticMode, mode: input.semanticMode, depth: input.depth || 'normal', trigger: 'codex_semantic_judgment', reason }
}

function classifyHardTrigger(task, depth = 'normal') {
  if (INCIDENT_PATTERN.test(task) && CURRENT_PATTERN.test(task)) {
    return {
      requirement: 'required',
      action: 'intel',
      investigation_mode: 'incident',
      mode: 'incident',
      depth,
      trigger: 'current_incident',
      reason: 'A current external incident requires source-backed service and release evidence.',
    }
  }
  if (CONTRACT_PATTERN.test(task)) {
    return {
      requirement: 'required',
      action: 'intel',
      investigation_mode: 'contract',
      mode: 'contract',
      depth,
      trigger: 'dependency_api_contract',
      reason: 'A dependency or external API contract requires current source-backed evidence.',
    }
  }
  return skippedDecision('No initial automatic external-intelligence trigger matched this task class.', 'no_initial_trigger')
}

function decorateActiveDecision(route, config, task) {
  if (route.requirement === 'disabled')
    return route

  const configuredXPolicy = config.x_search_policy || 'preferred'
  const policyMode = route.investigation_mode || route.mode
  if (!['normal', 'deep'].includes(route.depth || 'normal'))
    throw new Error(`Unsupported intelligence depth: ${String(route.depth)}`)
  return {
    enabled: true,
    ...route,
    status: 'pending',
    require_web_search: config.require_web_search !== false,
    configured_x_policy: configuredXPolicy,
    effective_x_policy: resolveEffectiveXPolicy(configuredXPolicy, policyMode),
  }
}

export function classifyWorkflowRoute(input, config, previous = null) {
  if (!config || config.enabled !== true)
    return skippedDecision('External intelligence automatic routing is disabled because configuration or explicit opt-in is missing.')
  if (config.auto_route !== true)
    return skippedDecision('External intelligence is enabled, but automatic routing is disabled by configuration.')
  const task = String(input.task || '').trim()
  if (!task)
    throw new Error('Automatic intelligence routing requires a non-empty task')
  const route = input.trigger === 'final_diff_verify'
    ? classifyFinalVerification(input, task, previous)
    : (classifySemanticRoute(input) || classifyHardTrigger(task, input.depth || 'normal'))
  return decorateActiveDecision(route, config, task)
}

export function buildRouteCommandArgv(decision, input) {
  const action = decision.action || 'intel'
  const argv = [action, '--task', input.task.trim()]
  argv.push('--mode', decision.investigation_mode || decision.mode)
  argv.push('--depth', decision.depth || 'normal')
  if (input.plan)
    argv.push('--plan', input.plan)
  if (input.diff)
    argv.push('--diff', input.diff)
  for (const dependency of input.dependencies || [])
    argv.push('--dependency', dependency)
  for (const domain of input.officialDomains || [])
    argv.push('--official-domain', domain)
  if (input.forceRefresh === true)
    argv.push('--force-refresh')
  return argv
}

function commandOptions(input, decision, config) {
  return {
    task: input.task.trim(),
    mode: decision.investigation_mode || decision.mode,
    depth: decision.depth || 'normal',
    ...(input.plan ? { plan: input.plan } : {}),
    ...(input.diff ? { diff: input.diff } : {}),
    dependencies: [...(input.dependencies || [])],
    officialDomains: [...(input.officialDomains || [])],
    forceRefresh: input.forceRefresh === true,
    config,
  }
}

async function defaultInvoke(request) {
  if (!request.configPath)
    return { exitCode: 4, status: 'configuration_required', reason: 'Automatic route has no readable CCG config path.' }
  const options = { ...request.options, config: request.configPath }
  return runManualCommand(request.action, options, { repoRoot: request.repoRoot, configPath: request.configPath })
}

function makeState({ input, bindings, decision, execution, inputDigest }) {
  return {
    schemaVersion: 1,
    workflow: input.workflow,
    phase: input.phase,
    task: input.task.trim().slice(0, 500),
    input_digest: inputDigest,
    bindings,
    decision,
    execution,
    updated_at: new Date().toISOString(),
  }
}

function routeInputDigest(input, decision, bindings, config = {}) {
  return sha256(stableJson({
    workflow: input.workflow,
    phase: input.phase,
    decision: {
      requirement: decision.requirement,
      action: decision.action,
      investigation_mode: decision.investigation_mode,
      mode: decision.mode,
      depth: decision.depth,
      trigger: decision.trigger,
      require_web_search: decision.require_web_search,
      configured_x_policy: decision.configured_x_policy,
      effective_x_policy: decision.effective_x_policy,
    },
    bindings,
    official_domains: [...new Set((input.officialDomains || []).map(value => String(value).trim().toLowerCase()))].sort(),
    execution_profile: {
      model: String(config.default_model || 'grok-4.5').trim(),
      artifact_root: String(config.artifact_root || '.codex/ccg/intelligence').trim(),
      auth_mode: String(config.auth_mode || ''),
      provider: String(config.provider || ''),
      transport: String(config.transport || ''),
    },
  }))
}

async function prepareWorkflowRoute(input, runtime) {
  const repoInput = resolve(input.repoRoot || process.cwd())
  const repoRoot = await realpath(repoInput)
  const metadata = await stat(repoRoot)
  if (!metadata.isDirectory())
    throw new Error('repoRoot must be a directory')
  if (!input.stateFile)
    throw new Error('Automatic intelligence routing requires --state-file')
  const requestedStatePath = mapInputPath(repoInput, repoRoot, input.stateFile, 'state file')
  const statePath = assertAllowedStatePath(repoRoot, requestedStatePath.absolute).absolute
  await assertNoLinkedPath(repoRoot, dirname(statePath), 'state directory', { allowMissing: true })
  const previous = validateExistingRouteState(await readJsonIfPresent(statePath))
  const config = await resolveConfig(input)
  const decision = classifyWorkflowRoute(input, config, previous)
  emit(runtime, 'decision')
  const officialDomains = (input.officialDomains || []).map(value => String(value).trim()).filter(Boolean)
  const bindings = await collectBindings({ ...input, task: String(input.task || '') }, repoRoot, repoInput)
  if (decision.action === 'verify' && (!bindings.diff || bindings.diff.bytes === 0))
    throw new Error('Final external verification requires a non-empty --diff binding')
  if (decision.action === 'verify' && officialDomains.length === 0)
    throw new Error('External fact verification requires at least one predeclared --official-domain before Grok invocation')
  const inputDigest = routeInputDigest(input, decision, bindings, config)
  return { repoRoot, repoInput, statePath, previous, config, decision, bindings, officialDomains, inputDigest, clock: runtime.clock || (() => new Date()) }
}

async function completeSkippedRoute(input, context, runtime) {
  const state = makeState({
    input,
    bindings: context.bindings,
    decision: context.decision,
    inputDigest: context.inputDigest,
    execution: { status: 'skipped', exit_code: 0, invoked: false },
  })
  await writeRouteState(context, state)
  emit(runtime, 'state:complete')
  return { exitCode: 0, invoked: false, reused: false, ...state }
}

async function invokeRouteRunner(input, context, runtime) {
  const action = context.decision.action || 'intel'
  const argv = buildRouteCommandArgv(context.decision, input)
  const pendingState = makeState({
    input,
    bindings: context.bindings,
    decision: context.decision,
    inputDigest: context.inputDigest,
    execution: { status: 'pending', exit_code: null, invoked: true, action, argv },
  })
  await writeRouteState(context, pendingState)
  emit(runtime, 'state:pending')
  const invoke = runtime.invoke || defaultInvoke
  const result = await invoke({
    action,
    argv,
    options: commandOptions(input, context.decision, context.config),
    repoRoot: context.repoRoot,
    configPath: input.configPath ? resolve(input.configPath) : '',
    stateFile: context.statePath,
  })
  return { action, argv, result }
}

async function canonicalizeRunnerResult(input, context, result) {
  let canonicalEvidence = null
  if (result?.exitCode === 0 && result?.status === 'valid') {
    try {
      const validated = await validateSuccessfulBundle(context.repoRoot, context.decision, result, context)
      canonicalEvidence = await publishCanonicalEvidence({
        input,
        repoRoot: context.repoRoot,
        repoInput: context.repoInput,
        statePath: context.statePath,
        validated,
      })
    }
    catch (error) {
      return {
        result: {
          exitCode: 3,
          status: 'unsafe_context',
          reason: error instanceof Error ? error.message : String(error),
        },
        canonicalEvidence: null,
      }
    }
  }
  return { result, canonicalEvidence }
}

async function completeInvokedRoute(input, context, invocation, runtime) {
  const published = await canonicalizeRunnerResult(input, context, invocation.result)
  const result = published.result
  const exitCode = Number.isInteger(result?.exitCode) ? result.exitCode : 4
  const finalDecision = {
    ...context.decision,
    status: exitCode === 0 && result?.status === 'valid' ? 'valid' : 'blocked',
  }
  const finalState = makeState({
    input,
    bindings: context.bindings,
    decision: finalDecision,
    inputDigest: context.inputDigest,
    execution: {
      status: String(result?.status || 'configuration_required'),
      exit_code: exitCode,
      invoked: true,
      action: invocation.action,
      argv: invocation.argv,
      ...(result?.reason ? { reason: String(result.reason) } : {}),
      ...(result?.evidencePath ? {
        evidence_path: result.evidencePath,
        evidence_sha256: result.evidenceSha256,
        manifest_path: result.manifestPath,
        manifest_sha256: result.manifestSha256,
        model: result.model,
      } : {}),
    },
  })
  if (published.canonicalEvidence)
    finalState.canonical_evidence = published.canonicalEvidence
  await writeRouteState(context, finalState)
  emit(runtime, 'state:complete')
  return { exitCode, invoked: true, reused: false, ...finalState }
}

export async function runWorkflowRoute(input, runtime = {}) {
  const context = await prepareWorkflowRoute(input, runtime)
  if (context.decision.requirement === 'disabled')
    return completeSkippedRoute(input, context, runtime)
  const invocation = await invokeRouteRunner(input, context, runtime)
  return completeInvokedRoute(input, context, invocation, runtime)
}

export async function waiveWorkflowRoute(input, runtime = {}) {
  const reason = String(input.reason || '').trim()
  if (!reason)
    throw new Error('An explicit non-empty user waiver reason is required')
  if (!input.stateFile)
    throw new Error('A waiver requires --state-file for an existing blocked route')
  const repoInput = resolve(input.repoRoot || process.cwd())
  const repoRoot = await realpath(repoInput)
  const requestedStatePath = mapInputPath(repoInput, repoRoot, input.stateFile, 'state file')
  const statePath = assertAllowedStatePath(repoRoot, requestedStatePath.absolute).absolute
  await assertNoLinkedPath(repoRoot, dirname(statePath), 'state directory')
  const previous = validateExistingRouteState(await readJsonIfPresent(statePath))
  if (!previous || previous.decision?.status !== 'blocked' || previous.execution?.exit_code === 0)
    throw new Error('A waiver may only be applied to an existing blocked route')
  if (previous.decision?.requirement === 'disabled')
    throw new Error('A disabled route cannot be waived')
  const createdAt = (runtime.clock ? runtime.clock() : new Date()).toISOString()
  const state = {
    ...previous,
    decision: {
      ...previous.decision,
      status: 'waived',
      reason: `User explicitly waived the blocked external-intelligence gate: ${reason}`,
      waiver: { reason, actor: 'user', created_at: createdAt },
    },
    updated_at: createdAt,
  }
  await writeRouteState({ repoRoot, statePath }, state)
  return { exitCode: 0, invoked: false, reused: false, ...state }
}

function parseArgs(argv) {
  const output = { dependencies: [], officialDomains: [] }
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index]
    if (!value.startsWith('--'))
      continue
    const key = value.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
    if (key === 'forceRefresh') {
      output.forceRefresh = true
      continue
    }
    const next = argv[++index]
    if (!next || next.startsWith('--'))
      throw new Error(`Missing value for ${value}`)
    if (key === 'dependency')
      output.dependencies.push(next)
    else if (key === 'officialDomain')
      output.officialDomains.push(next)
    else
      output[key] = next
  }
  return output
}

async function main(argv = process.argv.slice(2)) {
  const waiverAction = argv[0] === 'waive'
  const args = parseArgs(waiverAction ? argv.slice(1) : argv)
  const repoRoot = resolve(args.repoRoot || process.cwd())
  if (waiverAction) {
    const result = await waiveWorkflowRoute({ repoRoot, stateFile: args.stateFile, reason: args.reason })
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    process.exitCode = result.exitCode
    return
  }
  const configPath = resolve(args.config || resolve(homedir(), '.codex', 'ccg', 'config.toml'))
  const taskFile = args.taskFile ? await assertNoLinkedPath(repoRoot, args.taskFile, 'task file') : null
  const task = taskFile ? await readFile(taskFile.absolute, 'utf8') : String(args.task || '')
  const result = await runWorkflowRoute({
    repoRoot,
    configPath,
    workflow: args.workflow || 'unknown',
    phase: args.phase || 'intake',
    task,
    stateFile: args.stateFile,
    trigger: args.trigger,
    semanticMode: args.semanticMode,
    semanticReason: args.semanticReason,
    inheritedRequirement: args.inheritedRequirement,
    depth: args.depth,
    plan: args.plan,
    diff: args.diff,
    dependencies: args.dependencies,
    officialDomains: args.officialDomains,
    forceRefresh: args.forceRefresh === true,
  })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  process.exitCode = result.exitCode
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 4
  })
}
