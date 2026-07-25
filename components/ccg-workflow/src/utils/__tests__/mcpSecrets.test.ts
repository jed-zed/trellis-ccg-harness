import { spawnSync } from 'node:child_process'
import { constants } from 'node:fs'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as installerMcp from '../installer-mcp'
import * as secretStore from '../mcp-secrets'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('MCP credential boundaries', () => {
  it('stores one owner-only secret spec and returns a non-secret launcher reference', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'ccg secret home '))
    roots.push(homeDir)
    const secret = 'test-secret-never-copy'

    const config = await (secretStore as any).createSecretBackedMcpConfig({
      homeDir,
      serverId: 'fast-context',
      command: 'npx',
      args: ['-y', 'fast-context-mcp@1.5.2'],
      env: { WINDSURF_API_KEY: secret },
    })

    expect(JSON.stringify(config)).not.toContain(secret)
    expect(config.command).toBeTruthy()
    expect(config.args?.length).toBeGreaterThan(0)

    const secretPath = join(homeDir, '.claude', '.ccg', 'secrets', 'fast-context.json')
    expect(await readFile(secretPath, 'utf8')).toContain(secret)
    const launcherText = await readFile(
      join(homeDir, '.claude', '.ccg', 'engine', 'tools', 'mcp-secret-launcher.mjs'),
      'utf8',
    )
    expect(launcherText).toMatch(/Get-Acl/)
    expect(launcherText).toMatch(/taskkill\.exe/)
    expect(launcherText).toMatch(/process\.kill\(-pid,\s*signal\)/)
    expect(launcherText).toMatch(/detached:\s*process\.platform\s*!==\s*['"]win32['"]/)

    if (process.platform !== 'win32') {
      const secretMode = (await stat(secretPath)).mode & 0o777
      const directoryMode = (await stat(join(homeDir, '.claude', '.ccg', 'secrets'))).mode & 0o777
      expect(secretMode).toBe(constants.S_IRUSR | constants.S_IWUSR)
      expect(directoryMode).toBe(constants.S_IRWXU)
    }
  }, 180_000)

  it('launcher passes only its approved secret environment to the MCP child', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'ccg isolated launcher '))
    roots.push(homeDir)
    const approvedSecret = 'approved-launcher-secret'
    const unrelatedSecret = 'must-not-reach-mcp'
    const config = await (secretStore as any).createSecretBackedMcpConfig({
      homeDir,
      serverId: 'environment-test',
      command: process.execPath,
      args: [
        '-e',
        'process.stdout.write(JSON.stringify({ approved: process.env.APPROVED_SECRET, unrelated: process.env.UNRELATED_SECRET || null }))',
      ],
      env: { APPROVED_SECRET: approvedSecret },
    })
    const result = spawnSync(config.command, config.args, {
      encoding: 'utf8',
      windowsHide: true,
      env: {
        ...process.env,
        HOME: homeDir,
        USERPROFILE: homeDir,
        UNRELATED_SECRET: unrelatedSecret,
      },
    })

    expect(result.status, String(result.stderr)).toBe(0)
    expect(JSON.parse(String(result.stdout))).toEqual({
      approved: approvedSecret,
      unrelated: null,
    })
    expect(String(result.stdout)).not.toContain(unrelatedSecret)
  }, 30_000)

  it.runIf(process.platform === 'win32')('applies an owner-only Windows ACL to the secret directory', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'ccg secret acl '))
    roots.push(homeDir)
    await (secretStore as any).createSecretBackedMcpConfig({
      homeDir,
      serverId: 'acl-test',
      command: 'npx',
      args: ['-y', 'tool@1.0.0'],
      env: { API_KEY: 'test-only-secret' },
    })
    const secretDir = join(homeDir, '.claude', '.ccg', 'secrets')
    const shell = process.env.SystemRoot
      ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
      : 'powershell.exe'
    const script = [
      '$ErrorActionPreference = "Stop"',
      '$targetPath = [Console]::In.ReadToEnd().TrimEnd("`r", "`n")',
      '$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()',
      '$sidType = [System.Security.Principal.SecurityIdentifier]',
      '$acl = Get-Acl -LiteralPath $targetPath',
      '$access = @($acl.Access | ForEach-Object { [pscustomobject]@{ sid = $_.IdentityReference.Translate($sidType).Value; inherited = $_.IsInherited; type = $_.AccessControlType.ToString() } })',
      '[pscustomobject]@{ currentSid = $identity.User.Value; access = $access } | ConvertTo-Json -Depth 4 -Compress',
    ].join('; ')
    const result = spawnSync(shell, [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      script,
    ], {
      encoding: 'utf8',
      input: secretDir,
      windowsHide: true,
      env: Object.fromEntries(Object.entries({
        SystemRoot: process.env.SystemRoot,
        WINDIR: process.env.WINDIR,
        ComSpec: process.env.ComSpec,
        PATH: process.env.PATH,
        PATHEXT: process.env.PATHEXT,
      }).filter(([, value]) => typeof value === 'string' && value.length > 0)),
    })
    expect(result.status, String(result.stderr)).toBe(0)
    const acl = JSON.parse(String(result.stdout).replace(/^\uFEFF/, '').trim())
    const access = Array.isArray(acl.access)
      ? acl.access
      : acl.access
        ? [acl.access]
        : []
    expect(access.length, JSON.stringify(acl)).toBeGreaterThan(0)
    expect(access.every((entry: any) => (
      entry.sid === acl.currentSid
      && entry.inherited === false
      && entry.type === 'Allow'
    ))).toBe(true)
  }, 180_000)

  it.runIf(process.platform === 'win32')('rechecks the Windows ACL before launching an MCP child', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'ccg secret launch acl '))
    roots.push(homeDir)
    const marker = join(homeDir, 'child-started.txt')
    const config = await (secretStore as any).createSecretBackedMcpConfig({
      homeDir,
      serverId: 'launch-acl-test',
      command: process.execPath,
      args: [
        '-e',
        `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started\\n')`,
      ],
      env: { API_KEY: 'test-only-secret' },
    })
    const secretDir = join(homeDir, '.claude', '.ccg', 'secrets')
    const aclResult = spawnSync('icacls.exe', [
      secretDir,
      '/grant',
      '*S-1-1-0:(OI)(CI)R',
    ], {
      encoding: 'utf8',
      windowsHide: true,
      shell: false,
    })
    expect(aclResult.status, String(aclResult.stderr)).toBe(0)

    const result = spawnSync(config.command, config.args, {
      encoding: 'utf8',
      windowsHide: true,
      env: {
        ...process.env,
        HOME: homeDir,
        USERPROFILE: homeDir,
      },
    })
    expect(result.status).not.toBe(0)
    expect(String(result.stderr)).toMatch(/ACL|permission/i)
    await expect(readFile(marker, 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
  }, 180_000)

  it('signals the complete MCP child tree on Unix and Windows', async () => {
    const launcher = await import(pathToFileURL(join(
      process.cwd(),
      'templates',
      'engine',
      'tools',
      'mcp-secret-launcher.mjs',
    )).href)
    const child = {
      pid: 4321,
      exitCode: null,
      signalCode: null,
      kill: vi.fn(),
    }
    const groupSignals: Array<[number, string]> = []
    launcher.signalProcessTree(child, 'SIGTERM', {
      platform: 'linux',
      killGroup: (pid: number, signal: string) => {
        groupSignals.push([pid, signal])
      },
    })
    expect(groupSignals).toEqual([[-4321, 'SIGTERM']])
    expect(child.kill).not.toHaveBeenCalled()

    const taskkill = vi.fn(() => ({ status: 0, error: null }))
    launcher.signalProcessTree(child, 'SIGTERM', {
      platform: 'win32',
      runTaskkill: taskkill,
    })
    expect(taskkill).toHaveBeenCalledWith([
      '/PID',
      '4321',
      '/T',
      '/F',
    ])
  })

  it('recognizes legacy inline credentials but allows a secret reference config', () => {
    expect((secretStore as any).containsInlineMcpSecret({
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'ace-tool@0.2.3', '--token', 'secret'],
    })).toBe(true)
    expect((secretStore as any).containsInlineMcpSecret({
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'tool@1.0.0'],
      env: { API_KEY: 'secret' },
    })).toBe(true)
    expect((secretStore as any).containsInlineMcpSecret({
      type: 'sse',
      url: 'https://example.invalid/mcp?api_key=secret',
    })).toBe(true)
    expect((secretStore as any).containsInlineMcpSecret({
      type: 'stdio',
      command: 'node',
      args: ['C:/Users/Test/.claude/.ccg/engine/tools/mcp-secret-launcher.mjs', 'C:/Users/Test/.claude/.ccg/secrets/tool.json'],
    })).toBe(false)
  })

  it('does not synchronize legacy MCP entries containing inline secrets', () => {
    const safe = (installerMcp as any).filterSecretSafeMcpServers({
      context7: { type: 'stdio', command: 'npx', args: ['-y', '@upstash/context7-mcp@3.2.4'] },
      legacy: { type: 'stdio', command: 'npx', args: ['tool', '--token', 'secret'] },
      legacyEnv: { type: 'stdio', command: 'npx', args: ['tool'], env: { API_KEY: 'secret' } },
    })
    expect(Object.keys(safe)).toEqual(['context7'])
  })

  it('refuses ace-tool because its supported authentication transport exposes the token in argv', async () => {
    const result = await installerMcp.installAceTool({
      baseUrl: 'https://example.invalid',
      token: 'secret',
    })
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/argv|command line|unsafe|安全/i)
  })
})
