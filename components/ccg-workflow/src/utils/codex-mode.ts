import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { isAbsolute, relative, resolve } from 'node:path'
import fs from 'fs-extra'
import { dirname, join } from 'pathe'
import { version as packageVersion } from '../../package.json'
import { readCcgConfig } from './config'
import { PACKAGE_ROOT, injectConfigVariables, replaceHomePathsInTemplate } from './installer-template'
import { formatPythonCommand, resolvePythonInvocation } from './python-resolver'

const START_MARKER = '<!-- CCG:START'
const END_MARKER = '<!-- CCG:END -->'

interface OriginalFile {
  sha256: string
  backupPath: string
}

interface ManagedFile {
  relativePath: string
  installedSha256: string
  original?: OriginalFile
}

interface OwnershipManifest {
  schemaVersion: 1
  version: string
  installedAt: string
  files: ManagedFile[]
  agentsBlock: {
    sha256: string
    installedFileSha256?: string
    backup?: OriginalFile
  }
  hookGroup: {
    event: string
    value: Record<string, unknown>
    sha256: string
    fileCreated: boolean
    installedFileSha256?: string
    backup?: OriginalFile
  }
}

export interface InstallCodexModeOptions {
  codexHome?: string
  templateDir?: string
  pythonCommand?: string
}

export interface UninstallCodexModeOptions {
  codexHome?: string
}

type CodexModeResult = { success: boolean, message: string }
type CodexModeUninstallResult = { success: boolean, removed: string[], skipped: string[] }

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function normalizedRelative(path: string): string {
  return path.replace(/\\/g, '/')
}

function ownedPath(root: string, relativePath: string): string {
  if (!relativePath || isAbsolute(relativePath))
    throw new Error(`Ownership manifest contains an unsafe path: ${relativePath}`)
  const canonicalRoot = resolve(root)
  const target = resolve(canonicalRoot, relativePath)
  const delta = relative(canonicalRoot, target)
  if (delta === '..' || delta.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(delta))
    throw new Error(`Ownership manifest path escapes Codex home: ${relativePath}`)
  return target
}

function managedBlock(content: string): string {
  const start = content.indexOf(START_MARKER)
  const end = content.indexOf(END_MARKER)
  if (start < 0 || end < start)
    throw new Error('Codex AGENTS template is missing its complete CCG managed block.')
  return content.slice(start, end + END_MARKER.length)
}

function locateManagedBlock(content: string): { start: number, end: number, block: string } | null {
  const starts = [...content.matchAll(/<!-- CCG:START/g)]
  const ends = [...content.matchAll(/<!-- CCG:END -->/g)]
  if (starts.length === 0 && ends.length === 0)
    return null
  if (starts.length !== 1 || ends.length !== 1 || ends[0].index! < starts[0].index!)
    throw new Error('Existing AGENTS.md has malformed or duplicate CCG managed markers.')
  const start = starts[0].index!
  const end = ends[0].index! + END_MARKER.length
  return { start, end, block: content.slice(start, end) }
}

function upsertManagedBlock(
  existing: string,
  block: string,
  previous?: OwnershipManifest['agentsBlock'],
): string {
  const located = locateManagedBlock(existing)
  if (!located) {
    const prefix = existing.length > 0 ? `${existing.replace(/\s+$/u, '')}\n\n` : ''
    return `${prefix}${block}\n`
  }
  if (!previous || sha256(located.block) !== previous.sha256)
    throw new Error('Existing CCG AGENTS.md block is not owned by this installation or was modified.')
  return `${existing.slice(0, located.start)}${block}${existing.slice(located.end)}`
}

function removeManagedBlock(
  existing: string,
  ownership: OwnershipManifest['agentsBlock'],
): string | null {
  const located = locateManagedBlock(existing)
  if (!located)
    return null
  if (sha256(located.block) !== ownership.sha256)
    return null
  const before = existing.slice(0, located.start).replace(/[ \t]*\r?\n?[ \t]*\r?\n?$/u, '')
  const after = existing.slice(located.end).replace(/^[ \t]*\r?\n?/u, '')
  return [before, after].filter(Boolean).join('\n')
}

