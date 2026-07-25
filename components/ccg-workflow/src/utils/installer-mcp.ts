import type { AceToolConfig, FastContextConfig } from '../types'
import { homedir } from 'node:os'
import fs from 'fs-extra'
import { join } from 'pathe'
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'
import {
  type ClaudeCodeConfig,
  type McpServerConfig,
  buildMcpServerConfig,
  fixWindowsMcpConfig,
  readClaudeCodeConfigAt,
} from './mcp'
import {
  type JsonValue,
  type McpOwnershipLedger,
  claimMcpOwnership,
  readMcpOwnershipLedger,
  releaseMcpOwnership,
  writeMcpOwnershipLedger,
} from './mcp-ownership'
import {
  containsInlineMcpSecret,
  createSecretBackedMcpConfig,
  mcpSecretSpecPath,
  removeSecretBackedMcpConfig,
} from './mcp-secrets'
import {
  assertManagedPath,
  ensureManagedRoot,
  safeManagedAtomicWrite,
  safeManagedRead,
  safeManagedRemoveFile,
} from './managed-path'
import { isWindows } from './platform'
import { npmSelector, verifyPinnedExecutableCommand, verifyPinnedNpmCommand } from './third-party-sources'

// ═══════════════════════════════════════════════════════
// Shared types & helpers
// ═══════════════════════════════════════════════════════

type McpInstallResult = { success: boolean, message: string, configPath?: string }

export interface McpInstallOptions {
  adoptExisting?: boolean
  homeDir?: string
}

function homeRelative(homeDir: string, path: string): string {
  const normalizedHome = homeDir.replace(/\\/g, '/').replace(/\/+$/u, '')
  const normalizedPath = path.replace(/\\/g, '/')
  if (!normalizedPath.startsWith(`${normalizedHome}/`))
    throw new Error(`MCP path is outside the configured home directory: ${path}`)
  return normalizedPath.slice(normalizedHome.length + 1)
}

async function fileSnapshot(
  homeDir: string,
  path: string,
): Promise<Buffer | null> {
  await ensureManagedRoot(homeDir)
  await assertManagedPath(
    homeDir,
    homeRelative(homeDir, path),
    'missing-or-file',
    true,
  )
  return safeManagedRead(homeDir, homeRelative(homeDir, path))
}

async function restoreFileSnapshot(
  homeDir: string,
  path: string,
  content: Buffer | null,
): Promise<void> {
  const relativePath = homeRelative(homeDir, path)
  if (content === null) {
    await safeManagedRemoveFile(homeDir, relativePath)
    return
  }
  await safeManagedAtomicWrite(homeDir, relativePath, content)
}

async function backupClaudeConfig(
  homeDir: string,
  configPath: string,
): Promise<string | null> {
  const content = await fileSnapshot(homeDir, configPath)
  if (!content)
    return null
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const relativePath = `.claude/backup/claude-config-${timestamp}.json`
  await safeManagedAtomicWrite(homeDir, relativePath, content)
  return join(homeDir, relativePath)
}

async function commitConfigAndOwnership(
  homeDir: string,
  configPath: string,
  config: ClaudeCodeConfig,
  ledger: ReturnType<typeof claimMcpOwnership>['ledger'],
): Promise<void> {
  const before = await fileSnapshot(homeDir, configPath)
  try {
    await safeManagedAtomicWrite(
      homeDir,
      homeRelative(homeDir, configPath),
      `${JSON.stringify(config, null, 2)}\n`,
    )
    await writeMcpOwnershipLedger(homeDir, ledger)
  }
  catch (error) {
    await restoreFileSnapshot(homeDir, configPath, before)
    throw error
  }
}

/**
 * Common pipeline for installing an MCP server into ~/.claude.json:
 * read → ownership check → backup → write config + ownership ledger.
 *
 * All MCP installers funnel through this to avoid duplication.
 */
