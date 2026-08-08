#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, relative, resolve, win32 } from 'node:path'
import { pathToFileURL } from 'node:url'
import { clearCredentialHomeVolatileState, createGrokAcpClient, withCredentialHomeLease, withCredentialHomeVolatileSnapshot } from './lib/acp-client.mjs'
import { cleanupIntelligenceArtifacts } from './lib/artifacts.mjs'
import { buildExactGrokEnvironment } from './lib/exact-env.mjs'
import { createPrivateRunRoots, securePrivateDirectory, validatePinnedGrokConfig, writePinnedGrokConfig } from './lib/private-temp.mjs'
import { resolveGrokExecutable, runBoundedProcess, runGrokDiagnostics } from './lib/process.mjs'
import { runGrokIntelligence } from './runner.mjs'

export const LOCAL_DOCTOR_ACP_TIMEOUT_MS = 120_000
export const LIVE_DOCTOR_ACP_TIMEOUT_MS = 300_000

const HELP = `CCG Grok intelligence account and diagnostics

Usage:
  manage.mjs login              Open the official browser OAuth login
  manage.mjs status [--json]    Show dedicated-home login status
  manage.mjs logout             Sign out of the dedicated Grok home
  manage.mjs doctor [--json] [--live] [--cleanup]
                    [--artifact-root <relative-path>] [--retention-days <days>]
                    [--max-bundle-bytes <bytes>]

The default doctor is local-only and never sends a model prompt. --live is an
explicit paid Web/X smoke check. Credentials are never printed or copied.`

function envValue(env, name) {
  if (env[name]) return env[name]
  const key = Object.keys(env).find(item => item.toLowerCase() === name.toLowerCase())
  return key ? env[key] : undefined
}

export function resolveDoctorAuthentication({ env = {}, loggedIn = false } = {}) {
  const apiKey = envValue(env, 'XAI_API_KEY')
  if (typeof apiKey === 'string' && apiKey.trim())
    return { authMode: 'api_key', apiKey }
  if (loggedIn)
    return { authMode: 'browser_oauth', apiKey: undefined }
  throw new Error('Grok doctor requires browser login or an explicit XAI_API_KEY')
}

export function getDefaultGrokIntelligencePaths({
  platform = process.platform,
  env = process.env,
  userHome = homedir(),
} = {}) {
  const pathResolve = platform === 'win32' ? win32.resolve : resolve
  const root = platform === 'win32'
    ? pathResolve(envValue(env, 'LOCALAPPDATA') || pathResolve(userHome, 'AppData', 'Local'), 'CCG', 'grok-intelligence')
    : pathResolve(envValue(env, 'XDG_DATA_HOME') || pathResolve(userHome, '.local', 'share'), 'ccg', 'grok-intelligence')
  return {
    root,
    grokHome: pathResolve(root, 'grok-home'),
    neutralHome: pathResolve(root, 'neutral-home'),
    tempParent: pathResolve(root, 'runs'),
  }
}

async function pathExists(path) {
  try {
    await access(path)
    return true
  }
  catch {
    return false
  }
}

export async function ensureDedicatedGrokHome(options = {}) {
  const paths = options.paths || getDefaultGrokIntelligencePaths(options)
  for (const path of [paths.root, paths.grokHome, paths.neutralHome, paths.tempParent])
    await securePrivateDirectory(path, {
      platform: options.platform || process.platform,
      restrictWindowsAcl: options.restrictWindowsAcl,
      validateDirectory: options.validateDirectory,
    })
  await writePinnedGrokConfig(paths.grokHome, {
    platform: options.platform || process.platform,
    restrictWindowsAcl: options.restrictWindowsAcl,
    validateDirectory: options.validateDirectory,
  })
  return paths
}

async function readDedicatedStatus(paths = getDefaultGrokIntelligencePaths()) {
  const configPath = resolve(paths.grokHome, 'config.toml')
  const authPath = resolve(paths.grokHome, 'auth.json')
  let configIssues = ['config.toml missing']
  if (await pathExists(configPath))
    configIssues = validatePinnedGrokConfig(await readFile(configPath, 'utf8'))
  return {
    root: paths.root,
    grokHome: paths.grokHome,
    authMode: 'browser_oauth',
    loggedIn: await pathExists(authPath),
    configSafe: configIssues.length === 0,
    configIssues,
  }
}

function runInteractive(command, args, options) {
  return new Promise((resolvePromise, rejectPromise) => {
    const executable = resolveGrokExecutable(command, { env: options.env })
    const child = spawn(executable, args, { ...options, shell: false, stdio: 'inherit', windowsHide: false })
    child.once('error', rejectPromise)
    child.once('close', code => code === 0 ? resolvePromise() : rejectPromise(new Error(`${command} exited with ${String(code)}`)))
  })
}

