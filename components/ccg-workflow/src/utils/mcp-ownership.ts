import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'pathe'
import {
  ensureManagedRoot,
  safeManagedAtomicWrite,
  safeManagedEnsureDirectory,
  safeManagedRead,
} from './managed-path'

export type McpOwnershipTarget = 'claude' | 'codex' | 'gemini'

type JsonPrimitive = boolean | null | number | string
export type JsonValue
  = | JsonPrimitive
    | JsonValue[]
    | { [key: string]: JsonValue }

interface MissingMcpSnapshot {
  present: false
  digest: string
}

interface PresentMcpSnapshot {
  present: true
  digest: string
  value: JsonValue
}

export type McpEntrySnapshot = MissingMcpSnapshot | PresentMcpSnapshot

export interface McpOwnershipEntry {
  target: McpOwnershipTarget
  configPath: string
  serverId: string
  original: McpEntrySnapshot
  installed: McpEntrySnapshot
}

export interface McpOwnershipLedger {
  schemaVersion: 1
  entries: McpOwnershipEntry[]
}

interface ClaimMcpOwnershipOptions {
  ledger: McpOwnershipLedger
  target: McpOwnershipTarget
  serverId: string
  current: unknown
  installed: unknown
  adoptExisting?: boolean
}

interface ReleaseMcpOwnershipOptions {
  ledger: McpOwnershipLedger
  target: McpOwnershipTarget
  serverId: string
  current: unknown
}

const MAX_OWNERSHIP_BYTES = 1024 * 1024
const MAX_OWNERSHIP_ENTRIES = 256
const ABSENT_DIGEST = digestText('absent')
const TARGET_CONFIG_PATHS: Record<McpOwnershipTarget, string> = {
  claude: '.claude.json',
  codex: '.codex/config.toml',
  gemini: '.gemini/settings.json',
}

function digestText(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function assertPlainObject(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error(`${label} must be a plain object.`)
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (
    actual.length !== wanted.length
    || actual.some((key, index) => key !== wanted[index])
  ) {
    throw new Error(`${label} has an invalid schema.`)
  }
}

function normalizeJsonValue(value: unknown, label: string): JsonValue {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
  ) {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new Error(`${label} contains a non-finite number.`)
    return value
  }
  if (Array.isArray(value))
    return value.map((entry, index) => normalizeJsonValue(entry, `${label}[${index}]`))

  assertPlainObject(value, label)
  const normalized: Record<string, JsonValue> = {}
  for (const key of Object.keys(value)) {
    if (!key || key.includes('\0'))
      throw new Error(`${label} contains an invalid key.`)
    normalized[key] = normalizeJsonValue(value[key], `${label}.${key}`)
  }
  return normalized
}

function stableJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object')
    return JSON.stringify(value)
  if (Array.isArray(value))
    return `[${value.map(stableJson).join(',')}]`
  return `{${Object.keys(value)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(',')}}`
}

function snapshot(value: unknown): McpEntrySnapshot {
  if (value === undefined)
    return { present: false, digest: ABSENT_DIGEST }
  const normalized = normalizeJsonValue(value, 'MCP entry')
  return {
    present: true,
    digest: digestText(stableJson(normalized)),
    value: normalized,
  }
}

function validateServerId(serverId: unknown): string {
  if (
    typeof serverId !== 'string'
    || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(serverId)
  ) {
    throw new Error('MCP ownership entry has an invalid server id.')
  }
  return serverId
}

function validateTarget(target: unknown): McpOwnershipTarget {
  if (target !== 'claude' && target !== 'codex' && target !== 'gemini')
    throw new Error('MCP ownership entry has an invalid target.')
  return target
}

function validateSnapshot(value: unknown, label: string): McpEntrySnapshot {
  assertPlainObject(value, label)
  if (value.present === false) {
    assertExactKeys(value, ['present', 'digest'], label)
    if (value.digest !== ABSENT_DIGEST)
      throw new Error(`${label} has an invalid digest.`)
    return { present: false, digest: ABSENT_DIGEST }
  }
  if (value.present !== true)
    throw new Error(`${label} has an invalid presence marker.`)
  assertExactKeys(value, ['present', 'digest', 'value'], label)
  const normalized = normalizeJsonValue(value.value, `${label}.value`)
  const expectedDigest = digestText(stableJson(normalized))
  if (value.digest !== expectedDigest)
    throw new Error(`${label} digest does not match its value.`)
  return {
    present: true,
    digest: expectedDigest,
    value: normalized,
  }
}

function validateEntry(value: unknown): McpOwnershipEntry {
  assertPlainObject(value, 'MCP ownership entry')
  assertExactKeys(
    value,
    ['target', 'configPath', 'serverId', 'original', 'installed'],
    'MCP ownership entry',
  )
  const target = validateTarget(value.target)
  if (value.configPath !== TARGET_CONFIG_PATHS[target])
    throw new Error('MCP ownership entry config path is invalid.')
  return {
    target,
    configPath: TARGET_CONFIG_PATHS[target],
    serverId: validateServerId(value.serverId),
    original: validateSnapshot(value.original, 'MCP ownership original snapshot'),
    installed: validateSnapshot(value.installed, 'MCP ownership installed snapshot'),
  }
}

