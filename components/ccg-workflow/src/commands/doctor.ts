import ansis from 'ansis'
import fs from 'fs-extra'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'pathe'
import type { ModelRouting, ModelType } from '../types'
import type { ProductManagerProvider } from '../product-manager/contracts'
import { STANDARD_ROUTING_ROLES } from '../types'
import { IMPLEMENTED_PRODUCT_MANAGER_PROVIDERS } from '../product-manager/provider-registry'
import { resolveClaudeExecutable, resolveGeminiEntrypoint } from './product-manager'
import { readCcgConfig, readCcgConfigAt } from '../utils/config'
import { resolveCodexHome, validateOwnershipManifest } from '../utils/codex-mode'
import { EXPECTED_BINARY_VERSION, verifyBinaryVersion } from '../utils/installer'
import { createDefaultRoleRouting, isRoutingRole } from '../utils/model-routing'
import { assertManagedPath } from '../utils/managed-path'
import { PACKAGE_ROOT } from '../utils/installer-template'
import { version as packageVersion } from '../../package.json'

const OK = ansis.green('✓')
const WARN = ansis.yellow('⚠')
const FAIL = ansis.red('✗')
const CODEX_AGENTS_END = '<!-- CCG:END -->'

async function fileExists(p: string): Promise<boolean> {
  return fs.pathExists(p)
}

