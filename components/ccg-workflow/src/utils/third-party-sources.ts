import { execFileSync } from 'node:child_process'
import { basename } from 'node:path'
import fs from 'fs-extra'
import { join } from 'pathe'
import { PACKAGE_ROOT } from './installer-template'

export interface NpmExecutableSource {
  package: string
  version: string
  selector: string
  integrity: string
  bin: string
}

interface GitExecutableSource {
  repository: string
  commit: string
  selector: string
}

interface ThirdPartySources {
  schemaVersion: number
  npmExecutables: Record<string, NpmExecutableSource>
  gitExecutables: Record<string, GitExecutableSource>
}

const manifestPath = join(PACKAGE_ROOT, 'third-party-sources.json')
const manifest = fs.readJsonSync(manifestPath) as ThirdPartySources

if (manifest.schemaVersion !== 1) {
  throw new Error(`Unsupported third-party source manifest schema: ${manifest.schemaVersion}`)
}

export function npmExecutableSource(packageName: string): Readonly<NpmExecutableSource> {
  const source = manifest.npmExecutables[packageName]
  if (!source || source.package !== packageName || source.selector !== `${source.package}@${source.version}`) {
    throw new Error(`No trusted npm executable source is recorded for ${packageName}.`)
  }
  return source
}

export function npmSelector(packageName: string): string {
  return npmExecutableSource(packageName).selector
}

function normalizeIntegrity(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('"')) {
    const parsed = JSON.parse(trimmed)
    if (typeof parsed !== 'string')
      throw new TypeError('npm registry returned a non-string integrity value.')
    return parsed
  }
  return trimmed
}

export function assertNpmExecutableIntegrity(
  packageName: string,
  observedIntegrity: string,
): Readonly<NpmExecutableSource> {
  const source = npmExecutableSource(packageName)
  const actual = normalizeIntegrity(observedIntegrity)
  if (actual !== source.integrity) {
    throw new Error(
      `Integrity mismatch for ${source.selector}; refusing to execute an unreviewed npm package.`,
    )
  }
  return source
}

type IntegrityLookup = (selector: string) => Promise<string>

async function lookupRegistryIntegrity(selector: string): Promise<string> {
  return execFileSync(
    'npm',
    ['view', selector, 'dist.integrity', '--json'],
    {
      encoding: 'utf8',
      timeout: 30_000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
}

export async function verifyPinnedNpmCommand(
  command: string,
  args: readonly string[],
  lookup: IntegrityLookup = lookupRegistryIntegrity,
): Promise<void> {
  const executable = basename(command).toLowerCase()
  if (executable !== 'npx' && executable !== 'npx.cmd')
    return

  const source = Object.values(manifest.npmExecutables)
    .find(candidate => args.includes(candidate.selector))
  if (!source) {
    throw new Error(
      'npx command does not contain a trusted exact package selector; refusing to configure it.',
    )
  }

  const observedIntegrity = await lookup(source.selector)
  assertNpmExecutableIntegrity(source.package, observedIntegrity)
}

export async function verifyPinnedExecutableCommand(
  command: string,
  args: readonly string[],
  lookup?: IntegrityLookup,
): Promise<void> {
  const executable = basename(command).toLowerCase()
  if (executable === 'npx' || executable === 'npx.cmd') {
    await verifyPinnedNpmCommand(command, args, lookup)
    return
  }

  if (executable === 'uvx' || executable === 'uvx.exe') {
    const source = Object.values(manifest.gitExecutables)
      .find(candidate => args.includes(candidate.selector))
    if (!source) {
      throw new Error(
        'uvx command does not contain a trusted immutable Git commit selector; refusing to configure it.',
      )
    }
  }
}

export function gitExecutableSource(name: string): Readonly<GitExecutableSource> {
  const source = manifest.gitExecutables[name]
  if (!source || !/^[a-f0-9]{40}$/.test(source.commit) || !source.selector.includes(source.commit)) {
    throw new Error(`No immutable Git executable source is recorded for ${name}.`)
  }
  return source
}
