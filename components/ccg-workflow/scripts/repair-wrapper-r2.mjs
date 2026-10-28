import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, isMissingKeyError, readPins, repairMirror, targets } from './repair-wrapper-r2-core.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

function execute(bin, args) {
  return execFileSync(bin, args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
}

export async function runRepair({ tag, expectedCommit, command = execute, fetchBucket = globalThis.fetch, env = process.env }) {
  expect(/^wrapper-[A-Za-z0-9][A-Za-z0-9._-]*$/.test(tag ?? ''), 'Explicit release tag is required')
  expect(/^[0-9a-f]{40}$/.test(expectedCommit ?? ''), 'Explicit full expected commit SHA is required')
  expect(env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ACCOUNT_ID, 'Cloudflare token and account ID are required')
  expect(env.GH_TOKEN, 'GitHub token is required')

  // Annotated tags are peeled to commits. Release files come from that commit.
  expect(command('git', ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`]).trim() === expectedCommit, 'Tag does not resolve to approved commit')
  command('git', ['merge-base', '--is-ancestor', expectedCommit, 'refs/remotes/origin/main'])
  const recipe = JSON.parse(command('git', ['show', `${expectedCommit}:scripts/wrapper-release.json`]))
  const installer = command('git', ['show', `${expectedCommit}:src/utils/installer.ts`])
  const pins = readPins(recipe, installer, tag)
  const release = JSON.parse(command('gh', ['release', 'view', tag, '--json', 'tagName,assets']))
  expect(release.tagName === tag, 'GitHub release tag mismatch')
  const assetNames = release.assets?.map(asset => asset.name)
  expect(Array.isArray(assetNames) && assetNames.length === targets.length && new Set(assetNames).size === targets.length
    && targets.every(name => assetNames.includes(name)), 'GitHub release must contain exactly six expected assets')

  const directory = mkdtempSync(join(tmpdir(), 'wrapper-r2-repair-'))
  try {
    command('gh', ['release', 'download', tag, '--dir', directory])
    const files = readdirSync(directory)
    expect(files.length === targets.length && targets.every(name => files.includes(name)), 'Downloaded assets differ from release inventory')
    const assets = new Map(targets.map(name => [name, readFileSync(join(directory, name))]))
    const bucketResponse = await fetchBucket(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/r2/buckets/github`, {
      headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
    })
    expect(bucketResponse.ok, 'R2 bucket preflight HTTP request failed')
    const bucket = await bucketResponse.json()
    expect(bucket.success === true && bucket.result?.name === 'github', 'R2 bucket preflight did not confirm the github bucket')
    let readNumber = 0
    const readObject = async (releaseTag, name) => {
      const path = join(directory, `r2-read-${readNumber++}`)
      const key = `github/${releaseTag}/${name}`
      try {
        command('wrangler', ['r2', 'object', 'get', key, `--file=${path}`, '--remote'])
        return { status: 'present', bytes: readFileSync(path) }
      }
      catch (error) {
        const output = `${error.stdout ?? ''}\n${error.stderr ?? ''}`
        if (isMissingKeyError(output)) return { status: 'missing' }
        throw new Error(`R2 read failed for ${key}: ${output.trim() || error.message}`)
      }
    }
    const putObject = async (releaseTag, name) => {
      const key = `github/${releaseTag}/${name}`
      command('wrangler', ['r2', 'object', 'put', key, `--file=${join(directory, name)}`, '--content-type=application/octet-stream', '--remote'])
    }
    return await repairMirror({ tag, pins, assetNames, assets, readObject, putObject })
  }
  finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [tag, expectedCommit] = process.argv.slice(2)
  const result = await runRepair({ tag, expectedCommit })
  console.log(`Verified ${result.checked} R2 objects; uploaded ${result.uploaded} missing objects for ${tag}`)
}
