import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const repository = fileURLToPath(new URL('../../..', import.meta.url))
const entrypoint = path.join(repository, 'bin', 'ccg.mjs')
const fixtureParent = path.join(tmpdir(), 'ccg-codex-host-isolation-tests')
const ownedFixtures: string[] = []
const explicitGuardFailure = /Codex-only|Legacy Claude command|Claude diagnosis belongs to upstream|Legacy Claude Grok doctor/i

interface Fixture {
  root: string
  home: string
  codexHome: string
  environment: NodeJS.ProcessEnv
}

function writeFixtureFile(home: string, relative: string, contents: string): void {
  const target = path.join(home, relative)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, contents)
}

function createFixture(): Fixture {
  fs.mkdirSync(fixtureParent, { recursive: true })
  const root = fs.mkdtempSync(path.join(fixtureParent, 'case-'))
  ownedFixtures.push(root)
  const home = path.join(root, 'home')
  const codexHome = path.join(home, '.codex')
  fs.mkdirSync(codexHome, { recursive: true })
  writeFixtureFile(home, '.claude/settings.json', `${JSON.stringify({
    model: 'opus[1m]',
    permissions: { allow: ['Bash(echo user-owned-sentinel)'] },
    hooks: {
      SessionStart: [{ hooks: [{ type: 'command', command: 'echo user-owned-hook' }] }],
    },
  }, null, 2)}\n`)
  writeFixtureFile(home, '.claude/.ccg/config.toml', [
    '[general]',
    'version = "3.3.0-upstream-fixture"',
    'language = "en"',
    '',
    '[product_manager]',
    'enabled = false',
    'provider = "claude"',
    '',
  ].join('\n'))
  writeFixtureFile(home, '.claude/commands/ccg/user-command.md', 'original-claude-ccg-command\n')
  writeFixtureFile(home, '.claude/hooks/ccg/user-hook.js', '// original-claude-ccg-hook\n')
  writeFixtureFile(home, '.claude/skills/ccg/SKILL.md', '# Original Claude CCG fixture\n')
  writeFixtureFile(home, '.claude/rules/user-rule.md', '# User-owned Claude rule\n')
  writeFixtureFile(home, '.claude/CLAUDE.md', '# User-owned Claude instructions\n')
  writeFixtureFile(home, '.claude/prompts/ccg/legacy.md', 'do not migrate this fixture\n')
  writeFixtureFile(home, '.ccg/config.toml', '[general]\nversion = "1.3.0"\n')
  writeFixtureFile(home, '.claude.json', '{"mcpServers":{"upstream-sentinel":{"command":"never-start-this-fixture"}}}\n')

  const environment: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (!['path', 'home', 'userprofile', 'homedrive', 'homepath', 'codex_home', 'claude_config_dir', 'claudecode', 'ccg_host'].includes(key.toLowerCase()))
      environment[key] = value
  }
  Object.assign(environment, {
    HOME: home,
    USERPROFILE: home,
    HOMEDRIVE: path.parse(home).root.replace(/[\\/]+$/, ''),
    HOMEPATH: home.slice(path.parse(home).root.length - 1),
    CODEX_HOME: codexHome,
    CCG_HOST: 'codex',
    // Built CLI only. Native model CLIs are absent from this fixture PATH.
    PATH: path.dirname(process.execPath),
    NO_COLOR: '1',
    FORCE_COLOR: '0',
  })
  return { root, home, codexHome, environment }
}

function protectedBytes(fixture: Fixture): Record<string, string> {
  const result: Record<string, string> = {}
  function visit(target: string): void {
    if (!fs.existsSync(target))
      return
    const stat = fs.lstatSync(target)
    const relative = path.relative(fixture.home, target).replaceAll('\\', '/')
    if (stat.isDirectory()) {
      result[`${relative}/`] = 'directory'
      for (const name of fs.readdirSync(target).sort())
        visit(path.join(target, name))
    }
    else {
      result[relative] = createHash('sha256').update(fs.readFileSync(target)).digest('hex')
    }
  }
  for (const name of ['.claude', '.claude.json', '.ccg'])
    visit(path.join(fixture.home, name))
  return result
}

