import { lstatSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

function canonicalPath(path) {
  let ancestor = resolve(path)
  const suffix = []
  for (;;) {
    try {
      return resolve(realpathSync.native(ancestor), ...suffix)
    }
    catch (error) {
      if (error?.code !== 'ENOENT')
        throw error
      try {
        if (lstatSync(ancestor).isSymbolicLink())
          throw new Error(`Codex host boundary cannot resolve a dangling link: ${ancestor}`)
      }
      catch (metadataError) {
        if (metadataError?.code !== 'ENOENT')
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

function contains(root, target) {
  const delta = relative(root, target)
  return !delta || (delta !== '..' && !delta.startsWith(`..${sep}`) && !isAbsolute(delta))
}

export function assertCodexEngineHost(environment = process.env) {
  if (environment.CCG_HOST === 'claude' || environment.CLAUDECODE === '1')
    throw new Error('Personal CCG is Codex-only. Claude uses upstream CCG and the separate ccg-gptpro-bridge plugin.')
}

export function assertCodexHostPath(path, options = {}) {
  if (typeof path !== 'string' || !path.trim() || /[\u0000-\u001F\u007F]/u.test(path))
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
    if (contains(absoluteRoot, target) || contains(target, absoluteRoot)
      || contains(canonicalRoot, canonicalTarget) || contains(canonicalTarget, canonicalRoot))
      throw new Error(`Personal CCG requires a separate Codex home; the target overlaps Claude configuration: ${path}`)
  }
}

export function resolveCodexHome(configuredHome = process.env.CODEX_HOME, userHome = homedir()) {
  assertCodexEngineHost()
  const home = configuredHome?.trim() || join(userHome, '.codex')
  assertCodexHostPath(home, { userHome })
  return home
}

export function resolveCodexConfigPath(explicit) {
  assertCodexEngineHost()
  const configPath = resolve(explicit || join(resolveCodexHome(), 'ccg', 'config.toml'))
  assertCodexHostPath(configPath)
  return configPath
}