async function configureMcpInClaude(
  serverId: string,
  serverConfig: McpServerConfig,
  label: string,
  options: McpInstallOptions = {},
): Promise<McpInstallResult> {
  const homeDir = options.homeDir ?? homedir()
  const configPath = join(homeDir, '.claude.json')
  try {
    await ensureManagedRoot(homeDir)
    await assertManagedPath(
      homeDir,
      '.claude.json',
      'missing-or-file',
      true,
    )
    const ledger = await readMcpOwnershipLedger(homeDir)
    const existingConfig = await readClaudeCodeConfigAt(configPath)
    const workingConfig: ClaudeCodeConfig = existingConfig
      ? JSON.parse(JSON.stringify(existingConfig))
      : { mcpServers: {} }
    if (!workingConfig.mcpServers)
      workingConfig.mcpServers = {}

    workingConfig.mcpServers[serverId] = serverConfig

    // Apply Windows fixes if needed
    let installedConfig = workingConfig
    if (isWindows()) {
      installedConfig = fixWindowsMcpConfig(workingConfig)
      console.log('  ✓ Applied Windows MCP configuration fixes')
    }
    const installedEntry = installedConfig.mcpServers?.[serverId]
    if (!installedEntry)
      throw new Error('MCP entry disappeared during platform normalization.')

    const claimed = claimMcpOwnership({
      ledger,
      target: 'claude',
      serverId,
      current: existingConfig?.mcpServers?.[serverId],
      installed: installedEntry,
      adoptExisting: options.adoptExisting,
    })

    // Ownership is proven before any backup or configuration mutation.
    if (existingConfig?.mcpServers && Object.keys(existingConfig.mcpServers).length > 0) {
      const backupPath = await backupClaudeConfig(homeDir, configPath)
      if (backupPath)
        console.log(`  ✓ Backup created: ${backupPath}`)
    }
    await commitConfigAndOwnership(
      homeDir,
      configPath,
      installedConfig,
      claimed.ledger,
    )

    return {
      success: true,
      message: isWindows()
        ? `${label} configured successfully with Windows compatibility`
        : `${label} configured successfully`,
      configPath,
    }
  }
  catch (error) {
    return {
      success: false,
      message: `Failed to configure ${label}: ${error}`,
    }
  }
}

async function configureExecutableMcpInClaude(
  serverId: string,
  command: string,
  args: string[],
  env: Record<string, string>,
  label: string,
  options: McpInstallOptions = {},
): Promise<McpInstallResult> {
  const homeDir = options.homeDir ?? homedir()
  const secretPath = mcpSecretSpecPath(serverId, homeDir)
  let secretBefore: Buffer | null = null
  let secretSnapshotReady = false
  try {
    secretBefore = await fileSnapshot(homeDir, secretPath)
    secretSnapshotReady = true
    await verifyPinnedExecutableCommand(command, args)
    const serverConfig = Object.keys(env).length > 0
      ? await createSecretBackedMcpConfig({
          serverId,
          command,
          args,
          env,
          homeDir,
        })
      : buildMcpServerConfig({ type: 'stdio', command, args })
    const result = await configureMcpInClaude(
      serverId,
      serverConfig,
      label,
      options,
    )
    if (
      !result.success
      && Object.keys(env).length > 0
      && secretSnapshotReady
    ) {
      await restoreFileSnapshot(homeDir, secretPath, secretBefore)
    }
    return result
  }
  catch (error) {
    if (Object.keys(env).length > 0 && secretSnapshotReady)
      await restoreFileSnapshot(homeDir, secretPath, secretBefore)
    return {
      success: false,
      message: `Failed to verify ${label}: ${error}`,
    }
  }
}

// ═══════════════════════════════════════════════════════
// ace-tool MCP
// ═══════════════════════════════════════════════════════

/**
 * Uninstall ace-tool MCP configuration from ~/.claude.json
 */
