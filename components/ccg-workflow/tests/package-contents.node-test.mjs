import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  inspectPackage,
  isSafeRelativePath,
  runtimeDirectories,
  runtimeFiles,
  secretCategories,
  sourceOnlyNotes,
} from '../scripts/check-package-contents.mjs'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))

function put(root, path, content) {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), content)
}

function fixture(root) {
  // Keep this independent from the real worktree: mutation probes never touch
  // installed plugins, the source repository, or another agent's build files.
  const copied = new Set([
    'package.json',
    'LICENSE',
    'README.md',
    'README.zh-CN.md',
    ...runtimeFiles,
    ...runtimeDirectories,
    ...sourceOnlyNotes,
  ])
  for (const path of copied)
    cpSync(join(repoRoot, path), join(root, path), { recursive: true })
  put(root, 'dist/cli.mjs', '// package fixture\n')
  put(root, 'dist/index.mjs', '// package fixture\n')
  put(root, 'dist/index.d.mts', '// package fixture\n')
  put(root, 'dist/shared/runtime.mjs', '// shared chunk fixture\n')
}

test('built npm package contains every approved runtime asset and no detected secrets', () => {
  const report = inspectPackage(repoRoot)
  assert.equal(report.ok, true, JSON.stringify(report))
})

test('personal package cannot take upstream Claude ccg bin or expose legacy installers', async () => {
  const manifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
  assert.equal(manifest.name, '@jed-zed/ccg-codex-workflow')
  assert.deepEqual(manifest.bin, { 'ccg-codex': 'bin/ccg.mjs' })
  const api = await import('../dist/index.mjs')
  for (const name of ['init', 'showMainMenu', 'installWorkflows', 'uninstallWorkflows', 'installAceTool', 'installAceToolRs', 'uninstallAceTool', 'migrateToV1_4_0'])
    assert.equal(name in api, false, `${name} must not be a personal public API`)
  for (const name of ['installCodexMode', 'uninstallCodexMode', 'recoverCodexMode'])
    assert.equal(typeof api[name], 'function')
})

test('npm whitelist excludes source-only notes, new skill groups, and Python caches', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'ccg-package-regression-'))
  try {
    fixture(temporary)
    put(temporary, 'templates/skills/unapproved/SKILL.md', '# Unapproved fixture\n')
    put(temporary, 'templates/skills/unapproved/.env', 'FIXTURE=excluded\n')
    for (const directory of ['templates/engine', 'templates/codex/hooks', 'templates/skills/tools']) {
      put(temporary, `${directory}/__pycache__/fixture.pyc`, 'cache fixture')
      put(temporary, `${directory}/fixture.pyo`, 'cache fixture')
    }
    const report = inspectPackage(temporary)
    assert.equal(report.ok, true, JSON.stringify(report))
    const files = JSON.parse(readFileSync(join(temporary, 'package.json'), 'utf8')).files
    assert.equal(files.includes('templates/skills/'), false)

    // An allowed directory must not hide a credential or token-containing file.
    put(temporary, 'templates/commands/.env.local', 'FIXTURE=credential-file\n')
    const token = ['ghp_', 'A'.repeat(36)].join('')
    put(temporary, 'templates/commands/accidental-secret.md', token)
    const unsafe = inspectPackage(temporary)
    assert.equal(unsafe.ok, false)
    assert.ok(unsafe.findings.some(item => item.path === 'templates/commands/.env.local' && item.category === 'credential-file'))
    assert.ok(unsafe.findings.some(item => item.path === 'templates/commands/accidental-secret.md' && item.category === 'github-token'))
    assert.equal(JSON.stringify(unsafe).includes(token), false)

    // Preserve Git skills and safe security references when pruning a package.
    const manifest = JSON.parse(readFileSync(join(temporary, 'package.json'), 'utf8'))
    manifest.files = manifest.files.filter(path => path !== 'templates/skills/domains/devops/' && path !== 'templates/skills/domains/security/blue-team.md')
    manifest.files = manifest.files.filter(path => path !== 'dist')
    manifest.files.push('dist/cli.mjs', 'dist/index.mjs', 'dist/index.d.mts')
    put(temporary, 'package.json', JSON.stringify(manifest))
    const incomplete = inspectPackage(temporary)
    assert.ok(incomplete.missing.includes('templates/skills/domains/devops/git-workflow.md'))
    assert.ok(incomplete.missing.includes('templates/skills/domains/security/blue-team.md'))
    assert.ok(incomplete.missing.includes('dist/shared/runtime.mjs'))
  }
  finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})

test('secret detection reports categories and rejects unsafe file paths', () => {
  assert.deepEqual(secretCategories(['-----BEGIN ', 'PRIVATE KEY-----'].join('')), ['private-key'])
  assert.deepEqual(secretCategories(['sk-proj-', 'a'.repeat(40)].join('')), ['provider-api-key'])
  assert.deepEqual(secretCategories(['AKIA', 'A'.repeat(16)].join('')), ['aws-access-key-id'])
  assert.deepEqual(secretCategories('apiKey: process.env.PROVIDER_API_KEY\n<YOUR_API_KEY>'), [])
  for (const path of ['../outside', '/absolute', 'C:/private', 'templates/../secret', 'templates\\secret'])
    assert.equal(isSafeRelativePath(path), false)
  assert.equal(isSafeRelativePath('templates/skills/domains/devops/git-workflow.md'), true)
})
