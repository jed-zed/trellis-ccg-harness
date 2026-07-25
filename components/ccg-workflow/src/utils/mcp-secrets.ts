import type { McpServerConfig } from './mcp'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { basename, isAbsolute, relative, resolve } from 'node:path'
import fs from 'fs-extra'
import { join } from 'pathe'
import { buildMcpServerConfig } from './mcp'
import { PACKAGE_ROOT } from './installer-template'
import {
  assertManagedPath,
  ensureManagedRoot,
  safeManagedAtomicWrite,
  safeManagedEnsureDirectory,
  safeManagedRemoveFile,
} from './managed-path'

interface SecretBackedMcpOptions {
  serverId: string
  command: string
  args: string[]
  env: Record<string, string>
  homeDir?: string
}

export interface SecretMcpSpec {
  schemaVersion: 1
  serverId: string
  command: string
  args: string[]
  env: Record<string, string>
}

export interface ResolvedSecretMcpLaunch {
  command: string
  args: string[]
  env: Record<string, string>
  secrets: string[]
}

const MAX_SECRET_SPEC_BYTES = 1024 * 1024

interface WindowsAclEntry {
  identitySid?: string
  inherited?: boolean
  type?: string
}

interface WindowsAclEvidence {
  currentSid?: string
  currentOwnerSid?: string
  ownerSid?: string
  access?: WindowsAclEntry | WindowsAclEntry[]
}

const OWNER_ONLY_WINDOWS_ACL_SCRIPT = [
  '$ErrorActionPreference = "Stop"',
  '$targetPath = [Console]::In.ReadToEnd()',
  '$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()',
  '$sid = $identity.User',
  '$acl = Get-Acl -LiteralPath $targetPath',
  '$sidType = [System.Security.Principal.SecurityIdentifier]',
  '$acl.SetAccessRuleProtection($true, $false)',
  '$otherIdentities = @($acl.Access | Where-Object { '
  + '$_.IdentityReference.Translate($sidType).Value -ne $sid.Value '
  + '} | ForEach-Object { $_.IdentityReference } | Sort-Object -Unique)',
  'foreach ($other in $otherIdentities) { $acl.PurgeAccessRules($other) }',
  '$rule = [System.Security.AccessControl.FileSystemAccessRule]::new('
  + '$sid, "FullControl", "ContainerInherit,ObjectInherit", "None", "Allow")',
  '$acl.SetAccessRule($rule)',
  'Set-Acl -LiteralPath $targetPath -AclObject $acl',
  '$acl = Get-Acl -LiteralPath $targetPath',
  '$ownerSid = ([System.Security.Principal.NTAccount]$acl.Owner).Translate($sidType).Value',
  '$currentOwnerSid = if ($identity.Owner) { $identity.Owner.Value } else { $sid.Value }',
  '$access = @($acl.Access | ForEach-Object { [pscustomobject]@{ '
  + 'identitySid = $_.IdentityReference.Translate($sidType).Value; '
  + 'inherited = $_.IsInherited; type = $_.AccessControlType.ToString() } })',
  '[pscustomobject]@{ currentSid = $sid.Value; currentOwnerSid = $currentOwnerSid; '
  + 'ownerSid = $ownerSid; access = $access } | ConvertTo-Json -Depth 5 -Compress',
].join('; ')

function assertServerId(serverId: string): void {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(serverId))
    throw new Error(`Unsafe MCP server id: ${serverId}`)
}

function validateSecretMcpSpec(value: unknown): SecretMcpSpec {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('MCP secret specification root must be an object.')
  const spec = value as Partial<SecretMcpSpec>
  if (spec.schemaVersion !== 1)
    throw new Error('MCP secret specification schema is unsupported.')
  assertServerId(String(spec.serverId ?? ''))
  if (typeof spec.command !== 'string' || spec.command.length === 0)
    throw new Error('MCP secret specification command is missing.')
  if (!Array.isArray(spec.args) || spec.args.some(arg => typeof arg !== 'string'))
    throw new Error('MCP secret specification arguments are invalid.')
  if (!spec.env || typeof spec.env !== 'object' || Array.isArray(spec.env))
    throw new Error('MCP secret specification environment is invalid.')
  for (const [key, entry] of Object.entries(spec.env)) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(key) || typeof entry !== 'string')
      throw new Error('MCP secret specification environment entry is invalid.')
  }
  return spec as SecretMcpSpec
}

