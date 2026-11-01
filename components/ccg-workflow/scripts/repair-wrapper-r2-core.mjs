import { createHash } from 'node:crypto'
import { stripVTControlCharacters } from 'node:util'

export const targets = Object.freeze([
  'codeagent-wrapper-darwin-amd64',
  'codeagent-wrapper-darwin-arm64',
  'codeagent-wrapper-linux-amd64',
  'codeagent-wrapper-linux-arm64',
  'codeagent-wrapper-windows-amd64.exe',
  'codeagent-wrapper-windows-arm64.exe',
])

export function expect(condition, message) {
  if (!condition) throw new Error(message)
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

export function readPins(recipe, installer, tag) {
  expect(recipe.schemaVersion === 1, 'Unsupported release recipe')
  expect(recipe.releaseTag === tag && tag === `wrapper-${recipe.binaryVersion}`, 'Release tag disagrees with recipe')
  expect(installer.includes(`export const EXPECTED_BINARY_VERSION = '${recipe.binaryVersion}'`), 'Installer version disagrees with recipe')
  // eslint-disable-next-line no-template-curly-in-string -- matches the installer source text literally
  expect(installer.includes('const RELEASE_TAG = `wrapper-${EXPECTED_BINARY_VERSION}`'), 'Installer tag does not derive from pinned version')
  const block = /export const EXPECTED_BINARY_SHA256:[\s\S]*?Object\.freeze\(\{([\s\S]*?)\n\}\)/.exec(installer)?.[1]
  expect(block, 'Installer digest table not found')
  const entries = [...block.matchAll(/^\s*'([^']+)': '([0-9a-f]{64})',?\s*$/gm)]
  const pins = new Map(entries.map(([, name, digest]) => [name, digest]))
  expect(entries.length === targets.length && pins.size === targets.length && targets.every(name => pins.has(name)), 'Installer must pin exactly six expected assets')
  return pins
}

export function validateAssets(assetNames, assets, pins) {
  expect(Array.isArray(assetNames) && assetNames.length === targets.length && new Set(assetNames).size === targets.length
    && targets.every(name => assetNames.includes(name)), 'GitHub release must contain exactly six expected assets')
  expect(assets instanceof Map && assets.size === targets.length && targets.every(name => assets.has(name)), 'Downloaded assets must match exactly six expected names')
  for (const name of targets) {
    expect(Buffer.isBuffer(assets.get(name)), `Downloaded asset is not bytes: ${name}`)
    expect(sha256(assets.get(name)) === pins.get(name), `GitHub release asset hash mismatch: ${name}`)
  }
}

// readObject returns {status:'missing'} only for proven key-level absence, or
// {status:'present', bytes: Buffer}. All other read failures must throw.
export async function repairMirror({ tag, pins, assetNames, assets, readObject, putObject }) {
  validateAssets(assetNames, assets, pins)
  const missing = []
  // Finish every read before issuing any put, so a corrupt later object blocks all writes.
  for (const name of targets) {
    const result = await readObject(tag, name)
    expect(result?.status === 'missing' || result?.status === 'present', `Unknown R2 read status: ${name}`)
    if (result.status === 'missing') missing.push(name)
    else expect(Buffer.isBuffer(result.bytes) && sha256(result.bytes) === pins.get(name), `Existing R2 object hash mismatch: ${name}`)
  }
  let uploaded = 0
  for (const name of missing) {
    // Recheck immediately before an unconditional Wrangler put.
    const result = await readObject(tag, name)
    expect(result?.status === 'missing' || result?.status === 'present', `Unknown R2 reread status: ${name}`)
    if (result.status === 'present') {
      expect(Buffer.isBuffer(result.bytes) && sha256(result.bytes) === pins.get(name), `Existing R2 object hash mismatch before upload: ${name}`)
      continue
    }
    await putObject(tag, name, assets.get(name))
    uploaded++
    const after = await readObject(tag, name)
    expect(after?.status === 'present' && Buffer.isBuffer(after.bytes) && sha256(after.bytes) === pins.get(name), `R2 readback hash mismatch: ${name}`)
  }
  return { checked: targets.length, uploaded }
}

// Wrangler emits this key-specific R2 error for a missing object. A generic 404,
// bucket error, permission error, or network error cannot authorize a write.
export function isMissingKeyError(output) {
  const message = stripVTControlCharacters(output)
  return /^[ \t]*(?:[X✘][ \t]+)?\[ERROR\][ \t]+(?:NoSuchKey|The specified key does not exist\.)[ \t]*$/im.test(message)
}