function canonical(value: unknown): string {
  return JSON.stringify(value)
}

function shellQuote(value: string): string {
  if (process.platform === 'win32')
    return `"${value.replace(/"/g, '\\"')}"`
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function hookCommand(pythonCommand: string, scriptPath: string): string {
  return `${pythonCommand} ${shellQuote(scriptPath)}`
}

async function readJsonStrict(path: string, label: string): Promise<Record<string, any> | null> {
  if (!(await fs.pathExists(path)))
    return null
  try {
    const parsed = JSON.parse(await fs.readFile(path, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('root value must be an object')
    return parsed
  }
  catch (error) {
    throw new Error(`${label} is malformed; original bytes were preserved: ${error}`)
  }
}

async function atomicWrite(path: string, value: string | Buffer, mode = 0o600): Promise<void> {
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`
  try {
    await fs.ensureDir(dirname(path), 0o700)
    await fs.writeFile(temporary, value, { mode })
    if (process.platform !== 'win32')
      await fs.chmod(temporary, mode)
    await fs.move(temporary, path, { overwrite: true })
    if (process.platform !== 'win32')
      await fs.chmod(path, mode)
  }
  finally {
    await fs.remove(temporary)
  }
}

async function backupBytes(
  codexHome: string,
  backupRoot: string,
  relativePath: string,
  bytes: Buffer,
): Promise<OriginalFile> {
  const backupPath = join(backupRoot, relativePath)
  await atomicWrite(backupPath, bytes)
  return {
    sha256: sha256(bytes),
    backupPath: normalizedRelative(backupPath.slice(codexHome.length + 1)),
  }
}

async function readOwnership(path: string): Promise<OwnershipManifest | null> {
  const parsed = await readJsonStrict(path, 'Codex mode ownership manifest')
  if (!parsed)
    return null
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.files))
    throw new Error('Codex mode ownership manifest has an unsupported schema.')
  return parsed as OwnershipManifest
}

function templateHookGroup(template: Record<string, any>, command: string): {
  event: string
  group: Record<string, unknown>
} {
  const event = 'UserPromptSubmit'
  const groups = template.hooks?.[event]
  if (!Array.isArray(groups) || groups.length !== 1)
    throw new Error('Codex hooks template has an unexpected UserPromptSubmit shape.')
  const group = structuredClone(groups[0])
  if (!Array.isArray(group.hooks) || group.hooks.length !== 1)
    throw new Error('Codex hooks template has an unexpected command hook shape.')
  group.hooks[0].command = command
  return { event, group }
}

function mergeHookGroup(
  existing: Record<string, any>,
  event: string,
  group: Record<string, unknown>,
  previous?: OwnershipManifest['hookGroup'],
): Record<string, any> {
  const merged = structuredClone(existing)
  merged.hooks ??= {}
  merged.hooks[event] ??= []
  if (!Array.isArray(merged.hooks[event]))
    throw new Error(`Existing hooks.json ${event} entry is not an array.`)

  if (previous) {
    const index = merged.hooks[event].findIndex((entry: unknown) => canonical(entry) === canonical(previous.value))
    if (index < 0)
      throw new Error('Previously managed Codex hook was modified or removed; refusing to overwrite hooks.json.')
    merged.hooks[event].splice(index, 1)
  }
  else if (merged.hooks[event].some((entry: unknown) => canonical(entry) === canonical(group))) {
    throw new Error('A matching unowned CCG hook already exists; refusing to claim ownership.')
  }

  merged.hooks[event].push(group)
  return merged
}

function removeHookGroup(
  existing: Record<string, any>,
  ownership: OwnershipManifest['hookGroup'],
): { changed: boolean, config: Record<string, any> } {
  const config = structuredClone(existing)
  const groups = config.hooks?.[ownership.event]
  if (!Array.isArray(groups))
    return { changed: false, config }
  const index = groups.findIndex((entry: unknown) => canonical(entry) === canonical(ownership.value))
  if (index < 0)
    return { changed: false, config }
  groups.splice(index, 1)
  if (groups.length === 0)
    delete config.hooks[ownership.event]
  if (config.hooks && Object.keys(config.hooks).length === 0)
    delete config.hooks
  return { changed: true, config }
}

async function restoreSnapshot(path: string, value: Buffer | null): Promise<void> {
  if (value === null)
    await fs.remove(path)
  else
    await atomicWrite(path, value)
}

async function verifiedBackup(codexHome: string, original: OriginalFile): Promise<Buffer> {
  const backup = ownedPath(codexHome, original.backupPath)
  const bytes = await fs.readFile(backup)
  if (sha256(bytes) !== original.sha256)
    throw new Error(`Backup digest mismatch for ${original.backupPath}.`)
  return bytes
}

export async function installCodexModeAt(
  options: InstallCodexModeOptions = {},
): Promise<CodexModeResult> {
  const codexHome = options.codexHome ?? join(homedir(), '.codex')
  const templateDir = options.templateDir ?? join(PACKAGE_ROOT, 'templates', 'codex')
  const ownershipPath = join(codexHome, '.ccg', 'ownership.json')
  const hooksPath = join(codexHome, 'hooks.json')
  const agentsPath = join(codexHome, 'AGENTS.md')
  const pythonCommand = options.pythonCommand
    ?? formatPythonCommand(resolvePythonInvocation())

  if (!(await fs.pathExists(templateDir)))
    return { success: false, message: 'Codex template directory not found' }

  const snapshots = new Map<string, Buffer | null>()
  let attemptedBackupRoot: string | null = null
  try {
    const previous = await readOwnership(ownershipPath)
    const existingHooks = (await readJsonStrict(hooksPath, 'Codex hooks.json')) ?? {}
    const existingAgents = await fs.pathExists(agentsPath) ? await fs.readFile(agentsPath, 'utf8') : ''

    const config = await readCcgConfig()
    const injectOpts = {
      routing: config?.routing as any,
      liteMode: config?.performance?.liteMode || false,
      mcpProvider: config?.mcp?.provider || 'skip',
    }
    let agentsTemplate = await fs.readFile(join(templateDir, 'AGENTS.md'), 'utf8')
    agentsTemplate = injectConfigVariables(agentsTemplate, injectOpts)
    agentsTemplate = replaceHomePathsInTemplate(
      agentsTemplate,
      join(dirname(codexHome), '.claude'),
    )
    const block = managedBlock(agentsTemplate)
    const nextAgents = upsertManagedBlock(existingAgents, block, previous?.agentsBlock)

    const hookScriptPath = join(codexHome, 'hooks', 'ccg-workflow.py')
    const hooksTemplate = await readJsonStrict(join(templateDir, 'hooks.json'), 'Codex hooks template')
    if (!hooksTemplate)
      throw new Error('Codex hooks template is missing.')
    const { event, group } = templateHookGroup(
      hooksTemplate,
      hookCommand(pythonCommand, hookScriptPath),
    )
    const nextHooks = mergeHookGroup(existingHooks, event, group, previous?.hookGroup)

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupRoot = join(codexHome, '.ccg', 'backups', timestamp)
    attemptedBackupRoot = backupRoot
    const files: ManagedFile[] = []
    const previousFiles = new Map(previous?.files.map(file => [file.relativePath, file]) ?? [])
    const planned = new Map<string, Buffer>()

    const agentsTemplateDir = join(templateDir, 'agents')
    for (const name of (await fs.readdir(agentsTemplateDir)).sort()) {
      const relativePath = normalizedRelative(join('agents', name))
      planned.set(relativePath, await fs.readFile(join(agentsTemplateDir, name)))
    }

    const hooksTemplateDir = join(templateDir, 'hooks')
    for (const name of (await fs.readdir(hooksTemplateDir)).sort()) {
      const source = join(hooksTemplateDir, name)
      let bytes = await fs.readFile(source)
      if (name.endsWith('.py')) {
        const injected = injectConfigVariables(bytes.toString('utf8'), injectOpts)
        bytes = Buffer.from(injected, 'utf8')
      }
      planned.set(normalizedRelative(join('hooks', name)), bytes)
    }
    planned.set('.ccg-version', Buffer.from(packageVersion, 'utf8'))

    const configPath = join(codexHome, 'config.toml')
    const previousConfig = previousFiles.get('config.toml')
    if (!(await fs.pathExists(configPath)) || previousConfig)
      planned.set('config.toml', await fs.readFile(join(templateDir, 'config.toml')))

    for (const [relativePath, bytes] of planned) {
      const target = join(codexHome, relativePath)
      const current = await fs.pathExists(target) ? await fs.readFile(target) : null
      const prior = previousFiles.get(relativePath)
      let original = prior?.original
      if (prior) {
        if (!current || sha256(current) !== prior.installedSha256)
          throw new Error(`${relativePath} was modified after installation; refusing to overwrite it.`)
      }
      else if (current) {
        original = await backupBytes(codexHome, backupRoot, relativePath, current)
      }
      files.push({ relativePath, installedSha256: sha256(bytes), ...(original ? { original } : {}) })
    }

    const agentsBackup = existingAgents.length > 0 && !previous
      ? await backupBytes(codexHome, backupRoot, 'AGENTS.md', Buffer.from(existingAgents))
      : previous?.agentsBlock.backup
    const hooksBytes = await fs.pathExists(hooksPath) ? await fs.readFile(hooksPath) : null
    const hooksBackup = hooksBytes && !previous
      ? await backupBytes(codexHome, backupRoot, 'hooks.json', hooksBytes)
      : previous?.hookGroup.backup

    const touched = [
      agentsPath,
      hooksPath,
      ...[...planned.keys()].map(relativePath => join(codexHome, relativePath)),
      ownershipPath,
    ]
    for (const path of touched)
      snapshots.set(path, await fs.pathExists(path) ? await fs.readFile(path) : null)

    const nextHooksText = `${JSON.stringify(nextHooks, null, 2)}\n`
    await atomicWrite(agentsPath, nextAgents)
    await atomicWrite(hooksPath, nextHooksText)
    for (const [relativePath, bytes] of planned)
      await atomicWrite(join(codexHome, relativePath), bytes)

    const ownership: OwnershipManifest = {
      schemaVersion: 1,
      version: packageVersion,
      installedAt: new Date().toISOString(),
      files,
      agentsBlock: {
        sha256: sha256(block),
        installedFileSha256: sha256(nextAgents),
        ...(agentsBackup ? { backup: agentsBackup } : {}),
      },
      hookGroup: {
        event,
        value: group,
        sha256: sha256(canonical(group)),
        fileCreated: hooksBytes === null,
        installedFileSha256: sha256(nextHooksText),
        ...(hooksBackup ? { backup: hooksBackup } : {}),
      },
    }
    await atomicWrite(ownershipPath, `${JSON.stringify(ownership, null, 2)}\n`)

    return {
      success: true,
      message: `Codex mode installed with managed ownership at ${ownershipPath}`,
    }
  }
  catch (error) {
    for (const [path, value] of [...snapshots.entries()].reverse()) {
      try {
        await restoreSnapshot(path, value)
      }
      catch {
        // Preserve the primary failure; doctor can report any rollback residue.
      }
    }
    if (attemptedBackupRoot)
      await fs.remove(attemptedBackupRoot).catch(() => {})
    return { success: false, message: `Failed to install Codex mode: ${error}` }
  }
}

async function restoreManagedFile(
  codexHome: string,
  file: ManagedFile,
  removed: string[],
  skipped: string[],
): Promise<void> {
  const target = ownedPath(codexHome, file.relativePath)
  if (!(await fs.pathExists(target)))
    return
  const current = await fs.readFile(target)
  if (sha256(current) !== file.installedSha256) {
    skipped.push(`${file.relativePath} (modified after installation)`)
    return
  }

  if (file.original) {
    const original = await verifiedBackup(codexHome, file.original)
    await atomicWrite(target, original)
    removed.push(`${file.relativePath} (original restored)`)
  }
  else {
    await fs.remove(target)
    removed.push(file.relativePath)
  }
}

export async function uninstallCodexModeAt(
  options: UninstallCodexModeOptions = {},
): Promise<CodexModeUninstallResult> {
  const codexHome = options.codexHome ?? join(homedir(), '.codex')
  const ownershipPath = join(codexHome, '.ccg', 'ownership.json')
  const removed: string[] = []
  const skipped: string[] = []

  try {
    const ownership = await readOwnership(ownershipPath)
    if (!ownership) {
      return {
        success: true,
        removed,
        skipped: ['No CCG ownership manifest found; no global Codex files were changed.'],
      }
    }

    const agentsPath = join(codexHome, 'AGENTS.md')
    if (await fs.pathExists(agentsPath)) {
      const existingBytes = await fs.readFile(agentsPath)
      if (
        ownership.agentsBlock.backup
        && ownership.agentsBlock.installedFileSha256
        && sha256(existingBytes) === ownership.agentsBlock.installedFileSha256
      ) {
        await atomicWrite(
          agentsPath,
          await verifiedBackup(codexHome, ownership.agentsBlock.backup),
        )
        removed.push('AGENTS.md (original restored)')
      }
      else {
        const withoutBlock = removeManagedBlock(existingBytes.toString('utf8'), ownership.agentsBlock)
        if (withoutBlock === null) {
          skipped.push('AGENTS.md (managed block was modified)')
        }
        else if (withoutBlock.length === 0) {
          await fs.remove(agentsPath)
          removed.push('AGENTS.md')
        }
        else {
          await atomicWrite(agentsPath, withoutBlock)
          removed.push('AGENTS.md (managed block)')
        }
      }
    }

    const hooksPath = join(codexHome, 'hooks.json')
    if (await fs.pathExists(hooksPath)) {
      const existingBytes = await fs.readFile(hooksPath)
      if (
        ownership.hookGroup.backup
        && ownership.hookGroup.installedFileSha256
        && sha256(existingBytes) === ownership.hookGroup.installedFileSha256
      ) {
        await atomicWrite(
          hooksPath,
          await verifiedBackup(codexHome, ownership.hookGroup.backup),
        )
        removed.push('hooks.json (original restored)')
      }
      else {
        const existing = await readJsonStrict(hooksPath, 'Codex hooks.json')
        const result = removeHookGroup(existing ?? {}, ownership.hookGroup)
        if (!result.changed) {
          skipped.push('hooks.json (managed hook was modified)')
        }
        else if (Object.keys(result.config).length === 0 && ownership.hookGroup.fileCreated) {
          await fs.remove(hooksPath)
          removed.push('hooks.json')
        }
        else {
          await atomicWrite(hooksPath, `${JSON.stringify(result.config, null, 2)}\n`)
          removed.push('hooks.json (managed hook)')
        }
      }
    }

    for (const file of [...ownership.files].reverse())
      await restoreManagedFile(codexHome, file, removed, skipped)

    if (skipped.length === 0) {
      await fs.remove(ownershipPath)
      removed.push('.ccg/ownership.json')
    }
    return { success: true, removed, skipped }
  }
  catch (error) {
    return { success: false, removed, skipped: [...skipped, `Error: ${error}`] }
  }
}