export async function uninstallAceTool(): Promise<{ success: boolean, message: string }> {
  return uninstallMcpServer('ace-tool')
}

/**
 * Install and configure ace-tool MCP for Claude Code.
 */
export async function installAceTool(config: AceToolConfig): Promise<McpInstallResult> {
  void config
  return {
    success: false,
    message: 'ace-tool only supports token transport in command-line argv, which is unsafe. CCG refuses to persist or launch it until upstream supports environment or secret-file authentication.',
  }
}

/**
 * Install and configure ace-tool-rs MCP for Claude Code.
 * ace-tool-rs is a Rust implementation — more lightweight and faster.
 */
export async function installAceToolRs(config: AceToolConfig): Promise<McpInstallResult> {
  void config
  return {
    success: false,
    message: 'ace-tool-rs forwards the token through command-line argv, which is unsafe. CCG refuses to configure it until upstream supports environment or secret-file authentication.',
  }
}

// ═══════════════════════════════════════════════════════
// ContextWeaver MCP
// ═══════════════════════════════════════════════════════

/**
 * ContextWeaver MCP configuration
 */
export interface ContextWeaverConfig {
  siliconflowApiKey: string
}

/**
 * Install and configure ContextWeaver MCP for Claude Code.
 * ContextWeaver is a local-first semantic code search engine with hybrid search + rerank.
 */
export async function installContextWeaver(
  config: ContextWeaverConfig,
  options: McpInstallOptions = {},
): Promise<McpInstallResult> {
  const { siliconflowApiKey } = config

  try {
    const command = 'npx'
    const args = ['-y', npmSelector('@hsingjui/contextweaver'), 'mcp']
    await verifyPinnedNpmCommand(command, args)

    // Keep the API key in the shared owner-only secret launcher rather than
    // writing a second provider-specific .env file.
    return await configureExecutableMcpInClaude(
      'contextweaver',
      command,
      args,
      {
        EMBEDDINGS_API_KEY: siliconflowApiKey,
        EMBEDDINGS_BASE_URL: 'https://api.siliconflow.cn/v1/embeddings',
        EMBEDDINGS_MODEL: 'Qwen/Qwen3-Embedding-8B',
        EMBEDDINGS_MAX_CONCURRENCY: '10',
        EMBEDDINGS_DIMENSIONS: '1024',
        RERANK_API_KEY: siliconflowApiKey,
        RERANK_BASE_URL: 'https://api.siliconflow.cn/v1/rerank',
        RERANK_MODEL: 'Qwen/Qwen3-Reranker-8B',
        RERANK_TOP_N: '20',
      },
      'ContextWeaver MCP',
      options,
    )
  }
  catch (error) {
    return { success: false, message: `Failed to configure ContextWeaver: ${error}` }
  }
}

/**
 * Uninstall ContextWeaver MCP from Claude Code.
 * Delegates to generic uninstallMcpServer.
 */
export function uninstallContextWeaver(): Promise<{ success: boolean, message: string }> {
  return uninstallMcpServer('contextweaver')
}

// ═══════════════════════════════════════════════════════
// Fast Context (Windsurf) MCP
// ═══════════════════════════════════════════════════════

/**
 * Install and configure Fast Context (Windsurf) MCP for Claude Code.
 */
export async function installFastContext(
  config: FastContextConfig,
  options: McpInstallOptions = {},
): Promise<McpInstallResult> {
  const { apiKey, includeSnippets } = config

  const env: Record<string, string> = {}
  if (apiKey) env.WINDSURF_API_KEY = apiKey
  if (includeSnippets) env.FC_INCLUDE_SNIPPETS = 'true'

  const args = ['-y', '--prefer-online', npmSelector('fast-context-mcp')]
  return configureExecutableMcpInClaude(
    'fast-context',
    'npx',
    args,
    env,
    'fast-context MCP',
    options,
  )
}

