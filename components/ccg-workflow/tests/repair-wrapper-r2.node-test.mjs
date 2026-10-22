import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { test } from 'node:test'
import { isMissingKeyError, readPins, repairMirror, sha256, targets, validateAssets } from '../scripts/repair-wrapper-r2-core.mjs'
import { runRepair } from '../scripts/repair-wrapper-r2.mjs'

const tag = 'wrapper-1.2.3'
const recipe = { schemaVersion: 1, releaseTag: tag, binaryVersion: '1.2.3' }
const assets = new Map(targets.map((name, index) => [name, Buffer.from(`asset-${index}`)]))
const pins = new Map(targets.map(name => [name, sha256(assets.get(name))]))
const names = [...targets]

function fake(initial = new Map()) {
  const objects = new Map(initial)
  const events = []
  const readObject = async (_, name) => {
    events.push(`get:${name}`)
    return objects.has(name) ? { status: 'present', bytes: objects.get(name) } : { status: 'missing' }
  }
  const putObject = async (_, name, bytes) => {
    events.push(`put:${name}`)
    objects.set(name, bytes)
  }
  const repair = () => repairMirror({ tag, pins, assetNames: names, assets, readObject, putObject })
  return { objects, events, readObject, putObject, repair }
}

test('six assets are preflighted before the first upload; retry repairs every interrupted index', async () => {
  for (let failIndex = 0; failIndex < targets.length; failIndex++) {
    const state = fake()
    let count = 0
    const failingPut = async (...args) => {
      if (count++ === failIndex) throw new Error('upload interrupted')
      await state.putObject(...args)
    }
    await assert.rejects(repairMirror({ tag, pins, assetNames: names, assets, readObject: state.readObject, putObject: failingPut }), /upload interrupted/)
    assert.deepEqual(state.events.slice(0, sixGets()), targets.map(name => `get:${name}`))
    assert.equal(state.objects.size, failIndex)
    const result = await state.repair()
    assert.equal(result.uploaded, targets.length - failIndex)
    assert.equal(state.objects.size, targets.length)
    for (const name of targets) assert.deepEqual(state.objects.get(name), assets.get(name))
    assert.equal((await state.repair()).uploaded, 0)
  }
})

test('lost upload acknowledgement at every index is recovered without overwriting stored bytes', async () => {
  for (let failIndex = 0; failIndex < targets.length; failIndex++) {
    const state = fake()
    let count = 0
    const uncertainPut = async (...args) => {
      await state.putObject(...args)
      if (count++ === failIndex) throw new Error('acknowledgement lost')
    }
    await assert.rejects(repairMirror({ tag, pins, assetNames: names, assets, readObject: state.readObject, putObject: uncertainPut }), /acknowledgement lost/)
    assert.equal(state.objects.size, failIndex + 1)
    assert.deepEqual(state.events.slice(0, targets.length), targets.map(name => `get:${name}`))
    assert.equal((await state.repair()).uploaded, targets.length - failIndex - 1)
    assert.equal(state.events.filter(event => event === `put:${targets[failIndex]}`).length, 1)
    for (const name of targets) assert.deepEqual(state.objects.get(name), assets.get(name))
  }
})

function sixGets() {
  return targets.length
}

test('a wrong object at the last index prevents all writes', async () => {
  const state = fake(new Map([[targets.at(-1), Buffer.from('wrong')]]))
  await assert.rejects(state.repair(), /Existing R2 object hash mismatch/)
  assert.equal(state.events.some(event => event.startsWith('put:')), false)
})

test('a newly appearing correct object is skipped; wrong object fails before put', async () => {
  for (const bytes of [assets.get(targets[0]), Buffer.from('wrong')]) {
    const state = fake()
    let count = 0
    const readObject = async (...args) => {
      const result = await state.readObject(...args)
      if (args[1] === targets[0] && ++count === 2) return { status: 'present', bytes }
      return result
    }
    if (bytes.equals(assets.get(targets[0]))) {
      const result = await repairMirror({ tag, pins, assetNames: names, assets, readObject, putObject: state.putObject })
      assert.equal(result.uploaded, 5)
      assert.equal(state.events.includes(`put:${targets[0]}`), false)
    }
    else {
      await assert.rejects(repairMirror({ tag, pins, assetNames: names, assets, readObject, putObject: state.putObject }), /mismatch before upload/)
      assert.equal(state.events.some(event => event.startsWith('put:')), false)
    }
  }
})

test('wrong tag, asset inventory, and downloaded hashes fail before any R2 access', async () => {
  const installer = `export const EXPECTED_BINARY_VERSION = '1.2.3'\nconst RELEASE_TAG = \`wrapper-\${EXPECTED_BINARY_VERSION}\`\nexport const EXPECTED_BINARY_SHA256: Record<string, string> = Object.freeze({\n${targets.map(name => `  '${name}': '${pins.get(name)}',`).join('\n')}\n})`
  assert.deepEqual(readPins(recipe, installer, tag), pins)
  assert.throws(() => readPins(recipe, installer, 'wrapper-wrong'), /tag disagrees/)
  assert.throws(() => validateAssets([...names, 'extra'], assets, pins), /exactly six/)
  const corrupted = new Map(assets)
  corrupted.set(targets[0], Buffer.from('wrong'))
  const state = fake()
  await assert.rejects(repairMirror({ tag, pins, assetNames: names, assets: corrupted, readObject: state.readObject, putObject: state.putObject }), /asset hash mismatch/)
  assert.deepEqual(state.events, [])
})