export function validateMcpOwnershipLedger(value: unknown): McpOwnershipLedger {
  assertPlainObject(value, 'MCP ownership ledger')
  assertExactKeys(value, ['schemaVersion', 'entries'], 'MCP ownership ledger')
  if (value.schemaVersion !== 1 || !Array.isArray(value.entries))
    throw new Error('MCP ownership ledger schema is unsupported.')
  if (value.entries.length > MAX_OWNERSHIP_ENTRIES)
    throw new Error('MCP ownership ledger has too many entries.')

  const entries = value.entries.map(validateEntry)
  const identities = new Set<string>()
  for (const entry of entries) {
    const identity = `${entry.target}\0${entry.serverId}`
    if (identities.has(identity))
      throw new Error('MCP ownership ledger contains a duplicate entry.')
    identities.add(identity)
  }
  return { schemaVersion: 1, entries }
}

export function emptyMcpOwnershipLedger(): McpOwnershipLedger {
  return { schemaVersion: 1, entries: [] }
}

function clonedLedger(ledger: McpOwnershipLedger): McpOwnershipLedger {
  return validateMcpOwnershipLedger(ledger)
}

function findEntry(
  ledger: McpOwnershipLedger,
  target: McpOwnershipTarget,
  serverId: string,
): McpOwnershipEntry | undefined {
  return ledger.entries.find(
    entry => entry.target === target && entry.serverId === serverId,
  )
}

export function claimMcpOwnership(
  options: ClaimMcpOwnershipOptions,
): { ledger: McpOwnershipLedger, entry: McpOwnershipEntry } {
  const ledger = clonedLedger(options.ledger)
  const target = validateTarget(options.target)
  const serverId = validateServerId(options.serverId)
  const installed = snapshot(options.installed)
  if (!installed.present)
    throw new Error('MCP ownership cannot claim a missing installed entry.')

  const existing = findEntry(ledger, target, serverId)
  let entry: McpOwnershipEntry
  if (existing) {
    const current = snapshot(options.current)
    if (current.digest !== existing.installed.digest) {
      throw new Error(
        `MCP entry ${serverId} was modified after installation; preserving it.`,
      )
    }
    entry = { ...existing, installed }
    ledger.entries = ledger.entries.map(candidate => (
      candidate.target === target && candidate.serverId === serverId
        ? entry
        : candidate
    ))
  }
  else {
    const current = snapshot(options.current)
    if (current.present && !options.adoptExisting) {
      throw new Error(
        `MCP entry ${serverId} is an unowned collision; explicit adoption is required.`,
      )
    }
    entry = {
      target,
      configPath: TARGET_CONFIG_PATHS[target],
      serverId,
      original: current,
      installed,
    }
    ledger.entries.push(entry)
  }

  ledger.entries.sort((left, right) => (
    `${left.target}\0${left.serverId}`.localeCompare(
      `${right.target}\0${right.serverId}`,
    )
  ))
  return { ledger, entry }
}

export function releaseMcpOwnership(
  options: ReleaseMcpOwnershipOptions,
): {
  ledger: McpOwnershipLedger
  restored: JsonValue | undefined
} {
  const ledger = clonedLedger(options.ledger)
  const target = validateTarget(options.target)
  const serverId = validateServerId(options.serverId)
  const existing = findEntry(ledger, target, serverId)
  if (!existing)
    throw new Error(`MCP entry ${serverId} is unowned; refusing to remove it.`)

  const current = snapshot(options.current)
  if (current.digest !== existing.installed.digest) {
    throw new Error(
      `MCP entry ${serverId} was modified after installation; preserving it.`,
    )
  }
  ledger.entries = ledger.entries.filter(entry => (
    entry.target !== target || entry.serverId !== serverId
  ))
  return {
    ledger,
    restored: existing.original.present
      ? existing.original.value
      : undefined,
  }
}

export function mcpOwnershipPath(homeDir: string = homedir()): string {
  return join(homeDir, '.claude', '.ccg', 'mcp-ownership.json')
}

export async function readMcpOwnershipLedger(
  homeDir: string = homedir(),
): Promise<McpOwnershipLedger> {
  await ensureManagedRoot(homeDir)
  await safeManagedEnsureDirectory(homeDir, '.claude/.ccg')
  const content = await safeManagedRead(
    homeDir,
    '.claude/.ccg/mcp-ownership.json',
  )
  if (!content)
    return emptyMcpOwnershipLedger()
  if (content.length > MAX_OWNERSHIP_BYTES)
    throw new Error('MCP ownership ledger exceeds the size limit.')
  let parsed: unknown
  try {
    parsed = JSON.parse(content.toString('utf8'))
  }
  catch (error) {
    throw new Error(`Unable to parse MCP ownership ledger: ${error}`)
  }
  return validateMcpOwnershipLedger(parsed)
}

export async function writeMcpOwnershipLedger(
  homeDir: string,
  ledger: McpOwnershipLedger,
): Promise<void> {
  const validated = validateMcpOwnershipLedger(ledger)
  await ensureManagedRoot(homeDir)
  await safeManagedEnsureDirectory(homeDir, '.claude/.ccg')
  await safeManagedAtomicWrite(
    homeDir,
    '.claude/.ccg/mcp-ownership.json',
    `${JSON.stringify(validated, null, 2)}\n`,
  )
}
