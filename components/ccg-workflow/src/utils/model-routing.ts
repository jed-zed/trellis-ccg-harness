import type { ModelRouting, ModelType, RoleRouting, RoutingRole } from '../types'
import { REGISTERED_MODEL_TYPES, STANDARD_ROUTING_ROLES } from '../types'

const REGISTERED_MODELS = new Set<ModelType>(REGISTERED_MODEL_TYPES)

function route(primary: ModelType): RoleRouting {
  return {
    models: [primary],
    primary,
    strategy: 'fallback',
  }
}

export function createDefaultRoleRouting(): ModelRouting {
  return {
    frontend: route('gemini'),
    backend: route('codex'),
    search: route('grok'),
    'product-manager': route('claude'),
    mode: 'smart',
  }
}

function assertRegisteredModel(value: unknown, field: string): asserts value is ModelType {
  if (typeof value !== 'string' || !REGISTERED_MODELS.has(value as ModelType))
    throw new Error(`${field} must be a registered provider: ${REGISTERED_MODEL_TYPES.join(', ')}`)
}

function normalizeRole(
  value: Partial<RoleRouting> | undefined,
  fallback: RoleRouting,
  role: RoutingRole,
): RoleRouting {
  const primary = value?.primary || value?.models?.[0] || fallback.primary
  assertRegisteredModel(primary, `routing.${role}.primary`)

  const models = [...new Set(value?.models?.length ? value.models : fallback.models)]
  for (const model of models)
    assertRegisteredModel(model, `routing.${role}.models`)
  if (!models.includes(primary))
    models.unshift(primary)

  return {
    models,
    primary,
    strategy: value?.strategy || fallback.strategy,
  }
}

export function normalizeModelRouting(value: Partial<ModelRouting> | undefined): ModelRouting {
  const defaults = createDefaultRoleRouting()
  const input = value || {}
  const normalized = Object.fromEntries(
    STANDARD_ROUTING_ROLES.map(role => [
      role,
      normalizeRole(input[role], defaults[role], role),
    ]),
  ) as Record<RoutingRole, RoleRouting>

  return {
    ...normalized,
    mode: input.mode || defaults.mode,
    geminiModel: input.geminiModel,
    grokModel: input.grokModel,
  }
}

export function setRoleProvider(
  value: Partial<ModelRouting> | undefined,
  role: RoutingRole,
  provider: ModelType,
): ModelRouting {
  assertRegisteredModel(provider, `routing.${role}.primary`)
  const routing = normalizeModelRouting(value)
  return {
    ...routing,
    [role]: {
      ...routing[role],
      models: [provider],
      primary: provider,
    },
  }
}

export function isRoutingRole(value: string): value is RoutingRole {
  return STANDARD_ROUTING_ROLES.includes(value as RoutingRole)
}

export function isRegisteredModel(value: string): value is ModelType {
  return REGISTERED_MODELS.has(value as ModelType)
}
