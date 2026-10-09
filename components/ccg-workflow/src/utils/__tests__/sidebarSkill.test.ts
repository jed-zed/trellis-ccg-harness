import childProcess from 'node:child_process'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sidebarDoctorCheck } from '../../commands/doctor'
import { inspectSidebarSkill, SIDEBAR_REQUIRED_FILES, sidebarSkillDirectories } from '../sidebar-skill'
import type { SidebarSkillRoots } from '../sidebar-skill'

let root: string
let roots: SidebarSkillRoots
let directories: string[]

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'ccg sidebar skill '))
  roots = { projectRoot: join(root, 'project'), codexHome: join(root, 'custom codex'), userHome: join(root, 'user') }
  directories = sidebarSkillDirectories(roots)
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(root, { recursive: true, force: true })
})

async function install(directory: string, files: readonly string[] = SIDEBAR_REQUIRED_FILES): Promise<void> {
  await fs.mkdir(join(directory, 'scripts'), { recursive: true })
  for (const file of files)
    await fs.writeFile(join(directory, file), `fixture: ${file}\n`)
}

describe('local sidebar Skill resolution', () => {
  it('reports missing across all three explicit locations', async () => {
    const result = await inspectSidebarSkill(roots)
    expect(result.status).toBe('missing')
    expect(result.candidates).toEqual([
      join(roots.projectRoot, '.agents', 'skills', 'chatgpt-pro-sidebar'),
      join(roots.codexHome, 'skills', 'chatgpt-pro-sidebar'),
      join(roots.userHome, '.agents', 'skills', 'chatgpt-pro-sidebar'),
    ])
    expect(result.directory).toBeUndefined()
  })

  it.each([0, 1, 2])('selects location %i before any complete lower-priority installation', async (selected) => {
    for (const directory of directories.slice(selected))
      await install(directory)
    const result = await inspectSidebarSkill(roots)
    expect(result.status).toBe('installed')
    expect(result.directory).toBe(await fs.realpath(directories[selected]))
    expect(result.detail).toContain('browser connection and login were not checked')
  })

  it('skips a candidate with scripts but no SKILL.md', async () => {
    await install(directories[0], SIDEBAR_REQUIRED_FILES.filter(file => file !== 'SKILL.md'))
    await install(directories[1])
    expect((await inspectSidebarSkill(roots)).directory).toBe(await fs.realpath(directories[1]))
  })

  it('refuses a non-regular SKILL.md even when a lower installation is complete', async () => {
    await fs.mkdir(join(directories[0], 'SKILL.md'), { recursive: true })
    await install(directories[1])
    const result = await inspectSidebarSkill(roots)
    expect(result.status).toBe('broken')
    expect(result.detail).toContain('Not a regular file:')
    expect(result.directory).toBe(directories[0])
  })

  it('fails closed for an existing unreadable SKILL.md', async () => {
    await install(directories[0])
    await install(directories[1])
    const selectedDirectory = await fs.realpath(directories[0])
    const readFile = fs.readFile.bind(fs)
    vi.spyOn(fs, 'readFile').mockImplementation(((path: string, options: any) => {
      if (String(path) === join(selectedDirectory, 'SKILL.md'))
        return Promise.reject(Object.assign(new Error('permission denied'), { code: 'EACCES', path }))
      return readFile(path, options)
    }) as typeof fs.readFile)
    const result = await inspectSidebarSkill(roots)
    expect(result.status).toBe('broken')
    expect(result.detail).toContain('EACCES')
    expect(result.directory).toBe(selectedDirectory)
  })

  it.each(SIDEBAR_REQUIRED_FILES.slice(1))('requires %s in the selected installation', async (missingFile) => {
    await install(directories[0], SIDEBAR_REQUIRED_FILES.filter(file => file !== missingFile))
    await install(directories[1])
    const result = await inspectSidebarSkill(roots)
    expect(result.status).toBe('broken')
    expect(result.detail).toContain(join(await fs.realpath(directories[0]), missingFile))
    expect(result.directory).toBe(await fs.realpath(directories[0]))
  })

  it('does not combine entry scripts from different installations', async () => {
    await install(directories[0], ['SKILL.md', 'scripts/chatgpt-pro-sidebar.ps1'])
    await install(directories[1], ['scripts/chatgpt-pro-sidebar-watch.ps1', 'scripts/chatgpt-pro-agent-browser-v2.js', 'scripts/chatgpt-pro-agent-browser-select-pro.js'])
    expect((await inspectSidebarSkill(roots)).status).toBe('broken')
  })

  it('rejects an empty required file', async () => {
    await install(directories[0])
    await fs.writeFile(join(directories[0], 'scripts/chatgpt-pro-sidebar-watch.ps1'), ' \n')
    expect((await inspectSidebarSkill(roots)).detail).toContain('Empty required file:')
  })

  it('does not launch subprocesses or browser/extension installers during local checks', async () => {
    await install(directories[1])
    const commands = ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync'] as const
    const spies = commands.map(command => vi.spyOn(childProcess, command).mockImplementation((() => {
      throw new Error('Local inspection must not execute a command')
    }) as any))
    expect((await inspectSidebarSkill(roots)).status).toBe('installed')
    expect((await sidebarDoctorCheck(true, roots)).detail).toContain('installed:')
    for (const spy of spies)
      expect(spy).not.toHaveBeenCalled()
  })

  it('makes missing/broken files required only for requested GPT Pro diagnostics', async () => {
    const optional = await sidebarDoctorCheck(false, roots)
    const required = await sidebarDoctorCheck(true, roots)
    expect(optional.status).not.toBe(required.status)
    expect(optional.detail).toContain('Optional for ordinary CCG workflows')
    expect(required.detail).toContain('approved Harness installer')
    expect(required.detail).toContain('CCG installation does not deploy this dependency')
    await install(directories[0], ['SKILL.md'])
    const broken = await sidebarDoctorCheck(true, roots)
    expect(broken.status).toBe(required.status)
    expect(broken.detail).toContain('broken:')
  })
})
