function canonicalize(value: unknown, path: string): string {
  if (value === null)
    return 'null'
  if (typeof value === 'string')
    return JSON.stringify(value.normalize('NFC'))
  if (typeof value === 'boolean')
    return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0))
      throw new TypeError(`${path} contains an unsupported number`)
    return JSON.stringify(value)
  }
  if (Array.isArray(value))
    return `[${value.map((item, index) => canonicalize(item, `${path}[${index}]`)).join(',')}]`
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>
    const prototype = Object.getPrototypeOf(object)
    if (prototype !== Object.prototype && prototype !== null)
      throw new TypeError(`${path} must contain only plain objects`)
    const entries = Object.keys(object)
      .map(key => ({ key, normalized: key.normalize('NFC') }))
      .sort((left, right) => left.normalized < right.normalized ? -1 : left.normalized > right.normalized ? 1 : 0)
    if (new Set(entries.map(entry => entry.normalized)).size !== entries.length)
      throw new TypeError(`${path} contains duplicate keys after NFC normalization`)
    return `{${entries
      .map(({ key, normalized }) => `${JSON.stringify(normalized)}:${canonicalize(object[key], `${path}.${key}`)}`)
      .join(',')}}`
  }
  throw new TypeError(`${path} contains an unsupported ${typeof value} value`)
}

export function canonicalJson(value: unknown): string {
  return canonicalize(value, '$')
}
