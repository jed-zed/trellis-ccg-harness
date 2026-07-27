import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import fs from 'fs-extra'
import { afterEach, describe, expect, it } from 'vitest'
import * as codexMode from '../codex-mode'

const roots: string[] = []

async function makeCodexHome(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ccg codex mode '))
  roots.push(root)
  const codexHome = join(root, '.codex')
  await fs.ensureDir(join(codexHome, 'agents'))
  return codexHome
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function hardTerminateCodexMode(
  codexHome: string,
  operation: 'install' | 'uninstall',
  mutation: number,
): Promise<ReturnType<typeof spawnSync>> {
  const runnerPath = join(codexHome, '..', `crash-${operation}.mjs`)
  const codexModeUrl = pathToFileURL(
    join(import.meta.dirname, '..', 'codex-mode.ts'),
  ).href
  const functionName = operation === 'install'
    ? 'installCodexModeAt'
    : 'uninstallCodexModeAt'
  await writeFile(
    runnerPath,
    [
      `import { ${functionName} } from ${JSON.stringify(codexModeUrl)};`,
      `await ${functionName}({ codexHome: ${JSON.stringify(codexHome)}, pythonCommand: "python" });`,
      '',
    ].join('\n'),
  )
  return spawnSync(
    process.execPath,
    ['--import', 'tsx', runnerPath],
    {
      cwd: join(import.meta.dirname, '..', '..', '..'),
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        CCG_CODEX_MODE_TEST_CRASH_AFTER_MUTATION: String(mutation),
      },
      timeout: 30_000,
      windowsHide: true,
    },
  )
}

