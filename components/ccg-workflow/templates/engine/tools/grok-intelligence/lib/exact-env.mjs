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
])

const OVERRIDDEN_NAMES = new Set([
  'HOME',
  'USERPROFILE',
  'GROK_HOME',
  'XAI_API_KEY',
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

  if (apiKey != null) {
    if (typeof apiKey !== 'string' || apiKey.trim().length === 0 || /[\r\n\0]/.test(apiKey))
      throw new Error('apiKey must be a non-empty single-line string')
    environment.XAI_API_KEY = apiKey
  }

  return environment
}
