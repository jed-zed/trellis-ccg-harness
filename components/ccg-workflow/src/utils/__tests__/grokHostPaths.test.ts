import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, parse, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const roots: string[] = []
const engineRoots = [
  resolve(import.meta.dirname, '../../../templates/engine/tools/grok-intelligence'),
  resolve(import.meta.dirname, '../../../plugins/ccg/skills/ccg-grok-intel/scripts/grok-intelligence'),
]
const DISABLED_CONFIG = '[intelligence]\nenabled = false\n'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ccg-grok-host-'))
  roots.push(root)
  const userHome = join(root, 'user')
  const claudeHome = join(userHome, '.claude')
  const codexHome = join(root, 'external-codex')
  const project = join(root, 'project')
  await mkdir(claudeHome, { recursive: true })
  await mkdir(join(codexHome, 'ccg'), { recursive: true })
  await mkdir(project)
  await writeFile(join(codexHome, 'ccg', 'config.toml'), DISABLED_CONFIG)
  await writeFile(join(claudeHome, 'config.toml'), '# upstream Claude bytes\r\n' + DISABLED_CONFIG)
  await writeFile(join(project, 'README.md'), '# Synthetic host boundary acceptance\n')
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: userHome,
    USERPROFILE: userHome,
    CODEX_HOME: codexHome,
    CLAUDE_CONFIG_DIR: claudeHome,
    CCG_HOST: 'codex',
    CLAUDECODE: '0',
  }
  return { root, userHome, claudeHome, codexHome, project, env }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })))
})

function run(entry: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [entry, ...args], { cwd, env, encoding: 'utf8', timeout: 10_000, windowsHide: true })
}

function engineArgs(entry: string): string[] {
  return entry.endsWith('command.mjs')
    ? ['intel', '--task', 'synthetic host boundary test']
    : ['--workflow', 'analyze', '--phase', 'intake', '--task', 'synthetic host boundary test', '--state-file', '.ccg/tasks/host-boundary/intelligence-route.json']
}