describe('Codex mode ownership and reversibility', () => {
  it('restores byte-exact original global instructions and hooks when unchanged', async () => {
    const codexHome = await makeCodexHome()
    const agentsPath = join(codexHome, 'AGENTS.md')
    const hooksPath = join(codexHome, 'hooks.json')
    const originalAgents = '# User instructions\n\n\n'
    const originalHooks = '{"hooks":{"UserPromptSubmit":[]}}\n'
    await writeFile(agentsPath, originalAgents)
    await writeFile(hooksPath, originalHooks)

    expect((await codexMode.installCodexModeAt({
      codexHome,
      pythonCommand: 'python',
    })).success).toBe(true)

    const result = await codexMode.uninstallCodexModeAt({ codexHome })

    expect(result.success).toBe(true)
    expect(await readFile(agentsPath, 'utf8')).toBe(originalAgents)
    expect(await readFile(hooksPath, 'utf8')).toBe(originalHooks)
  })

  it('merges global instructions and hooks, records backups, and restores owned collisions', async () => {
    const codexHome = await makeCodexHome()
    const agentsPath = join(codexHome, 'AGENTS.md')
    const hooksPath = join(codexHome, 'hooks.json')
    const collisionPath = join(codexHome, 'agents', 'ccg-implement.toml')
    const userHook = { hooks: [{ type: 'command', command: 'node user-hook.js', timeout: 5 }] }
    await writeFile(agentsPath, '# User instructions\n')
    await writeFile(hooksPath, JSON.stringify({ hooks: { UserPromptSubmit: [userHook] } }, null, 2))
    await writeFile(collisionPath, 'user-owned-agent = true\n')

    const installed = await codexMode.installCodexModeAt({
      codexHome,
      pythonCommand: 'python',
    })
    expect(installed.success).toBe(true)

    const agents = await readFile(agentsPath, 'utf8')
    expect(agents).toContain('# User instructions')
    expect(agents.match(/<!-- CCG:START/g)).toHaveLength(1)

    const hooks = JSON.parse(await readFile(hooksPath, 'utf8'))
    expect(hooks.hooks.UserPromptSubmit).toContainEqual(userHook)
    expect(hooks.hooks.UserPromptSubmit).toHaveLength(2)

    const ownership = JSON.parse(await readFile(join(codexHome, '.ccg', 'ownership.json'), 'utf8'))
    expect(ownership.schemaVersion).toBe(1)
    expect(ownership.files.find((file: any) => file.relativePath === 'agents/ccg-implement.toml').original.backupPath).toBeTruthy()

    await writeFile(agentsPath, `${agents}\nUser added after install.\n`)
    hooks.hooks.UserPromptSubmit.push({ hooks: [{ type: 'command', command: 'node later-hook.js' }] })
    await writeFile(hooksPath, JSON.stringify(hooks, null, 2))

    const uninstalled = await codexMode.uninstallCodexModeAt({ codexHome })
    expect(uninstalled.success).toBe(true)
    expect(await readFile(agentsPath, 'utf8')).toContain('User added after install.')
    expect(await readFile(agentsPath, 'utf8')).not.toContain('<!-- CCG:START')
    const remainingHooks = JSON.parse(await readFile(hooksPath, 'utf8'))
    expect(remainingHooks.hooks.UserPromptSubmit).toContainEqual(userHook)
    expect(JSON.stringify(remainingHooks)).toContain('later-hook.js')
    expect(await readFile(collisionPath, 'utf8')).toBe('user-owned-agent = true\n')
  })

  it('keeps a managed file that the user changed after installation', async () => {
    const codexHome = await makeCodexHome()
    await codexMode.installCodexModeAt({ codexHome, pythonCommand: 'python' })
    const managedPath = join(codexHome, 'agents', 'ccg-review.toml')
    await writeFile(managedPath, 'user changed this after install\n')

    const result = await codexMode.uninstallCodexModeAt({ codexHome })

    expect(result.success).toBe(true)
    expect(await readFile(managedPath, 'utf8')).toContain('user changed')
    expect(result.skipped.join('\n')).toMatch(/ccg-review/)
  })

  it('fails closed on malformed hooks JSON before touching other user files', async () => {
    const codexHome = await makeCodexHome()
    const agentsPath = join(codexHome, 'AGENTS.md')
    const hooksPath = join(codexHome, 'hooks.json')
    await writeFile(agentsPath, '# untouched\n')
    await writeFile(hooksPath, '{"hooks":')

    const result = await codexMode.installCodexModeAt({
      codexHome,
      pythonCommand: 'python',
    })

    expect(result.success).toBe(false)
    expect(await readFile(agentsPath, 'utf8')).toBe('# untouched\n')
    expect(await readFile(hooksPath, 'utf8')).toBe('{"hooks":')
  })

  it('is idempotent and never duplicates its managed block or hook group', async () => {
    const codexHome = await makeCodexHome()

    expect((await codexMode.installCodexModeAt({ codexHome, pythonCommand: 'python' })).success).toBe(true)
    expect((await codexMode.installCodexModeAt({ codexHome, pythonCommand: 'python' })).success).toBe(true)

    const agents = await readFile(join(codexHome, 'AGENTS.md'), 'utf8')
    const hooks = JSON.parse(await readFile(join(codexHome, 'hooks.json'), 'utf8'))
    expect(agents.match(/<!-- CCG:START/g)).toHaveLength(1)
    expect(hooks.hooks.UserPromptSubmit).toHaveLength(1)
  })

  it('preserves customized role routing across Codex mode updates', async () => {
    const codexHome = await makeCodexHome()
    expect((await codexMode.installCodexModeAt({ codexHome, pythonCommand: 'python' })).success).toBe(true)

    const configPath = join(codexHome, 'ccg', 'config.toml')
    const configured = (await readFile(configPath, 'utf8')).replace(
      '[routing.search]\nmodels = ["grok"]\nprimary = "grok"',
      '[routing.search]\nmodels = ["claude"]\nprimary = "claude"',
    )
    await writeFile(configPath, configured)

    const updated = await codexMode.installCodexModeAt({ codexHome, pythonCommand: 'python' })

    expect(updated.success).toBe(true)
    const persisted = await readFile(configPath, 'utf8')
    expect(persisted).toContain('models = [ "claude" ]')
    expect(persisted).toContain('primary = "claude"')
  })

  it('installs a Claude-clean Codex runtime without creating or referencing .claude', async () => {
    const codexHome = await makeCodexHome()
    const claudeHome = join(codexHome, '..', '.claude')

    const result = await codexMode.installCodexModeAt({
      codexHome,
      pythonCommand: 'python',
    })

    expect(result.success).toBe(true)
    expect(await fs.pathExists(join(codexHome, 'ccg', 'config.toml'))).toBe(true)
    expect(await fs.pathExists(claudeHome)).toBe(false)
    const generated = [
      join(codexHome, 'AGENTS.md'),
      join(codexHome, 'hooks.json'),
      join(codexHome, 'hooks', 'ccg-workflow.py'),
      join(codexHome, 'ccg', 'config.toml'),
    ]
    for (const path of generated)
      expect(await readFile(path, 'utf8'), path).not.toContain('.claude')
    const hook = await readFile(join(codexHome, 'hooks', 'ccg-workflow.py'), 'utf8')
    expect(hook).not.toContain('--backend claude')
    expect(hook).toContain('applicable frontend/backend/search providers')
    const config = await readFile(join(codexHome, 'config.toml'), 'utf8')
    expect(config).not.toContain('[mcp_servers')
  })

  it('rejects ownership paths that escape Codex home', async () => {
    const codexHome = await makeCodexHome()
    const victimPath = join(codexHome, '..', 'victim.txt')
    const victim = Buffer.from('user-owned\n')
    await writeFile(victimPath, victim)
    await fs.ensureDir(join(codexHome, '.ccg'))
    await writeFile(join(codexHome, '.ccg', 'ownership.json'), JSON.stringify({
      schemaVersion: 1,
      version: '3.3.0',
      installedAt: new Date().toISOString(),
      files: [{
        relativePath: '../victim.txt',
        installedSha256: createHash('sha256').update(victim).digest('hex'),
      }],
      agentsBlock: { sha256: '0'.repeat(64) },
      hookGroup: {
        event: 'UserPromptSubmit',
        value: {},
        sha256: '0'.repeat(64),
        fileCreated: false,
      },
    }))

    const result = await codexMode.uninstallCodexModeAt({ codexHome })

    expect(result.success).toBe(false)
    expect(await readFile(victimPath, 'utf8')).toBe(victim.toString('utf8'))
    expect(result.skipped.join('\n')).toMatch(/escapes|unsafe path/i)
  })

  it.each(['agents', 'hooks', '.ccg'])(
    'rejects a %s junction before writing outside Codex home',
    async (component) => {
      const codexHome = await makeCodexHome()
      const external = join(codexHome, '..', `outside-${component.replace('.', '')}`)
      await fs.ensureDir(external)
      await writeFile(join(external, 'sentinel.txt'), 'outside\n')
      await rm(join(codexHome, component), { recursive: true, force: true })
      await symlink(
        external,
        join(codexHome, component),
        process.platform === 'win32' ? 'junction' : 'dir',
      )

      const result = await codexMode.installCodexModeAt({
        codexHome,
        pythonCommand: 'python',
      })

      expect(result.success).toBe(false)
      expect(result.message).toMatch(/symbolic link|junction|managed path/i)
      expect(await readdir(external)).toEqual(['sentinel.txt'])
      expect(await readFile(join(external, 'sentinel.txt'), 'utf8')).toBe('outside\n')
    },
  )

  it('recovers byte-exact originals after a hard-killed install process', async () => {
    const codexHome = await makeCodexHome()
    const agentsPath = join(codexHome, 'AGENTS.md')
    const hooksPath = join(codexHome, 'hooks.json')
    const originalAgents = '# original instructions\n'
    const originalHooks = '{"hooks":{"UserPromptSubmit":[]}}\n'
    await writeFile(agentsPath, originalAgents)
    await writeFile(hooksPath, originalHooks)

    const child = await hardTerminateCodexMode(codexHome, 'install', 3)
    expect(child.status).not.toBe(0)
    expect(await fs.pathExists(
      join(codexHome, '.ccg', 'transaction.json'),
    )).toBe(true)

    const blocked = await codexMode.installCodexModeAt({
      codexHome,
      pythonCommand: 'python',
    })
    expect(blocked.success).toBe(false)
    expect(blocked.message).toMatch(/requires recovery/i)

    const recovered = await codexMode.recoverCodexModeAt({ codexHome })
    expect(recovered).toMatchObject({ success: true, recovered: true })
    expect(await readFile(agentsPath, 'utf8')).toBe(originalAgents)
    expect(await readFile(hooksPath, 'utf8')).toBe(originalHooks)
    expect(await fs.pathExists(
      join(codexHome, '.ccg', 'ownership.json'),
    )).toBe(false)
  }, 30_000)

  it('restores the installed state after a hard-killed uninstall process', async () => {
    const codexHome = await makeCodexHome()
    expect((await codexMode.installCodexModeAt({
      codexHome,
      pythonCommand: 'python',
    })).success).toBe(true)
    const tracked = [
      'AGENTS.md',
      'hooks.json',
      'agents/ccg-implement.toml',
      'hooks/ccg-workflow.py',
      '.ccg/ownership.json',
    ]
    const installed = new Map<string, Buffer>()
    for (const relativePath of tracked)
      installed.set(relativePath, await readFile(join(codexHome, relativePath)))

    const child = await hardTerminateCodexMode(codexHome, 'uninstall', 2)
    expect(child.status).not.toBe(0)
    expect(await fs.pathExists(
      join(codexHome, '.ccg', 'transaction.json'),
    )).toBe(true)

    const recovered = await codexMode.recoverCodexModeAt({ codexHome })
    expect(recovered).toMatchObject({ success: true, recovered: true })
    for (const [relativePath, bytes] of installed)
      expect(await readFile(join(codexHome, relativePath))).toEqual(bytes)
  }, 30_000)

  it('rejects a tampered transaction schema without touching an external path', async () => {
    const codexHome = await makeCodexHome()
    const victimPath = join(codexHome, '..', 'transaction-victim.txt')
    await writeFile(victimPath, 'outside\n')
    const child = await hardTerminateCodexMode(codexHome, 'install', 1)
    expect(child.status).not.toBe(0)
    const journalPath = join(codexHome, '.ccg', 'transaction.json')
    const journal = JSON.parse(await readFile(journalPath, 'utf8'))
    journal.snapshots[0].relativePath = '../transaction-victim.txt'
    await writeFile(journalPath, JSON.stringify(journal))

    const recovered = await codexMode.recoverCodexModeAt({ codexHome })

    expect(recovered.success).toBe(false)
    expect(recovered.message).toMatch(/transaction target|invalid|unsafe/i)
    expect(await readFile(victimPath, 'utf8')).toBe('outside\n')
    expect(await fs.pathExists(journalPath)).toBe(true)
  }, 30_000)

  it('rejects unknown ownership fields before uninstalling any managed file', async () => {
    const codexHome = await makeCodexHome()
    expect((await codexMode.installCodexModeAt({
      codexHome,
      pythonCommand: 'python',
    })).success).toBe(true)
    const managedPath = join(codexHome, 'agents', 'ccg-review.toml')
    const before = await readFile(managedPath)
    const ownershipPath = join(codexHome, '.ccg', 'ownership.json')
    const ownership = JSON.parse(await readFile(ownershipPath, 'utf8'))
    ownership.files[0].unexpected = true
    const tampered = JSON.stringify(ownership)
    await writeFile(ownershipPath, tampered)

    const result = await codexMode.uninstallCodexModeAt({ codexHome })

    expect(result.success).toBe(false)
    expect(result.skipped.join('\n')).toMatch(/schema/i)
    expect(await readFile(managedPath)).toEqual(before)
    expect(await readFile(ownershipPath, 'utf8')).toBe(tampered)
  })
})
