import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const recipe = JSON.parse(readFileSync(join(root, 'scripts', 'wrapper-release.json'), 'utf8'))
const installer = readFileSync(join(root, 'src', 'utils', 'installer.ts'), 'utf8')
const wrapper = readFileSync(join(root, 'codeagent-wrapper', 'main.go'), 'utf8')
const targets = [
  'codeagent-wrapper-darwin-amd64',
  'codeagent-wrapper-darwin-arm64',
  'codeagent-wrapper-linux-amd64',
  'codeagent-wrapper-linux-arm64',
  'codeagent-wrapper-windows-amd64.exe',
  'codeagent-wrapper-windows-arm64.exe',
]

function git(...args) {
  return execFileSync('git', args, { cwd: root, maxBuffer: 32 * 1024 * 1024 })
}

function expect(condition, message) {
  if (!condition)
    throw new Error(message)
}

expect(recipe.schemaVersion === 1, 'Unsupported wrapper release recipe')
expect(recipe.releaseTag === `wrapper-${recipe.binaryVersion}`, 'Release tag and binary version disagree')
expect(
  installer.includes(`export const EXPECTED_BINARY_VERSION = '${recipe.binaryVersion}'`),
  'Installer binary version disagrees with recipe',
)
expect(
  /const RELEASE_TAG = `wrapper-\$\{EXPECTED_BINARY_VERSION\}`/.test(installer),
  'Installer download tag must derive from the pinned binary version',
)
expect(
  wrapper.includes(`version               = "${recipe.binaryVersion}"`),
  'Go wrapper version disagrees with recipe',
)
expect(
  git('rev-parse', 'HEAD:codeagent-wrapper').toString().trim() === recipe.sourceTree,
  'Wrapper Git source tree differs from the reviewed recipe',
)

const tracked = git('ls-files', '-z', '--', 'codeagent-wrapper')
  .toString('utf8')
  .split('\0')
  .filter(Boolean)
expect(tracked.length > 0, 'No tracked wrapper source files found')
for (const name of tracked) {
  const path = join(root, name)
  expect(lstatSync(path).isFile(), `Wrapper source is not a regular file: ${name}`)
  expect(
    readFileSync(path).equals(git('show', `HEAD:${name}`)),
    `Wrapper source differs from exact Git bytes: ${name}`,
  )
}

const version = execFileSync('go', ['version'], { cwd: root, encoding: 'utf8' })
expect(version.includes(`go${recipe.goVersion} `), `Expected Go ${recipe.goVersion}; got ${version.trim()}`)

const block = /export const EXPECTED_BINARY_SHA256:[\s\S]*?Object\.freeze\(\{([\s\S]*?)\n\}\)/.exec(installer)?.[1]
expect(block, 'Installer digest table was not found')
const entries = [...block.matchAll(/^\s*'([^']+)': '([0-9a-f]{64})',?\s*$/gm)]
const pins = new Map(entries.map(([, name, digest]) => [name, digest]))
expect(
  entries.length === targets.length
  && pins.size === targets.length
  && targets.every(name => pins.has(name)),
  'Installer must pin exactly the six reviewed wrapper assets',
)

for (const directory of process.argv.slice(2)) {
  const output = resolve(directory)
  const files = readdirSync(output).sort()
  expect(
    JSON.stringify(files) === JSON.stringify([...targets].sort()),
    `Artifact filenames differ from reviewed targets: ${output}`,
  )
  for (const name of targets) {
    const path = join(output, name)
    expect(lstatSync(path).isFile(), `Artifact is not a regular file: ${path}`)
    const actual = createHash('sha256').update(readFileSync(path)).digest('hex')
    expect(actual === pins.get(name), `Digest mismatch for ${name}: expected ${pins.get(name)}, got ${actual}`)
    console.log(`${name} ${actual}`)
  }
}

console.log(`Verified ${tracked.length} exact Git source files, Go ${recipe.goVersion}, and ${process.argv.length - 2} artifact set(s)`)
