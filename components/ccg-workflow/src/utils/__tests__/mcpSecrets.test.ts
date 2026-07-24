import { spawnSync } from 'node:child_process'
import { constants } from 'node:fs'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
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

    if (process.platform !== 'win32') {
      const secretMode = (await stat(secretPath)).mode & 0o777
      const directoryMode = (await stat(join(homeDir, '.claude', '.ccg', 'secrets'))).mode & 0o777
      expect(secretMode).toBe(constants.S_IRUSR | constants.S_IWUSR)
      expect(directoryMode).toBe(constants.S_IRWXU)
    }
  })

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
  }, 15_000)

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
