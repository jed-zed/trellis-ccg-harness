export const INTELLIGENCE_EVENT_SCHEMA_VERSION = 1
export const SOURCE_REGISTRY_SCHEMA_VERSION = 1
export const CLAIM_STATUSES = Object.freeze([
  'verified',
  'partially_verified',
  'contradicted',
  'unresolved',
  'early_warning',
])
export const SOURCE_TIERS = Object.freeze(['A', 'B', 'C', 'D', 'U'])
export const X_SEARCH_POLICIES = Object.freeze(['required', 'preferred', 'disabled'])

export function isPlainObject(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value))
    return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export function requirePlainObject(value, name) {
  if (!isPlainObject(value))
    throw new Error(`${name} must be a plain object`)
  return value
}

export function requireNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new Error(`${name} must be a non-empty string`)
  return value.trim()
}

export function requireIsoTimestamp(value, name) {
  const timestamp = requireNonEmptyString(value, name)
  const parsed = new Date(timestamp)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== timestamp)
    throw new Error(`${name} must be an exact ISO-8601 UTC timestamp`)
  return timestamp
}

export function containsUrl(value, seen = new WeakSet()) {
  if (typeof value === 'string')
    return /(?:https?:\/\/|\bwww\.)/i.test(value)
  if (value == null || typeof value !== 'object')
    return false
  if (seen.has(value))
    return false
  seen.add(value)
  if (Array.isArray(value))
    return value.some(item => containsUrl(item, seen))
  return Object.values(value).some(child => containsUrl(child, seen))
}

export function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}
