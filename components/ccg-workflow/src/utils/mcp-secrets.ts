import type { McpServerConfig } from './mcp'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import fs from 'fs-extra'
import { join } from 'pathe'
import { buildMcpServerConfig } from './mcp'
import { PACKAGE_ROOT } from './installer-template'

interface SecretBackedMcpOptions {
  serverId: string
  command: string
  args: string[]
  env: Record<string, string>
  homeDir?: string
}

interface SecretMcpSpec {
  schemaVersion: 1
  serverId: string
  command: string
  args: string[]
  env: Record<string, string>
}

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

async function ensurePrivateDirectory(path: string): Promise<void> {
  await fs.ensureDir(path, 0o700)
  if (process.platform === 'win32')
    ownerOnlyWindowsAcl(path)
  else
    await fs.chmod(path, 0o700)
}

async function atomicPrivateJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    if (process.platform !== 'win32')
      await fs.chmod(temporary, 0o600)
    await fs.move(temporary, path, { overwrite: true })
    if (process.platform !== 'win32')
      await fs.chmod(path, 0o600)
  }
  finally {
    await fs.remove(temporary)
  }
}

export async function createSecretBackedMcpConfig(
  options: SecretBackedMcpOptions,
): Promise<McpServerConfig> {
  const homeDir = options.homeDir ?? homedir()
  const paths = secretPaths(options.serverId, homeDir)
  await ensurePrivateDirectory(paths.secretsDir)
  await fs.ensureDir(paths.launcherDir)

  const launcherSource = join(
    PACKAGE_ROOT,
    'templates',
    'engine',
    'tools',
    'mcp-secret-launcher.mjs',
  )
  if (!(await fs.pathExists(launcherSource)))
    throw new Error('MCP secret launcher is missing from the trusted CCG package.')

  await fs.copy(launcherSource, paths.launcherPath, { overwrite: true })
  if (process.platform !== 'win32')
    await fs.chmod(paths.launcherPath, 0o700)

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
  await atomicPrivateJson(paths.secretPath, spec)

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
  const { secretPath } = secretPaths(serverId, homeDir)
  await fs.remove(secretPath)
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
