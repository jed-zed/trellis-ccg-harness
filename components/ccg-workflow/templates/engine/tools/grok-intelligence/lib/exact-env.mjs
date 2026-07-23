import { isAbsolute, resolve } from 'node:path'

export const INTELLIGENCE_ENV_ALLOWLIST = Object.freeze([
  'PATH',
  'HOME',
  'USERPROFILE',
  'GROK_HOME',
  'TEMP',
  'TMP',
  'TMPDIR',
  'SystemRoot',
  'WINDIR',
  'ComSpec',
  'PATHEXT',
  'LANG',
  'LC_ALL',
  'XAI_API_KEY',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
  'GROK_DISABLE_AUTOUPDATER',
  'GROK_WRITE_FILE',
  'GROK_TOOL_SEARCH',
  'GROK_MEMORY',
  'GROK_SUBAGENTS',
  'GROK_WEB_FETCH',
  'GROK_CRASH_HANDLER',
  'GROK_CURSOR_SKILLS_ENABLED',
  'GROK_CURSOR_RULES_ENABLED',
  'GROK_CURSOR_AGENTS_ENABLED',
  'GROK_CURSOR_MCPS_ENABLED',
  'GROK_CURSOR_HOOKS_ENABLED',
  'GROK_CLAUDE_SKILLS_ENABLED',
  'GROK_CLAUDE_RULES_ENABLED',
  'GROK_CLAUDE_AGENTS_ENABLED',
  'GROK_CLAUDE_MCPS_ENABLED',
  'GROK_CLAUDE_HOOKS_ENABLED',
  'GROK_CURSOR_SESSIONS_ENABLED',
  'GROK_CLAUDE_SESSIONS_ENABLED',
  'GROK_CODEX_SKILLS_ENABLED',
  'GROK_CODEX_RULES_ENABLED',
  'GROK_CODEX_AGENTS_ENABLED',
  'GROK_CODEX_MCPS_ENABLED',
  'GROK_CODEX_HOOKS_ENABLED',
  'GROK_CODEX_SESSIONS_ENABLED',
  'GROK_MANAGED_MCPS_ENABLED',
  'GROK_MCP_AUTO_RESTART',
])

export const FORCED_GROK_ENV = Object.freeze({
  GROK_DISABLE_AUTOUPDATER: '1',
  GROK_WRITE_FILE: '0',
  GROK_TOOL_SEARCH: '0',
  GROK_MEMORY: '0',
  GROK_SUBAGENTS: '0',
  GROK_WEB_FETCH: '0',
  GROK_CRASH_HANDLER: '0',
  GROK_CURSOR_SKILLS_ENABLED: '0',
  GROK_CURSOR_RULES_ENABLED: '0',
  GROK_CURSOR_AGENTS_ENABLED: '0',
  GROK_CURSOR_MCPS_ENABLED: '0',
  GROK_CURSOR_HOOKS_ENABLED: '0',
  GROK_CURSOR_SESSIONS_ENABLED: '0',
  GROK_CLAUDE_SKILLS_ENABLED: '0',
  GROK_CLAUDE_RULES_ENABLED: '0',
  GROK_CLAUDE_AGENTS_ENABLED: '0',
  GROK_CLAUDE_MCPS_ENABLED: '0',
  GROK_CLAUDE_HOOKS_ENABLED: '0',
  GROK_CLAUDE_SESSIONS_ENABLED: '0',
  GROK_CODEX_SKILLS_ENABLED: '0',
  GROK_CODEX_RULES_ENABLED: '0',
  GROK_CODEX_AGENTS_ENABLED: '0',
  GROK_CODEX_MCPS_ENABLED: '0',
  GROK_CODEX_HOOKS_ENABLED: '0',
  GROK_CODEX_SESSIONS_ENABLED: '0',
  GROK_MANAGED_MCPS_ENABLED: '0',
  GROK_MCP_AUTO_RESTART: '0',
})

const OVERRIDDEN_NAMES = new Set([
  'HOME',
  'USERPROFILE',
  'GROK_HOME',
  'XAI_API_KEY',
  ...Object.keys(FORCED_GROK_ENV),
])

function readEnvironmentValue(sourceEnv, name, platform) {
  if (sourceEnv[name] != null)
    return sourceEnv[name]
  if (platform !== 'win32')
    return undefined
  const matchedName = Object.keys(sourceEnv).find(key => key.toLowerCase() === name.toLowerCase())
  return matchedName ? sourceEnv[matchedName] : undefined
}

function requireAbsoluteDirectoryPath(value, name) {
  if (typeof value !== 'string' || value.length === 0 || !isAbsolute(value))
    throw new Error(`${name} must be an absolute directory path`)
  if (value.includes('\0'))
    throw new Error(`${name} contains a NUL byte`)
  return resolve(value)
}

export function buildExactGrokEnvironment({
  sourceEnv = {},
  neutralHome,
  grokHome,
  apiKey,
  platform = process.platform,
}) {
  const safeNeutralHome = requireAbsoluteDirectoryPath(neutralHome, 'neutralHome')
  const safeGrokHome = requireAbsoluteDirectoryPath(grokHome, 'grokHome')
  const environment = {}

  for (const name of INTELLIGENCE_ENV_ALLOWLIST) {
    if (OVERRIDDEN_NAMES.has(name))
      continue
    const value = readEnvironmentValue(sourceEnv, name, platform)
    if (value != null && String(value).length > 0)
      environment[name] = String(value)
  }

  environment.HOME = safeNeutralHome
  environment.USERPROFILE = safeNeutralHome
  environment.GROK_HOME = safeGrokHome
  Object.assign(environment, FORCED_GROK_ENV)

  if (apiKey != null) {
    if (typeof apiKey !== 'string' || apiKey.trim().length === 0 || /[\r\n\0]/.test(apiKey))
      throw new Error('apiKey must be a non-empty single-line string')
    environment.XAI_API_KEY = apiKey
  }

  return environment
}
