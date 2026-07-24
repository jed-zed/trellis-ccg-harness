import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
})
