#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, lstat, readFile, readlink, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { exportIntelligenceBundle, writeIntelligenceBundle } from './lib/artifacts.mjs'
import { createCacheFingerprint, readCacheEntry, removeCacheEntry, withCacheLock, writeCacheEntry } from './lib/cache.mjs'
import { createIntelligenceDecision } from './lib/router.mjs'
import { getDefaultGrokIntelligencePaths, runIsolatedGrokDiagnostics } from './manage.mjs'
import { runBoundedProcess } from './lib/process.mjs'
import { GROK_PROMPT_TEMPLATE_VERSION, runGrokIntelligence } from './runner.mjs'
import { assertExistingPathWithoutLinks } from './lib/path-safety.mjs'
import { resolveEffectiveXPolicy, validateEvidencePackage } from './lib/validator.mjs'

const HELP = `CCG Grok external intelligence runner

Usage:
  command.mjs intel --task <text>|--task-file <file> [--mode discover|contract|incident|landscape]
                    [--depth normal|deep] [--file <relative-path>]...
                    [--official-domain <domain>]...
                    [--force-refresh] [--export <directory>]
  command.mjs verify --task <text> [--mode discover|contract|incident|landscape]
                     [--depth normal|deep] [--plan <file>] --diff <file>
                     [--allow-empty-diff] [--dependency <file>]... [--force-refresh]

Exit codes: 0 valid/skip, 2 required evidence unavailable, 3 unsafe context,
4 consent or configuration missing.`

const CACHE_VERSION = Object.freeze({
  runnerVersion: '2',
  wrapperProtocolVersion: 'acp-jsonrpc-1',
  promptTemplateSha256: createHash('sha256').update(GROK_PROMPT_TEMPLATE_VERSION).digest('hex'),
  evidenceSchemaVersion: '2',
  routerPolicyVersion: '1',
  sourceTierPolicyVersion: '1',
  eventNormalizerVersion: '2',
  snapshotPolicyVersion: '1',
})

const CACHE_TTL = Object.freeze({
  incident: 30 * 60 * 1000,
  verify: 2 * 60 * 60 * 1000,
  contract: 72 * 60 * 60 * 1000,
  discover: 7 * 24 * 60 * 60 * 1000,
  landscape: 7 * 24 * 60 * 60 * 1000,
  deep: 7 * 24 * 60 * 60 * 1000,
})

function parseArgs(argv) {
  const output = { files: [], dependencies: [], officialDomains: [] }
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index]
    if (!value.startsWith('--')) continue
    const key = value.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
    if (['forceRefresh', 'allowEmptyDiff'].includes(key)) output[key] = true
    else {
      const next = argv[++index]
      if (!next || next.startsWith('--')) throw new Error(`Missing value for ${value}`)
      if (key === 'file') output.files.push(next)
      else if (key === 'dependency') output.dependencies.push(next)
      else if (key === 'officialDomain') output.officialDomains.push(next)
      else output[key] = next
    }
  }
  return output
}

