import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  inspectGlobalPackage, buildBootstrapOwnership, buildRestoreAction,
  validateBootstrapOwnership, assertBootstrapOwnershipContinuity,
} from '../scripts/lib/harness-lifecycle.mjs'

const PACKAGE = '@jed-zed/ccg-codex-workflow'
const COMMAND = 'ccg-codex'

test('scoped Codex CCG package is inspected at its exact nested npm root', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ccg-codex-package-'))
  try {
    const packageRoot = path.join(root, ...PACKAGE.split('/'))
    await mkdir(path.join(packageRoot, 'bin'), { recursive: true })
    await writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({ name: PACKAGE, version: '3.4.16-localarchive.3', bin: { [COMMAND]: 'bin/ccg.mjs' } }))
    await writeFile(path.join(packageRoot, 'bin', 'ccg.mjs'), "console.log('ccg-codex/3.4.16-localarchive.3')\n")
    const observed = await inspectGlobalPackage(root, PACKAGE)
    assert.equal(observed.version, '3.4.16-localarchive.3')
    assert.equal(observed.entryPath, path.resolve(packageRoot))
    assert.equal(observed.sourcePath, undefined)
    assert.match(observed.contentIdentity.digest, /^[a-f0-9]{64}$/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('scoped Codex bootstrap ownership retains its exact npm uninstall target', () => {
  const repoRoot = path.resolve('C:/synthetic-harness')
  const installed = {
    version: '3.4.16-localarchive.3', entryPath: path.resolve('C:/synthetic-prefix/node_modules/@jed-zed/ccg-codex-workflow'),
    entryIdentity: { dev: '1', ino: '2', birthtimeNs: '3' }, packageJsonSha256: 'a'.repeat(64),
    contentIdentity: { algorithm: 'sha256-tree-v1', digest: 'b'.repeat(64), entryCount: 2 },
  }
  const first = buildBootstrapOwnership({ repoRoot, ccgPackage: PACKAGE, managed: { ccg: true }, before: { ccg: null }, after: { ccg: installed } })
  assert.equal(first.entries[0].package, PACKAGE)
  validateBootstrapOwnership(first, repoRoot)
  assert.deepEqual(buildRestoreAction(first.entries[0]), { operation: 'uninstall', spec: PACKAGE })
  const repeated = buildBootstrapOwnership({ repoRoot, ccgPackage: PACKAGE, managed: { ccg: true }, before: { ccg: installed }, after: { ccg: installed }, existingOwnership: first })
  assert.equal(repeated.entries[0].originalBeforeFirstManagement, null)
  assert.deepEqual(buildRestoreAction(repeated.entries[0]), { operation: 'uninstall', spec: PACKAGE })
  assert.throws(() => assertBootstrapOwnershipContinuity(first, { ccg: installed }, { ccg: true, ccgPackage: 'ccg-workflow' }, repoRoot), /package.*identity|package.*migration/i)
})


test('runtime identity rejects unknown packages, wrong bins and extra legacy aliases', async () => {
  const { resolveCcgRuntimePackage, validateCcgRuntimePackage } = await import('../scripts/ccg-runtime.mjs')
  const source = { ccg: { package: PACKAGE, version: '3.4.16-localarchive.3' } }
  assert.deepEqual(resolveCcgRuntimePackage(PACKAGE), { packageName: PACKAGE, command: COMMAND, entrypoint: 'bin/ccg.mjs' })
  assert.throws(() => resolveCcgRuntimePackage('@another/ccg'), /Unsupported/)
  for (const bin of [{ ccg: 'bin/ccg.mjs' }, { [COMMAND]: '../elsewhere.mjs' }, { [COMMAND]: 'bin/ccg.mjs', ccg: 'bin/ccg.mjs' }]) {
    assert.throws(() => validateCcgRuntimePackage({ name: PACKAGE, version: source.ccg.version, bin }, source), /identity/)
  }
  assert.equal(validateCcgRuntimePackage({ name: PACKAGE, version: source.ccg.version, bin: { [COMMAND]: './bin/ccg.mjs' } }, source).command, COMMAND)
  const { parseCcgVersion } = await import('../scripts/lib/harness-adapter/conflict-utils.mjs')
  assert.equal(parseCcgVersion('ccg-codex/3.4.16-localarchive.3 win32-x64'), '3.4.16-localarchive.3')
  assert.equal(parseCcgVersion('ccg/3.4.15 win32-x64'), '3.4.15')
})


test('actual isolated npm prefix supports scoped clean/repeat/uninstall and failed bootstrap recovery', async () => {
  const { spawnSync } = await import('node:child_process')
  const { readFile, access } = await import('node:fs/promises')
  const { resolvePackageManagerInvocation, globalPackageRootFromNpmPrefix } = await import('../scripts/lib/harness-lifecycle.mjs')
  const lifecycle = new URL('../scripts/harness-lifecycle.mjs', import.meta.url)
  const root = await mkdtemp(path.join(tmpdir(), 'harness-scoped-npm-'))
  const prefix = path.join(root, 'private prefix')
  const project = path.join(root, 'project')
  const source = path.join(project, 'components', 'ccg-workflow')
  const version = '3.4.16-localarchive.3'
  const globalRoot = globalPackageRootFromNpmPrefix(prefix, { platform: process.platform })
  const npmrc = path.join(root, 'empty.npmrc')
  const env = { ...process.env, NPM_CONFIG_PREFIX: prefix, NPM_CONFIG_CACHE: path.join(root, 'cache'), NPM_CONFIG_USERCONFIG: npmrc, NPM_CONFIG_GLOBALCONFIG: path.join(root, 'empty-global.npmrc'), NPM_CONFIG_UPDATE_NOTIFIER: 'false' }
  const run = (command, args, expected = 0) => {
    const result = spawnSync(command, args, { env, encoding: 'utf8', shell: false, timeout: 60000 })
    assert.equal(result.status, expected, [result.error, result.stdout, result.stderr].filter(Boolean).join('\n'))
    return result
  }
  const npm = args => {
    const resolved = resolvePackageManagerInvocation('npm', [...args, '--prefix', prefix, '--offline', '--ignore-scripts', '--no-audit', '--no-fund'])
    return run(resolved.command, resolved.args)
  }
  const stage = name => run(process.execPath, [lifecycle.pathname.replace(/^\/(?:([A-Za-z]:))/, '$1'), name, '--repo-root', project, ...(name === 'bootstrap-begin' ? ['--manage-ccg'] : [])])
  try {
    await mkdir(path.join(source, 'bin'), { recursive: true })
    await mkdir(path.join(project, '.claude'), { recursive: true })
    await mkdir(path.join(root, 'home', '.claude'), { recursive: true })
    await mkdir(path.join(globalRoot, 'ccg-workflow', 'bin'), { recursive: true })
    await writeFile(npmrc, '')
    await writeFile(env.NPM_CONFIG_GLOBALCONFIG, '')
    await writeFile(path.join(project, 'harness.sources.json'), JSON.stringify({ trellis: { version: '0.6.16' }, ccg: { package: PACKAGE, version, snapshotPath: 'components/ccg-workflow' } }))
    await writeFile(path.join(source, 'package.json'), JSON.stringify({ name: PACKAGE, version, bin: { [COMMAND]: './bin/ccg.mjs' } }))
    await writeFile(path.join(source, 'bin', 'ccg.mjs'), `#!/usr/bin/env node\nconsole.log('ccg-codex/${version}')\n`)
    await writeFile(path.join(globalRoot, 'ccg-workflow', 'package.json'), JSON.stringify({ name: 'ccg-workflow', version: '3.6.7', bin: { ccg: 'bin/ccg.mjs' } }))
    await writeFile(path.join(globalRoot, 'ccg-workflow', 'bin', 'ccg.mjs'), "throw new Error('upstream sentinel must not execute')\n")
    const legacyShim = process.platform === 'win32' ? path.join(prefix, 'ccg.cmd') : path.join(prefix, 'bin', 'ccg')
    await mkdir(path.dirname(legacyShim), { recursive: true })
    const sentinels = [path.join(project, '.claude', 'keep.txt'), path.join(root, 'home', '.claude', 'keep.txt'), legacyShim, path.join(globalRoot, 'ccg-workflow', 'package.json'), path.join(globalRoot, 'ccg-workflow', 'bin', 'ccg.mjs')]
    await writeFile(sentinels[0], 'project Claude bytes stay original\n')
    await writeFile(sentinels[1], 'home Claude bytes stay original\n')
    await writeFile(legacyShim, 'upstream CCG alias sentinel\n')
    const before = await Promise.all(sentinels.map(file => readFile(file)))
    const preserved = async () => { for (const [index, file] of sentinels.entries()) assert.deepEqual(await readFile(file), before[index], file) }
    for (let attempt = 0; attempt < 2; attempt++) {
      stage('bootstrap-begin')
      npm(['install', '-g', '--install-links=true', '--install-strategy=nested', source])
      stage('bootstrap-complete')
      const installed = await inspectGlobalPackage(globalRoot, PACKAGE)
      assert.equal(installed.version, version)
      assert.equal(installed.sourcePath, undefined)
      const owned = JSON.parse(await readFile(path.join(project, '.harness-cache', 'ownership.json'), 'utf8'))
      assert.equal(owned.entries[0].package, PACKAGE)
      assert.equal(owned.entries[0].originalBeforeFirstManagement, null)
      await preserved()
    }
    const ownershipBeforeFailure = await readFile(path.join(project, '.harness-cache', 'ownership.json'))
    const packageBeforeFailure = await inspectGlobalPackage(globalRoot, PACKAGE)
    stage('bootstrap-begin')
    const badSource = path.join(root, 'bad upgrade source')
    await mkdir(badSource)
    await writeFile(path.join(badSource, 'package.json'), '{ invalid JSON')
    const failedInvocation = resolvePackageManagerInvocation('npm', ['install', '-g', '--install-links=true', '--prefix', prefix, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', badSource])
    const failed = spawnSync(failedInvocation.command, failedInvocation.args, { env, encoding: 'utf8', shell: false, timeout: 60000 })
    assert.notEqual(failed.status, 0)
    stage('bootstrap-abort')
    assert.deepEqual(await readFile(path.join(project, '.harness-cache', 'ownership.json')), ownershipBeforeFailure)
    assert.deepEqual(await inspectGlobalPackage(globalRoot, PACKAGE), packageBeforeFailure)
    await preserved()
    stage('uninstall')
    assert.equal(await inspectGlobalPackage(globalRoot, PACKAGE), null)
    await assert.rejects(access(path.join(prefix, process.platform === 'win32' ? 'ccg-codex.cmd' : 'bin/ccg-codex')))
    await preserved()
    // An interrupted first install with no previous scoped package can be exactly
    // undone; this uses the actual lifecycle abort and actual npm uninstall.
    stage('bootstrap-begin')
    npm(['install', '-g', '--install-links=true', '--install-strategy=nested', source])
    stage('bootstrap-abort')
    assert.equal(await inspectGlobalPackage(globalRoot, PACKAGE), null)
    await preserved()
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep))
    await rm(root, { recursive: true, force: true })
  }
})