function secretSpecArgument(config: McpServerConfig): string | null {
  const args = config.args ?? []
  const launcherIndexes = args
    .map((arg, index) => basename(arg) === 'mcp-secret-launcher.mjs' ? index : -1)
    .filter(index => index >= 0)
  if (launcherIndexes.length === 0)
    return null
  if (launcherIndexes.length !== 1)
    throw new Error('MCP secret launcher configuration is ambiguous.')
  const launcherIndex = launcherIndexes[0]
  const direct = config.command === 'node'
    && launcherIndex === 0
    && args.length === 2
  const windowsWrapped = config.command === 'cmd'
    && launcherIndex === 2
    && args.length === 4
    && args[0]?.toLowerCase() === '/c'
    && args[1]?.toLowerCase() === 'node'
  if (!direct && !windowsWrapped)
    throw new Error('MCP secret launcher configuration has an unsafe command shape.')
  return args[launcherIndex + 1]
}

export async function resolveSecretBackedMcpConfig(
  config: McpServerConfig,
  homeDir: string = homedir(),
): Promise<ResolvedSecretMcpLaunch | null> {
  const specPath = secretSpecArgument(config)
  if (specPath === null)
    return null
  if (!specPath || !isAbsolute(specPath))
    throw new Error('MCP secret specification path must be absolute.')
  await ensureManagedRoot(homeDir)
  const relativeSpec = relative(resolve(homeDir), resolve(specPath))
    .replace(/\\/g, '/')
  const managedSpec = await assertManagedPath(
    homeDir,
    relativeSpec,
    'file',
  )
  const metadata = await fs.lstat(managedSpec)
  if (!metadata.isFile() || metadata.isSymbolicLink())
    throw new Error('MCP secret specification must be a regular file.')
  if (metadata.size > MAX_SECRET_SPEC_BYTES)
    throw new Error('MCP secret specification exceeds the size limit.')
  if (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0)
    throw new Error('MCP secret specification permissions must be 0600.')

  const trustedRoot = await fs.realpath(
    resolve(homeDir, '.claude', '.ccg', 'secrets'),
  )
  const canonicalSpec = await fs.realpath(managedSpec)
  const delta = relative(trustedRoot, canonicalSpec)
  if (
    delta === '..'
    || delta.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
    || isAbsolute(delta)
  ) {
    throw new Error('MCP secret specification is outside the trusted directory.')
  }
  const spec = validateSecretMcpSpec(
    JSON.parse(await fs.readFile(canonicalSpec, 'utf8')),
  )
  if (basename(canonicalSpec) !== `${spec.serverId}.json`)
    throw new Error('MCP secret specification filename does not match its server id.')
  return {
    command: spec.command,
    args: [...spec.args],
    env: { ...spec.env },
    secrets: Object.values(spec.env),
  }
}

function secretPaths(serverId: string, homeDir: string): {
  secretsDir: string
  secretPath: string
  launcherDir: string
  launcherPath: string
} {
  assertServerId(serverId)
  const ccgRoot = join(homeDir, '.claude', '.ccg')
  const secretsDir = join(ccgRoot, 'secrets')
  const launcherDir = join(ccgRoot, 'engine', 'tools')
  return {
    secretsDir,
    secretPath: join(secretsDir, `${serverId}.json`),
    launcherDir,
    launcherPath: join(launcherDir, 'mcp-secret-launcher.mjs'),
  }
}

export function mcpSecretSpecPath(
  serverId: string,
  homeDir: string = homedir(),
): string {
  return secretPaths(serverId, homeDir).secretPath
}

function windowsPowerShellPath(): string {
  return process.env.SystemRoot
    ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
    : 'powershell.exe'
}

function restrictedWindowsEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries({
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR,
    ComSpec: process.env.ComSpec,
    PATH: process.env.PATH,
    PATHEXT: process.env.PATHEXT,
  }).filter(([, value]) => typeof value === 'string' && value.length > 0))
}

function parseWindowsAclEvidence(stdout: string): WindowsAclEvidence {
  try {
    return JSON.parse(stdout.replace(/^\uFEFF/, '').trim()) as WindowsAclEvidence
  }
  catch {
    throw new Error('Unable to verify the owner-only Windows ACL for the MCP secret directory.')
  }
}

