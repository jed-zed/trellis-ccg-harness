import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import fs from 'fs-extra'
import { afterEach, describe, expect, it } from 'vitest'
import * as codexMode from '../codex-mode'
import { readCcgConfigAt } from '../config'

const roots: string[] = []
const TEST_WRAPPER_BYTES = Buffer.from('verified test wrapper')

function installCodexModeAt(
  options: Omit<codexMode.InstallCodexModeOptions, 'wrapperBytes'>,
) {
  return codexMode.installCodexModeAt({ ...options, wrapperBytes: TEST_WRAPPER_BYTES })
}

async function makeCodexHome(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ccg codex mode '))
  roots.push(root)
  const codexHome = join(root, '.codex')
  await fs.ensureDir(join(codexHome, 'agents'))
  return codexHome
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  })))
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
      `await ${functionName}({ codexHome: ${JSON.stringify(codexHome)}, pythonCommand: "python", wrapperBytes: Buffer.from(${JSON.stringify(TEST_WRAPPER_BYTES.toString('base64'))}, "base64") });`,
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
  it('owns the wrapper and restores a pre-existing binary on uninstall', async () => {
    const codexHome = await makeCodexHome()
    const wrapperName = process.platform === 'win32' ? 'codeagent-wrapper.exe' : 'codeagent-wrapper'
    const wrapperPath = join(codexHome, 'ccg', 'bin', wrapperName)
    const original = Buffer.from('user wrapper')
    await fs.ensureDir(join(codexHome, 'ccg', 'bin'))
    await writeFile(wrapperPath, original)

    expect((await installCodexModeAt({ codexHome, pythonCommand: 'python' })).success).toBe(true)
    expect(await readFile(wrapperPath)).toEqual(TEST_WRAPPER_BYTES)
    const ownership = await fs.readJSON(join(codexHome, '.ccg', 'ownership.json'))
    expect(ownership.files).toContainEqual(expect.objectContaining({
      relativePath: `ccg/bin/${wrapperName}`,
      original: expect.objectContaining({ backupPath: expect.any(String) }),
    }))

    expect((await codexMode.uninstallCodexModeAt({ codexHome })).success).toBe(true)
    expect(await readFile(wrapperPath)).toEqual(original)
  })

  it.skipIf(process.platform === 'win32')('installs the managed wrapper with executable mode', async () => {
    const codexHome = await makeCodexHome()

    expect((await installCodexModeAt({ codexHome, pythonCommand: 'python' })).success).toBe(true)

    const wrapperPath = join(codexHome, 'ccg', 'bin', 'codeagent-wrapper')
    expect((await fs.stat(wrapperPath)).mode & 0o777).toBe(0o755)
  })

  it('restores byte-exact original global instructions and hooks when unchanged', async () => {
    const codexHome = await makeCodexHome()
    const agentsPath = join(codexHome, 'AGENTS.md')
    const hooksPath = join(codexHome, 'hooks.json')
    const originalAgents = '# User instructions\n\n\n'
    const originalHooks = '{"hooks":{"UserPromptSubmit":[]}}\n'
    await writeFile(agentsPath, originalAgents)
    await writeFile(hooksPath, originalHooks)

    expect((await installCodexModeAt({
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

    const installed = await installCodexModeAt({
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
    await installCodexModeAt({ codexHome, pythonCommand: 'python' })
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

    const result = await installCodexModeAt({
      codexHome,
      pythonCommand: 'python',
    })

    expect(result.success).toBe(false)
    expect(await readFile(agentsPath, 'utf8')).toBe('# untouched\n')
    expect(await readFile(hooksPath, 'utf8')).toBe('{"hooks":')
  })

  it('is idempotent and never duplicates its managed block or hook group', async () => {
    const codexHome = await makeCodexHome()

    expect((await installCodexModeAt({ codexHome, pythonCommand: 'python' })).success).toBe(true)
    expect((await installCodexModeAt({ codexHome, pythonCommand: 'python' })).success).toBe(true)

    const agents = await readFile(join(codexHome, 'AGENTS.md'), 'utf8')
    const hooks = JSON.parse(await readFile(join(codexHome, 'hooks.json'), 'utf8'))
    expect(agents.match(/<!-- CCG:START/g)).toHaveLength(1)
    expect(hooks.hooks.UserPromptSubmit).toHaveLength(1)
  })

  it('preserves customized role routing across Codex mode updates', async () => {
    const codexHome = await makeCodexHome()
    expect((await installCodexModeAt({ codexHome, pythonCommand: 'python' })).success).toBe(true)

    const configPath = join(codexHome, 'ccg', 'config.toml')
    const installed = await readFile(configPath, 'utf8')
    const configured = installed.replace(
      /(\[routing\.search\]\r?\n)models = \["grok"\](\r?\n)primary = "grok"/,
      '$1models = ["codex"]$2primary = "codex"',
    )
    expect(configured).not.toBe(installed)
    await writeFile(configPath, configured)

    const updated = await installCodexModeAt({ codexHome, pythonCommand: 'python' })

    expect(updated.success).toBe(true)
    const persisted = await readFile(configPath, 'utf8')
    expect(persisted).toContain('models = [ "codex" ]')
    expect(persisted).toContain('primary = "codex"')
  })

  it('installs a Claude-clean Codex runtime without creating or referencing .claude', async () => {
    const codexHome = await makeCodexHome()
    const claudeHome = join(codexHome, '..', '.claude')

    const result = await installCodexModeAt({
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
    expect(hook).toContain('Claude may be explicitly selected for frontend, backend, or product-manager, but not search')
    const config = await readFile(join(codexHome, 'config.toml'), 'utf8')
    expect(config).not.toContain('[mcp_servers')
  })

  it('installs the unified product-manager route without creating Claude project state', async () => {
    const codexHome = await makeCodexHome()
    const claudeHome = join(codexHome, '..', '.claude')

    const result = await installCodexModeAt({
      codexHome,
      pythonCommand: 'python',
    })

    expect(result.success).toBe(true)
    expect(await fs.pathExists(claudeHome)).toBe(false)
    const config = await readFile(join(codexHome, 'ccg', 'config.toml'), 'utf8')
    expect(config).toContain('[routing.product-manager]')
    expect(config).toContain('primary = "claude"')
    expect(config).toContain('[product_manager]')
    expect(config).not.toMatch(/\[product_manager\][\s\S]*provider\s*=/)
    expect(config).not.toContain('.claude')
  })

  it('upgrades after the owned legacy product-manager route is migrated on first read', async () => {
    const codexHome = await makeCodexHome()
    expect((await installCodexModeAt({
      codexHome,
      pythonCommand: 'python',
    })).success).toBe(true)

    const configPath = join(codexHome, 'ccg', 'config.toml')
    const ownershipPath = join(codexHome, '.ccg', 'ownership.json')
    const currentConfig = await readFile(configPath, 'utf8')
    const legacyConfig = currentConfig
      .replace(
        /\r?\n\[routing\.product-manager\]\r?\nmodels\s*=\s*\[[^\]]+\]\r?\nprimary\s*=\s*"claude"\r?\nstrategy\s*=\s*"fallback"\r?\n/u,
        '\n',
      )
      .replace(
        /\[product_manager\]\r?\n/u,
        '[product_manager]\nprovider = "gemini"\n',
      )
      .replace(
        /enabled = false\r?\nauto_route = false/u,
        'enabled = true\nauto_route = true',
      )
    expect(legacyConfig).not.toContain('[routing.product-manager]')
    expect(legacyConfig).toContain('provider = "gemini"')
    await writeFile(configPath, legacyConfig)

    const ownership = await fs.readJSON(ownershipPath)
    ownership.version = '3.4.1'
    ownership.files.find(
      (file: { relativePath: string }) => file.relativePath === 'ccg/config.toml',
    ).installedSha256 = createHash('sha256').update(legacyConfig).digest('hex')
    await writeFile(ownershipPath, `${JSON.stringify(ownership, null, 2)}\n`)

    const migrated = await readCcgConfigAt(configPath)
    expect(migrated?.routing['product-manager'].primary).toBe('gemini')
    expect(await readFile(configPath, 'utf8')).not.toMatch(
      /\[product_manager\][\s\S]*provider\s*=/,
    )

    const upgraded = await installCodexModeAt({
      codexHome,
      pythonCommand: 'python',
    })
    expect(upgraded.success).toBe(true)

    const installed = await readFile(configPath, 'utf8')
    expect(installed).toContain('[routing.product-manager]')
    expect(installed).toContain('primary = "gemini"')
    expect(installed).toContain('[intelligence]')
    expect(installed).toContain('enabled = true')
    expect(installed).not.toMatch(/\[product_manager\][\s\S]*provider\s*=/)
    const nextOwnership = await fs.readJSON(ownershipPath)
    expect(nextOwnership.version).toBe('3.4.10')
    expect(nextOwnership.files.find(
      (file: { relativePath: string }) => file.relativePath === 'ccg/config.toml',
    ).installedSha256).toBe(
      createHash('sha256').update(installed).digest('hex'),
    )
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

      const result = await installCodexModeAt({
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

    const blocked = await installCodexModeAt({
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
    expect((await installCodexModeAt({
      codexHome,
      pythonCommand: 'python',
    })).success).toBe(true)
    const tracked = [
      'AGENTS.md',
      'hooks.json',
      'agents/ccg-implement.toml',
      'hooks/ccg-workflow.py',
      `ccg/bin/${process.platform === 'win32' ? 'codeagent-wrapper.exe' : 'codeagent-wrapper'}`,
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
    if (process.platform !== 'win32') {
      expect((await fs.stat(join(codexHome, 'ccg', 'bin', 'codeagent-wrapper'))).mode & 0o777).toBe(0o755)
    }
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
    expect((await installCodexModeAt({
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