/**
 * Uninstall Fast Context MCP from Claude Code.
 * Delegates to generic uninstallMcpServer.
 */
export function uninstallFastContext(): Promise<{ success: boolean, message: string }> {
  return uninstallMcpServer('fast-context')
}

// ═══════════════════════════════════════════════════════
// Generic MCP server install/uninstall
// ═══════════════════════════════════════════════════════

/**
 * Install a generic MCP server to Claude Code
 */
export async function installMcpServer(
  id: string,
  command: string,
  args: string[],
  env: Record<string, string> = {},
  options: McpInstallOptions = {},
): Promise<{ success: boolean, message: string }> {
  return configureExecutableMcpInClaude(id, command, args, env, id, options)
}

/**
 * Uninstall a generic MCP server from Claude Code
 */
export async function uninstallMcpServer(
  id: string,
  options: Pick<McpInstallOptions, 'homeDir'> = {},
): Promise<{ success: boolean, message: string }> {
  const homeDir = options.homeDir ?? homedir()
  const configPath = join(homeDir, '.claude.json')
  try {
    await ensureManagedRoot(homeDir)
    await assertManagedPath(
      homeDir,
      '.claude.json',
      'missing-or-file',
      true,
    )
    const ledger = await readMcpOwnershipLedger(homeDir)
    const existingConfig = await readClaudeCodeConfigAt(configPath)
    const released = releaseMcpOwnership({
      ledger,
      target: 'claude',
      serverId: id,
      current: existingConfig?.mcpServers?.[id],
    })
    const workingConfig: ClaudeCodeConfig = existingConfig
      ? JSON.parse(JSON.stringify(existingConfig))
      : { mcpServers: {} }
    if (!workingConfig.mcpServers)
      workingConfig.mcpServers = {}
    if (released.restored === undefined)
      delete workingConfig.mcpServers[id]
    else
      workingConfig.mcpServers[id] = released.restored as unknown as McpServerConfig

    await backupClaudeConfig(homeDir, configPath)
    await commitConfigAndOwnership(
      homeDir,
      configPath,
      workingConfig,
      released.ledger,
    )
    await removeSecretBackedMcpConfig(id, homeDir)
    return { success: true, message: `${id} MCP uninstalled successfully` }
  }
  catch (error) {
    return { success: false, message: `Failed to uninstall ${id}: ${error}` }
  }
}

// ═══════════════════════════════════════════════════════
// MCP Sync — Mirror CCG-relevant MCP servers
// to Codex (~/.codex/config.toml) and Gemini (~/.gemini/settings.json)
// ═══════════════════════════════════════════════════════

/** MCP server IDs that CCG manages and should sync to Codex/Gemini */
const CCG_MCP_IDS = new Set([
  'grok-search',
  'context7',
  'ace-tool',
  'ace-tool-rs',
  'contextweaver',
  'fast-context',
])

type SyncResult = { success: boolean, message: string, synced: string[], removed: string[] }
type McpSyncOptions = McpInstallOptions

/**
 * Read only CCG-owned Claude MCP entries. A same-name entry without a ledger
 * claim is user-owned and must never be mirrored or removed.
 */
async function getCcgMcpServersFromClaude(
  homeDir: string,
): Promise<{
  ledger: McpOwnershipLedger
  servers: Record<string, McpServerConfig>
}> {
  let ledger = await readMcpOwnershipLedger(homeDir)
  await assertManagedPath(
    homeDir,
    '.claude.json',
    'missing-or-file',
    true,
  )
  const claudeConfig = await readClaudeCodeConfigAt(
    join(homeDir, '.claude.json'),
  )
  const claudeMcpServers = claudeConfig?.mcpServers || {}

  const serversToSync: Record<string, McpServerConfig> = {}
  const ownedEntries = ledger.entries.filter(
    entry => entry.target === 'claude' && CCG_MCP_IDS.has(entry.serverId),
  )
  for (const entry of ownedEntries) {
    const current = claudeMcpServers[entry.serverId]
    if (!current)
      throw new Error(`Owned Claude MCP entry ${entry.serverId} is missing.`)
    const verified = claimMcpOwnership({
      ledger,
      target: 'claude',
      serverId: entry.serverId,
      current,
      installed: current,
    })
    ledger = verified.ledger
    serversToSync[entry.serverId] = current
  }
  return {
    ledger,
    servers: filterSecretSafeMcpServers(serversToSync),
  }
}