function runCli(fixture: Fixture, args: string[], overrides: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [entrypoint, ...args], {
    cwd: fixture.root,
    env: { ...fixture.environment, ...overrides },
    encoding: 'utf8',
    timeout: 8_000,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  })
}

function combinedOutput(result: ReturnType<typeof runCli>): string {
  return `${result.stdout || ''}\n${result.stderr || ''}`
}

afterEach(() => {
  for (const root of ownedFixtures.splice(0)) {
    // Delete only fixtures created here, after proving their canonical boundary.
    const relative = path.relative(path.resolve(fixtureParent), path.resolve(root))
    if (relative.startsWith('..') || path.isAbsolute(relative) || !relative.startsWith('case-'))
      throw new Error(`Refusing fixture cleanup outside its owned parent: ${root}`)
    fs.rmSync(root, { recursive: true, force: true })
  }
})

describe('personal built CLI cannot take ownership of Claude CCG', () => {
  it('keeps legacy Grok CLI actions blocked when an executable Claude manager exists', () => {
    const fixture = createFixture()
    writeFixtureFile(fixture.home, '.claude/.ccg/engine/tools/grok-intelligence/manage.mjs',      'process.stderr.write("LEGACY_CLAUDE_MANAGER_EXECUTED\\n"); process.exit(97)\n')
    const before = protectedBytes(fixture)
    const result = runCli(fixture, ['grok', 'status', '--json'], {
      LOCALAPPDATA: path.join(fixture.root, 'localappdata'),
      GROK_HOME: path.join(fixture.root, 'dedicated-grok-home'),
    })
    expect(result.error, combinedOutput(result)).toBeUndefined()
    expect(result.status, combinedOutput(result)).toBe(1)
    expect(combinedOutput(result)).not.toContain('LEGACY_CLAUDE_MANAGER_EXECUTED')
    expect(combinedOutput(result)).toMatch(explicitGuardFailure)
    expect(protectedBytes(fixture)).toEqual(before)
  })

  it.each([
    ['init'],
    ['i'],
    ['init', '--skip-prompt', '--force'],
    ['uninstall'],
    ['config', 'mcp'],
    ['diagnose-mcp'],
    ['fix-mcp'],
    ['grok', 'status'],
    ['doctor', '--platform', 'claude'],
    ['doctor', '--platform=claude'],
    ['doctor', '--gptpro', '--platform', 'claude'],
    ['--platform', 'claude', 'doctor'],
    ['--platform=claude', 'doctor'],
    ['--gptpro', 'doctor', '--platform', 'claude'],
    ['doctor', '--grok'],
    ['doctor', '--grok-live'],
    ['doctor', '--grok-cleanup'],
    ['doctor', '--gptpro', '--grok-cleanup'],
  ].map(args => ({ args, command: args.join(' ') })))('rejects "$command" before any migration or mutation', ({ args }) => {
    const fixture = createFixture()
    const before = protectedBytes(fixture)
    const result = runCli(fixture, args)
    expect(protectedBytes(fixture)).toEqual(before)
    expect(result.error, combinedOutput(result)).toBeUndefined()
    expect(result.status, combinedOutput(result)).toBe(1)
    expect(combinedOutput(result)).toMatch(explicitGuardFailure)
    expect(combinedOutput(result)).not.toMatch(/CCG Doctor \(/)
  })

  it('displays Codex-only help without loading or migrating the Claude language config', () => {
    const fixture = createFixture()
    const before = protectedBytes(fixture)
    const result = runCli(fixture, [])
    expect(protectedBytes(fixture)).toEqual(before)
    expect(result.error, combinedOutput(result)).toBeUndefined()
    expect(result.status, combinedOutput(result)).toBe(0)
    expect(combinedOutput(result)).toMatch(/ccg-codex/)
    expect(combinedOutput(result)).toMatch(/Codex/)
    expect(combinedOutput(result)).not.toMatch(/show.*interactive.*menu|npx ccg init|ccg config mcp/i)
  })

  it.each([['--help'], ['--version'], ['codex-mode', '--help'], ['addons', '--json']])(
    'serves safe metadata request %j with Claude bytes unchanged',
    (...args: string[]) => {
      const fixture = createFixture()
      const before = protectedBytes(fixture)
      const result = runCli(fixture, args)
      expect(protectedBytes(fixture)).toEqual(before)
      expect(result.error, combinedOutput(result)).toBeUndefined()
      expect(result.status, combinedOutput(result)).toBe(0)
    },
  )

  it.each([['status'], ['doctor'], ['doctor', '--platform', 'codex'], ['doctor', '--platform=codex']])(
    'diagnoses Codex for native request %j and preserves the other host',
    (...args: string[]) => {
      const fixture = createFixture()
      const before = protectedBytes(fixture)
      const result = runCli(fixture, args)
      expect(protectedBytes(fixture)).toEqual(before)
      expect(result.error, combinedOutput(result)).toBeUndefined()
      // An empty isolated Codex home may produce a failed installation diagnosis.
      expect([0, 1]).toContain(result.status)
      expect(combinedOutput(result)).toMatch(/CCG Doctor \(Codex\)/)
      expect(combinedOutput(result)).not.toMatch(/\.claude[/\\]commands|ccg init --force/)
    },
  )

  it.each([
    { args: ['providers', 'not-an-action'], exitCode: 1 },
    { args: ['deepseek-harness', 'not-an-action'], exitCode: 1 },
    { args: ['product-manager', 'not-an-action'], exitCode: 2 },
    { args: ['wrapper'], exitCode: 1 },
  ])('reaches native validation for request $args without calling a model', ({ args, exitCode }) => {
    const fixture = createFixture()
    const before = protectedBytes(fixture)
    const result = runCli(fixture, args)
    expect(protectedBytes(fixture)).toEqual(before)
    expect(result.error, combinedOutput(result)).toBeUndefined()
    expect(result.status, combinedOutput(result)).toBe(exitCode)
    expect(combinedOutput(result)).not.toMatch(/Claude-host|legacy Claude|only available.*Codex host/i)
  })

  it('rejects an explicitly selected Claude host even for a safe personal command', () => {
    const fixture = createFixture()
    const before = protectedBytes(fixture)
    const result = runCli(fixture, ['addons', '--json'], { CCG_HOST: 'claude' })
    expect(protectedBytes(fixture)).toEqual(before)
    expect(result.error, combinedOutput(result)).toBeUndefined()
    expect(result.status, combinedOutput(result)).toBe(1)
    expect(combinedOutput(result)).toMatch(explicitGuardFailure)
  })

  it('rejects the explicit Claude process marker without broadening permissions', () => {
    const fixture = createFixture()
    const before = protectedBytes(fixture)
    const result = runCli(fixture, ['addons', '--json'], { CLAUDECODE: '1' })
    expect(protectedBytes(fixture)).toEqual(before)
    expect(result.error, combinedOutput(result)).toBeUndefined()
    expect(result.status, combinedOutput(result)).toBe(1)
    expect(combinedOutput(result)).toMatch(explicitGuardFailure)
  })

  it('owns a separate package name and executable without claiming upstream ccg', () => {
    const document = JSON.parse(fs.readFileSync(path.join(repository, 'package.json'), 'utf8'))
    expect(document.name).toBe('@jed-zed/ccg-codex-workflow')
    expect(document.bin).toEqual({ 'ccg-codex': 'bin/ccg.mjs' })
  })
})