test('unknown get errors and generic 404 never count as missing', async () => {
  assert.equal(isMissingKeyError('✘ [ERROR] The specified key does not exist.\n'), true)
  assert.equal(isMissingKeyError('X [ERROR] The specified key does not exist.\n'), true)
  assert.equal(isMissingKeyError('\x1B[31mX \x1B[41;31m[\x1B[41;97mERROR\x1B[41;31m]\x1B[0m \x1B[1mThe specified key does not exist.\x1B[0m\n\n'), true)
  assert.equal(isMissingKeyError('[ERROR] NoSuchKey\n'), true)
  for (const error of ['HTTP 404', '[ERROR] Bucket not found', '[ERROR] Unauthorized', 'network timeout']) {
    assert.equal(isMissingKeyError(error), false)
  }
  const state = fake()
  const failingRead = async () => {
    throw new Error('network timeout')
  }
  await assert.rejects(repairMirror({ tag, pins, assetNames: names, assets, readObject: failingRead, putObject: state.putObject }), /network timeout/)
  assert.deepEqual(state.events, [])
})

test('readback mismatch fails and retry refuses to overwrite it', async () => {
  const state = fake()
  const putObject = async (_, name) => state.objects.set(name, Buffer.from('wrong'))
  await assert.rejects(repairMirror({ tag, pins, assetNames: names, assets, readObject: state.readObject, putObject }), /readback hash mismatch/)
  await assert.rejects(state.repair(), /Existing R2 object hash mismatch/)
  assert.equal(state.events.some(event => event.startsWith('put:')), false)
})

test('CLI adapter uses historical git recipe, exact GitHub assets, and fake Wrangler only', async () => {
  const commit = 'a'.repeat(40)
  const installer = `export const EXPECTED_BINARY_VERSION = '1.2.3'\nconst RELEASE_TAG = \`wrapper-\${EXPECTED_BINARY_VERSION}\`\nexport const EXPECTED_BINARY_SHA256: Record<string, string> = Object.freeze({\n${targets.map(name => `  '${name}': '${pins.get(name)}',`).join('\n')}\n})`
  const objects = new Map()
  const calls = []
  const command = (bin, args) => {
    calls.push([bin, ...args])
    if (bin === 'git') {
      if (args[0] === 'rev-parse') return commit
      if (args[0] === 'merge-base') return ''
      if (args[0] === 'show') return args[1].endsWith('wrapper-release.json') ? JSON.stringify(recipe) : installer
    }
    if (bin === 'gh') {
      if (args[1] === 'view') return JSON.stringify({ tagName: tag, assets: targets.map(name => ({ name })) })
      if (args[1] === 'download') {
        const directory = args[args.indexOf('--dir') + 1]
        for (const [name, bytes] of assets) writeFileSync(`${directory}/${name}`, bytes)
        return ''
      }
    }
    if (bin === 'wrangler') {
      const name = args[3].split('/').at(-1)
      const file = args.find(arg => arg.startsWith('--file=')).slice('--file='.length)
      if (args[2] === 'get') {
        if (!objects.has(name)) throw Object.assign(new Error('missing'), { stderr: '✘ [ERROR] The specified key does not exist.\n' })
        writeFileSync(file, objects.get(name))
        return ''
      }
      if (args[2] === 'put') {
        objects.set(name, readFileSync(file))
        return ''
      }
    }
    throw new Error(`Unexpected fake command: ${bin} ${args.join(' ')}`)
  }
  const env = { GH_TOKEN: 'fake', CLOUDFLARE_API_TOKEN: 'fake', CLOUDFLARE_ACCOUNT_ID: 'fake' }
  const fetchBucket = async (url, options) => {
    assert.equal(url, 'https://api.cloudflare.com/client/v4/accounts/fake/r2/buckets/github')
    assert.equal(options.headers.Authorization, 'Bearer fake')
    return { ok: true, json: async () => ({ success: true, result: { name: 'github' } }) }
  }
  assert.equal((await runRepair({ tag, expectedCommit: commit, command, fetchBucket, env })).uploaded, 6)
  assert.equal((await runRepair({ tag, expectedCommit: commit, command, fetchBucket, env })).uploaded, 0)
  assert.equal(calls.filter(call => call[0] === 'wrangler' && call[3] === 'put').length, 6)
  assert.equal(calls.filter(call => call[0] === 'git' && call[1] === 'show').length, 4)
  const prior = calls.length
  await assert.rejects(runRepair({ tag, expectedCommit: 'b'.repeat(40), command, fetchBucket, env }), /Tag does not resolve/)
  assert.equal(calls.slice(prior).some(call => call[0] === 'wrangler'), false)
  for (const failedFetch of [
    async () => ({ ok: false }),
    async () => ({ ok: true, json: async () => ({ success: false, result: { name: 'github' } }) }),
    async () => ({ ok: true, json: async () => ({ success: true, result: { name: 'other' } }) }),
    async () => { throw new Error('network failure') },
  ]) {
    const beforeBucketFailure = calls.length
    await assert.rejects(runRepair({ tag, expectedCommit: commit, command, fetchBucket: failedFetch, env }))
    assert.equal(calls.slice(beforeBucketFailure).some(call => call[0] === 'wrangler'), false)
  }
})