export function filterSecretSafeMcpServers(
  servers: Record<string, McpServerConfig>,
): Record<string, McpServerConfig> {
  const safe: Record<string, McpServerConfig> = {}
  for (const [id, config] of Object.entries(servers)) {
    if (!containsInlineMcpSecret(config))
      safe[id] = config
  }
  return safe
}

function mirrorOwnedCcgServers(
  target: 'codex' | 'gemini',
  serversToSync: Record<string, JsonValue>,
  targetServers: Record<string, JsonValue>,
  originalLedger: McpOwnershipLedger,
  adoptExisting: boolean,
): {
  ledger: McpOwnershipLedger
  targetServers: Record<string, JsonValue>
  synced: string[]
  removed: string[]
} {
  let ledger = originalLedger
  const nextServers = JSON.parse(JSON.stringify(targetServers)) as Record<
    string,
    JsonValue
  >
  const synced: string[] = []
  const removed: string[] = []

  for (const [id, claudeServer] of Object.entries(serversToSync)) {
    const claimed = claimMcpOwnership({
      ledger,
      target,
      serverId: id,
      current: nextServers[id],
      installed: claudeServer,
      adoptExisting,
    })
    ledger = claimed.ledger
    nextServers[id] = claudeServer
    synced.push(id)
  }

  const staleEntries = ledger.entries.filter(entry => (
    entry.target === target && !(entry.serverId in serversToSync)
  ))
  for (const entry of staleEntries) {
    const released = releaseMcpOwnership({
      ledger,
      target,
      serverId: entry.serverId,
      current: nextServers[entry.serverId],
    })
    ledger = released.ledger
    if (released.restored === undefined)
      delete nextServers[entry.serverId]
    else
      nextServers[entry.serverId] = released.restored
    removed.push(entry.serverId)
  }

  return { ledger, targetServers: nextServers, synced, removed }
}

/**
 * Format sync result message
 */
function formatSyncMessage(target: string, synced: string[], removed: string[]): string {
  const parts: string[] = []
  if (synced.length > 0) parts.push(`synced: ${synced.join(', ')}`)
  if (removed.length > 0) parts.push(`removed: ${removed.join(', ')}`)
  return `${target} MCP mirror complete (${parts.join('; ')})`
}

/**
 * Sync (mirror) CCG-managed MCP servers from Claude's ~/.claude.json
 * to Codex's ~/.codex/config.toml
 *
 * - Only touches servers in CCG_MCP_IDS — user's custom servers untouched.
 * - Uses atomic write (temp file + rename) to prevent corruption.
 */
