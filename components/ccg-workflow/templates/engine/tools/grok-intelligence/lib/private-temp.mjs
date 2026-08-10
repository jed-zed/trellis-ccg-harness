import { spawnSync } from 'node:child_process'
import { chmod, lstat, mkdir, mkdtemp, readdir, realpath, rm } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { validatePrivateDirectory } from './acp-client.mjs'

export function lockDownWindowsDirectory(path) {
  const shell = process.env.SystemRoot
    ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
    : 'powershell.exe'
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$targetPath = [Console]::In.ReadToEnd()',
    '$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()',
    '$sid = $identity.User',
    '$acl = Get-Acl -LiteralPath $targetPath',
    '$sidType = [System.Security.Principal.SecurityIdentifier]',
    '$ownerSid = ([System.Security.Principal.NTAccount]$acl.Owner).Translate($sidType).Value',
    '$currentOwnerSid = if ($identity.Owner) { $identity.Owner.Value } else { $sid.Value }',
    '$unexpected = @($acl.Access | Where-Object { $_.IdentityReference.Translate($sidType).Value -ne $sid.Value -or $_.AccessControlType.ToString() -ne "Allow" })',
    '$ownerIsCurrent = $ownerSid -eq $sid.Value -or $ownerSid -eq $currentOwnerSid',
    'if (-not ($ownerIsCurrent -and $acl.Access.Count -gt 0 -and $unexpected.Count -eq 0)) {',
    '  $acl.SetAccessRuleProtection($true, $false)',
    '  $otherIdentities = @($acl.Access | Where-Object { $_.IdentityReference.Translate($sidType).Value -ne $sid.Value } | ForEach-Object { $_.IdentityReference } | Sort-Object -Unique)',
    '  foreach ($other in $otherIdentities) { $acl.PurgeAccessRules($other) }',
    '  $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, "FullControl", "ContainerInherit,ObjectInherit", "None", "Allow")',
    '  $acl.SetAccessRule($rule)',
    '  Set-Acl -LiteralPath $targetPath -AclObject $acl',
    '  $acl = Get-Acl -LiteralPath $targetPath',
    '}',
    '$ownerSid = ([System.Security.Principal.NTAccount]$acl.Owner).Translate($sidType).Value',
    '$access = @($acl.Access | ForEach-Object { [pscustomobject]@{ identity = $_.IdentityReference.Value; identitySid = $_.IdentityReference.Translate($sidType).Value; inherited = $_.IsInherited; type = $_.AccessControlType.ToString() } })',
    '[pscustomobject]@{ current = $identity.Name; currentSid = $sid.Value; currentOwnerSid = $currentOwnerSid; owner = $acl.Owner; ownerSid = $ownerSid; access = $access } | ConvertTo-Json -Depth 5 -Compress',
  ].join('; ')
  const result = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    input: path,
    windowsHide: true,
    env: Object.fromEntries(Object.entries({
      SystemRoot: process.env.SystemRoot,
      WINDIR: process.env.WINDIR,
      ComSpec: process.env.ComSpec,
      PATH: process.env.PATH,
      PATHEXT: process.env.PATHEXT,
    }).filter(([, value]) => typeof value === 'string' && value.length > 0)),
  })
  if (result.status !== 0)
    throw new Error(`Unable to create owner-only Windows ACL: ${String(result.stderr).trim()}`)
  return JSON.parse(String(result.stdout).replace(/^\uFEFF/, '').trim())
}

export async function securePrivateDirectory(path, {
  platform = process.platform,
  restrictWindowsAcl = lockDownWindowsDirectory,
  validateDirectory = validatePrivateDirectory,
} = {}) {
  await mkdir(path, { recursive: true, mode: 0o700 })
  await chmod(path, 0o700)
  let windowsAcl
  if (platform === 'win32')
    windowsAcl = await restrictWindowsAcl(path)
  return validateDirectory(path, {
    platform,
    ...(windowsAcl && typeof windowsAcl === 'object'
      ? { inspectWindowsAcl: async () => windowsAcl }
      : {}),
  })
}

async function assertNoReparseTree(path) {
  const metadata = await lstat(path)
  if (metadata.isSymbolicLink())
    throw new Error(`Private cleanup refuses a symbolic link, junction, or reparse point: ${path}`)
  if (!metadata.isDirectory())
    return
  for (const entry of await readdir(path))
    await assertNoReparseTree(resolve(path, entry))
}

async function createPrivateDirectory(path, { platform, restrictWindowsAcl, validateDirectory }) {
  return securePrivateDirectory(path, { platform, restrictWindowsAcl, validateDirectory })
}

export async function removePrivateRunRoot(runRoot, { allowedParent } = {}) {
  if (!isAbsolute(runRoot) || !isAbsolute(allowedParent))
    throw new Error('Private cleanup requires absolute run and parent paths')
  const canonicalParent = await realpath(allowedParent)
  const canonicalRunRoot = await realpath(runRoot)
  const rel = relative(canonicalParent, canonicalRunRoot)
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || !/^ccg-grok-run-[^\\/]+$/i.test(rel))
    throw new Error('Private cleanup target is outside its intended parent')
  await assertNoReparseTree(runRoot)
  await rm(canonicalRunRoot, { recursive: true, force: true })
}

export async function createPrivateRunRoots({
  parent,
  grokHome,
  platform = process.platform,
  restrictWindowsAcl = lockDownWindowsDirectory,
  validateDirectory = validatePrivateDirectory,
} = {}) {
  if (!isAbsolute(parent) || !isAbsolute(grokHome))
    throw new Error('Private temp parent and GROK_HOME must be absolute paths')
  const canonicalParent = await validateDirectory(parent, { platform })
  await validateDirectory(grokHome, { platform })
  const runRoot = await mkdtemp(resolve(canonicalParent, 'ccg-grok-run-'))
  try {
    await chmod(runRoot, 0o700)
    if (platform === 'win32')
      await restrictWindowsAcl(runRoot)
    await validateDirectory(runRoot, { platform })
    const neutralHome = resolve(runRoot, 'neutral-home')
    const snapshotRoot = resolve(runRoot, 'snapshot')
    const rawEventsDir = resolve(runRoot, 'raw')
    for (const path of [neutralHome, snapshotRoot, rawEventsDir])
      await createPrivateDirectory(path, { platform, restrictWindowsAcl, validateDirectory })

    return {
      runRoot: await realpath(runRoot),
      neutralHome: await realpath(neutralHome),
      snapshotRoot: await realpath(snapshotRoot),
      rawEventsDir: await realpath(rawEventsDir),
      grokHome: await realpath(grokHome),
      cleanup: () => removePrivateRunRoot(runRoot, { allowedParent: canonicalParent }),
    }
  }
  catch (error) {
    await removePrivateRunRoot(runRoot, { allowedParent: canonicalParent }).catch(() => {})
    throw error
  }
}
