import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { isAbsolute, relative, resolve } from 'node:path'
import fs from 'fs-extra'
import { join } from 'pathe'
import { stringify } from 'smol-toml'
import { version as packageVersion } from '../../package.json'
import { readCcgConfigAt } from './config'
import { PACKAGE_ROOT, injectConfigVariables } from './installer-template'
import {
  assertManagedPath,
  ensureManagedRoot,
  safeManagedAtomicWrite,
  safeManagedEnsureDirectory,
  safeManagedRead,
  safeManagedRemoveDirectory,
  safeManagedRemoveFile,
} from './managed-path'
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

export interface OwnershipManifest {
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
type CodexModeRecoveryResult = {
  success: boolean
  recovered: boolean
  message: string
}

interface CodexModeTransactionSnapshot {
  relativePath: string
  present: boolean
  sha256?: string
  snapshotPath?: string
}

interface CodexModeTransactionJournal {
  schemaVersion: 1
  id: string
  operation: 'install' | 'uninstall'
  createdAt: string
  snapshots: CodexModeTransactionSnapshot[]
}

const TRANSACTION_JOURNAL_PATH = '.ccg/transaction.json'

export function resolveCodexHome(
  configuredHome = process.env.CODEX_HOME,
  userHome = homedir(),
): string {
  return configuredHome?.trim() || join(userHome, '.codex')
}

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

function managedRelativePath(codexHome: string, path: string): string {
  const absolute = ownedPath(codexHome, normalizedRelative(relative(codexHome, path)))
  return normalizedRelative(relative(codexHome, absolute))
}

async function atomicWrite(
  codexHome: string,
  path: string,
  value: string | Buffer,
  mode = 0o600,
): Promise<void> {
  await safeManagedAtomicWrite(
    codexHome,
    managedRelativePath(codexHome, path),
    value,
    mode,
  )
}

function planBackupBytes(
  codexHome: string,
  backupRoot: string,
  relativePath: string,
  bytes: Buffer,
  plannedBackups: Map<string, Buffer>,
): OriginalFile {
  const backupPath = join(backupRoot, relativePath)
  const backupRelative = normalizedRelative(backupPath.slice(codexHome.length + 1))
  plannedBackups.set(backupRelative, bytes)
  return {
    sha256: sha256(bytes),
    backupPath: backupRelative,
  }
}

function assertPlainObject(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object.`)
}

function assertKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const allowed = new Set([...required, ...optional])
  if (
    required.some(key => !(key in value))
    || Object.keys(value).some(key => !allowed.has(key))
  ) {
    throw new Error(`${label} has an invalid schema.`)
  }
}

function validateDigest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    throw new Error(`${label} has an invalid SHA-256 digest.`)
  return value
}

function validateManagedRelativePath(value: unknown): string {
  if (typeof value !== 'string')
    throw new Error('Codex mode ownership path must be a string.')
  const normalized = normalizedRelative(value)
  const allowed = normalized === '.ccg-version'
    || normalized === 'config.toml'
    || normalized === 'ccg/config.toml'
    || /^(?:agents|hooks)\/[a-z0-9._-]+$/i.test(normalized)
  if (!allowed || normalized.includes('..'))
    throw new Error(`Codex mode ownership contains an unsafe path: ${value}`)
  return normalized
}

function validateOriginalFile(
  value: unknown,
  managedRelative: string,
  label: string,
): OriginalFile {
  assertPlainObject(value, label)
  assertKeys(value, ['sha256', 'backupPath'], [], label)
  if (typeof value.backupPath !== 'string')
    throw new Error(`${label} backup path must be a string.`)
  const backupPath = normalizedRelative(value.backupPath)
  if (
    !/^\.ccg\/backups\/[^/]+\/.+$/u.test(backupPath)
    || !backupPath.endsWith(`/${managedRelative}`)
    || backupPath.includes('/../')
  ) {
    throw new Error(`${label} backup path is invalid.`)
  }
  return {
    sha256: validateDigest(value.sha256, label),
    backupPath,
  }
}

function validateManagedFile(value: unknown): ManagedFile {
  assertPlainObject(value, 'Codex mode managed file')
  assertKeys(
    value,
    ['relativePath', 'installedSha256'],
    ['original'],
    'Codex mode managed file',
  )
  const relativePath = validateManagedRelativePath(value.relativePath)
  return {
    relativePath,
    installedSha256: validateDigest(
      value.installedSha256,
      `Codex mode managed file ${relativePath}`,
    ),
    ...(value.original === undefined
      ? {}
      : {
          original: validateOriginalFile(
            value.original,
            relativePath,
            `Codex mode managed file ${relativePath}`,
          ),
        }),
  }
}

function validateAgentsBlock(value: unknown): OwnershipManifest['agentsBlock'] {
  assertPlainObject(value, 'Codex mode agents ownership')
  assertKeys(
    value,
    ['sha256'],
    ['installedFileSha256', 'backup'],
    'Codex mode agents ownership',
  )
  return {
    sha256: validateDigest(value.sha256, 'Codex mode agents block'),
    ...(value.installedFileSha256 === undefined
      ? {}
      : {
          installedFileSha256: validateDigest(
            value.installedFileSha256,
            'Codex mode AGENTS.md',
          ),
        }),
    ...(value.backup === undefined
      ? {}
      : {
          backup: validateOriginalFile(
            value.backup,
            'AGENTS.md',
            'Codex mode AGENTS.md',
          ),
        }),
  }
}

function validateHookGroup(value: unknown): OwnershipManifest['hookGroup'] {
  assertPlainObject(value, 'Codex mode hook ownership')
  assertKeys(
    value,
    ['event', 'value', 'sha256', 'fileCreated'],
    ['installedFileSha256', 'backup'],
    'Codex mode hook ownership',
  )
  if (value.event !== 'UserPromptSubmit' || typeof value.fileCreated !== 'boolean')
    throw new Error('Codex mode hook ownership metadata is invalid.')
  assertPlainObject(value.value, 'Codex mode managed hook group')
  const hookValue = structuredClone(value.value)
  const hookDigest = validateDigest(value.sha256, 'Codex mode hook group')
  if (sha256(canonical(hookValue)) !== hookDigest)
    throw new Error('Codex mode hook ownership digest does not match its value.')
  return {
    event: value.event,
    value: hookValue,
    sha256: hookDigest,
    fileCreated: value.fileCreated,
    ...(value.installedFileSha256 === undefined
      ? {}
      : {
          installedFileSha256: validateDigest(
            value.installedFileSha256,
            'Codex mode hooks.json',
          ),
        }),
    ...(value.backup === undefined
      ? {}
      : {
          backup: validateOriginalFile(
            value.backup,
            'hooks.json',
            'Codex mode hooks.json',
          ),
        }),
  }
}

export function validateOwnershipManifest(value: unknown): OwnershipManifest {
  assertPlainObject(value, 'Codex mode ownership manifest')
  assertKeys(
    value,
    [
      'schemaVersion',
      'version',
      'installedAt',
      'files',
      'agentsBlock',
      'hookGroup',
    ],
    [],
    'Codex mode ownership manifest',
  )
  if (
    value.schemaVersion !== 1
    || typeof value.version !== 'string'
    || typeof value.installedAt !== 'string'
    || !Array.isArray(value.files)
    || Number.isNaN(Date.parse(value.installedAt))
  ) {
    throw new Error('Codex mode ownership manifest has an unsupported schema.')
  }
  const files = value.files.map(validateManagedFile)
  if (new Set(files.map(file => file.relativePath)).size !== files.length)
    throw new Error('Codex mode ownership manifest contains duplicate paths.')
  return {
    schemaVersion: 1,
    version: value.version,
    installedAt: value.installedAt,
    files,
    agentsBlock: validateAgentsBlock(value.agentsBlock),
    hookGroup: validateHookGroup(value.hookGroup),
  }
}

async function readOwnership(path: string): Promise<OwnershipManifest | null> {
  const parsed = await readJsonStrict(path, 'Codex mode ownership manifest')
  if (!parsed)
    return null
  return validateOwnershipManifest(parsed)
}

function validateTransactionTarget(value: unknown): string {
  if (typeof value !== 'string')
    throw new Error('Codex mode transaction target must be a string.')
  const normalized = normalizedRelative(value)
  const allowed = normalized === 'AGENTS.md'
    || normalized === 'hooks.json'
    || normalized === 'config.toml'
    || normalized === 'ccg/config.toml'
    || normalized === '.ccg-version'
    || normalized === '.ccg/ownership.json'
    || /^(?:agents|hooks)\/[a-z0-9._-]+$/i.test(normalized)
    || /^\.ccg\/backups\/[^/]+\/(?:AGENTS\.md|hooks\.json|config\.toml|ccg\/config\.toml|\.ccg-version|(?:agents|hooks)\/[a-z0-9._-]+)$/i.test(normalized)
  if (!allowed || normalized.includes('..'))
    throw new Error(`Codex mode transaction target is invalid: ${value}`)
  return normalized
}

function validateTransactionJournal(value: unknown): CodexModeTransactionJournal {
  assertPlainObject(value, 'Codex mode transaction journal')
  assertKeys(
    value,
    ['schemaVersion', 'id', 'operation', 'createdAt', 'snapshots'],
    [],
    'Codex mode transaction journal',
  )
  if (
    value.schemaVersion !== 1
    || typeof value.id !== 'string'
    || !/^[a-f0-9-]{36}$/i.test(value.id)
    || (value.operation !== 'install' && value.operation !== 'uninstall')
    || typeof value.createdAt !== 'string'
    || Number.isNaN(Date.parse(value.createdAt))
    || !Array.isArray(value.snapshots)
  ) {
    throw new Error('Codex mode transaction journal has an invalid schema.')
  }

  const snapshots = value.snapshots.map((snapshot, index) => {
    assertPlainObject(snapshot, 'Codex mode transaction snapshot')
    assertKeys(
      snapshot,
      ['relativePath', 'present'],
      ['sha256', 'snapshotPath'],
      'Codex mode transaction snapshot',
    )
    const relativePath = validateTransactionTarget(snapshot.relativePath)
    if (typeof snapshot.present !== 'boolean')
      throw new Error('Codex mode transaction snapshot presence is invalid.')
    if (!snapshot.present) {
      if (snapshot.sha256 !== undefined || snapshot.snapshotPath !== undefined)
        throw new Error('Missing Codex transaction snapshot has unexpected data.')
      return { relativePath, present: false } satisfies CodexModeTransactionSnapshot
    }
    const expectedSnapshotPath = `.ccg/transactions/${value.id}/snapshots/${index}.bin`
    if (snapshot.snapshotPath !== expectedSnapshotPath)
      throw new Error('Codex mode transaction snapshot path is invalid.')
    return {
      relativePath,
      present: true,
      sha256: validateDigest(
        snapshot.sha256,
        'Codex mode transaction snapshot',
      ),
      snapshotPath: expectedSnapshotPath,
    } satisfies CodexModeTransactionSnapshot
  })
  if (new Set(snapshots.map(entry => entry.relativePath)).size !== snapshots.length)
    throw new Error('Codex mode transaction journal contains duplicate targets.')
  return {
    schemaVersion: 1,
    id: value.id,
    operation: value.operation,
    createdAt: value.createdAt,
    snapshots,
  }
}

async function readTransactionJournal(
  codexHome: string,
): Promise<CodexModeTransactionJournal | null> {
  await safeManagedEnsureDirectory(codexHome, '.ccg')
  const bytes = await safeManagedRead(codexHome, TRANSACTION_JOURNAL_PATH)
  if (!bytes)
    return null
  let parsed: unknown
  try {
    parsed = JSON.parse(bytes.toString('utf8'))
  }
  catch (error) {
    throw new Error(`Codex mode transaction journal is malformed: ${error}`)
  }
  return validateTransactionJournal(parsed)
}

async function beginCodexModeTransaction(
  codexHome: string,
  operation: CodexModeTransactionJournal['operation'],
  relativePaths: string[],
): Promise<CodexModeTransactionJournal> {
  const pending = await readTransactionJournal(codexHome)
  if (pending) {
    throw new Error(
      `Interrupted Codex mode ${pending.operation} transaction requires recovery. `
      + 'Run `ccg codex-mode recover` first.',
    )
  }

  const id = randomUUID()
  const transactionRoot = `.ccg/transactions/${id}`
  await safeManagedEnsureDirectory(codexHome, `${transactionRoot}/snapshots`)
  const targets = [...new Set(relativePaths.map(validateTransactionTarget))].sort()
  const snapshots: CodexModeTransactionSnapshot[] = []
  try {
    for (const [index, relativePath] of targets.entries()) {
      await assertManagedPath(
        codexHome,
        relativePath,
        'missing-or-file',
        true,
      )
      const bytes = await safeManagedRead(codexHome, relativePath)
      if (!bytes) {
        snapshots.push({ relativePath, present: false })
        continue
      }
      const snapshotPath = `${transactionRoot}/snapshots/${index}.bin`
      await safeManagedAtomicWrite(codexHome, snapshotPath, bytes)
      snapshots.push({
        relativePath,
        present: true,
        sha256: sha256(bytes),
        snapshotPath,
      })
    }
    const journal: CodexModeTransactionJournal = {
      schemaVersion: 1,
      id,
      operation,
      createdAt: new Date().toISOString(),
      snapshots,
    }
    await safeManagedAtomicWrite(
      codexHome,
      TRANSACTION_JOURNAL_PATH,
      `${JSON.stringify(journal, null, 2)}\n`,
    )
    return journal
  }
  catch (error) {
    await safeManagedRemoveDirectory(codexHome, transactionRoot).catch(() => {})
    throw error
  }
}

async function finishCodexModeTransaction(
  codexHome: string,
  journal: CodexModeTransactionJournal,
): Promise<void> {
  await safeManagedRemoveFile(codexHome, TRANSACTION_JOURNAL_PATH)
  await safeManagedRemoveDirectory(
    codexHome,
    `.ccg/transactions/${journal.id}`,
  ).catch(() => {
    // The journal deletion is the commit point. Orphaned private snapshots are
    // inert and can be cleaned later without rolling back a committed result.
  })
}

function testCrashAfterMutation(mutationCount: number): void {
  const requested = Number(process.env.CCG_CODEX_MODE_TEST_CRASH_AFTER_MUTATION)
  if (
    process.env.NODE_ENV === 'test'
    && Number.isSafeInteger(requested)
    && requested > 0
    && mutationCount === requested
  ) {
    process.kill(process.pid, 'SIGKILL')
  }
}

export async function recoverCodexModeAt(
  options: UninstallCodexModeOptions = {},
): Promise<CodexModeRecoveryResult> {
  const codexHome = options.codexHome ?? resolveCodexHome()
  try {
    await ensureManagedRoot(codexHome)
    const journal = await readTransactionJournal(codexHome)
    if (!journal) {
      return {
        success: true,
        recovered: false,
        message: 'No interrupted Codex mode transaction was found.',
      }
    }

    const recovery: Array<{
      relativePath: string
      bytes: Buffer | null
    }> = []
    for (const snapshot of journal.snapshots) {
      await assertManagedPath(
        codexHome,
        snapshot.relativePath,
        'missing-or-file',
        true,
      )
      if (!snapshot.present) {
        recovery.push({ relativePath: snapshot.relativePath, bytes: null })
        continue
      }
      const bytes = await safeManagedRead(codexHome, snapshot.snapshotPath!)
      if (!bytes || sha256(bytes) !== snapshot.sha256)
        throw new Error(`Transaction snapshot is missing or corrupt: ${snapshot.snapshotPath}`)
      recovery.push({ relativePath: snapshot.relativePath, bytes })
    }

    for (const entry of [...recovery].reverse()) {
      if (entry.bytes)
        await safeManagedAtomicWrite(codexHome, entry.relativePath, entry.bytes)
      else
        await safeManagedRemoveFile(codexHome, entry.relativePath)
    }
    await finishCodexModeTransaction(codexHome, journal)
    return {
      success: true,
      recovered: true,
      message: `Recovered interrupted Codex mode ${journal.operation} transaction.`,
    }
  }
  catch (error) {
    return {
      success: false,
      recovered: false,
      message: `Failed to recover Codex mode transaction: ${error}`,
    }
  }
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

async function verifiedBackup(codexHome: string, original: OriginalFile): Promise<Buffer> {
  const backup = await assertManagedPath(
    codexHome,
    original.backupPath,
    'file',
  )
  const bytes = await fs.readFile(backup)
  if (sha256(bytes) !== original.sha256)
    throw new Error(`Backup digest mismatch for ${original.backupPath}.`)
  return bytes
}

export async function installCodexModeAt(
  options: InstallCodexModeOptions = {},
): Promise<CodexModeResult> {
  const codexHome = options.codexHome ?? resolveCodexHome()
  const templateDir = options.templateDir ?? join(PACKAGE_ROOT, 'templates', 'codex')
  const ownershipPath = join(codexHome, '.ccg', 'ownership.json')
  const hooksPath = join(codexHome, 'hooks.json')
  const agentsPath = join(codexHome, 'AGENTS.md')
  const pythonCommand = options.pythonCommand
    ?? formatPythonCommand(resolvePythonInvocation())

  if (!(await fs.pathExists(templateDir)))
    return { success: false, message: 'Codex template directory not found' }

  let transaction: CodexModeTransactionJournal | null = null
  let mutationCount = 0
  try {
    await ensureManagedRoot(codexHome)
    for (const relativePath of [
      '.ccg/ownership.json',
      'ccg/config.toml',
      'hooks.json',
      'AGENTS.md',
    ]) {
      await assertManagedPath(
        codexHome,
        relativePath,
        'missing-or-file',
        true,
      )
    }
    const pending = await readTransactionJournal(codexHome)
    if (pending) {
      throw new Error(
        `Interrupted Codex mode ${pending.operation} transaction requires recovery. `
        + 'Run `ccg codex-mode recover` first.',
      )
    }

    const previous = await readOwnership(ownershipPath)
    const existingHooks = (await readJsonStrict(hooksPath, 'Codex hooks.json')) ?? {}
    const existingAgents = await fs.pathExists(agentsPath) ? await fs.readFile(agentsPath, 'utf8') : ''

    const ccgConfigPath = join(codexHome, 'ccg', 'config.toml')
    const config = await readCcgConfigAt(ccgConfigPath)
    const injectOpts = {
      routing: config?.routing as any,
      liteMode: config?.performance?.liteMode || false,
      mcpProvider: config?.mcp?.provider || 'skip',
    }
    let agentsTemplate = await fs.readFile(join(templateDir, 'AGENTS.md'), 'utf8')
    agentsTemplate = injectConfigVariables(agentsTemplate, injectOpts)
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
    const files: ManagedFile[] = []
    const previousFiles = new Map(previous?.files.map(file => [file.relativePath, file]) ?? [])
    const planned = new Map<string, Buffer>()
    const plannedBackups = new Map<string, Buffer>()

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
    const ccgConfigBytes = config
      ? Buffer.from(stringify({
          ...config,
          general: {
            ...config.general,
            version: packageVersion,
          },
        } as any), 'utf8')
      : await fs.readFile(join(templateDir, 'ccg-config.toml'))
    planned.set('ccg/config.toml', ccgConfigBytes)
    planned.set('.ccg-version', Buffer.from(packageVersion, 'utf8'))

    const configPath = join(codexHome, 'config.toml')
    const previousConfig = previousFiles.get('config.toml')
    await assertManagedPath(
      codexHome,
      'config.toml',
      'missing-or-file',
      true,
    )
    if (!(await fs.pathExists(configPath)) || previousConfig)
      planned.set('config.toml', await fs.readFile(join(templateDir, 'config.toml')))

    for (const [relativePath, bytes] of planned) {
      const target = await assertManagedPath(
        codexHome,
        relativePath,
        'missing-or-file',
        true,
      )
      const current = await fs.pathExists(target) ? await fs.readFile(target) : null
      const prior = previousFiles.get(relativePath)
      let original = prior?.original
      if (prior) {
        const userEditableCcgConfig = relativePath === 'ccg/config.toml'
        if (!userEditableCcgConfig && (!current || sha256(current) !== prior.installedSha256))
          throw new Error(`${relativePath} was modified after installation; refusing to overwrite it.`)
      }
      else if (current) {
        original = planBackupBytes(
          codexHome,
          backupRoot,
          relativePath,
          current,
          plannedBackups,
        )
      }
      files.push({ relativePath, installedSha256: sha256(bytes), ...(original ? { original } : {}) })
    }

    const agentsBackup = existingAgents.length > 0 && !previous
      ? planBackupBytes(
          codexHome,
          backupRoot,
          'AGENTS.md',
          Buffer.from(existingAgents),
          plannedBackups,
        )
      : previous?.agentsBlock.backup
    const hooksBytes = await fs.pathExists(hooksPath) ? await fs.readFile(hooksPath) : null
    const hooksBackup = hooksBytes && !previous
      ? planBackupBytes(
          codexHome,
          backupRoot,
          'hooks.json',
          hooksBytes,
          plannedBackups,
        )
      : previous?.hookGroup.backup

    const touched = [
      'AGENTS.md',
      'hooks.json',
      ...planned.keys(),
      ...plannedBackups.keys(),
      '.ccg/ownership.json',
    ]
    transaction = await beginCodexModeTransaction(
      codexHome,
      'install',
      touched,
    )

    const write = async (
      path: string,
      value: string | Buffer,
    ): Promise<void> => {
      await atomicWrite(codexHome, path, value)
      mutationCount += 1
      testCrashAfterMutation(mutationCount)
    }

    const nextHooksText = `${JSON.stringify(nextHooks, null, 2)}\n`
    for (const [relativePath, bytes] of plannedBackups)
      await write(join(codexHome, relativePath), bytes)
    await write(agentsPath, nextAgents)
    await write(hooksPath, nextHooksText)
    for (const [relativePath, bytes] of planned)
      await write(join(codexHome, relativePath), bytes)

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
    await write(ownershipPath, `${JSON.stringify(ownership, null, 2)}\n`)
    await finishCodexModeTransaction(codexHome, transaction)
    transaction = null

    return {
      success: true,
      message: `Codex mode installed with managed ownership at ${ownershipPath}`,
    }
  }
  catch (error) {
    let recovery = ''
    if (transaction) {
      const result = await recoverCodexModeAt({ codexHome })
      if (!result.success)
        recovery = ` Automatic recovery also failed: ${result.message}`
    }
    return {
      success: false,
      message: `Failed to install Codex mode: ${error}${recovery}`,
    }
  }
}

async function restoreManagedFile(
  codexHome: string,
  file: ManagedFile,
  removed: string[],
  skipped: string[],
  write: (path: string, value: string | Buffer) => Promise<void>,
  remove: (path: string) => Promise<void>,
): Promise<void> {
  const target = await assertManagedPath(
    codexHome,
    file.relativePath,
    'missing-or-file',
    true,
  )
  if (!(await fs.pathExists(target)))
    return
  const current = await fs.readFile(target)
  if (sha256(current) !== file.installedSha256) {
    skipped.push(`${file.relativePath} (modified after installation)`)
    return
  }

  if (file.original) {
    const original = await verifiedBackup(codexHome, file.original)
    await write(target, original)
    removed.push(`${file.relativePath} (original restored)`)
  }
  else {
    await remove(target)
    removed.push(file.relativePath)
  }
}

export async function uninstallCodexModeAt(
  options: UninstallCodexModeOptions = {},
): Promise<CodexModeUninstallResult> {
  const codexHome = options.codexHome ?? resolveCodexHome()
  const ownershipPath = join(codexHome, '.ccg', 'ownership.json')
  const removed: string[] = []
  const skipped: string[] = []
  let transaction: CodexModeTransactionJournal | null = null
  let mutationCount = 0

  try {
    if (!(await fs.pathExists(codexHome))) {
      return {
        success: true,
        removed,
        skipped: ['No CCG ownership manifest found; no global Codex files were changed.'],
      }
    }
    await ensureManagedRoot(codexHome)
    await assertManagedPath(
      codexHome,
      '.ccg/ownership.json',
      'missing-or-file',
      true,
    )
    const pending = await readTransactionJournal(codexHome)
    if (pending) {
      throw new Error(
        `Interrupted Codex mode ${pending.operation} transaction requires recovery. `
        + 'Run `ccg codex-mode recover` first.',
      )
    }
    const ownership = await readOwnership(ownershipPath)
    if (!ownership) {
      return {
        success: true,
        removed,
        skipped: ['No CCG ownership manifest found; no global Codex files were changed.'],
      }
    }

    const touched = [
      'AGENTS.md',
      'hooks.json',
      ...ownership.files.map(file => file.relativePath),
      '.ccg/ownership.json',
    ]
    for (const relativePath of touched) {
      await assertManagedPath(
        codexHome,
        relativePath,
        'missing-or-file',
        true,
      )
    }
    const backups = [
      ownership.agentsBlock.backup,
      ownership.hookGroup.backup,
      ...ownership.files.map(file => file.original),
    ].filter((entry): entry is OriginalFile => Boolean(entry))
    for (const backup of backups)
      await verifiedBackup(codexHome, backup)

    transaction = await beginCodexModeTransaction(
      codexHome,
      'uninstall',
      touched,
    )
    const write = async (
      path: string,
      value: string | Buffer,
    ): Promise<void> => {
      await atomicWrite(codexHome, path, value)
      mutationCount += 1
      testCrashAfterMutation(mutationCount)
    }
    const remove = async (path: string): Promise<void> => {
      await safeManagedRemoveFile(
        codexHome,
        managedRelativePath(codexHome, path),
      )
      mutationCount += 1
      testCrashAfterMutation(mutationCount)
    }

    const agentsPath = join(codexHome, 'AGENTS.md')
    if (await fs.pathExists(agentsPath)) {
      const existingBytes = await fs.readFile(agentsPath)
      if (
        ownership.agentsBlock.backup
        && ownership.agentsBlock.installedFileSha256
        && sha256(existingBytes) === ownership.agentsBlock.installedFileSha256
      ) {
        await write(
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
          await remove(agentsPath)
          removed.push('AGENTS.md')
        }
        else {
          await write(agentsPath, withoutBlock)
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
        await write(
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
          await remove(hooksPath)
          removed.push('hooks.json')
        }
        else {
          await write(hooksPath, `${JSON.stringify(result.config, null, 2)}\n`)
          removed.push('hooks.json (managed hook)')
        }
      }
    }

    for (const file of [...ownership.files].reverse())
      await restoreManagedFile(
        codexHome,
        file,
        removed,
        skipped,
        write,
        remove,
      )

    if (skipped.length === 0) {
      await remove(ownershipPath)
      removed.push('.ccg/ownership.json')
    }
    await finishCodexModeTransaction(codexHome, transaction)
    transaction = null
    return { success: true, removed, skipped }
  }
  catch (error) {
    let recovery = ''
    if (transaction) {
      const result = await recoverCodexModeAt({ codexHome })
      if (!result.success)
        recovery = `; automatic recovery failed: ${result.message}`
    }
    return {
      success: false,
      removed,
      skipped: [...skipped, `Error: ${error}${recovery}`],
    }
  }
}
