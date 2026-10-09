import { lstatSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { join } from 'pathe'

export interface HostBoundaryOptions {
  userHome?: string
  claudeConfigDir?: string
}

// Resolve the existing ancestor as well as the missing suffix, so a new child of
// a Claude junction cannot evade the boundary before the child is created.
function canonicalPath(path: string): string {
  let ancestor = resolve(path)
  const suffix: string[] = []
  for (;;) {
    try {
      return resolve(realpathSync.native(ancestor), ...suffix)
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw error
      // An unresolved link is not a missing ordinary directory. Do not guess
      // where it will point if its target is subsequently created.
      try {
        if (lstatSync(ancestor).isSymbolicLink())
          throw new Error(`Codex host boundary cannot resolve a dangling link: ${ancestor}`)
      }
      catch (metadataError) {
        if ((metadataError as NodeJS.ErrnoException).code !== 'ENOENT')
          throw metadataError
      }
      const parent = dirname(ancestor)
      if (parent === ancestor)
        throw error
      suffix.unshift(basename(ancestor))
      ancestor = parent
    }
  }
}

function contains(root: string, target: string): boolean {
  const delta = relative(root, target)
  return !delta || (delta !== '..' && !delta.startsWith(`..${sep}`) && !isAbsolute(delta))
}

/** Personal Codex paths must never overlap the upstream Claude config tree. */
export function assertCodexHostPath(path: string, options: HostBoundaryOptions = {}): void {
  if (!path.trim() || /[\u0000-\u001F\u007F]/u.test(path))
    throw new Error('Codex host path must be a non-empty single-line path.')
  const claudeRoots = [join(options.userHome ?? homedir(), '.claude')]
  const configuredClaudeRoot = options.claudeConfigDir ?? process.env.CLAUDE_CONFIG_DIR
  if (configuredClaudeRoot?.trim())
    claudeRoots.push(configuredClaudeRoot.trim())
  const target = resolve(path)
  const canonicalTarget = canonicalPath(target)
  for (const root of claudeRoots) {
    const absoluteRoot = resolve(root)
    const canonicalRoot = canonicalPath(absoluteRoot)
    if (
      contains(absoluteRoot, target)
      || contains(target, absoluteRoot)
      || contains(canonicalRoot, canonicalTarget)
      || contains(canonicalTarget, canonicalRoot)
    ) {
      throw new Error(`Personal CCG requires a separate Codex home; the target overlaps Claude configuration: ${path}`)
    }
  }
}

export function resolveCodexHome(
  configuredHome = process.env.CODEX_HOME,
  userHome = homedir(),
): string {
  const home = configuredHome?.trim() || join(userHome, '.codex')
  assertCodexHostPath(home, { userHome })
  return home
}
