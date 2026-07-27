import type { ModelRouting, ModelType, RoutingRole } from '../types'
import ansis from 'ansis'
import fs from 'fs-extra'
import { homedir } from 'node:os'
import { join } from 'pathe'
import { parse, stringify } from 'smol-toml'
import { REGISTERED_MODEL_TYPES, STANDARD_ROUTING_ROLES } from '../types'
import {
  isRegisteredModel,
  isRoutingRole,
  normalizeModelRouting,
  setRoleProvider,
} from '../utils/model-routing'

interface CodexConfigDocument {
  [key: string]: unknown
  routing?: Partial<ModelRouting>
}

export interface RoutingCommandOptions {
  json?: boolean
}

export function getCodexRoutingConfigPath(): string {
  return join(homedir(), '.codex', 'ccg', 'config.toml')
}

async function readDocument(configPath: string): Promise<CodexConfigDocument> {
  if (!await fs.pathExists(configPath))
    throw new Error(`Codex CCG config not found: ${configPath}. Run \`ccg codex-mode install\` first.`)
  return parse(await fs.readFile(configPath, 'utf8')) as CodexConfigDocument
}

async function writeDocument(configPath: string, document: CodexConfigDocument): Promise<void> {
  await fs.writeFile(configPath, stringify(document as any), 'utf8')
}

export async function readCodexRoutingConfig(): Promise<ModelRouting> {
  const document = await readDocument(getCodexRoutingConfigPath())
  return normalizeModelRouting(document.routing)
}

function routingRows(routing: ModelRouting): Array<{ role: RoutingRole, provider: ModelType }> {
  return STANDARD_ROUTING_ROLES.map(role => ({
    role,
    provider: routing[role].primary,
  }))
}

function printRows(routing: ModelRouting, json = false): void {
  const rows = routingRows(routing)
  if (json) {
    console.log(JSON.stringify({ roles: rows }, null, 2))
    return
  }
  for (const row of rows)
    console.log(`${row.role.padEnd(10)} ${row.provider}`)
}

export async function configRouting(
  action = 'list',
  roleValue?: string,
  providerValue?: string,
  options: RoutingCommandOptions = {},
): Promise<void> {
  const configPath = getCodexRoutingConfigPath()
  const document = await readDocument(configPath)
  const routing = normalizeModelRouting(document.routing)

  if (action === 'list') {
    printRows(routing, options.json)
    return
  }

  if (!roleValue || !isRoutingRole(roleValue))
    throw new Error(`role must be one of: ${STANDARD_ROUTING_ROLES.join(', ')}`)

  if (action === 'get') {
    const result = { role: roleValue, provider: routing[roleValue].primary }
    console.log(options.json ? JSON.stringify(result, null, 2) : result.provider)
    return
  }

  if (action !== 'set')
    throw new Error('routing action must be list, get, or set')
  if (!providerValue || !isRegisteredModel(providerValue))
    throw new Error(`provider must be one of: ${REGISTERED_MODEL_TYPES.join(', ')}`)

  document.routing = setRoleProvider(routing, roleValue, providerValue)
  await writeDocument(configPath, document)
  console.log(ansis.green(`✓ ${roleValue} → ${providerValue}`))
}
