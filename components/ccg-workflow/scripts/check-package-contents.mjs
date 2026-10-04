import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, isAbsolute, join, posix, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// This contract is deliberately independent of package.json's files field.
// A broken or broadened files field must not broaden the regression check too.
export const runtimeDirectories = [
  'templates/commands',
  'templates/commands-legacy',
  'templates/engine',
  'templates/hooks',
  'templates/spec',
  'templates/codex',
  'templates/prompts/codex',
  'templates/prompts/claude',
  'templates/prompts/antigravity',
  'templates/prompts/grok',
  'templates/prompts/kimi',
  'templates/prompts/opencode',
  'templates/deepseek-harness-compat',
  'templates/prompts/product-manager',
  'templates/output-styles',
  'templates/rules',
  'templates/skills/impeccable',
  'templates/skills/orchestration',
  'templates/skills/scrapling',
  'templates/skills/tools',
  ...[
    'ai',
    'architecture',
    'data-engineering',
    'development',
    'devops',
    'frontend-design',
    'infrastructure',
    'mobile',
    'orchestration',
    'seo',
  ].map(domain => `templates/skills/domains/${domain}`),
]

export const runtimeFiles = [
  'bin/ccg.mjs',
  'HOST_ISOLATION.md',
  'AI_INSTALL.md',
  'CLAUDE_SSH_BRIDGE_V2.md',
  'NOTICE.md',
  'third-party-sources.json',
  'templates/skills/SKILL.md',
  'templates/skills/run_skill.js',
  ...[
    'analyzer',
    'architect',
    'debugger',
    'frontend',
    'optimizer',
    'reviewer',
    'tester',
  ].map(role => `templates/prompts/gemini/${role}.md`),
  ...[
    'SKILL',
    'blue-team',
    'code-audit',
    'threat-intel',
  ].map(name => `templates/skills/domains/security/${name}.md`),
]

export const sourceOnlyNotes = [
  'templates/skills/domains/security/red-team.md',
  'templates/skills/domains/security/pentest.md',
  'templates/skills/domains/security/vuln-research.md',
]

const builtEntries = ['dist/cli.mjs', 'dist/index.mjs', 'dist/index.d.mts']
const runtimeAnchors = [
  'templates/commands/commit.md',
  'templates/commands/worktree.md',
  'templates/commands/rollback.md',
  'templates/commands/clean-branches.md',
  'templates/engine/strategies/git-action.md',
  'templates/skills/domains/devops/git-workflow.md',
  'templates/skills/tools/lib/shared.js',
  'templates/engine/tools/mcp-secret-launcher.mjs',
  'templates/engine/tools/gptpro/gptpro_bridge.py',
  'templates/engine/tools/grok-intelligence/manage.mjs',
  'templates/engine/tools/grok-intelligence/route.mjs',
  'templates/engine/tools/grok-intelligence/lib/focused-snapshot.mjs',
  'templates/codex/AGENTS.md',
  'templates/codex/config.toml',
  'templates/codex/ccg-config.toml',
  'templates/codex/hooks.json',
  'templates/codex/hooks/ccg-workflow.py',
  'templates/codex/agents/ccg-research.toml',
  'templates/codex/agents/ccg-implement.toml',
  'templates/codex/agents/ccg-review.toml',
]
const npmIncludedFiles = new Set(['package.json', 'LICENSE', 'README.md', 'README.zh-CN.md'])
const secretPatterns = [
  ['private-key', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{30,})\b/],
  ['provider-api-key', /\bsk-[A-Za-z0-9_-]{32,}\b/],
  ['aws-access-key-id', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
]

export function isSafeRelativePath(path) {
  return typeof path === 'string' && path !== '' && !isAbsolute(path)
    && !path.includes('\\') && !path.includes(':')
    && path !== '..' && !path.startsWith('../') && posix.normalize(path) === path
}

export function fileCategory(path) {
  if (/(?:^|\/)(?:__pycache__|node_modules|\.git|\.github|\.agents|\.claude|\.codex|\.ssh)(?:\/|$)/i.test(path)
    || /\.(?:pyc|pyo|log|swp|swo|tgz)$/i.test(path))
    return 'cache-or-development-file'
  if (/(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|\.credentials\.json|credentials\.json|auth\.json|id_(?:rsa|ed25519)|[^/]+\.(?:pem|key|p12|pfx))$/i.test(path))
    return 'credential-file'
  if (sourceOnlyNotes.includes(path))
    return 'source-only-security-note'
  return null
}