async function login(command = 'grok') {
  const paths = await ensureDedicatedGrokHome()
  const env = buildExactGrokEnvironment({ sourceEnv: process.env, neutralHome: paths.neutralHome, grokHome: paths.grokHome })
  await runInteractive(command, ['login', '--oauth'], { cwd: paths.neutralHome, env })
  const status = await readDedicatedStatus(paths)
  if (!status.loggedIn)
    throw new Error('Official Grok login completed without creating dedicated-home authentication state')
  process.stdout.write(`Grok browser OAuth login ready: ${paths.grokHome}\n`)
}

async function logout(command = 'grok') {
  const paths = getDefaultGrokIntelligencePaths()
  if (!(await pathExists(paths.grokHome))) {
    process.stdout.write('Grok dedicated home is not initialized.\n')
    return
  }
  const env = buildExactGrokEnvironment({ sourceEnv: process.env, neutralHome: paths.neutralHome, grokHome: paths.grokHome })
  await runInteractive(command, ['logout'], { cwd: paths.neutralHome, env })
  process.stdout.write('Grok dedicated-home logout complete.\n')
}

async function inventoryRetention(projectRoot, paths, { artifactRoot: requestedArtifactRoot = '.codex/ccg/intelligence', retentionDays = 7, maxBundleBytes = 16 * 1024 * 1024 } = {}) {
  const artifactRoot = resolve(projectRoot, requestedArtifactRoot)
  const artifactRelative = relative(resolve(projectRoot), artifactRoot)
  if (!artifactRelative || artifactRelative.startsWith('..') || isAbsolute(artifactRelative))
    throw new Error('Doctor artifact root must remain inside the project root')
  const result = { artifactRoot, bundles: 0, expiredBundles: 0, oversizedBundles: 0, invalidCanonicalPointers: 0, orphanPrivateRoots: 0, activeEvidenceIds: [] }
  const tasksRoot = resolve(projectRoot, '.ccg', 'tasks')
  if (await pathExists(tasksRoot)) {
    const terminal = new Set(['completed', 'complete', 'done', 'finished', 'archived', 'cancelled', 'closed'])
    for (const entry of await readdir(tasksRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'archive') continue
      try {
        const task = JSON.parse(await readFile(resolve(tasksRoot, entry.name, 'task.json'), 'utf8'))
        const pointer = task.intelligence || task.external_intelligence
        if (!pointer?.evidence_id) continue
        if (!terminal.has(String(task.status || '').toLowerCase())) result.activeEvidenceIds.push(pointer.evidence_id)
        const manifestFile = String(pointer.manifest_file || '').replace(/\\/g, '/')
        const manifestPath = resolve(projectRoot, manifestFile)
        if (!manifestFile.startsWith('.codex/ccg/intelligence/') || manifestFile.split('/').includes('..') || !(await pathExists(manifestPath))) {
          result.invalidCanonicalPointers++
          continue
        }
        if (pointer.manifest_sha256) {
          const actual = createHash('sha256').update(await readFile(manifestPath)).digest('hex')
          if (actual !== pointer.manifest_sha256) result.invalidCanonicalPointers++
        }
      }
      catch { result.invalidCanonicalPointers++ }
    }
  }
  if (await pathExists(artifactRoot)) {
    for (const entry of await readdir(artifactRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      result.bundles++
      try {
        const manifest = JSON.parse(await readFile(resolve(artifactRoot, entry.name, 'manifest.json'), 'utf8'))
        const created = new Date(manifest.createdAt)
        if (Number.isFinite(created.getTime()) && Date.now() - created.getTime() > retentionDays * 24 * 60 * 60 * 1000)
          result.expiredBundles++
      }
      catch {}
      let total = 0
      for (const file of await readdir(resolve(artifactRoot, entry.name), { withFileTypes: true })) {
        if (file.isFile()) total += (await stat(resolve(artifactRoot, entry.name, file.name))).size
      }
      if (total > maxBundleBytes) result.oversizedBundles++
    }
  }
  if (await pathExists(paths.tempParent)) {
    result.orphanPrivateRoots = (await readdir(paths.tempParent, { withFileTypes: true }))
      .filter(entry => entry.isDirectory() && /^ccg-grok-run-/i.test(entry.name)).length
  }
  return result
}

export async function runIsolatedGrokDiagnostics({
  paths,
  authentication,
  command = 'grok',
  prefixArgs = [],
  sourceEnv = process.env,
  createRoots = createPrivateRunRoots,
  runProcess = runBoundedProcess,
  runDiagnostics = runGrokDiagnostics,
  credentialLeaseHeld = false,
} = {}) {
  if (!paths?.tempParent || !paths?.grokHome)
    throw new Error('Isolated Grok diagnostics require dedicated paths')
  const roots = await createRoots({ parent: paths.tempParent, grokHome: paths.grokHome })
  try {
    const env = buildExactGrokEnvironment({
      sourceEnv,
      neutralHome: roots.neutralHome,
      grokHome: roots.grokHome,
      apiKey: authentication?.authMode === 'api_key' ? authentication.apiKey : undefined,
    })
    const action = () => withCredentialHomeVolatileSnapshot(roots.grokHome, async () => {
      const help = await runProcess(command, [...prefixArgs, '--no-auto-update', '--help'], {
        cwd: roots.neutralHome,
        env,
      })
      if (help.exitCode !== 0 || !/agent|models|inspect/i.test(help.stdout))
        throw new Error('Grok help contract is missing required local commands')
      const diagnostics = await runDiagnostics({
        command,
        prefixArgs,
        cwd: roots.neutralHome,
        env,
        runProcess,
      })
      return { help, diagnostics }
    }, { validateDirectory: async path => path })
    return await (credentialLeaseHeld
      ? action()
      : withCredentialHomeLease(roots.grokHome, action, { validateDirectory: async path => path }))
  }
  finally {
    await roots.cleanup()
  }
}

async function localDoctor(options = {}) {
  const {
    cleanup = false,
    projectRoot = process.cwd(),
    command = 'grok',
    prefixArgs = [],
    sourceEnv = process.env,
  } = options
  const paths = options.paths || getDefaultGrokIntelligencePaths({ env: sourceEnv })
  if (envValue(sourceEnv, 'XAI_API_KEY'))
    await ensureDedicatedGrokHome({ paths })
  const status = await readDedicatedStatus(paths)
  if (!status.configSafe)
    throw new Error(`Dedicated Grok config is unsafe: ${status.configIssues.join(', ')}`)
  const authentication = resolveDoctorAuthentication({ env: sourceEnv, loggedIn: status.loggedIn })
  for (const path of [paths.root, paths.grokHome, paths.neutralHome, paths.tempParent]) {
    if (!isAbsolute(path) || !(await pathExists(path)))
      throw new Error(`Dedicated Grok path is missing: ${path}`)
  }
  const clearCredentialState = options.clearCredentialState || clearCredentialHomeVolatileState
  const withCredentialLease = options.withCredentialLease || withCredentialHomeLease
  return withCredentialLease(paths.grokHome, async () => {
    await clearCredentialState(paths.grokHome)
    try {
      const diagnosticProbe = await (options.runIsolatedDiagnostics || runIsolatedGrokDiagnostics)({
        paths,
        authentication,
        command,
        prefixArgs,
        sourceEnv,
        credentialLeaseHeld: true,
      })
      const diagnostics = diagnosticProbe.diagnostics
      const createPrivateRoots = options.createPrivateRoots || createPrivateRunRoots
      const createAcpClient = options.createAcpClient || createGrokAcpClient
      const roots = await createPrivateRoots({ parent: paths.tempParent, grokHome: paths.grokHome })
      let handshake
      try {
        handshake = await createAcpClient({ command, prefixArgs }).run({
          handshakeOnly: true,
          cwd: roots.snapshotRoot,
          allowedCwdRoots: [roots.snapshotRoot],
          neutralHome: roots.neutralHome,
          grokHome: roots.grokHome,
          rawEventsDir: roots.rawEventsDir,
          rawEventsMaxBytes: 1024 * 1024,
          rawEventsMaxEvents: 2000,
          timeoutMs: LOCAL_DOCTOR_ACP_TIMEOUT_MS,
          maxTurns: 6,
          authMode: authentication.authMode,
          apiKey: authentication.apiKey,
          sourceEnv,
          credentialLeaseHeld: true,
        })
      }
      finally {
        await roots.cleanup()
      }
      const retentionDays = options.retentionDays || 7
      const retention = await inventoryRetention(projectRoot, paths, {
        artifactRoot: options.artifactRoot,
        retentionDays,
        maxBundleBytes: options.maxBundleBytes || 16 * 1024 * 1024,
      })
      let cleanupResult = null
      if (cleanup && await pathExists(retention.artifactRoot)) {
        cleanupResult = await cleanupIntelligenceArtifacts({
          artifactRoot: retention.artifactRoot,
          tempParent: paths.tempParent,
          activeEvidenceIds: retention.activeEvidenceIds,
          activePrivateRoots: [],
          retentionDays,
        })
      }
      return {
        ok: true,
        paidModelPromptSent: false,
        status,
        version: diagnostics.version,
        models: diagnostics.models,
        compatibilitySafe: diagnostics.safe,
        authMethod: handshake.authMethod,
        mcpServersEmpty: handshake.mcpPreflight.serversEmpty,
        mcpToolCount: handshake.mcpPreflight.toolCount,
        retention,
        cleanup: cleanupResult,
      }
    }
    finally {
      await clearCredentialState(paths.grokHome)
    }
  }, { validateDirectory: async path => path })
}

async function liveDoctor(options = {}) {
  const runLocalDoctor = options.runLocalDoctor || localDoctor
  const runner = options.runner || runGrokIntelligence
  const secureDirectory = options.secureDirectory || securePrivateDirectory
  const local = await runLocalDoctor(options)
  const sourceEnv = options.sourceEnv || process.env
  const paths = options.paths || getDefaultGrokIntelligencePaths({ env: sourceEnv })
  const authentication = resolveDoctorAuthentication({ env: sourceEnv, loggedIn: local.status.loggedIn })
  const probeRoot = resolve(paths.root, `live-probe-${process.pid}`)
  await secureDirectory(probeRoot)
  await writeFile(resolve(probeRoot, 'probe.txt'), 'CCG bounded Grok Web and X live evidence smoke test.\n', { flag: 'wx', mode: 0o400 })
  let live
  try {
    live = await runner({
      action: 'verify',
      requirement: 'required',
      consent: true,
      config: {
        enabled: true,
        auth_mode: authentication.authMode,
        default_model: 'grok-4.5',
        require_web_search: true,
        x_search_policy: 'required',
        max_retries: 0,
        max_bundle_bytes: 1024 * 1024,
      },
      task: 'Perform two bounded current-source checks: one official Web query for the Grok Build CLI documentation and one domain-restricted X query for the official xAI account. Return only source-backed evidence.',
      mode: 'incident',
      depth: 'normal',
      repoRoot: probeRoot,
      selectedPaths: ['probe.txt'],
      dirtyDiffs: [],
      officialDomains: ['x.ai'],
      officialXAccounts: ['xai'],
      tempParent: paths.tempParent,
      grokHome: paths.grokHome,
      sourceEnv,
      apiKey: authentication.apiKey,
      timeoutMs: LIVE_DOCTOR_ACP_TIMEOUT_MS,
    })
  }
  finally {
    await rm(probeRoot, { recursive: true, force: true })
  }
  if (live.exitCode !== 0 || live.status !== 'valid')
    throw new Error(`Paid Grok Web/X smoke failed: ${live.status || 'unknown'} (${live.reason || 'no reason'})`)
  const searches = live.evidence?.normalized?.searches || []
  const validation = live.evidence?.validation || {}
  const model = live.evidence?.model || {}
  return {
    ...local,
    paidModelPromptSent: true,
    live: {
      status: live.status,
      action: 'verify',
      investigationMode: 'incident',
      depth: 'normal',
      packageStatus: validation.package_status,
      verificationOutcome: validation.verification_outcome,
      requestedModel: model.requested,
      actualModel: model.actual,
      claimCount: Array.isArray(live.evidence?.claims) ? live.evidence.claims.length : 0,
      qualifyingClaimCount: Array.isArray(validation.qualifying_claims) ? validation.qualifying_claims.length : 0,
      webSearches: searches.filter(search => search.tool === 'web_search' && search.status === 'completed').length,
      xSearches: searches.filter(search => search.tool === 'x_search' && search.status === 'completed').length,
    },
  }
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${HELP}\n`)
    return
  }
  const [action] = argv
  const json = argv.includes('--json')
  if (action === 'login') return login()
  if (action === 'logout') return logout()
  if (action === 'status') {
    const result = await readDedicatedStatus()
    process.stdout.write(json ? `${JSON.stringify(result)}\n` : `${result.loggedIn ? 'Logged in' : 'Not logged in'} (${result.grokHome})\n`)
    return
  }
  if (action === 'doctor') {
    const valueAfter = flag => argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined
    const integerFlag = (flag, fallback) => {
      const value = valueAfter(flag)
      if (value == null) return fallback
      const parsed = Number(value)
      if (!Number.isInteger(parsed) || parsed < 1)
        throw new Error(`${flag} must be a positive integer`)
      return parsed
    }
    const doctorOptions = {
      cleanup: argv.includes('--cleanup'),
      artifactRoot: valueAfter('--artifact-root'),
      retentionDays: integerFlag('--retention-days', 7),
      maxBundleBytes: integerFlag('--max-bundle-bytes', 16 * 1024 * 1024),
    }
    const result = argv.includes('--live')
      ? await liveDoctor(doctorOptions)
      : await localDoctor(doctorOptions)
    const message = argv.includes('--live')
      ? `Grok paid Web/X doctor passed (${result.live.actualModel}); verification=${result.live.verificationOutcome}.`
      : `Grok local doctor passed (${result.version}); no model prompt was sent.`
    process.stdout.write(json ? `${JSON.stringify(result)}\n` : `${message}\n`)
    return
  }
  throw new Error(`Unknown Grok management action: ${action}`)
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}

export { liveDoctor, localDoctor, readDedicatedStatus }
