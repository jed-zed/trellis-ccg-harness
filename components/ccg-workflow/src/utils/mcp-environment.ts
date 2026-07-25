const MCP_BASE_ENVIRONMENT_KEYS = [
  'PATH',
  'PATHEXT',
  'SystemRoot',
  'WINDIR',
  'ComSpec',
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'TMP',
  'TEMP',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
] as const

export function buildMcpEnvironment(
  approved: Record<string, string> = {},
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {}
  for (const key of MCP_BASE_ENVIRONMENT_KEYS) {
    const value = source[key]
    if (typeof value === 'string' && value.length > 0)
      environment[key] = value
  }
  for (const [key, value] of Object.entries(approved))
    environment[key] = value
  return environment
}
