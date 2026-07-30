import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  installMcpServer,
  installRemoteMcpServer,
  syncMcpToCodex,
  syncMcpToGemini,
  uninstallMcpServer,
} from '../installer-mcp'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(root => rm(root, { recursive: true, force: true })),
  )
})

async function isolatedHome(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ccg mcp integration '))
  roots.push(root)
  return root
}

describe('MCP ownership integration', () => {
  it('refuses a Claude collision, then explicit adoption restores the original', async () => {
    const homeDir = await isolatedHome()
    const configPath = join(homeDir, '.claude.json')
    const original = {
      mcpServers: {
        context7: {
          type: 'stdio',
          command: 'user-context7',
          args: ['--user'],
        },
      },
      untouched: true,
    }
    const originalBytes = `${JSON.stringify(original, null, 2)}\n`
    await writeFile(configPath, originalBytes)

    const refused = await installMcpServer(
      'context7',
      'node',
      ['ccg-context7.mjs'],
      {},
      { homeDir },
    )
    expect(refused.success).toBe(false)
    expect(refused.message).toMatch(/collision|unowned|adopt/i)
    expect(await readFile(configPath, 'utf8')).toBe(originalBytes)

    const adopted = await installMcpServer(
      'context7',
      'node',
      ['ccg-context7.mjs'],
      {},
      { homeDir, adoptExisting: true },
    )
    expect(adopted.success).toBe(true)

    const removed = await uninstallMcpServer('context7', { homeDir })
    expect(removed.success).toBe(true)
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual(original)
  })

  it('preserves a post-install Claude edit and refuses uninstall', async () => {
    const homeDir = await isolatedHome()
    const configPath = join(homeDir, '.claude.json')
    const installed = await installMcpServer(
      'context7',
      'node',
      ['ccg-context7.mjs'],
      {},
      { homeDir },
    )
    expect(installed.success).toBe(true)

    const edited = JSON.parse(await readFile(configPath, 'utf8'))
    edited.mcpServers.context7 = {
      type: 'stdio',
      command: 'user-edited',
      args: [],
    }
    const editedBytes = `${JSON.stringify(edited, null, 2)}\n`
    await writeFile(configPath, editedBytes)

    const removed = await uninstallMcpServer('context7', { homeDir })
    expect(removed.success).toBe(false)
    expect(removed.message).toMatch(/modified|preserv|digest/i)
    expect(await readFile(configPath, 'utf8')).toBe(editedBytes)
  })

  it('refuses Codex and Gemini collisions, then restores adopted entries', async () => {
    const homeDir = await isolatedHome()
    const codexDir = join(homeDir, '.codex')
    const geminiDir = join(homeDir, '.gemini')
    const codexPath = join(codexDir, 'config.toml')
    const geminiPath = join(geminiDir, 'settings.json')
    await Promise.all([
      mkdir(codexDir, { recursive: true }),
      mkdir(geminiDir, { recursive: true }),
    ])
    const codexOriginal = [
      '[mcp_servers.context7]',
      'type = "stdio"',
      'command = "user-codex"',
      'args = ["--user"]',
      '',
    ].join('\n')
    const geminiOriginal = {
      mcpServers: {
        context7: {
          type: 'stdio',
          command: 'user-gemini',
          args: ['--user'],
        },
      },
      untouched: true,
    }
    const geminiOriginalBytes = `${JSON.stringify(geminiOriginal, null, 2)}\n`
    await writeFile(codexPath, codexOriginal)
    await writeFile(geminiPath, geminiOriginalBytes)

    expect((await installMcpServer(
      'context7',
      'node',
      ['ccg-context7.mjs'],
      {},
      { homeDir },
    )).success).toBe(true)

    const codexRefused = await syncMcpToCodex({ homeDir })
    const geminiRefused = await syncMcpToGemini({ homeDir })
    expect(codexRefused.success).toBe(false)
    expect(geminiRefused.success).toBe(false)
    expect(await readFile(codexPath, 'utf8')).toBe(codexOriginal)
    expect(await readFile(geminiPath, 'utf8')).toBe(geminiOriginalBytes)

    expect((await syncMcpToCodex({
      homeDir,
      adoptExisting: true,
    })).success).toBe(true)
    expect((await syncMcpToGemini({
      homeDir,
      adoptExisting: true,
    })).success).toBe(true)

    expect((await uninstallMcpServer('context7', { homeDir })).success).toBe(true)
    expect((await syncMcpToCodex({ homeDir })).success).toBe(true)
    expect((await syncMcpToGemini({ homeDir })).success).toBe(true)

    expect(await readFile(codexPath, 'utf8')).toContain('command = "user-codex"')
    expect(JSON.parse(await readFile(geminiPath, 'utf8'))).toEqual(geminiOriginal)
  })

  it('fails closed on a malformed ownership ledger before changing configs', async () => {
    const homeDir = await isolatedHome()
    const configPath = join(homeDir, '.claude.json')
    const ledgerDir = join(homeDir, '.claude', '.ccg')
    const ledgerPath = join(ledgerDir, 'mcp-ownership.json')
    const original = '{"mcpServers":{},"untouched":true}\n'
    await mkdir(ledgerDir, { recursive: true })
    await writeFile(configPath, original)
    await writeFile(ledgerPath, '{"schemaVersion":1,"entries":[{"bad":true}]}')

    const result = await installMcpServer(
      'context7',
      'node',
      ['ccg-context7.mjs'],
      {},
      { homeDir },
    )
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/ownership|schema|entry/i)
    expect(await readFile(configPath, 'utf8')).toBe(original)
  })

  it.each([
    ['deepwiki', 'https://mcp.deepwiki.com/mcp'],
    ['exa', 'https://mcp.exa.ai/mcp'],
  ])('installs allowlisted %s and mirrors each host-native shape', async (serverId, url) => {
    const homeDir = await isolatedHome()

    const installed = await installRemoteMcpServer(
      serverId,
      url,
      { homeDir },
    )
    expect(installed.success).toBe(true)

    const claude = JSON.parse(await readFile(join(homeDir, '.claude.json'), 'utf8'))
    expect(claude.mcpServers[serverId]).toEqual({
      type: 'http',
      url,
    })

    expect((await syncMcpToCodex({ homeDir })).success).toBe(true)
    expect((await syncMcpToGemini({ homeDir })).success).toBe(true)

    const codex = await readFile(join(homeDir, '.codex', 'config.toml'), 'utf8')
    expect(codex).toContain(`[mcp_servers.${serverId}]`)
    expect(codex).toContain(`url = "${url}"`)
    expect(codex).not.toContain('type = "http"')

    const gemini = JSON.parse(await readFile(join(homeDir, '.gemini', 'settings.json'), 'utf8'))
    expect(gemini.mcpServers[serverId]).toEqual({
      httpUrl: url,
    })
  })

  it.each([
    ['deepwiki', 'http://mcp.deepwiki.com/mcp'],
    ['deepwiki', 'https://user@mcp.deepwiki.com/mcp'],
    ['deepwiki', 'https://mcp.deepwiki.com/mcp?token=secret'],
    ['deepwiki', 'https://mcp.deepwiki.com/sse'],
    ['deepwiki', 'https://example.com/mcp'],
    ['unknown', 'https://mcp.deepwiki.com/mcp'],
  ])('rejects an untrusted remote MCP endpoint for %s', async (serverId, url) => {
    const homeDir = await isolatedHome()
    const result = await installRemoteMcpServer(serverId, url, { homeDir })

    expect(result.success).toBe(false)
    expect(result.message).toMatch(/allowlist|trusted|https|credential|query|endpoint/i)
    await expect(readFile(join(homeDir, '.claude.json'), 'utf8')).rejects.toThrow()
  })

  it.each([
    ['.codex', syncMcpToCodex],
    ['.gemini', syncMcpToGemini],
  ] as const)(
    'rejects a %s junction without writing to its external target',
    async (targetDirectory, sync) => {
      const homeDir = await isolatedHome()
      expect((await installMcpServer(
        'context7',
        'node',
        ['ccg-context7.mjs'],
        {},
        { homeDir },
      )).success).toBe(true)
      const external = join(homeDir, `external-${targetDirectory.slice(1)}`)
      await mkdir(external, { recursive: true })
      await writeFile(join(external, 'sentinel.txt'), 'outside\n')
      await symlink(
        external,
        join(homeDir, targetDirectory),
        process.platform === 'win32' ? 'junction' : 'dir',
      )

      const result = await sync({ homeDir })

      expect(result.success).toBe(false)
      expect(result.message).toMatch(/symbolic link|junction|managed path/i)
      expect(await readdir(external)).toEqual(['sentinel.txt'])
    },
  )

  it('rejects a secret-directory junction before persisting a credential', async () => {
    const homeDir = await isolatedHome()
    const ccgDir = join(homeDir, '.claude', '.ccg')
    const external = join(homeDir, 'external-secrets')
    await mkdir(ccgDir, { recursive: true })
    await mkdir(external, { recursive: true })
    await writeFile(join(external, 'sentinel.txt'), 'outside\n')
    await symlink(
      external,
      join(ccgDir, 'secrets'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )

    const result = await installMcpServer(
      'private-tool',
      'node',
      ['private-tool.mjs'],
      { PRIVATE_TOKEN: 'secret-value' },
      { homeDir },
    )

    expect(result.success).toBe(false)
    expect(result.message).toMatch(/symbolic link|junction|managed path/i)
    expect(await readdir(external)).toEqual(['sentinel.txt'])
  })
})