async function dirFiles(p: string): Promise<string[]> {
  if (!(await fs.pathExists(p))) return []
  return (await fs.readdir(p)).filter(f => !f.startsWith('.'))
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function codexManagedAgentsBlock(content: string): string | null {
  const starts = [...content.matchAll(/<!-- CCG:START/g)]
  const ends = [...content.matchAll(/<!-- CCG:END -->/g)]
  if (starts.length !== 1 || ends.length !== 1 || ends[0].index! < starts[0].index!)
    return null
  return content.slice(starts[0].index!, ends[0].index! + CODEX_AGENTS_END.length)
}

export function execFileSafe(command: string, args: string[] = []): string | null {
  try {
    return execFileSync(command, args, {
      stdio: 'pipe',
      timeout: 10_000,
      windowsHide: true,
    }).toString().trim()
  }
  catch { return null }
}

export interface DoctorOptions {
  grok?: boolean
  grokLive?: boolean
  grokCleanup?: boolean
  platform?: 'claude' | 'codex'
}

export interface DoctorCheck {
  label: string
  status: string
  detail: string
}

export interface DoctorResult {
  ok: boolean
  failures: DoctorCheck[]
  checks: DoctorCheck[]
}

export function collectRoutingModels(routing?: Partial<ModelRouting>): string[] {
  return STANDARD_ROUTING_ROLES.flatMap((role) => {
    const route = routing?.[role]
    return [route?.primary, ...(route?.models || [])]
  }).filter((model): model is ModelType => Boolean(model))
}

export function routingStatusRows(routing?: Partial<ModelRouting>): Array<{ role: string, provider: string }> {
  return STANDARD_ROUTING_ROLES.map(role => ({
    role,
    provider: routing?.[role]?.primary || '—',
  }))
}

export function providerCliCommand(provider: ModelType): string | null {
  return ({
    gemini: 'gemini',
    antigravity: 'agy',
    grok: 'grok',
    pi: 'pi',
  } as Partial<Record<ModelType, string>>)[provider] ?? null
}

function commandAvailable(command: string): boolean {
  return execFileSafe(process.platform === 'win32' ? 'where.exe' : 'which', [command]) !== null
}

export function buildGrokDoctorArguments(options: DoctorOptions, intelligence?: Partial<NonNullable<Awaited<ReturnType<typeof readCcgConfig>>>['intelligence']>): string[] {
  const args = ['doctor', '--json']
  if (options.grokLive) args.push('--live')
  if (options.grokCleanup) args.push('--cleanup')
  if (intelligence?.artifact_root)
    args.push('--artifact-root', intelligence.artifact_root)
  if (intelligence?.retention_days != null)
    args.push('--retention-days', String(intelligence.retention_days))
  if (intelligence?.max_bundle_bytes != null)
    args.push('--max-bundle-bytes', String(intelligence.max_bundle_bytes))
  return args
}

export function getGrokDoctorTimeout(options: DoctorOptions): number {
  return options.grokLive ? 600_000 : 180_000
}

export function validateIntelligenceDoctorConfig(config: any): string[] {
  const expected: Record<string, unknown> = {
    provider: 'grok-cli',
    transport: 'acp',
    legacy_search_provider: 'grok-search-mcp',
    allow_provider_fallback: false,
  }
  const errors = Object.entries(expected)
    .filter(([name, value]) => config?.[name] !== value)
    .map(([name, value]) => `${name} must be ${String(value)}`)
  if (!['browser_oauth', 'api_key'].includes(config?.auth_mode))
    errors.push('auth_mode must be browser_oauth or api_key')
  return errors
}

interface CapturedProcess {
  ok: boolean
  stdout: string
  stderr: string
}

export function formatGrokDoctorFailure(value: string): string {
  return String(value || 'Unknown Grok doctor failure')
    .replace(/((?:api[_-]?key|token|authorization)\s*[:=]\s*)\S+/gi, '$1[REDACTED]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\bxai-[A-Za-z0-9_-]+/g, '[REDACTED]')
    .trim()
    .slice(0, 400)
}

function execFileCaptured(command: string, args: string[], timeout = 60_000): CapturedProcess {
  try {
    return {
      ok: true,
      stdout: execFileSync(command, args, { stdio: 'pipe', timeout, encoding: 'utf8', cwd: process.cwd() }).trim(),
      stderr: '',
    }
  }
  catch (error: any) {
    return {
      ok: false,
      stdout: String(error?.stdout || '').trim(),
      stderr: [error?.stderr, error?.message].filter(Boolean).map(String).join('\n').trim(),
    }
  }
}

async function grokManagerPath(): Promise<string> {
  const installed = join(homedir(), '.claude', '.ccg', 'engine', 'tools', 'grok-intelligence', 'manage.mjs')
  if (await fs.pathExists(installed)) return installed
  return join(PACKAGE_ROOT, 'templates', 'engine', 'tools', 'grok-intelligence', 'manage.mjs')
}

async function inspectCodexOwnership(
  codexHome: string,
  installedVersion: string | null,
  agentsContent: string | null,
): Promise<{ valid: boolean, detail: string }> {
  const ownershipPath = join(codexHome, '.ccg', 'ownership.json')
  if (!(await fileExists(ownershipPath)))
    return { valid: false, detail: `Not found (${ownershipPath})` }

  let ownership
  try {
    await assertManagedPath(codexHome, '.ccg/ownership.json', 'file')
    ownership = validateOwnershipManifest(await fs.readJSON(ownershipPath))
  }
  catch (error) {
    return { valid: false, detail: `Malformed (${String(error)})` }
  }

  const issues: string[] = []
  const notes: string[] = []
  const files = Array.isArray(ownership?.files) ? ownership.files : []
  if (ownership?.schemaVersion !== 1)
    issues.push('unsupported schema')
  if (ownership?.version !== packageVersion || ownership?.version !== installedVersion)
    issues.push('version does not match marker/package')
  if (files.length === 0)
    issues.push('managed file list is empty')

  const agentsBlock = agentsContent ? codexManagedAgentsBlock(agentsContent) : null
  if (!agentsBlock || typeof ownership?.agentsBlock?.sha256 !== 'string') {
    issues.push('AGENTS ownership is incomplete')
  }
  else if (sha256(agentsBlock) !== ownership.agentsBlock.sha256) {
    issues.push('AGENTS managed block digest mismatch')
  }

  const hookEvent = ownership?.hookGroup?.event
  const hookValue = ownership?.hookGroup?.value
  const hookDigest = ownership?.hookGroup?.sha256
  if (typeof hookEvent !== 'string' || !hookValue || typeof hookValue !== 'object' || typeof hookDigest !== 'string') {
    issues.push('hook ownership is incomplete')
  }
  else {
    if (sha256(JSON.stringify(hookValue)) !== hookDigest)
      issues.push('hook ownership digest mismatch')
    try {
      await assertManagedPath(codexHome, 'hooks.json', 'file')
      const hooks = await fs.readJSON(join(codexHome, 'hooks.json'))
      const groups = hooks?.hooks?.[hookEvent]
      if (!Array.isArray(groups) || !groups.some((group: unknown) => JSON.stringify(group) === JSON.stringify(hookValue)))
        issues.push('managed hook group is missing or modified')
    }
    catch {
      issues.push('hooks.json is missing or malformed')
    }
  }

  const managedPaths = new Set<string>()
  for (const file of files) {
    const relativePath = file?.relativePath
    const installedSha256 = file?.installedSha256
    if (typeof relativePath !== 'string' || typeof installedSha256 !== 'string') {
      issues.push('managed file entry is malformed')
      continue
    }
    if (managedPaths.has(relativePath)) {
      issues.push(`duplicate managed path: ${relativePath}`)
      continue
    }
    managedPaths.add(relativePath)
    try {
      const target = await assertManagedPath(codexHome, relativePath, 'file')
      if (!(await fileExists(target))) {
        issues.push(`managed file missing: ${relativePath}`)
        continue
      }
      if (sha256(await fs.readFile(target)) !== installedSha256) {
        if (relativePath === 'ccg/config.toml') {
          try {
            if (!(await readCcgConfigAt(target)))
              issues.push('mutable CCG config is missing')
            else
              notes.push('mutable CCG config differs from the installed template and will be preserved')
          }
          catch {
            issues.push('mutable CCG config is malformed')
          }
        }
        else {
          issues.push(`managed file digest mismatch: ${relativePath}`)
        }
      }
    }
    catch {
      issues.push(`managed file unreadable: ${relativePath}`)
    }
  }

  const wrapperName = process.platform === 'win32' ? 'codeagent-wrapper.exe' : 'codeagent-wrapper'
  for (const requiredPath of [
    '.ccg-version',
    'ccg/config.toml',
    `ccg/bin/${wrapperName}`,
    'hooks/ccg-workflow.py',
  ]) {
    if (!managedPaths.has(requiredPath))
      issues.push(`ownership missing required path: ${requiredPath}`)
  }
  if (![...managedPaths].some(path => /^agents\/[^/]+\.toml$/u.test(path.replace(/\\/g, '/'))))
    issues.push('ownership missing agent definitions')

  return {
    valid: issues.length === 0,
    detail: issues.length === 0
      ? `v${String(ownership.version)}, ${files.length} managed files; ownership digests verified${
        notes.length === 0 ? '' : `; ${notes.join('; ')}`
      }`
      : issues.join('; '),
  }
}

async function doctorCodex(): Promise<DoctorResult> {
  const codexHome = resolveCodexHome()
  const checks: DoctorCheck[] = []

  const nodeVer = process.version
  const major = Number.parseInt(nodeVer.slice(1))
  checks.push({
    label: 'Node.js',
    status: major >= 20 ? OK : FAIL,
    detail: `${nodeVer}${major < 20 ? ' (requires >=20)' : ''}`,
  })

  const agentsPath = join(codexHome, 'AGENTS.md')
  let agentsDetail = `Not found (${agentsPath})`
  let agentsContent: string | null = null
  let hasManagedAgents = false
  if (await fileExists(agentsPath)) {
    try {
      await assertManagedPath(codexHome, 'AGENTS.md', 'file')
      agentsContent = await fs.readFile(agentsPath, 'utf8')
      hasManagedAgents = codexManagedAgentsBlock(agentsContent) !== null
      agentsDetail = hasManagedAgents ? 'Managed CCG block installed' : 'Missing or malformed managed CCG block'
    }
    catch (error) {
      agentsDetail = `Unreadable (${String(error)})`
    }
  }
  checks.push({
    label: 'Codex AGENTS.md',
    status: hasManagedAgents ? OK : FAIL,
    detail: agentsDetail,
  })

  const versionPath = join(codexHome, '.ccg-version')
  let installedVersion: string | null = null
  if (await fileExists(versionPath)) {
    try {
      await assertManagedPath(codexHome, '.ccg-version', 'file')
      installedVersion = (await fs.readFile(versionPath, 'utf8')).trim()
    }
    catch {}
  }
  const versionMatches = installedVersion === packageVersion
  checks.push({
    label: 'Codex version',
    status: versionMatches ? OK : FAIL,
    detail: installedVersion
      ? `v${installedVersion}${versionMatches ? '' : ` (expected v${packageVersion})`}`
      : `Not found (${versionPath})`,
  })

  const ownership = await inspectCodexOwnership(codexHome, installedVersion, agentsContent)
  checks.push({
    label: 'Codex ownership',
    status: ownership.valid ? OK : FAIL,
    detail: ownership.detail,
  })

  const wrapperName = process.platform === 'win32' ? 'codeagent-wrapper.exe' : 'codeagent-wrapper'
  const wrapperPath = join(codexHome, 'ccg', 'bin', wrapperName)
  const wrapperExists = await fileExists(wrapperPath)
  const wrapperValid = wrapperExists && await verifyBinaryVersion(join(codexHome, 'ccg'))
  checks.push({
    label: 'Codex wrapper',
    status: wrapperValid ? OK : FAIL,
    detail: wrapperValid
      ? `Pinned SHA-256 and version v${EXPECTED_BINARY_VERSION} verified`
      : wrapperExists
        ? `Pinned SHA-256 or version check failed (expected v${EXPECTED_BINARY_VERSION})`
        : `Not found (${wrapperPath})`,
  })

  const transactionPath = join(codexHome, '.ccg', 'transaction.json')
  const hasPendingTransaction = await fileExists(transactionPath)
  checks.push({
    label: 'Codex transaction',
    status: hasPendingTransaction ? FAIL : OK,
    detail: hasPendingTransaction
      ? 'Interrupted operation found; run `ccg codex-mode recover`'
      : 'No interrupted operation',
  })

  const ccgConfigPath = join(codexHome, 'ccg', 'config.toml')
  let codexConfig: Awaited<ReturnType<typeof readCcgConfigAt>> = null
  let routingError: string | null = null
  try {
    codexConfig = await readCcgConfigAt(ccgConfigPath)
  }
  catch (error) {
    routingError = error instanceof Error ? error.message : String(error)
  }
  const routeRows = routingStatusRows(codexConfig?.routing)
  checks.push({
    label: 'CCG role routing',
    status: codexConfig && !routingError ? OK : FAIL,
    detail: routingError || (codexConfig
      ? routeRows.map(row => `${row.role}=${row.provider}`).join(', ')
      : `Not found (${ccgConfigPath})`),
  })
  const productManagerProvider = codexConfig?.routing?.['product-manager']?.primary
  const productManagerImplemented = Boolean(
    productManagerProvider
    && IMPLEMENTED_PRODUCT_MANAGER_PROVIDERS.includes(productManagerProvider as ProductManagerProvider),
  )
  const productManagerRuntime = productManagerProvider === 'claude'
    ? Boolean(resolveClaudeExecutable())
    : productManagerProvider === 'gemini'
      ? Boolean(resolveGeminiEntrypoint())
      : productManagerProvider === 'codex'
  checks.push({
    label: 'Product manager route',
    status: productManagerImplemented && productManagerRuntime ? OK : FAIL,
    detail: productManagerProvider
      ? `${productManagerProvider}${
        !productManagerImplemented
          ? '; adapter unavailable, no fallback'
          : productManagerRuntime
            ? '; read-only adapter and runtime available'
            : '; selected runtime unavailable, no fallback'
      }`
      : 'No unified product-manager route',
  })

  const routedProviders = new Set<ModelType>(
    STANDARD_ROUTING_ROLES
      .filter(role => role !== 'product-manager')
      .flatMap((role) => {
        const route = codexConfig?.routing?.[role]
        return [route?.primary, ...(route?.models || [])]
      })
      .filter((provider): provider is ModelType => Boolean(provider)),
  )
  for (const provider of routedProviders) {
    const command = providerCliCommand(provider)
    if (!command)
      continue
    const available = commandAvailable(command)
    checks.push({
      label: `Provider CLI (${provider})`,
      status: available ? OK : FAIL,
      detail: available ? `${command} available on PATH` : `${command} not found; selected route cannot execute`,
    })
  }

  console.log()
  console.log(ansis.cyan.bold(`  CCG Doctor (Codex) v${packageVersion}`))
  console.log()
  for (const { label, status, detail } of checks)
    console.log(`  ${status} ${ansis.bold(label.padEnd(20))} ${ansis.gray(detail)}`)

  const failures = checks.filter(check => check.status === FAIL)
  console.log()
  if (failures.length === 0) {
    console.log(ansis.green('  All Codex checks passed.'))
  }
  else {
    const invalidRole = routingError?.match(/not supported for role ([a-z-]+);/u)?.[1]
    const routingRepair = invalidRole && isRoutingRole(invalidRole)
      ? `ccg routing set ${invalidRole} ${createDefaultRoleRouting()[invalidRole].primary}`
      : null
    const repairCommand = hasPendingTransaction
      ? 'ccg codex-mode recover'
      : routingRepair || 'ccg codex-mode install'
    console.log(ansis.red(`  ${failures.length} issue(s) found. Run ${ansis.cyan(repairCommand)}, then rerun this check.`))
  }
  console.log()
  return {
    ok: failures.length === 0,
    failures,
    checks,
  }
}

function unsupportedDoctorPlatform(platform: string): DoctorResult {
  const checks: DoctorCheck[] = [{
    label: 'Platform',
    status: FAIL,
    detail: `Unsupported platform "${platform}". Expected "claude" or "codex".`,
  }]
  console.log()
  console.log(ansis.cyan.bold(`  CCG Doctor v${packageVersion}`))
  console.log()
  console.log(`  ${FAIL} ${ansis.bold('Platform'.padEnd(20))} ${ansis.gray(checks[0].detail)}`)
  console.log()
  console.log(ansis.red(`  Use ${ansis.cyan('--platform claude')} or ${ansis.cyan('--platform codex')}.`))
  console.log()
  return {
    ok: false,
    failures: checks,
    checks,
  }
}

export async function doctor(options: DoctorOptions = {}): Promise<DoctorResult> {
  if (options.platform === 'codex')
    return doctorCodex()
  if (options.platform && options.platform !== 'claude')
    return unsupportedDoctorPlatform(String(options.platform))

  const installDir = join(homedir(), '.claude')
  const checks: DoctorCheck[] = []

  // 1. Node version
  const nodeVer = process.version
  const major = Number.parseInt(nodeVer.slice(1))
  checks.push({
    label: 'Node.js',
    status: major >= 20 ? OK : FAIL,
    detail: `${nodeVer}${major < 20 ? ' (requires >=20)' : ''}`,
  })

  // 2. CCG config
  const config = await readCcgConfig()
  checks.push({
    label: 'CCG config',
    status: config ? OK : WARN,
    detail: config ? `v${config.general?.version || '?'}, lang=${config.general?.language || '?'}` : 'Not found (~/.claude/.ccg/config.toml)',
  })

  // 3. Commands
  const cmds = await dirFiles(join(installDir, 'commands', 'ccg'))
  const cmdCount = cmds.filter(f => f.endsWith('.md')).length
  checks.push({
    label: 'Commands',
    status: cmdCount > 0 ? OK : FAIL,
    detail: `${cmdCount} installed`,
  })

  // 4. Hooks
  const hookDir = join(installDir, 'hooks', 'ccg')
  const hooks = await dirFiles(hookDir)
  const hookCount = hooks.filter(f => f.endsWith('.js')).length
  checks.push({
    label: 'Hooks',
    status: hookCount >= 4 ? OK : hookCount > 0 ? WARN : FAIL,
    detail: `${hookCount}/5 scripts`,
  })

  // 5. Hooks registered in settings.json
  let hooksRegistered = 0
  const settingsPath = join(installDir, 'settings.json')
  if (await fileExists(settingsPath)) {
    try {
      const settings = await fs.readJSON(settingsPath)
      const hooksConfig = settings.hooks || {}
      for (const entries of Object.values(hooksConfig) as any[]) {
        for (const entry of (Array.isArray(entries) ? entries : [])) {
          const cmds = (entry?.hooks || []) as any[]
          if (cmds.some((h: any) => typeof h?.command === 'string' && h.command.includes('hooks/ccg/'))) {
            hooksRegistered++
          }
        }
      }
    }
    catch { /* ignore */ }
  }
  checks.push({
    label: 'Hook registration',
    status: hooksRegistered >= 3 ? OK : hooksRegistered > 0 ? WARN : FAIL,
    detail: `${hooksRegistered} events in settings.json`,
  })

  // 6. Binary
  const wrapperName = process.platform === 'win32' ? 'codeagent-wrapper.exe' : 'codeagent-wrapper'
  const wrapperPath = join(installDir, 'bin', wrapperName)
  let binaryVer: string | null = null
  const binaryExists = await fileExists(wrapperPath)
  if (binaryExists && await verifyBinaryVersion(installDir))
    binaryVer = EXPECTED_BINARY_VERSION
  checks.push({
    label: 'Binary',
    status: binaryVer ? OK : FAIL,
    detail: binaryVer
      ? `v${binaryVer}; pinned digest verified`
      : binaryExists
        ? `Integrity/version mismatch (${wrapperPath})`
        : `Not found (${wrapperPath})`,
  })

  // 7. Skills
  const skillDir = join(installDir, 'skills', 'ccg')
  const hasSkills = await fileExists(skillDir)
  checks.push({
    label: 'Skills',
    status: hasSkills ? OK : WARN,
    detail: hasSkills ? 'Installed' : 'Not found',
  })

  // 8. Rules
  const rulesDir = join(installDir, 'rules')
  const rules = (await dirFiles(rulesDir)).filter(f => f.startsWith('ccg-'))
  checks.push({
    label: 'Rules',
    status: rules.length >= 2 ? OK : rules.length > 0 ? WARN : FAIL,
    detail: rules.length > 0 ? rules.join(', ') : 'None',
  })

  // 9. MCP servers
  const claudeJsonPath = join(homedir(), '.claude.json')
  let mcpServers: string[] = []
  if (await fileExists(claudeJsonPath)) {
    try {
      const cj = await fs.readJSON(claudeJsonPath)
      mcpServers = Object.keys(cj.mcpServers || {})
    }
    catch { /* ignore */ }
  }
  checks.push({
    label: 'MCP servers',
    status: mcpServers.length > 0 ? OK : WARN,
    detail: mcpServers.length > 0 ? mcpServers.join(', ') : 'None configured',
  })

  if (options.grok || options.grokLive) {
    const configErrors = validateIntelligenceDoctorConfig(config?.intelligence)
    checks.push({
      label: 'Grok policy config',
      status: configErrors.length === 0 ? OK : FAIL,
      detail: configErrors.length === 0 ? 'grok-cli / ACP / strict no-fallback' : configErrors.join('; '),
    })
    if (mcpServers.some(name => name.toLowerCase() === 'grok-search')) {
      checks.push({
        label: 'Grok provider conflict',
        status: WARN,
        detail: 'Legacy grok-search MCP is configured; intelligence remains pinned to official Grok ACP. It was not removed.',
      })
    }
    const manager = await grokManagerPath()
    const execution = execFileCaptured(process.execPath, [manager, ...buildGrokDoctorArguments(options, config?.intelligence)], getGrokDoctorTimeout(options))
    let result: any = null
    try {
      result = execution.stdout ? JSON.parse(execution.stdout) : null
    }
    catch {}
    checks.push({
      label: options.grokLive ? 'Grok live Web/X' : 'Grok local ACP',
      status: result?.ok === true ? OK : FAIL,
      detail: result?.ok === true
        ? `${result.version}; auth=${result.authMethod}; paidPrompt=${String(result.paidModelPromptSent)}`
        : formatGrokDoctorFailure(execution.stderr),
    })
    if (result?.retention) {
      checks.push({
        label: 'Grok retention',
        status: result.retention.oversizedBundles > 0 || result.retention.invalidCanonicalPointers > 0 ? WARN : OK,
        detail: `${result.retention.bundles} bundles, ${result.retention.expiredBundles} expired, ${result.retention.oversizedBundles} oversized, ${result.retention.invalidCanonicalPointers} invalid pointers, ${result.retention.orphanPrivateRoots} orphan roots${options.grokCleanup ? ' (cleanup requested)' : ''}`,
      })
    }
  }

  // 10. Codex mode
  const codexAgentsMd = join(homedir(), '.codex', 'AGENTS.md')
  const hasCodexMode = await fileExists(codexAgentsMd)
  checks.push({
    label: 'Codex mode',
    status: hasCodexMode ? OK : ansis.gray('—'),
    detail: hasCodexMode ? 'Installed' : 'Not installed (optional)',
  })
  const codexTransaction = join(
    homedir(),
    '.codex',
    '.ccg',
    'transaction.json',
  )
  const hasPendingCodexTransaction = await fileExists(codexTransaction)
  checks.push({
    label: 'Codex transaction',
    status: hasPendingCodexTransaction ? FAIL : OK,
    detail: hasPendingCodexTransaction
      ? 'Interrupted operation found; run `ccg codex-mode recover`'
      : 'No interrupted operation',
  })

  // 12. Grok CLI (only when routing uses grok)
  const routingModels = collectRoutingModels(config?.routing)
  if (routingModels.includes('grok')) {
    const grokName = process.platform === 'win32' ? 'grok.exe' : 'grok'
    const grokFallback = join(homedir(), '.grok', 'bin', grokName)
    const grokVer = execFileSafe('grok', ['--version'])
      || (await fileExists(grokFallback) ? execFileSafe(grokFallback, ['--version']) : null)
    const grokAuth = await fileExists(join(homedir(), '.grok', 'auth.json'))
    checks.push({
      label: 'Grok CLI',
      status: grokVer ? (grokAuth ? OK : WARN) : FAIL,
      detail: grokVer
        ? `${grokVer.split('\n')[0]}${grokAuth ? '' : ' — not logged in (run: grok login; tokens expire after 7 days)'}`
        : 'Not found — install: curl -fsSL https://x.ai/cli/install.sh | bash',
    })
  }

  // Output
  console.log()
  console.log(ansis.cyan.bold(`  CCG Doctor v${packageVersion}`))
  console.log()
  for (const { label, status, detail } of checks) {
    console.log(`  ${status} ${ansis.bold(label.padEnd(20))} ${ansis.gray(detail)}`)
  }

  const failures = checks.filter(c => c.status === FAIL)
  console.log()
  if (failures.length === 0) {
    console.log(ansis.green('  All checks passed.'))
  }
  else {
    console.log(ansis.red(`  ${failures.length} issue(s) found. Run ${ansis.cyan('ccg init --force')} to reinstall.`))
  }
  console.log()
  return {
    ok: failures.length === 0,
    failures,
    checks,
  }
}

export async function status(): Promise<void> {
  const installDir = join(homedir(), '.claude')

  // Version
  const config = await readCcgConfig()
  const installedVer = config?.general?.version || 'unknown'
  const latestVer = packageVersion

  // Commands
  const cmds = (await dirFiles(join(installDir, 'commands', 'ccg'))).filter(f => f.endsWith('.md'))

  // Hooks
  const hooks = (await dirFiles(join(installDir, 'hooks', 'ccg'))).filter(f => f.endsWith('.js'))

  // Binary
  const wrapperName = process.platform === 'win32' ? 'codeagent-wrapper.exe' : 'codeagent-wrapper'
  const wrapperPath = join(installDir, 'bin', wrapperName)
  let binaryVer = '—'
  if (await fileExists(wrapperPath) && await verifyBinaryVersion(installDir))
    binaryVer = `v${EXPECTED_BINARY_VERSION}`

  // Model routing
  const roleRows = routingStatusRows(config?.routing)

  // MCP
  let mcpServers: string[] = []
  const claudeJsonPath = join(homedir(), '.claude.json')
  if (await fileExists(claudeJsonPath)) {
    try {
      const cj = await fs.readJSON(claudeJsonPath)
      mcpServers = Object.keys(cj.mcpServers || {})
    }
    catch { /* ignore */ }
  }

  // Active tasks
  let activeTasks = 0
  const tasksDir = join(process.cwd(), '.ccg', 'tasks')
  if (await fileExists(tasksDir)) {
    for (const d of await fs.readdir(tasksDir)) {
      if (d === 'archive') continue
      const taskJson = join(tasksDir, d, 'task.json')
      if (await fileExists(taskJson)) {
        try {
          const t = await fs.readJSON(taskJson)
          const s = String(t.status || '').toLowerCase()
          if (!['completed', 'complete', 'done', 'finished', 'archived', 'cancelled', 'closed'].includes(s)) {
            activeTasks++
          }
        }
        catch { /* ignore */ }
      }
    }
  }

  // Codex mode
  const codexMode = await fileExists(join(homedir(), '.codex', 'AGENTS.md'))

  // Output
  console.log()
  console.log(ansis.cyan.bold('  CCG Status'))
  console.log()
  console.log(`  ${ansis.bold('Version')}        ${installedVer}${installedVer !== latestVer ? ansis.yellow(` (latest: ${latestVer})`) : ansis.green(' (up to date)')}`)
  console.log(`  ${ansis.bold('Commands')}       ${cmds.length}`)
  console.log(`  ${ansis.bold('Hooks')}          ${hooks.length} scripts`)
  console.log(`  ${ansis.bold('Binary')}         ${binaryVer}`)
  for (const row of roleRows)
    console.log(`  ${ansis.bold(row.role.padEnd(15))} ${row.provider}`)
  console.log(`  ${ansis.bold('MCP')}            ${mcpServers.length > 0 ? mcpServers.join(', ') : ansis.gray('none')}`)
  console.log(`  ${ansis.bold('Codex mode')}     ${codexMode ? 'installed' : ansis.gray('not installed')}`)
  console.log(`  ${ansis.bold('Active tasks')}   ${activeTasks > 0 ? ansis.yellow(String(activeTasks)) : '0'}`)
  console.log()
}