function hasOwnerOnlyWindowsAcl(evidence: WindowsAclEvidence): boolean {
  const currentSid = String(evidence.currentSid ?? '').toLowerCase()
  const ownerSid = String(evidence.ownerSid ?? '').toLowerCase()
  const allowedOwners = new Set([
    currentSid,
    String(evidence.currentOwnerSid ?? '').toLowerCase(),
  ].filter(Boolean))
  const access = Array.isArray(evidence.access)
    ? evidence.access
    : evidence.access
      ? [evidence.access]
      : []
  return Boolean(currentSid)
    && allowedOwners.has(ownerSid)
    && access.length > 0
    && access.every(entry => (
      String(entry.identitySid ?? '').toLowerCase() === currentSid
      && entry.inherited === false
      && entry.type === 'Allow'
    ))
}

function ownerOnlyWindowsAcl(path: string): void {
  const result = spawnSync(windowsPowerShellPath(), [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    OWNER_ONLY_WINDOWS_ACL_SCRIPT,
  ], {
    encoding: 'utf8',
    input: path,
    windowsHide: true,
    env: restrictedWindowsEnvironment(),
  })
  if (result.status !== 0)
    throw new Error('Unable to apply an owner-only Windows ACL to the MCP secret directory.')

  const evidence = parseWindowsAclEvidence(String(result.stdout))
  if (!hasOwnerOnlyWindowsAcl(evidence))
    throw new Error('Unable to verify the owner-only Windows ACL for the MCP secret directory.')
}

async function ensurePrivateDirectory(
  homeDir: string,
  relativePath: string,
): Promise<string> {
  const path = await safeManagedEnsureDirectory(homeDir, relativePath)
  if (process.platform === 'win32')
    ownerOnlyWindowsAcl(path)
  else
    await fs.chmod(path, 0o700)
  return path
}

export async function createSecretBackedMcpConfig(
  options: SecretBackedMcpOptions,
): Promise<McpServerConfig> {
  const homeDir = options.homeDir ?? homedir()
  const paths = secretPaths(options.serverId, homeDir)
  await ensureManagedRoot(homeDir)
  await ensurePrivateDirectory(homeDir, '.claude/.ccg/secrets')
  await safeManagedEnsureDirectory(homeDir, '.claude/.ccg/engine/tools')

  const launcherSource = join(
    PACKAGE_ROOT,
    'templates',
    'engine',
    'tools',
    'mcp-secret-launcher.mjs',
  )
  if (!(await fs.pathExists(launcherSource)))
    throw new Error('MCP secret launcher is missing from the trusted CCG package.')

  await safeManagedAtomicWrite(
    homeDir,
    '.claude/.ccg/engine/tools/mcp-secret-launcher.mjs',
    await fs.readFile(launcherSource),
    0o700,
  )

  const child = buildMcpServerConfig({
    type: 'stdio',
    command: options.command,
    args: options.args,
  })
  if (!child.command)
    throw new Error('MCP child command is missing.')

  const spec: SecretMcpSpec = {
    schemaVersion: 1,
    serverId: options.serverId,
    command: child.command,
    args: child.args ?? [],
    env: { ...options.env },
  }
  await safeManagedAtomicWrite(
    homeDir,
    `.claude/.ccg/secrets/${options.serverId}.json`,
    `${JSON.stringify(spec, null, 2)}\n`,
  )

  return buildMcpServerConfig({
    type: 'stdio',
    command: 'node',
    args: [paths.launcherPath, paths.secretPath],
  })
}

export async function removeSecretBackedMcpConfig(
  serverId: string,
  homeDir: string = homedir(),
): Promise<void> {
  assertServerId(serverId)
  await ensureManagedRoot(homeDir)
  await safeManagedRemoveFile(
    homeDir,
    `.claude/.ccg/secrets/${serverId}.json`,
  )
}

function containsCredentialUrl(value: string): boolean {
  return /https?:\/\/[^/\s:@]+:[^@\s/]+@/i.test(value)
    || /[?&](?:api[_-]?key|access[_-]?token|token|secret|password)=/i.test(value)
}

function containsSensitiveArgument(arg: string): boolean {
  return /^--?(?:api[_-]?key|access[_-]?token|token|secret|password)(?:=|$)/i.test(arg)
    || /^(?:sk|xai|ghp|github_pat)-[a-z0-9_-]{8,}$/i.test(arg)
    || containsCredentialUrl(arg)
}

export function containsInlineMcpSecret(config: McpServerConfig): boolean {
  const hasEnvironmentSecret = Object.keys(config.env ?? {}).length > 0
  const hasUrlSecret = Boolean(config.url && containsCredentialUrl(config.url))
  const hasArgumentSecret = (config.args ?? []).some(containsSensitiveArgument)
  return [hasEnvironmentSecret, hasUrlSecret, hasArgumentSecret].some(Boolean)
}