export async function syncMcpToCodex(
  options: McpSyncOptions = {},
): Promise<SyncResult> {
  const homeDir = options.homeDir ?? homedir()
  try {
    const source = await getCcgMcpServersFromClaude(homeDir)

    // Read or create Codex config
    const codexConfigDir = join(homeDir, '.codex')
    const codexConfigPath = join(codexConfigDir, 'config.toml')
    await assertManagedPath(
      homeDir,
      '.codex/config.toml',
      'missing-or-file',
      true,
    )

    let codexConfig: Record<string, any> = {}
    if (await fs.pathExists(codexConfigPath)) {
      const content = await fs.readFile(codexConfigPath, 'utf-8')
      codexConfig = parseToml(content) as Record<string, any>
    }

    if (!codexConfig.mcp_servers) {
      codexConfig.mcp_servers = {}
    }

    // Codex needs field-level copy (TOML compatibility: filter null/undefined)
    const codexServersToSync: Record<string, JsonValue> = {}
    for (const [id, server] of Object.entries(source.servers)) {
      const entry: Record<string, JsonValue> = {}
      for (const [key, value] of Object.entries(server as Record<string, any>)) {
        if (value !== null && value !== undefined) {
          entry[key] = value as JsonValue
        }
      }
      codexServersToSync[id] = entry
    }

    const mirrored = mirrorOwnedCcgServers(
      'codex',
      codexServersToSync,
      codexConfig.mcp_servers as Record<string, JsonValue>,
      source.ledger,
      options.adoptExisting === true,
    )
    const { synced, removed } = mirrored

    if (synced.length === 0 && removed.length === 0) {
      return { success: true, message: 'No CCG MCP servers to sync or remove', synced: [], removed: [] }
    }

    codexConfig.mcp_servers = mirrored.targetServers
    const before = await fileSnapshot(homeDir, codexConfigPath)
    try {
      await safeManagedAtomicWrite(
        homeDir,
        '.codex/config.toml',
        stringifyToml(codexConfig),
      )
      await writeMcpOwnershipLedger(homeDir, mirrored.ledger)
    }
    catch (error) {
      await restoreFileSnapshot(homeDir, codexConfigPath, before)
      throw error
    }

    return { success: true, message: formatSyncMessage('Codex', synced, removed), synced, removed }
  }
  catch (error) {
    return { success: false, message: `Failed to sync MCP to Codex: ${error}`, synced: [], removed: [] }
  }
}

/**
 * Sync (mirror) CCG-managed MCP servers from Claude's ~/.claude.json
 * to Gemini CLI's ~/.gemini/settings.json
 */
export async function syncMcpToGemini(
  options: McpSyncOptions = {},
): Promise<SyncResult> {
  const homeDir = options.homeDir ?? homedir()
  try {
    const source = await getCcgMcpServersFromClaude(homeDir)

    // Read or create Gemini settings
    const geminiDir = join(homeDir, '.gemini')
    const geminiSettingsPath = join(geminiDir, 'settings.json')
    await assertManagedPath(
      homeDir,
      '.gemini/settings.json',
      'missing-or-file',
      true,
    )

    let geminiSettings: Record<string, any> = {}
    if (await fs.pathExists(geminiSettingsPath)) {
      geminiSettings = await fs.readJSON(geminiSettingsPath)
    }

    if (!geminiSettings.mcpServers) {
      geminiSettings.mcpServers = {}
    }

    const mirrored = mirrorOwnedCcgServers(
      'gemini',
      source.servers as unknown as Record<string, JsonValue>,
      geminiSettings.mcpServers as Record<string, JsonValue>,
      source.ledger,
      options.adoptExisting === true,
    )
    const { synced, removed } = mirrored

    if (synced.length === 0 && removed.length === 0) {
      return { success: true, message: 'No CCG MCP servers to sync to Gemini', synced: [], removed: [] }
    }

    geminiSettings.mcpServers = mirrored.targetServers
    const before = await fileSnapshot(homeDir, geminiSettingsPath)
    try {
      await safeManagedAtomicWrite(
        homeDir,
        '.gemini/settings.json',
        `${JSON.stringify(geminiSettings, null, 2)}\n`,
      )
      await writeMcpOwnershipLedger(homeDir, mirrored.ledger)
    }
    catch (error) {
      await restoreFileSnapshot(homeDir, geminiSettingsPath, before)
      throw error
    }

    return { success: true, message: formatSyncMessage('Gemini', synced, removed), synced, removed }
  }
  catch (error) {
    return { success: false, message: `Failed to sync MCP to Gemini: ${error}`, synced: [], removed: [] }
  }
}