function sha256(value: Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

describe('standalone personal Grok engine Codex host paths', () => {
  it('keeps the template and independently invoked plugin engine byte-identical', async () => {
    for (const path of ['command.mjs', 'route.mjs', 'lib/host-boundary.mjs'])
      expect(await readFile(join(engineRoots[0], path))).toEqual(await readFile(join(engineRoots[1], path)))
  })

  it('resolves an explicit drive and user-home fallback in an actual Node child', async () => {
    const { userHome, project, env } = await fixture()
    const explicitHome = process.platform === 'win32'
      ? join(parse(tmpdir()).root, 'CodexData', '.codex')
      : 'G:\\CodexData\\.codex'
    for (const engineRoot of engineRoots) {
      const moduleUrl = pathToFileURL(join(engineRoot, 'lib/host-boundary.mjs')).href
      const script = `import { resolveCodexHome } from ${JSON.stringify(moduleUrl)}; process.stdout.write(JSON.stringify([resolveCodexHome(${JSON.stringify(` ${explicitHome} `)}, ${JSON.stringify(userHome)}), resolveCodexHome("", ${JSON.stringify(userHome)})]));`
      const result = run('--input-type=module', ['-e', script], project, env)
      expect(result.status, result.stderr).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual([explicitHome, join(userHome, '.codex')])
    }
  })

  it('uses CODEX_HOME for actual command and route children without invoking a provider', async () => {
    const { project, env } = await fixture()
    for (const engineRoot of engineRoots) {
      for (const name of ['command.mjs', 'route.mjs']) {
        const entry = join(engineRoot, name)
        const result = run(entry, engineArgs(entry), project, env)
        expect(result.status, result.stderr).toBe(name === 'command.mjs' ? 4 : 0)
        const response = JSON.parse(result.stdout)
        if (name === 'command.mjs')
          expect(response.status).toBe('configuration_required')
        else {
          expect(response.invoked).toBe(false)
          expect(response.decision.requirement).toBe('disabled')
        }
      }
    }
  })

  it('honors an explicit config-equals path instead of an absent default in actual engine children', async () => {
    const { root, codexHome, project, env } = await fixture()
    const explicit = join(codexHome, 'ccg', 'config.toml')
    const childEnvironment = { ...env, CODEX_HOME: join(root, 'missing-default-home') }
    for (const engineRoot of engineRoots) {
      for (const name of ['command.mjs', 'route.mjs']) {
        const entry = join(engineRoot, name)
        const result = run(entry, [...engineArgs(entry), `--config=${explicit}`], project, childEnvironment)
        expect(result.status, result.stderr).toBe(name === 'command.mjs' ? 4 : 0)
        const response = JSON.parse(result.stdout)
        if (name === 'command.mjs')
          expect(response.status).toBe('configuration_required')
        else
          expect(response.invoked).toBe(false)
      }
    }
  })

  it('uses the actual user-home config fallback when CODEX_HOME is empty', async () => {
    const { userHome, project, env } = await fixture()
    await mkdir(join(userHome, '.codex', 'ccg'), { recursive: true })
    await writeFile(join(userHome, '.codex', 'ccg', 'config.toml'), DISABLED_CONFIG)
    for (const engineRoot of engineRoots) {
      const result = run(join(engineRoot, 'command.mjs'), ['intel', '--task', 'synthetic fallback'], project, { ...env, CODEX_HOME: '' })
      expect(result.status, result.stderr).toBe(4)
      expect(JSON.parse(result.stdout).status).toBe('configuration_required')
    }
  })

  it('rejects explicit Claude config and an ancestor before either direct entry can read it', async () => {
    const { userHome, claudeHome, project, env } = await fixture()
    const upstream = join(claudeHome, 'config.toml')
    const before = sha256(await readFile(upstream))
    for (const engineRoot of engineRoots) {
      for (const name of ['command.mjs', 'route.mjs']) {
        const entry = join(engineRoot, name)
        const result = run(entry, [...engineArgs(entry), '--config', upstream], project, env)
        expect(result.status).toBe(4)
        expect(result.stderr).toContain('overlaps Claude configuration')
        const equalsResult = run(entry, [...engineArgs(entry), `--config=${upstream}`], project, env)
        expect(equalsResult.status).toBe(4)
        expect(equalsResult.stderr).toContain('overlaps Claude configuration')
      }
      const result = run(join(engineRoot, 'command.mjs'), ['intel', '--task', 'synthetic ancestor', '--config', userHome], project, env)
      expect(result.status).toBe(4)
      expect(result.stderr).toContain('overlaps Claude configuration')
    }
    expect(sha256(await readFile(upstream))).toBe(before)
  })

  it('rejects CODEX_HOME ccg junction aliases with byte-exact upstream preservation', async () => {
    const { claudeHome, codexHome, project, env } = await fixture()
    const upstream = join(claudeHome, 'config.toml')
    const before = sha256(await readFile(upstream))
    await rm(join(codexHome, 'ccg'), { recursive: true })
    await symlink(claudeHome, join(codexHome, 'ccg'), process.platform === 'win32' ? 'junction' : 'dir')
    for (const engineRoot of engineRoots) {
      for (const name of ['command.mjs', 'route.mjs']) {
        const entry = join(engineRoot, name)
        const result = run(entry, engineArgs(entry), project, env)
        expect(result.status).toBe(4)
        expect(result.stderr).toContain('overlaps Claude configuration')
      }
    }
    expect(sha256(await readFile(upstream))).toBe(before)
  })

  it('refuses direct personal engine execution from a Claude host', async () => {
    const { project, env } = await fixture()
    for (const engineRoot of engineRoots) {
      for (const name of ['command.mjs', 'route.mjs']) {
        const entry = join(engineRoot, name)
        const result = run(entry, engineArgs(entry), project, { ...env, CLAUDECODE: '1' })
        expect(result.status).toBe(4)
        expect(result.stderr).toContain('Personal CCG is Codex-only')
      }
    }
  })
})
