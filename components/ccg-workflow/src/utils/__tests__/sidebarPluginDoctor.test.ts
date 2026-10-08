import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SIDEBAR_REQUIRED_FILES, sidebarSkillDirectories } from '../sidebar-skill'

const powershell = process.platform === 'win32'
  ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  : process.env.PATH?.split(delimiter).map(directory => join(directory, 'pwsh')).find(existsSync) || 'pwsh'
const powershellAvailable = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'], { windowsHide: true, timeout: 10_000 }).status === 0
const doctorScript = join(process.cwd(), 'plugins', 'ccg', 'scripts', 'doctor.ps1')
const pluginRoot = join(process.cwd(), 'plugins', 'ccg')
let root: string
let directories: string[]

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'ccg plugin sidebar doctor '))
  // PowerShell itself initializes profile directories when USERPROFILE is new.
  await fs.mkdir(join(root, 'user'))
  directories = sidebarSkillDirectories({ projectRoot: join(root, 'project'), codexHome: join(root, 'codex'), userHome: join(root, 'user') })
})
afterEach(async () => {
  if (root)
    await fs.rm(root, { recursive: true, force: true })
})

async function install(directory: string, files: readonly string[] = SIDEBAR_REQUIRED_FILES): Promise<void> {
  await fs.mkdir(join(directory, 'scripts'), { recursive: true })
  for (const file of files)
    await fs.writeFile(join(directory, file), 'throw "File checks must never execute this fixture"\n')
}

function runDoctor(gptpro = true) {
  const result = spawnSync(powershell, [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    doctorScript,
    '-CodexHome',
    join(root, 'codex'),
    '-PluginRoot',
    pluginRoot,
    '-ProjectRoot',
    join(root, 'project'),
    '-UserHome',
    join(root, 'user'),
    '-Json',
    ...(gptpro ? ['-GptPro'] : []),
  ], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20_000,
    env: { ...process.env, PATH: '', HOME: join(root, 'user'), USERPROFILE: join(root, 'user'), CODEX_HOME: join(root, 'codex') },
  })
  expect(result.error || result.stderr).toBeFalsy()
  return { exitCode: result.status, report: JSON.parse(result.stdout.replace(/^\uFEFF/, '')) }
}

describe.skipIf(!powershellAvailable)('PowerShell sidebar file doctor', () => {
  it('fails requested GPT Pro on a clean machine using files only', async () => {
    const { exitCode, report } = runDoctor()
    expect(exitCode).toBe(1)
    expect(report.checks).toEqual([
      expect.objectContaining({ name: 'GPT Pro sidebar files', status: 'FAIL', detail: expect.stringContaining('missing:') }),
      expect.objectContaining({ name: 'GPT Pro live transport', status: 'SKIP' }),
    ])
    expect(report.checks[0].recommendation).toContain('approved Harness installer')
    expect(await fs.readdir(root)).toEqual(['user'])
    for (const path of [...directories, join(root, 'user', '.claude')])
      await expect(fs.stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each([0, 1, 2])('uses complete location %i in priority order without executing entry scripts', async (selected) => {
    for (const directory of directories.slice(selected))
      await install(directory)
    const { exitCode, report } = runDoctor()
    expect(exitCode).toBe(0)
    expect(report.checks[0]).toMatchObject({ status: 'PASS', detail: expect.stringContaining('installed: Installed local files: ') })
    const installedPath = /installed: Installed local files: (.*?); browser connection/.exec(report.checks[0].detail)?.[1]
    expect(installedPath).toBeTruthy()
    expect(await fs.realpath(installedPath!)).toBe(await fs.realpath(directories[selected]))
    expect(report.checks[0].detail).toContain('browser connection and login were not checked')
  })

  it('fails a higher-priority incomplete installation instead of using a lower complete one', async () => {
    await install(directories[0], ['SKILL.md', 'scripts/chatgpt-pro-sidebar.ps1'])
    await install(directories[1])
    const { exitCode, report } = runDoctor()
    expect(exitCode).toBe(1)
    expect(report.checks[0].detail).toContain('broken:')
    expect(report.checks[0].detail).toContain(directories[0])
  })

  it('fails a non-regular SKILL.md before inspecting lower installations', async () => {
    await fs.mkdir(join(directories[0], 'SKILL.md'), { recursive: true })
    await install(directories[1])
    const { exitCode, report } = runDoctor()
    expect(exitCode).toBe(1)
    expect(report.checks[0].detail).toContain('Not a regular file:')
  })

  it('requires the direct JavaScript dependencies from the same installation', async () => {
    await install(directories[0], SIDEBAR_REQUIRED_FILES.filter(file => file !== 'scripts/chatgpt-pro-agent-browser-v2.js'))
    await install(directories[1])
    const { exitCode, report } = runDoctor()
    expect(exitCode).toBe(1)
    expect(report.checks[0].detail).toContain('chatgpt-pro-agent-browser-v2.js')
  })

  it('keeps independent sidebar missing optional when checking ordinary CCG assets', () => {
    const { report } = runDoctor(false)
    expect(report.checks).toContainEqual(expect.objectContaining({ name: 'CCG GPT Pro bridge assets', status: 'PASS' }))
    expect(report.checks).toContainEqual(expect.objectContaining({ name: 'GPT Pro sidebar files', status: 'WARN', detail: expect.stringContaining('missing:') }))
    expect(report.checks.some((check: any) => check.name === 'GPT Pro sidebar bridge')).toBe(false)
  })
})
