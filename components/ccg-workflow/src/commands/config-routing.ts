import type { ModelRouting, ModelType, RoutingRole } from '../types'
import ansis from 'ansis'
import fs from 'fs-extra'
import { join } from 'pathe'
import { parse, stringify } from 'smol-toml'
import { REGISTERED_MODEL_TYPES, STANDARD_ROUTING_ROLES } from '../types'
import {
  allowedProvidersForRole,
  isRegisteredModel,
  isRoleProviderAllowed,
  isRoutingRole,
  normalizeModelRouting,
} from '../utils/model-routing'
import { migrateLegacyProductManagerProviderDocument } from '../utils/config'
import { resolveCodexHome } from '../utils/codex-mode'

interface CodexConfigDocument {
  [key: string]: unknown
  routing?: Partial<ModelRouting>
}

export interface RoutingCommandOptions {
  json?: boolean
}

export function getCodexRoutingConfigPath(): string {
  return join(resolveCodexHome(), 'ccg', 'config.toml')
}

async function readDocument(configPath: string): Promise<CodexConfigDocument> {
  if (!await fs.pathExists(configPath))
    throw new Error(`Codex CCG config not found: ${configPath}. Run \`ccg codex-mode install\` first.`)
  const parsed = parse(await fs.readFile(configPath, 'utf8')) as CodexConfigDocument
  const migrated = migrateLegacyProductManagerProviderDocument(parsed)
  if (migrated.changed)
    await writeDocument(configPath, migrated.document)
  return migrated.document as CodexConfigDocument
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
    console.log(`${row.role.padEnd(16)} ${row.provider}`)
}

export async function configRouting(
  action = 'list',
  roleValue?: string,
  providerValue?: string,
  options: RoutingCommandOptions = {},
): Promise<void> {
  const configPath = getCodexRoutingConfigPath()
  const document = await readDocument(configPath)

  if (action === 'list') {
    printRows(normalizeModelRouting(document.routing), options.json)
    return
  }

  if (!roleValue || !isRoutingRole(roleValue))
    throw new Error(`role must be one of: ${STANDARD_ROUTING_ROLES.join(', ')}`)

  if (action === 'get') {
    const routing = normalizeModelRouting(document.routing)
    const result = { role: roleValue, provider: routing[roleValue].primary }
    console.log(options.json ? JSON.stringify(result, null, 2) : result.provider)
    return
  }

  if (action !== 'set')
    throw new Error('routing action must be list, get, or set')
  if (!providerValue || !isRegisteredModel(providerValue))
    throw new Error(`provider must be one of: ${REGISTERED_MODEL_TYPES.join(', ')}`)
  if (!isRoleProviderAllowed(roleValue, providerValue)) {
    throw new Error(
      `routing.${roleValue}.primary provider ${providerValue} is not supported for role ${roleValue}; allowed: ${allowedProvidersForRole(roleValue).join(', ')}`,
    )
  }

  document.routing = {
    ...document.routing,
    [roleValue]: {
      ...document.routing?.[roleValue],
      models: [providerValue],
      primary: providerValue,
      strategy: document.routing?.[roleValue]?.strategy || 'fallback',
    },
  }
  await writeDocument(configPath, document)
  console.log(ansis.green(`✓ ${roleValue} → ${providerValue}`))
}