function parseTomlValue(raw) {
  const value = raw.trim()
  if (value === 'true') return true
  if (value === 'false') return false
  if (/^-?\d+$/.test(value)) return Number(value)
  const quoted = /^"(.*)"$/.exec(value)
  return quoted ? quoted[1].replace(/\\"/g, '"') : value
}

export function parseIntelligenceToml(content) {
  const match = /^\[intelligence\]\s*$([\s\S]*?)(?=^\[)/m.exec(`${content}\n[__end__]\n`)
  const config = {}
  for (const line of (match?.[1] || '').split(/\r?\n/)) {
    const field = /^([a-z_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (field) config[field[1]] = parseTomlValue(field[2])
  }
  const pinned = {
    provider: 'grok-cli',
    transport: 'acp',
    legacy_search_provider: 'grok-search-mcp',
    allow_provider_fallback: false,
  }
  for (const [key, expected] of Object.entries(pinned)) {
    if (Object.prototype.hasOwnProperty.call(config, key) && config[key] !== expected)
      throw new Error(`intelligence.${key} must remain ${JSON.stringify(expected)}`)
  }
  for (const key of ['enabled', 'auto_route', 'deep_research_enabled', 'live_checks_on_init', 'cleanup_credential_artifacts', 'require_web_search']) {
    if (Object.prototype.hasOwnProperty.call(config, key) && typeof config[key] !== 'boolean')
      throw new Error(`intelligence.${key} must be boolean`)
  }
  if (config.cleanup_credential_artifacts === false)
    throw new Error('intelligence.cleanup_credential_artifacts is a mandatory security invariant and must remain true')
  if (config.auth_mode != null && !['browser_oauth', 'api_key'].includes(config.auth_mode))
    throw new Error('intelligence.auth_mode must be browser_oauth or api_key')
  if (config.x_search_policy != null && !['required', 'preferred', 'disabled'].includes(config.x_search_policy))
    throw new Error('intelligence.x_search_policy must be required, preferred, or disabled')
  for (const key of ['default_model', 'deep_research_model']) {
    if (config[key] != null && (typeof config[key] !== 'string' || /[\u0000-\u001f\u007f]/.test(config[key])))
      throw new Error(`intelligence.${key} must be a single-line string`)
  }
  if (config.default_model != null && !config.default_model.trim())
    throw new Error('intelligence.default_model must not be empty')
  if (config.deep_research_enabled === true && (typeof config.deep_research_model !== 'string' || !config.deep_research_model.trim()))
    throw new Error('intelligence.deep_research_model is required when deep research is enabled')
  const ranges = {
    max_retries: [0, 2],
    max_bundle_bytes: [1024, 64 * 1024 * 1024],
    retention_days: [1, 365],
    exported_retention_days: [1, 3650],
  }
  for (const [key, [minimum, maximum]] of Object.entries(ranges)) {
    if (config[key] != null && (!Number.isInteger(config[key]) || config[key] < minimum || config[key] > maximum))
      throw new Error(`intelligence.${key} must be an integer between ${minimum} and ${maximum}`)
  }
  if (config.artifact_root != null) {
    if (typeof config.artifact_root !== 'string' || !config.artifact_root.trim() || /[\u0000-\u001f\u007f]/.test(config.artifact_root))
      throw new Error('intelligence.artifact_root must be a non-empty single-line string')
    const root = config.artifact_root.replace(/\\/g, '/')
    if (/^(?:[A-Za-z]:|\/)/.test(root) || root.split('/').some(part => !part || part === '.' || part === '..'))
      throw new Error('intelligence.artifact_root must be a contained relative path without traversal')
  }
  return config
}

async function exists(path) {
  try { await access(path); return true }
  catch { return false }
}

async function chooseSnapshotFiles(repoRoot, requested) {
  const output = []
  const candidates = requested.length > 0
    ? requested
    : ['package.json', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'go.mod', 'Cargo.toml', 'README.md']
  for (const candidate of candidates) {
    const absolute = resolve(repoRoot, candidate)
    const rel = relative(repoRoot, absolute).replace(/\\/g, '/')
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Snapshot path escapes the repository: ${candidate}`)
    if (await exists(absolute) && (await stat(absolute)).isFile()) output.push(rel)
  }
  if (output.length === 0) throw new Error('No safe snapshot file was selected; pass --file <relative-path>')
  return [...new Set(output)]
}

async function digestBinding(repoRoot, kind, file, { allowEmpty = false } = {}) {
  if (!file) return null
  const absolute = resolve(repoRoot, file)
  const rel = relative(repoRoot, absolute).replace(/\\/g, '/')
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`${kind} path escapes the repository`)
  const bytes = await readFile(absolute)
  if (!allowEmpty && bytes.length === 0)
    throw new Error(`${kind} file is empty; use --allow-empty-diff only when an intentionally empty diff is meaningful`)
  return { kind, path: rel, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, empty: bytes.length === 0 }
}

function countSearches(result, tool) {
  return result.evidence?.normalized?.searches?.filter(search => search.tool === tool && search.status === 'completed').length || 0
}

function reportFor(result, task, bindings) {
  const sources = result.evidence?.registry?.sources || []
  const claims = result.evidence?.claims || []
  return [
    '# Grok External Intelligence Evidence',
    '',
    `- Task: ${task}`,
    `- Web searches: ${countSearches(result, 'web_search')}`,
    `- X searches: ${countSearches(result, 'x_search')}`,
    `- Bound digests: ${bindings.length}`,
    `- Observed sources: ${sources.length}`,
    `- Bound claims: ${claims.length}`,
    '',
    ...claims.map(claim => `- Claim [${claim.id}] (${claim.status}): ${claim.claim}`),
    ...(claims.length ? [''] : []),
    ...sources.map(source => `- [${source.id}] ${source.canonical_url}`),
    '',
  ].join('\n')
}

function resolveContainedRoot(repoRoot, requested, name) {
  const target = resolve(repoRoot, requested)
  const rel = relative(repoRoot, target)
  if (!rel || rel.startsWith('..') || isAbsolute(rel))
    throw new Error(`${name} must remain inside the repository`)
  return target
}

export async function defaultGitState(repoRoot, files) {
  let head = 'unversioned'
  try {
    const result = await runBoundedProcess('git', ['rev-parse', '--verify', 'HEAD'], {
      cwd: repoRoot,
      timeoutMs: 5000,
      maxBytes: 4096,
    })
    if (result.exitCode === 0 && /^[a-f0-9]{40,64}$/i.test(result.stdout.trim()))
      head = result.stdout.trim().toLowerCase()
  }
  catch {}
  if (head !== 'unversioned') {
    const [statusResult, diffResult] = await Promise.all([
      runBoundedProcess('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
        cwd: repoRoot, timeoutMs: 10000, maxBytes: 4 * 1024 * 1024,
      }),
      runBoundedProcess('git', ['diff', '--binary', 'HEAD', '--'], {
        cwd: repoRoot, timeoutMs: 15000, maxBytes: 16 * 1024 * 1024,
      }),
    ])
    if (statusResult.exitCode !== 0 || diffResult.exitCode !== 0)
      throw new Error('Unable to compute the complete Git worktree digest')
    const digest = createHash('sha256')
      .update('git-status-v1\0').update(statusResult.stdout)
      .update('\0git-diff-binary\0').update(diffResult.stdout)
    const untracked = statusResult.stdout.split('\0')
      .filter(record => record.startsWith('?? '))
      .map(record => record.slice(3))
      .sort()
    for (const path of untracked) {
      const absolute = resolve(repoRoot, path)
      const rel = relative(repoRoot, absolute).replace(/\\/g, '/')
      if (!rel || rel.startsWith('../') || isAbsolute(rel))
        throw new Error('Git reported an untracked path outside the repository')
      const metadata = await lstat(absolute)
      digest.update('\0untracked\0').update(rel).update('\0')
      if (metadata.isSymbolicLink()) {
        digest.update('symlink\0').update(await readlink(absolute))
      }
      else if (metadata.isFile()) {
        digest.update('file\0')
        for await (const chunk of createReadStream(absolute))
          digest.update(chunk)
      }
      else {
        digest.update('other\0')
      }
    }
    return { head, dirtyDigest: digest.digest('hex') }
  }
  const selected = []
  for (const path of [...files].sort()) {
    const bytes = await readFile(resolve(repoRoot, path))
    selected.push({ path, sha256: createHash('sha256').update(bytes).digest('hex') })
  }
  return {
    head,
    dirtyDigest: createHash('sha256').update(JSON.stringify(selected)).digest('hex'),
  }
}

function normalizeOfficialDomains(values) {
  const output = []
  for (const value of values || []) {
    const domain = String(value).trim().toLowerCase().replace(/^\.+/, '')
    if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain))
      throw new Error(`Invalid --official-domain value: ${String(value)}`)
    if (!output.includes(domain)) output.push(domain)
  }
  return output.sort()
}

function ttlFor(action, mode) {
  return action === 'verify' ? CACHE_TTL.verify : (CACHE_TTL[mode] || CACHE_TTL.discover)
}

async function cachedArtifactsMatch(repoRoot, artifactRoot, result) {
  if (!result || result.status !== 'valid')
    return false
  const absolutePaths = {}
  for (const [pathField, hashField] of [['evidencePath', 'evidenceSha256'], ['manifestPath', 'manifestSha256']]) {
    const file = result[pathField]
    const expected = result[hashField]
    if (typeof file !== 'string' || !/^[a-f0-9]{64}$/.test(String(expected || '')))
      return false
    const absolute = resolve(repoRoot, file)
    const rel = relative(repoRoot, absolute)
    if (!rel || rel.startsWith('..') || isAbsolute(rel))
      return false
    try {
      const checked = await assertExistingPathWithoutLinks(absolute, { name: `cached ${pathField}`, expectedType: 'file' })
      if (checked.metadata.nlink > 1)
        return false
      absolutePaths[pathField] = checked.canonical
      const actual = createHash('sha256').update(await readFile(absolute)).digest('hex')
      if (actual !== expected)
        return false
    }
    catch {
      return false
    }
  }
  try {
    const evidencePath = absolutePaths.evidencePath
    const manifestPath = absolutePaths.manifestPath
    if (basename(evidencePath) !== 'evidence.json' || basename(manifestPath) !== 'manifest.json' || dirname(evidencePath) !== dirname(manifestPath))
      return false
    const bundleDirectory = dirname(manifestPath)
    const bundleRelative = relative(artifactRoot, bundleDirectory).replace(/\\/g, '/')
    if (!bundleRelative || bundleRelative.startsWith('../') || bundleRelative.includes('/'))
      return false
    const evidence = JSON.parse(await readFile(evidencePath, 'utf8'))
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    if (typeof result.model !== 'string' || !result.model
      || evidence?.evidence?.model?.actual !== result.model
      || !Array.isArray(evidence?.evidence?.claims) || evidence.evidence.claims.length === 0
      || manifest?.model !== result.model
      || manifest?.evidenceId !== basename(bundleDirectory)
      || manifest?.localOnly !== true || manifest?.exported !== false)
      return false
    const expectedFiles = ['evidence.json', 'raw-stream.jsonl', 'report.md']
    if (JSON.stringify(Object.keys(manifest.files || {}).sort()) !== JSON.stringify(expectedFiles))
      return false
    for (const name of expectedFiles) {
      const checked = await assertExistingPathWithoutLinks(resolve(bundleDirectory, name), { name: `cached bundle ${name}`, expectedType: 'file' })
      if (checked.metadata.nlink > 1)
        return false
      const bytes = await readFile(checked.canonical)
      if (manifest.files[name]?.sha256 !== createHash('sha256').update(bytes).digest('hex')
        || manifest.files[name]?.bytes !== bytes.length)
        return false
    }
    const payload = evidence?.evidence
    const decision = evidence?.decision
    const expectedMode = result.investigation_mode || result.mode
    if (decision?.action !== result.action
      || decision?.investigation_mode !== expectedMode
      || decision?.mode !== expectedMode
      || decision?.depth !== result.depth
      || decision?.package_status !== result.package_status
      || decision?.verification_outcome !== result.verification_outcome
      || manifest.action !== result.action
      || manifest.investigation_mode !== expectedMode
      || manifest.depth !== result.depth
      || manifest.package_status !== result.package_status
      || manifest.verification_outcome !== result.verification_outcome
      || manifest.validation_outcome !== result.verification_outcome)
      return false
    const validation = validateEvidencePackage({
      normalized: payload?.normalized,
      registry: payload?.registry,
      claims: payload?.claims,
      requireWebSearch: manifest.search_counts?.web > 0,
      xSearchPolicy: manifest.effective_x_policy || 'preferred',
      mode: expectedMode,
      requireClaims: true,
    })
    if (!validation.valid
      || validation.package_status !== result.package_status
      || validation.verification_outcome !== result.verification_outcome
      || (result.action === 'verify' && validation.qualifying_claims.length === 0))
      return false
  }
  catch {
    return false
  }
  return true
}

async function exportCachedResult({ repoRoot, options, result, config }) {
  if (!options.export)
    return result
  const manifestPath = resolve(repoRoot, result.manifestPath)
  const evidenceId = basename(dirname(manifestPath))
  const exported = await exportIntelligenceBundle({
    bundleDir: dirname(manifestPath),
    exportRoot: resolve(options.export),
    evidenceId,
    secrets: [process.env.XAI_API_KEY],
    maxBytes: config.max_bundle_bytes || 16 * 1024 * 1024,
    retentionDays: config.exported_retention_days || 30,
  })
  return { ...result, exported }
}

export async function runManualCommand(action, options, runtime = {}) {
  if (!['intel', 'verify'].includes(action)) throw new Error('Action must be intel or verify')
  if (typeof options.task !== 'string' || !options.task.trim()) throw new Error('--task is required')
  const repoRoot = await realpath(resolve(runtime.repoRoot || process.cwd()))
  const configPath = resolve(options.config || runtime.configPath || resolve(homedir(), '.codex', 'ccg', 'config.toml'))
  const config = parseIntelligenceToml(await readFile(configPath, 'utf8'))
  const mode = options.mode || (action === 'verify' ? 'contract' : 'discover')
  if (!['discover', 'contract', 'incident', 'landscape'].includes(mode)) throw new Error(`Unsupported mode: ${mode}`)
  const depth = options.depth || 'normal'
  if (!['normal', 'deep'].includes(depth)) throw new Error(`Unsupported depth: ${depth}`)
  if (depth === 'deep' && config.deep_research_enabled !== true) throw new Error('Deep research is disabled in CCG configuration')
  const selectedModel = String(depth === 'deep' ? config.deep_research_model : (config.default_model || 'grok-4.5')).trim()
  if (!selectedModel) throw new Error(`No Grok model is configured for ${depth} research`)
  if (action === 'verify' && !options.diff)
    throw new Error('--diff is required for verify; pass an actual bounded diff file')
  const officialDomains = normalizeOfficialDomains(options.officialDomains)
  const bindings = (await Promise.all([
    digestBinding(repoRoot, 'plan', options.plan),
    digestBinding(repoRoot, 'diff', options.diff, { allowEmpty: options.allowEmptyDiff === true }),
    ...(options.dependencies || []).map(file => digestBinding(repoRoot, 'dependency', file)),
  ])).filter(Boolean)
  if (action === 'verify' && officialDomains.length === 0)
    throw new Error('External fact verification requires at least one predeclared --official-domain before Grok diagnostics')
  const allowedCcgPlanPaths = bindings
    .filter(item => item.kind === 'plan' && /^\.codex\/ccg\/plans\/[^/]+\.md$/i.test(item.path))
    .map(item => item.path)
  const files = await chooseSnapshotFiles(repoRoot, [...(options.files || []), ...bindings.map(item => item.path)])
  const paths = runtime.paths || getDefaultGrokIntelligencePaths()
  const requirement = 'required'
  const task = bindings.length > 0
    ? `${options.task.trim()}\n\nBound input digests:\n${bindings.map(item => `${item.kind}:${item.path}:${item.sha256}`).join('\n')}`
    : options.task.trim()
  if (config.enabled !== true) {
    return {
      exitCode: 4,
      status: 'configuration_required',
      reason: 'External intelligence requires explicit user consent and enabled configuration',
      requirement,
      mode,
      depth,
      bindings,
    }
  }

  const sourceEnv = runtime.sourceEnv || process.env
  const apiKey = config.auth_mode === 'api_key' ? sourceEnv.XAI_API_KEY : undefined
  const authentication = { authMode: config.auth_mode || 'browser_oauth', apiKey }
  const diagnosticProbe = await (runtime.runDiagnostics || runIsolatedGrokDiagnostics)({
    paths,
    authentication,
    command: runtime.command || 'grok',
    prefixArgs: runtime.prefixArgs || [],
    sourceEnv,
  })
  const diagnostics = diagnosticProbe.diagnostics || diagnosticProbe
  if (diagnostics.safe !== true || typeof diagnostics.version !== 'string' || !diagnostics.version.trim())
    throw new Error('Grok diagnostics did not return a safe versioned contract')
  if (!Array.isArray(diagnostics.models) || !diagnostics.models.includes(selectedModel))
    throw new Error(`Configured Grok model is not available in the local CLI inventory: ${selectedModel}`)
  const gitState = await (runtime.gitState || defaultGitState)(repoRoot, files)
  if (typeof gitState?.head !== 'string' || !gitState.head || typeof gitState?.dirtyDigest !== 'string' || !gitState.dirtyDigest)
    throw new Error('Manual cache requires a valid repository state digest')
  const effectiveXPolicy = resolveEffectiveXPolicy(config.x_search_policy || 'preferred', mode)
  const fingerprint = createCacheFingerprint({
    task,
    mode,
    searchPolicy: {
      action,
      depth,
      require_web_search: config.require_web_search !== false,
      x_search_policy: config.x_search_policy || 'preferred',
      effective_x_policy: effectiveXPolicy,
    },
    model: selectedModel,
    gitHead: gitState.head,
    dirtyDigest: gitState.dirtyDigest,
    planDigest: bindings.find(item => item.kind === 'plan')?.sha256 || 'none',
    diffDigest: bindings.find(item => item.kind === 'diff')?.sha256 || 'none',
    lockfiles: bindings.filter(item => item.kind === 'dependency').map(item => ({ path: item.path, sha256: item.sha256 })),
    targetVersions: {},
    targetDomains: officialDomains,
    cliVersion: diagnostics.version.trim(),
    ...CACHE_VERSION,
  })
  const artifactRoot = resolveContainedRoot(repoRoot, String(config.artifact_root || '.codex/ccg/intelligence'), 'Artifact root')
  const cacheRoot = resolveContainedRoot(artifactRoot, runtime.cacheRoot || resolve(artifactRoot, '.cache'), 'Cache root')
  const now = runtime.clock ? runtime.clock() : new Date()

  return withCacheLock({ cacheRoot, key: fingerprint.key, clock: () => now }, async () => {
    let cached = await readCacheEntry({
      cacheRoot,
      fingerprint: fingerprint.key,
      now,
      ttlMs: ttlFor(action, mode),
      forceRefresh: options.forceRefresh === true,
    })
    if (cached.hit && await cachedArtifactsMatch(repoRoot, artifactRoot, cached.entry.result)) {
      const hit = { ...cached.entry.result, cache: { hit: true, reason: cached.reason, fingerprint: fingerprint.key } }
      return exportCachedResult({ repoRoot, options, result: hit, config })
    }
    if (cached.hit)
      cached = { hit: false, reason: 'artifact_mismatch' }
    const cacheState = { hit: false, reason: cached.reason, fingerprint: fingerprint.key }
    const result = await (runtime.runner || runGrokIntelligence)({
      action,
      requirement,
      consent: true,
      config,
      task,
      mode,
      depth,
      repoRoot,
      selectedPaths: files,
      allowedCcgPlanPaths,
      dirtyDiffs: [],
      tempParent: paths.tempParent,
      grokHome: paths.grokHome,
      sourceEnv,
      apiKey,
      model: selectedModel,
      officialDomains,
      command: runtime.command,
      prefixArgs: runtime.prefixArgs,
      runDiagnostics: async () => diagnostics,
    })
    const runnerPackageStatus = result.evidence?.validation?.package_status
    const runnerVerificationOutcome = result.evidence?.validation?.verification_outcome
    const runnerQualifyingClaims = result.evidence?.validation?.qualifying_claims
    if (result.exitCode === 0 && result.status === 'valid' && action === 'verify'
      && (runnerPackageStatus !== 'valid'
        || !['verified', 'partially_verified'].includes(runnerVerificationOutcome)
        || !Array.isArray(runnerQualifyingClaims) || runnerQualifyingClaims.length === 0)) {
      return {
        ...result,
        exitCode: 2,
        status: 'verification_unresolved',
        reason: `Required verification outcome is ${runnerVerificationOutcome || 'unresolved'}`,
        requirement,
        action,
        investigation_mode: mode,
        mode,
        depth,
        package_status: runnerPackageStatus || 'invalid',
        verification_outcome: runnerVerificationOutcome || 'unresolved',
        effective_x_policy: effectiveXPolicy,
        bindings,
        cache: cacheState,
      }
    }
    if (result.exitCode !== 0 || result.status !== 'valid')
      return { ...result, requirement, mode, depth, bindings, cache: cacheState }
    if (result.evidence?.model?.actual != null && result.evidence.model.actual !== selectedModel)
      throw new Error('Grok runner model provenance does not match the selected model')
    const modelProvenance = result.evidence?.model || {
      requested: selectedModel,
      actual: selectedModel,
      provenance: 'runtime-provided model binding',
      usage_models: [],
    }

    const createdAt = (runtime.clock ? runtime.clock() : new Date()).toISOString()
    const evidenceId = `${createdAt.replace(/[-:.TZ]/g, '').slice(0, 14)}-${createHash('sha256').update(`${task}\n${createdAt}`).digest('hex').slice(0, 12)}`
    const packageStatus = result.evidence?.validation?.package_status || 'valid'
    const verificationOutcome = result.evidence?.validation?.verification_outcome || 'unresolved'
    const decision = createIntelligenceDecision({
      requirement,
      status: 'valid',
      action,
      investigation_mode: mode,
      mode,
      depth,
      package_status: packageStatus,
      verification_outcome: verificationOutcome,
      reason: action === 'verify'
        ? `External verification completed with outcome ${verificationOutcome}`
        : `External intelligence collected with outcome ${verificationOutcome}`,
      created_at: createdAt,
      ...(depth === 'deep' ? { deepVisibility: {
        evidence_visibility: 'leader_only', observed_web_search_events: countSearches(result, 'web_search'),
        observed_x_search_events: countSearches(result, 'x_search'), total_server_tool_usage: null, advisory_only: true,
      } } : {}),
    })
    const bundle = await writeIntelligenceBundle({
      projectRoot: repoRoot,
      artifactRoot,
      evidenceId,
      decision,
      evidence: {
        ...result.evidence,
        model: modelProvenance,
        bindings,
        action,
        investigation_mode: mode,
        depth,
        effective_x_policy: effectiveXPolicy,
        force_refresh: options.forceRefresh === true,
        cache: cacheState,
      },
      report: reportFor(result, options.task.trim(), bindings),
      rawEvents: result.raw?.notifications || [],
      secrets: [apiKey],
      clock: () => new Date(createdAt),
      model: selectedModel,
      retentionDays: config.retention_days || 7,
      maxBytes: config.max_bundle_bytes || 16 * 1024 * 1024,
      provenance: {
        action,
        investigation_mode: mode,
        depth,
        requirement,
        effective_x_policy: effectiveXPolicy,
        cli_version: diagnostics.version.trim(),
        prompt_sha256: CACHE_VERSION.promptTemplateSha256,
        git_head: gitState.head,
        dirty_digest: gitState.dirtyDigest,
        bindings,
        official_domains: officialDomains,
        search_counts: { web: countSearches(result, 'web_search'), x: countSearches(result, 'x_search') },
        attempts: result.attempts || 1,
        package_status: packageStatus,
        validation_outcome: verificationOutcome,
        verification_outcome: verificationOutcome,
        cache_fingerprint: fingerprint.key,
        cache_contract_versions: CACHE_VERSION,
      },
    })
    let exported = null
    if (options.export) {
      exported = await exportIntelligenceBundle({
        bundleDir: bundle.directory,
        exportRoot: resolve(options.export),
        evidenceId,
        secrets: [apiKey],
        maxBytes: config.max_bundle_bytes || 16 * 1024 * 1024,
        retentionDays: config.exported_retention_days || 30,
      })
    }
    const commandResult = {
      exitCode: 0, status: 'valid', requirement, action, investigation_mode: mode, mode, depth,
      package_status: packageStatus, verification_outcome: verificationOutcome,
      effective_x_policy: effectiveXPolicy, model: selectedModel, bindings,
      webSearches: countSearches(result, 'web_search'), xSearches: countSearches(result, 'x_search'),
      evidencePath: bundle.artifactRelativePath, evidenceSha256: bundle.artifactSha256,
      manifestPath: bundle.manifestRelativePath, manifestSha256: bundle.manifestSha256,
      exported,
      cache: cacheState,
    }
    await removeCacheEntry({ cacheRoot, fingerprint: fingerprint.key })
    await writeCacheEntry({
      cacheRoot,
      fingerprint: fingerprint.key,
      entry: {
        fingerprint: fingerprint.key,
        created_at: createdAt,
        status: 'valid',
        requirement,
        action,
        degraded: false,
        failed: false,
        package_status: packageStatus,
        verification_outcome: verificationOutcome,
        evidence: { claims: result.evidence?.claims || [] },
        result: { ...commandResult, exported: null },
      },
    })
    return commandResult
  })
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${HELP}\n`)
    return
  }
  const action = argv[0]
  const options = parseArgs(argv.slice(1))
  if (options.taskFile) options.task = await readFile(resolve(options.taskFile), 'utf8')
  const result = await runManualCommand(action, options)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  process.exitCode = result.exitCode
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 4
  })
}
