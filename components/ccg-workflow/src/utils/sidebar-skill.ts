import fs from 'node:fs/promises'
import { join } from 'node:path'

export interface SidebarSkillRoots {
  projectRoot: string
  codexHome: string
  userHome: string
}

// This is the bundled agent-browser-cli-v2 file contract, not a live transport check.
export const SIDEBAR_REQUIRED_FILES = [
  'SKILL.md',
  'scripts/chatgpt-pro-sidebar.ps1',
  'scripts/chatgpt-pro-sidebar-watch.ps1',
  'scripts/chatgpt-pro-agent-browser-v2.js',
  'scripts/chatgpt-pro-agent-browser-select-pro.js',
] as const

export interface SidebarSkillResult {
  status: 'installed' | 'missing' | 'broken'
  candidates: string[]
  directory?: string
  detail: string
}

export function sidebarSkillDirectories(roots: SidebarSkillRoots): string[] {
  return [
    join(roots.projectRoot, '.agents', 'skills', 'chatgpt-pro-sidebar'),
    join(roots.codexHome, 'skills', 'chatgpt-pro-sidebar'),
    join(roots.userHome, '.agents', 'skills', 'chatgpt-pro-sidebar'),
  ]
}

function errorCode(error: unknown): string {
  return (error as NodeJS.ErrnoException)?.code || 'read error'
}

/** Read local files only. An existing higher-priority installation owns the result. */
export async function inspectSidebarSkill(roots: SidebarSkillRoots): Promise<SidebarSkillResult> {
  const candidates = sidebarSkillDirectories(roots)
  for (const candidate of candidates) {
    const skillPath = join(candidate, 'SKILL.md')
    try {
      // lstat distinguishes an absent file from an unreadable or non-regular one.
      const skill = await fs.lstat(skillPath)
      if (!skill.isFile())
        return { status: 'broken', candidates, directory: candidate, detail: `Not a regular file: ${skillPath}` }
    }
    catch (error) {
      if (errorCode(error) === 'ENOENT')
        continue
      return { status: 'broken', candidates, directory: candidate, detail: `Cannot inspect ${skillPath} (${errorCode(error)})` }
    }

    let directory = candidate
    try {
      directory = await fs.realpath(candidate)
      for (const relativePath of SIDEBAR_REQUIRED_FILES) {
        const filePath = join(directory, relativePath)
        const file = await fs.lstat(filePath)
        if (!file.isFile())
          return { status: 'broken', candidates, directory, detail: `Not a regular file: ${filePath}` }
        if (!(await fs.readFile(filePath, 'utf8')).trim())
          return { status: 'broken', candidates, directory, detail: `Empty required file: ${filePath}` }
      }
      return { status: 'installed', candidates, directory, detail: `Installed local files: ${directory}; browser connection and login were not checked` }
    }
    catch (error) {
      const filePath = (error as NodeJS.ErrnoException)?.path || directory
      return { status: 'broken', candidates, directory, detail: `Required file unavailable: ${filePath} (${errorCode(error)})` }
    }
  }
  return { status: 'missing', candidates, detail: `SKILL.md absent in: ${candidates.join('; ')}` }
}

export function sidebarSkillInstallGuidance(candidates: string[]): string {
  return 'Install the complete independent chatgpt-pro-sidebar Skill with your approved Harness installer: Global Init '
    + '(node scripts/harness-init.mjs global-init; use the reviewed plan and approvals described in scripts/README.md), '
    + `or your approved Skill installer, into one of: ${candidates.join('; ')}. `
    + 'Repair an existing higher-priority installation first. CCG installation does not deploy this dependency.'
}
