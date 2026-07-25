import { spawnSync } from 'node:child_process'

export interface PythonInvocation {
  command: string
  argsPrefix: string[]
  version: string
}

interface ProbeResult {
  ok: boolean
  version?: string
}

interface ResolvePythonOptions {
  platform?: NodeJS.Platform
  probe?: (command: string, argsPrefix: string[]) => ProbeResult
  locate?: (command: string, platform: NodeJS.Platform) => string
}

function parseVersion(value: string): string | undefined {
  return value.match(/\bPython\s+(\d+\.\d+\.\d+)\b/i)?.[1]
    ?? value.match(/\b(\d+\.\d+\.\d+)\b/)?.[1]
}

function versionAtLeast39(version: string): boolean {
  const [major, minor] = version.split('.').map(Number)
  return major > 3 || (major === 3 && minor >= 9)
}

function defaultProbe(command: string, argsPrefix: string[]): ProbeResult {
  const result = spawnSync(command, [...argsPrefix, '--version'], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 10_000,
  })
  const version = parseVersion(`${result.stdout ?? ''}\n${result.stderr ?? ''}`)
  return { ok: result.status === 0 && Boolean(version), version }
}

function defaultLocate(command: string, platform: NodeJS.Platform): string {
  const locator = platform === 'win32' ? 'where.exe' : 'which'
  const result = spawnSync(locator, [command], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 10_000,
  })
  const first = String(result.stdout ?? '').split(/\r?\n/).map(line => line.trim()).find(Boolean)
  return result.status === 0 && first ? first : command
}

export function resolvePythonInvocation(
  options: ResolvePythonOptions = {},
): PythonInvocation {
  const platform = options.platform ?? process.platform
  const probe = options.probe ?? defaultProbe
  const locate = options.locate ?? defaultLocate
  const candidates = platform === 'win32'
    ? [
        { command: 'py', argsPrefix: ['-3'] },
        { command: 'python', argsPrefix: [] },
        { command: 'python3', argsPrefix: [] },
      ]
    : [
        { command: 'python3', argsPrefix: [] },
        { command: 'python', argsPrefix: [] },
      ]

  for (const candidate of candidates) {
    const result = probe(candidate.command, candidate.argsPrefix)
    if (result.ok && result.version && versionAtLeast39(result.version)) {
      return {
        command: locate(candidate.command, platform),
        argsPrefix: candidate.argsPrefix,
        version: result.version,
      }
    }
  }
  throw new Error('Python 3.9 or newer is required, but no supported interpreter was found.')
}

function quoteExecutable(value: string, platform: NodeJS.Platform): string {
  if (platform === 'win32')
    return `"${value.replace(/"/g, '""')}"`
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function formatPythonCommand(
  invocation: PythonInvocation,
  platform: NodeJS.Platform = process.platform,
): string {
  return [quoteExecutable(invocation.command, platform), ...invocation.argsPrefix].join(' ')
}