export function secretCategories(content) {
  return secretPatterns.filter(([, pattern]) => pattern.test(content)).map(([category]) => category)
}

function allowedPath(path) {
  return npmIncludedFiles.has(path) || runtimeFiles.includes(path)
    || path.startsWith('dist/')
    || runtimeDirectories.some(directory => path.startsWith(`${directory}/`))
}

function walkFiles(root, relativePath) {
  const absolutePath = join(root, relativePath)
  if (!existsSync(absolutePath))
    return []
  const stat = lstatSync(absolutePath)
  if (!stat.isDirectory())
    return [relativePath]
  return readdirSync(absolutePath).sort().flatMap(name => walkFiles(root, `${relativePath}/${name}`))
}

export function validatePack(root, pack, { requireBuild = true } = {}) {
  const paths = pack.files.map(file => file.path)
  const packedPaths = new Set(paths)
  const required = new Set([
    ...npmIncludedFiles,
    ...runtimeFiles,
    ...runtimeAnchors,
    ...runtimeDirectories.flatMap(directory => walkFiles(root, directory).filter(path => !fileCategory(path))),
    ...walkFiles(root, 'dist').filter(path => !fileCategory(path)),
    ...(requireBuild ? builtEntries : []),
  ])
  const missing = [...required].filter(path => !packedPaths.has(path)).sort()
  const unexpected = []
  const findings = []
  for (const path of paths) {
    if (!isSafeRelativePath(path)) {
      findings.push({ path, category: 'unsafe-path' })
      continue
    }
    const category = fileCategory(path)
    if (category)
      findings.push({ path, category })
    if (!allowedPath(path))
      unexpected.push(path)
    const absolutePath = resolve(root, path)
    // npm omits symlinks. Fail if a changed pack implementation includes one.
    let currentPath = root
    let linked = false
    for (const part of path.split('/')) {
      currentPath = join(currentPath, part)
      if (!existsSync(currentPath) || lstatSync(currentPath).isSymbolicLink()) {
        linked = true
        break
      }
    }
    if (linked || !absolutePath.startsWith(`${resolve(root)}${sep}`)) {
      findings.push({ path, category: 'missing-or-linked-file' })
      continue
    }
    for (const secretCategory of secretCategories(readFileSync(absolutePath, 'utf8')))
      findings.push({ path, category: secretCategory })
  }
  return {
    ok: missing.length === 0 && unexpected.length === 0 && findings.length === 0,
    entryCount: paths.length,
    unpackedSize: pack.unpackedSize,
    missing,
    unexpected: unexpected.sort(),
    findings: findings.sort((a, b) => a.path.localeCompare(b.path) || a.category.localeCompare(b.category)),
  }
}

function npmCliPath() {
  const searchDirectories = (process.env.PATH || '').split(delimiter)
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    ...searchDirectories.map(directory => join(directory, 'node_modules', 'npm', 'bin', 'npm-cli.js')),
  ]
  const found = candidates.find(path => path && existsSync(path) && /npm-cli\.(?:js|cjs)$/.test(path))
  if (!found)
    throw new Error('npm CLI not found; run through npm run check:package or npm run test:package.')
  return found
}

export function inspectPackage(root, options = {}) {
  const temporary = mkdtempSync(join(tmpdir(), 'ccg-package-check-'))
  try {
    const result = spawnSync(process.execPath, [
      npmCliPath(),
      'pack',
      '--dry-run',
      '--json',
      '--ignore-scripts',
      '--offline',
      '--cache',
      join(temporary, 'npm-cache'),
    ], { cwd: root, encoding: 'utf8', timeout: 30_000, windowsHide: true })
    // Never echo npm stdout/stderr on failure: they can contain local metadata.
    if (result.status !== 0)
      throw new Error(`npm pack check failed (exit ${result.status ?? 'unavailable'}).`)
    const packs = JSON.parse(result.stdout)
    if (packs.length !== 1 || !Array.isArray(packs[0].files))
      throw new Error('npm pack returned an invalid file manifest.')
    return validatePack(root, packs[0], options)
  }
  finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

const invokedDirectly = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
if (invokedDirectly) {
  try {
    const root = dirname(dirname(fileURLToPath(import.meta.url)))
    const report = inspectPackage(root)
    // Reports include only counts, file paths, and finding categories.
    console.log(JSON.stringify(report, null, 2))
    process.exitCode = report.ok ? 0 : 1
  }
  catch {
    console.error('Package check could not complete; check local npm availability and build output.')
    process.exitCode = 1
  }
}
