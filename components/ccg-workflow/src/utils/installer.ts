import type { InstallResult } from '../types'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import ansis from 'ansis'
import fs from 'fs-extra'
import { basename, join } from 'pathe'
import { getLegacyCommandIds, getWorkflowById } from './installer-data'
import { PACKAGE_ROOT, injectConfigVariables, replaceHomePathsInTemplate } from './installer-template'
import { installCodexModeAt, recoverCodexModeAt, uninstallCodexModeAt } from './codex-mode'
import { installSkillCommands } from './skill-registry'

// ═══════════════════════════════════════════════════════
// Re-exports — all consumers import from './installer'
// These re-exports preserve backward compatibility.
// ═══════════════════════════════════════════════════════

export {
  getAllCommandIds,
  getCoreCommandIds,
  getLegacyCommandIds,
  getWorkflowById,
  getWorkflowConfigs,
  getWorkflowPreset,
  WORKFLOW_PRESETS,
} from './installer-data'
export type { WorkflowPreset } from './installer-data'

export { injectConfigVariables } from './installer-template'

export {
  installAceTool,
  installAceToolRs,
  installContextWeaver,
  installFastContext,
  installMcpServer,
  installRemoteMcpServer,
  syncMcpToCodex,
  syncMcpToGemini,
  uninstallAceTool,
  uninstallContextWeaver,
  uninstallFastContext,
  uninstallMcpServer,
} from './installer-mcp'
export type {
  ContextWeaverConfig,
  McpInstallOptions,
} from './installer-mcp'

export {
  removeFastContextPrompt,
  writeFastContextPrompt,
} from './installer-prompt'

export {
  collectInvocableSkills,
  collectSkills,
  parseFrontmatter,
} from './skill-registry'
export type { SkillMeta } from './skill-registry'

// ═══════════════════════════════════════════════════════
// Binary version tracking
// ═══════════════════════════════════════════════════════

/**
 * Expected codeagent-wrapper binary version.
 * Must match the `version` constant in codeagent-wrapper/main.go.
 * When this differs from the installed binary, update triggers re-download.
 */
export const EXPECTED_BINARY_VERSION = '5.12.9'
export const BINARY_INSTALL_FAILURE_POLICY = 'fatal' as const

/**
 * Trusted digests published by the authoritative personal fork's `preset`
 * release. A candidate must match before it is made executable or started.
 * Generated from the authoritative GitHub Actions LF checkout with Go 1.21.13,
 * CGO disabled, and `-buildvcs=false -trimpath -ldflags="-s -w"`.
 */
export const EXPECTED_BINARY_SHA256: Readonly<Record<string, string>> = Object.freeze({
  'codeagent-wrapper-darwin-amd64': 'd465b8fdd187fe125cb41b888e3ae152a0b6397e5842987ae7a609ad53f19b8f',
  'codeagent-wrapper-darwin-arm64': 'c4264486f8cb752a95c0742a74301dab082cd15b4d4c8515656178543e5e6860',
  'codeagent-wrapper-linux-amd64': '8b6cc89b4d70d9b4a81cd8f130e2cdf8a5e357defb785eec3b06d2b1e1fee8bb',
  'codeagent-wrapper-linux-arm64': '9af5e2bb60866d78f441eaac89e837f7c2a7b2cbdb1e6e25e46d8d215bb0462d',
  'codeagent-wrapper-windows-amd64.exe': 'ee95a3d52199f87e466126ffbda2be8ca63496ba1c14dce5f477fcc5707154a6',
  'codeagent-wrapper-windows-arm64.exe': '67e4be70249e21cbde13ec237638e4af3a9118acac74886bffe09cfe6ab893cb',
})

// ═══════════════════════════════════════════════════════
// Install context — shared across sub-functions
// ═══════════════════════════════════════════════════════

interface InstallConfig {
  routing: {
    mode: string
    frontend: { models: string[], primary: string }
    backend: { models: string[], primary: string }
    search: { models: string[], primary: string }
    review?: { models: string[] }
    geminiModel?: string
    grokModel?: string
  }
  liteMode: boolean
  mcpProvider: string
  skipImpeccable?: boolean
}

interface InstallContext {
  installDir: string
  force: boolean
  config: InstallConfig
  templateDir: string
  result: InstallResult
}

function normalizeTemplateContent(content: string): string {
  return content.replace(/\r\n/g, '\n')
}

// ═══════════════════════════════════════════════════════
// Binary download
// ═══════════════════════════════════════════════════════

const GITHUB_REPO = 'jed-zed/ccg-gptpro-worflow'
const RELEASE_TAG = 'preset'

/** Only the user's authoritative personal release is an executable source. */
const BINARY_SOURCES = [
  { name: 'Personal GitHub Release', url: `https://github.com/${GITHUB_REPO}/releases/download/${RELEASE_TAG}`, timeoutMs: 120_000 },
]

/**
 * Download a binary candidate from one authoritative URL with bounded retries.
 * Uses curl for proxy support (reads HTTPS_PROXY / ALL_PROXY env vars automatically).
 * Falls back to Node.js fetch if curl is unavailable.
 */
async function downloadFromUrl(url: string, destPath: string, timeoutMs: number, maxAttempts = 2): Promise<boolean> {
  const timeoutSec = Math.ceil(timeoutMs / 1000)

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Prefer curl — auto-reads HTTPS_PROXY / ALL_PROXY for proxy support.
      // Use argv rather than a shell command so paths cannot change execution.
      execFileSync(
        'curl',
        ['-fsSL', '--max-time', String(timeoutSec), '-o', destPath, url],
        { stdio: 'pipe', timeout: timeoutMs + 5000 },
      )
      return true
    }
    catch {
      // curl failed — try Node.js fetch as fallback (no proxy support)
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)

        const response = await fetch(url, { redirect: 'follow', signal: controller.signal })
        if (!response.ok) {
          clearTimeout(timer)
          if (attempt < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, attempt * 2000))
            continue
          }
          return false
        }

        const buffer = Buffer.from(await response.arrayBuffer())
        clearTimeout(timer)

        // Keep the candidate non-executable until its trusted digest matches.
        await fs.writeFile(destPath, buffer, { mode: 0o600 })
        return true
      }
      catch {
        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, attempt * 2000))
          continue
        }
        return false
      }
    }
  }
  return false
}

/** Download a codeagent-wrapper candidate from the personal release only. */
interface BinaryDownloadResult {
  downloaded: boolean
  observedDigests: string[]
}

async function sha256File(filePath: string): Promise<string> {
  const bytes = await fs.readFile(filePath)
  return createHash('sha256').update(bytes).digest('hex')
}

async function readBinaryVersion(binaryPath: string): Promise<string | null> {
  try {
    const output = execFileSync(binaryPath, ['--version'], { stdio: 'pipe' }).toString().trim()
    const versionMatch = output.match(/\bversion\s+(\S+)/i)
    return versionMatch?.[1] ?? output
  }
  catch {
    return null
  }
}

/**
 * Replace an installed binary only after the candidate matches the trusted
 * digest and reports the expected version. Digest verification always happens
 * before chmod or process creation.
 */
export async function promoteBinaryCandidate(
  candidatePath: string,
  destPath: string,
  expectedVersion: string,
  expectedSha256: string,
): Promise<{
  promoted: boolean
  actualVersion: string | null
  actualSha256: string | null
  reason: 'integrity-mismatch' | 'version-mismatch' | null
}> {
  const actualSha256 = await sha256File(candidatePath)
  if (actualSha256 !== expectedSha256) {
    await fs.remove(candidatePath)
    return { promoted: false, actualVersion: null, actualSha256, reason: 'integrity-mismatch' }
  }

  if (process.platform !== 'win32') {
    await fs.chmod(candidatePath, 0o755)
  }

  const actualVersion = await readBinaryVersion(candidatePath)
  if (actualVersion !== expectedVersion) {
    await fs.remove(candidatePath)
    return { promoted: false, actualVersion, actualSha256, reason: 'version-mismatch' }
  }

  await fs.move(candidatePath, destPath, { overwrite: true })
  return { promoted: true, actualVersion, actualSha256, reason: null }
}

async function downloadBinaryFromRelease(
  binaryName: string,
  destPath: string,
  expectedSha256: string,
): Promise<BinaryDownloadResult> {
  const observedDigests: string[] = []
  for (const source of BINARY_SOURCES) {
    const url = `${source.url}/${binaryName}`
    const ok = await downloadFromUrl(url, destPath, source.timeoutMs)
    if (!ok) continue

    const actualSha256 = await sha256File(destPath)
    if (actualSha256 === expectedSha256) {
      return { downloaded: true, observedDigests }
    }
    observedDigests.push(actualSha256)
    await fs.remove(destPath)
  }
  await fs.remove(destPath)
  return { downloaded: false, observedDigests }
}

// ═══════════════════════════════════════════════════════
// Shared file-copy helper
// ═══════════════════════════════════════════════════════

/**
 * Copy .md templates from srcDir → destDir with optional variable injection.
 * Returns list of installed file stems (filename without .md).
 */
async function copyMdTemplates(
  ctx: InstallContext,
  srcDir: string,
  destDir: string,
  options: { inject?: boolean } = {},
): Promise<string[]> {
  const installed: string[] = []
  if (!(await fs.pathExists(srcDir))) {
    // Log warning — helps diagnose "0 commands installed" issues
    console.error(`[CCG] Template source directory not found: ${srcDir}`)
    return installed
  }

  await fs.ensureDir(destDir)
  const files = await fs.readdir(srcDir)
  for (const file of files) {
    if (!file.endsWith('.md')) continue
    const destFile = join(destDir, file)
    if (ctx.force || !(await fs.pathExists(destFile))) {
      let content = await fs.readFile(join(srcDir, file), 'utf-8')
      if (options.inject) content = injectConfigVariables(content, ctx.config)
      content = replaceHomePathsInTemplate(content, ctx.installDir)
      content = normalizeTemplateContent(content)
      await fs.writeFile(destFile, content, 'utf-8')
      installed.push(file.replace('.md', ''))
    }
  }
  return installed
}

async function copyTemplateTree(
  ctx: InstallContext,
  srcDir: string,
  destDir: string,
  options: { injectMd?: boolean } = {},
): Promise<string[]> {
  const installed: string[] = []
  if (!(await fs.pathExists(srcDir))) return installed

  const copyEntry = async (source: string, dest: string, prefix = ''): Promise<void> => {
    await fs.ensureDir(dest)
    const entries = await fs.readdir(source, { withFileTypes: true })
    for (const entry of entries) {
      const sourcePath = join(source, entry.name)
      const destPath = join(dest, entry.name)
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name

      if (entry.isDirectory()) {
        await copyEntry(sourcePath, destPath, relPath)
        continue
      }

      if (entry.name.endsWith('.md')) {
        let content = await fs.readFile(sourcePath, 'utf-8')
        if (options.injectMd) content = injectConfigVariables(content, ctx.config)
        content = replaceHomePathsInTemplate(content, ctx.installDir)
        content = normalizeTemplateContent(content)
        await fs.writeFile(destPath, content, 'utf-8')
      }
      else {
        await fs.copy(sourcePath, destPath, { overwrite: true })
      }
      installed.push(relPath)
    }
  }

  await copyEntry(srcDir, destDir)
  return installed
}

// ═══════════════════════════════════════════════════════
// Install sub-steps
// ═══════════════════════════════════════════════════════

/**
 * Install slash command .md files from templates/commands/
 */
async function installCommandFiles(ctx: InstallContext, workflowIds: string[]): Promise<void> {
  const commandsDir = join(ctx.installDir, 'commands', 'ccg')
  const legacyIds = new Set(getLegacyCommandIds())

  for (const workflowId of workflowIds) {
    const workflow = getWorkflowById(workflowId)
    if (!workflow) {
      ctx.result.errors.push(`Unknown workflow: ${workflowId}`)
      continue
    }

    for (const cmd of workflow.commands) {
      // Route to correct source directory: core → commands/, legacy → commands-legacy/
      const srcSubdir = legacyIds.has(workflowId) ? 'commands-legacy' : 'commands'
      const srcFile = join(ctx.templateDir, srcSubdir, `${cmd}.md`)
      const destFile = join(commandsDir, `${cmd}.md`)

      try {
        if (await fs.pathExists(srcFile)) {
          if (ctx.force || !(await fs.pathExists(destFile))) {
            let content = await fs.readFile(srcFile, 'utf-8')
            content = injectConfigVariables(content, ctx.config)
            content = replaceHomePathsInTemplate(content, ctx.installDir)
            await fs.writeFile(destFile, content, 'utf-8')
          }
          ctx.result.installedCommands.push(cmd)
        }
        else {
          const placeholder = `---
description: "${workflow.descriptionEn}"
---

# /ccg:${cmd}

${workflow.description}

> This command is part of CCG multi-model collaboration system.
`
          await fs.writeFile(destFile, placeholder, 'utf-8')
          ctx.result.installedCommands.push(cmd)
        }
      }
      catch (error) {
        ctx.result.errors.push(`Failed to install ${cmd}: ${error}`)
        ctx.result.success = false
      }
    }
  }
}

/**
 * Install agent .md files from templates/commands/agents/
 */
async function installAgentFiles(ctx: InstallContext): Promise<void> {
  try {
    await copyMdTemplates(
      ctx,
      join(ctx.templateDir, 'commands', 'agents'),
      join(ctx.installDir, 'agents', 'ccg'),
      { inject: true },
    )
  }
  catch (error) {
    ctx.result.errors.push(`Failed to install agents: ${error}`)
    ctx.result.success = false
  }
}

/**
 * Install expert prompt .md files from templates/prompts/{codex,gemini,claude}/
 */
async function installPromptFiles(ctx: InstallContext): Promise<void> {
  const promptsTemplateDir = join(ctx.templateDir, 'prompts')
  const promptsDir = join(ctx.installDir, '.ccg', 'prompts')
  if (!(await fs.pathExists(promptsTemplateDir))) {
    ctx.result.errors.push(`Prompts template directory not found: ${promptsTemplateDir}`)
    return
  }

  for (const model of ['codex', 'gemini', 'claude', 'antigravity', 'grok']) {
    try {
      const installed = await copyMdTemplates(
        ctx,
        join(promptsTemplateDir, model),
        join(promptsDir, model),
      )
      for (const name of installed) {
        ctx.result.installedPrompts.push(`${model}/${name}`)
      }
    }
    catch (error) {
      ctx.result.errors.push(`Failed to install ${model} prompts: ${error}`)
      ctx.result.success = false
    }
  }
}

/**
 * Recursively collect skill names (directories containing SKILL.md, excludes root).
 * Used by both install (count) and uninstall (list names).
 */
async function collectSkillNames(dir: string, depth = 0): Promise<string[]> {
  const names: string[] = []
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        names.push(...await collectSkillNames(join(dir, entry.name), depth + 1))
      }
      else if (entry.name === 'SKILL.md' && depth > 0) {
        names.push(basename(dir))
      }
    }
  }
  catch (error) {
    // Only suppress ENOENT (dir not found); log other errors that indicate real problems
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      console.error(`[CCG] Failed to read skills directory ${dir}: ${code || error}`)
    }
  }
  return names
}

/**
 * Remove a directory and collect .md file stems. Returns [] if dir doesn't exist.
 */
async function removeDirCollectMdNames(dir: string): Promise<string[]> {
  if (!(await fs.pathExists(dir))) return []
  const files = await fs.readdir(dir)
  const names = files.filter(f => f.endsWith('.md')).map(f => f.replace('.md', ''))
  await fs.remove(dir)
  return names
}

/**
 * Install skill files from templates/skills/ → ~/.claude/skills/ccg/
 * Includes v1.7.73 legacy layout migration.
 */
async function installSkillFiles(ctx: InstallContext): Promise<void> {
  const skillsTemplateDir = join(ctx.templateDir, 'skills')
  const skillsDestDir = join(ctx.installDir, 'skills', 'ccg')

  // Report error instead of silently returning when template dir is missing
  if (!(await fs.pathExists(skillsTemplateDir))) {
    ctx.result.errors.push(`Skills template directory not found: ${skillsTemplateDir}`)
    return
  }

  try {
    // Migration: move old v1.7.73 layout into skills/ccg/ namespace
    const oldSkillsRoot = join(ctx.installDir, 'skills')
    const ccgLegacyItems = ['tools', 'orchestration', 'SKILL.md', 'run_skill.js']
    const needsMigration = !await fs.pathExists(skillsDestDir)
      && await fs.pathExists(join(oldSkillsRoot, 'tools'))
    if (needsMigration) {
      await fs.ensureDir(skillsDestDir)
      for (const item of ccgLegacyItems) {
        const oldPath = join(oldSkillsRoot, item)
        const newPath = join(skillsDestDir, item)
        if (await fs.pathExists(oldPath)) {
          try {
            await fs.move(oldPath, newPath, { overwrite: true })
          }
          catch (moveErr) {
            // Windows: file locking can cause move to fail — log but continue
            ctx.result.errors.push(`Skills migration: failed to move ${item}: ${moveErr}`)
          }
        }
      }
    }

    // Recursive copy: preserves full directory tree
    // Always overwrite to ensure fresh install gets all files
    await fs.copy(skillsTemplateDir, skillsDestDir, {
      overwrite: true,
      errorOnExist: false,
    })

    // Remove security domain files — contains red team/pentest reference content
    // that triggers antivirus/corporate security tool false positives.
    // Users who need it can manually copy from templates/skills/domains/security/.
    const securityDir = join(skillsDestDir, 'domains', 'security')
    if (await fs.pathExists(securityDir)) {
      await fs.remove(securityDir)
    }

    // Post-copy: apply template variable replacement to .md files
    const replacePathsInDir = async (dir: string): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
          await replacePathsInDir(fullPath)
        }
        else if (entry.name.endsWith('.md')) {
          const content = await fs.readFile(fullPath, 'utf-8')
          const processed = replaceHomePathsInTemplate(content, ctx.installDir)
          if (processed !== content) {
            await fs.writeFile(fullPath, processed, 'utf-8')
          }
        }
      }
    }
    await replacePathsInDir(skillsDestDir)

    // Post-copy validation: verify at least one SKILL.md was actually copied
    const installedSkills = await collectSkillNames(skillsDestDir)
    ctx.result.installedSkills = installedSkills.length

    if (installedSkills.length === 0) {
      ctx.result.errors.push(
        `Skills copy completed but no SKILL.md found in ${skillsDestDir}. `
        + `Possible cause: file locking (antivirus), permission denied, or path too long. `
        + `Try running as administrator or disabling antivirus real-time scanning temporarily.`,
      )
    }
  }
  catch (error) {
    ctx.result.errors.push(`Failed to install skills: ${error}`)
    ctx.result.success = false
  }
}

/**
 * Auto-generate slash commands for user-invocable skills via Skill Registry.
 *
 * Scans templates/skills/ for SKILL.md files with `user-invocable: true` frontmatter,
 * then generates ~/.claude/commands/ccg/{name}.md for each — SKIPPING any name that
 * already exists in installer-data.ts to avoid conflicts with complex multi-model commands.
 */
async function installSkillGeneratedCommands(ctx: InstallContext): Promise<void> {
  const skillsTemplateDir = join(ctx.templateDir, 'skills')
  const skillsInstallDir = join(ctx.installDir, 'skills', 'ccg')
  const commandsDir = join(ctx.installDir, 'commands', 'ccg')

  if (!(await fs.pathExists(skillsTemplateDir))) return

  try {
    // Collect names of commands already installed by installer-data.ts
    const existingCommandNames = new Set<string>()
    const existingFiles = await fs.readdir(commandsDir).catch(() => [] as string[])
    for (const f of existingFiles) {
      if (f.endsWith('.md')) {
        existingCommandNames.add(basename(f, '.md'))
      }
    }

    const skipCategories: import('./skill-registry').SkillCategory[] = []
    if (ctx.config.skipImpeccable) {
      skipCategories.push('impeccable')
    }

    const generated = await installSkillCommands(
      skillsTemplateDir,
      skillsInstallDir,
      commandsDir,
      existingCommandNames,
      skipCategories,
    )

    if (generated.length > 0) {
      ctx.result.installedCommands.push(...generated)
      ctx.result.installedSkillCommands = generated.length
    }
  }
  catch (error) {
    // Non-fatal: skill command generation failure shouldn't block installation
    ctx.result.errors.push(`Skill Registry command generation warning: ${error}`)
  }
}

/**
 * Install Codex-mode files: AGENTS.md + .codex/config.toml + .codex/agents/*.toml
 * These enable Codex CLI as an alternative lead orchestrator (Codex-led multi-model mode).
 * Files are installed to ~/.codex/ (global) and user copies AGENTS.md to project root.
 */
export async function installCodexMode(): Promise<{ success: boolean, message: string }> {
  return installCodexModeAt()
}

/**
 * Uninstall CCG Codex mode — only removes files installed by CCG, preserves user files.
 */
export async function uninstallCodexMode(): Promise<{ success: boolean, removed: string[], skipped: string[] }> {
  return uninstallCodexModeAt()
}

export async function recoverCodexMode(): Promise<{
  success: boolean
  recovered: boolean
  message: string
}> {
  return recoverCodexModeAt()
}

/**
 * Install rule .md files from templates/rules/ → ~/.claude/rules/
 */
async function installRuleFiles(ctx: InstallContext): Promise<void> {
  try {
    const installed = await copyMdTemplates(
      ctx,
      join(ctx.templateDir, 'rules'),
      join(ctx.installDir, 'rules'),
    )
    if (installed.length > 0) ctx.result.installedRules = true
  }
  catch (error) {
    ctx.result.errors.push(`Failed to install rules: ${error}`)
  }
}

/** Resolve platform-specific binary name. Returns null for unsupported platforms. */
function getBinaryName(): string | null {
  const osMap: Record<string, string> = { darwin: 'darwin', linux: 'linux', win32: 'windows' }
  const os = osMap[process.platform]
  if (!os) return null
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64'
  const ext = process.platform === 'win32' ? '.exe' : ''
  return `codeagent-wrapper-${os}-${arch}${ext}`
}

/**
 * Check if codeagent-wrapper binary exists and is functional.
 * Returns true if the binary passes `--version` check.
 */
export async function verifyBinary(installDir: string): Promise<boolean> {
  const binDir = join(installDir, 'bin')
  const wrapperName = process.platform === 'win32' ? 'codeagent-wrapper.exe' : 'codeagent-wrapper'
  const wrapperPath = join(binDir, wrapperName)

  const binaryName = getBinaryName()
  const expectedSha256 = binaryName ? EXPECTED_BINARY_SHA256[binaryName] : null
  if (!(await fs.pathExists(wrapperPath)) || !expectedSha256) return false
  if (await sha256File(wrapperPath) !== expectedSha256) return false

  return (await readBinaryVersion(wrapperPath)) !== null
}

/**
 * Check if installed binary version matches expected version.
 * Returns true if version matches, false if outdated or unreadable.
 */
export async function verifyBinaryVersion(installDir: string): Promise<boolean> {
  const binDir = join(installDir, 'bin')
  const wrapperName = process.platform === 'win32' ? 'codeagent-wrapper.exe' : 'codeagent-wrapper'
  const wrapperPath = join(binDir, wrapperName)

  const binaryName = getBinaryName()
  const expectedSha256 = binaryName ? EXPECTED_BINARY_SHA256[binaryName] : null
  if (!expectedSha256 || !(await fs.pathExists(wrapperPath))) return false
  if (await sha256File(wrapperPath) !== expectedSha256) return false
  return (await readBinaryVersion(wrapperPath)) === EXPECTED_BINARY_VERSION
}

/**
 * Explain how to recover after a fatal codeagent-wrapper installation failure.
 * Initialization is not successful until a pinned binary is verified.
 */
export function showBinaryInstallFailure(binDir: string): void {
  const binaryExt = process.platform === 'win32' ? '.exe' : ''
  const platformLabel = process.platform === 'darwin'
    ? (process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-amd64')
    : process.platform === 'linux'
      ? (process.arch === 'arm64' ? 'linux-arm64' : 'linux-amd64')
      : (process.arch === 'arm64' ? 'windows-arm64' : 'windows-amd64')
  const binaryFileName = `codeagent-wrapper-${platformLabel}${binaryExt}`
  const destFileName = `codeagent-wrapper${binaryExt}`
  const releaseUrl = `https://github.com/${GITHUB_REPO}/releases/tag/${RELEASE_TAG}`

  console.log()
  console.log(ansis.red.bold(`  ╔════════════════════════════════════════════════════════════╗`))
  console.log(ansis.red.bold(`  ║  ✗  codeagent-wrapper 安装失败，初始化已停止              ║`))
  console.log(ansis.red.bold(`  ║     Binary verification failed; initialization stopped     ║`))
  console.log(ansis.red.bold(`  ╚════════════════════════════════════════════════════════════╝`))
  console.log()
  console.log(ansis.yellow(`  当前安装不可用；固定版本二进制通过摘要和版本校验后才算成功。`))
  console.log(ansis.yellow(`  This installation is unusable until the pinned binary passes verification.`))
  console.log()
  console.log(ansis.cyan(`  手动修复 / Manual fix:`))
  console.log()
  console.log(ansis.white(`    1. 下载 / Download:`))
  console.log(ansis.cyan(`       ${releaseUrl}`))
  console.log(ansis.gray(`       → 找到 ${ansis.white(binaryFileName)} 并下载`))
  console.log()
  console.log(ansis.white(`    2. 放到 / Place at:`))
  const displayPath = process.platform === 'win32'
    ? `${binDir.replace(/\//g, '\\')}\\${destFileName}`
    : `${binDir}/${destFileName}`
  console.log(ansis.cyan(`       ${displayPath}`))
  console.log()
  if (process.platform !== 'win32') {
    console.log(ansis.white(`    3. 加权限 / Make executable:`))
    console.log(ansis.cyan(`       chmod +x "${binDir}/${destFileName}"`))
    console.log()
  }
  console.log(ansis.white(`    3. 重新运行并等待成功结果 / Re-run and require success:`))
  console.log(ansis.cyan(`       ccg init --force`))
  console.log()
}

function recordFatalBinaryFailure(
  ctx: Pick<InstallContext, 'result'>,
  message: string,
): void {
  ctx.result.binInstalled = false
  ctx.result.success = false
  ctx.result.errors.push(`Fatal codeagent-wrapper installation failure: ${message}`)
}

/**
 * Download and install codeagent-wrapper for the current platform.
 * Existing and downloaded bytes must match the pinned digest before execution.
 */
async function installBinaryFile(ctx: Pick<InstallContext, 'installDir' | 'result'>): Promise<void> {
  let candidateBinary: string | null = null
  try {
    const binDir = join(ctx.installDir, 'bin')
    await fs.ensureDir(binDir)

    const binaryName = getBinaryName()
    if (!binaryName) {
      recordFatalBinaryFailure(
        ctx,
        `unsupported platform: ${process.platform}`,
      )
      return
    }

    const binaryExt = process.platform === 'win32' ? '.exe' : ''
    const destBinary = join(binDir, `codeagent-wrapper${binaryExt}`)
    const expectedSha256 = EXPECTED_BINARY_SHA256[binaryName]
    if (!expectedSha256) {
      recordFatalBinaryFailure(
        ctx,
        `no trusted SHA-256 is recorded for ${binaryName}.`,
      )
      return
    }

    // Verify installed bytes before executing the binary.
    if (await fs.pathExists(destBinary)) {
      const installedDigest = await sha256File(destBinary)
      const installedVersion = installedDigest === expectedSha256
        ? await readBinaryVersion(destBinary)
        : null
      if (installedDigest === expectedSha256 && installedVersion === EXPECTED_BINARY_VERSION) {
        // Binary exists, works, and version matches — skip download
        ctx.result.binPath = binDir
        ctx.result.binInstalled = true
        return
      }
      // Version mismatch or broken binary — fall through to a validated download.
    }

    candidateBinary = join(binDir, `.codeagent-wrapper-download-${process.pid}-${Date.now()}${binaryExt}`)
    const download = await downloadBinaryFromRelease(binaryName, candidateBinary, expectedSha256)

    if (download.downloaded) {
      try {
        const promotion = await promoteBinaryCandidate(
          candidateBinary,
          destBinary,
          EXPECTED_BINARY_VERSION,
          expectedSha256,
        )
        if (promotion.promoted) {
          ctx.result.binPath = binDir
          ctx.result.binInstalled = true
        }
        else {
          const detail = promotion.reason === 'integrity-mismatch'
            ? `Binary integrity mismatch: expected ${expectedSha256}, got ${promotion.actualSha256 ?? 'unknown'}.`
            : `Binary version mismatch: expected ${EXPECTED_BINARY_VERSION}, got ${promotion.actualVersion ?? 'unknown'}.`
          recordFatalBinaryFailure(
            ctx,
            `${detail} Existing binary was preserved.`,
          )
        }
      }
      catch (verifyError) {
        recordFatalBinaryFailure(
          ctx,
          `binary verification failed: ${verifyError}`,
        )
        await fs.remove(candidateBinary)
      }
    }
    else {
      const observed = [...new Set(download.observedDigests)]
      if (observed.length > 0) {
        recordFatalBinaryFailure(
          ctx,
          `binary integrity mismatch: expected ${expectedSha256}, downloaded ${observed.join(', ')}. Existing binary was preserved.`,
        )
      }
      else {
        recordFatalBinaryFailure(
          ctx,
          `failed to download ${binaryName} from the personal GitHub release after bounded retries. Check network or visit https://github.com/${GITHUB_REPO}/releases/tag/${RELEASE_TAG}`,
        )
      }
    }
  }
  catch (error) {
    recordFatalBinaryFailure(ctx, String(error))
  }
  finally {
    if (candidateBinary) await fs.remove(candidateBinary).catch(() => {})
  }
}

/** Install one pinned, verified wrapper without installing legacy workflow assets. */
export async function installVerifiedBinaryAt(installDir: string): Promise<string> {
  const result: InstallResult = {
    success: true,
    installedCommands: [],
    installedPrompts: [],
    errors: [],
    configPath: '',
  }
  await installBinaryFile({ installDir, result })
  if (!result.binInstalled || !result.binPath)
    throw new Error(result.errors.join('\n') || 'codeagent-wrapper installation failed')
  return join(
    result.binPath,
    process.platform === 'win32' ? 'codeagent-wrapper.exe' : 'codeagent-wrapper',
  )
}

// ═══════════════════════════════════════════════════════
// CCG 3.0 Engine installation
// ═══════════════════════════════════════════════════════

/**
 * Install the unified /ccg entry point command.
 * Installed to ~/.claude/commands/ccg.md (NOT commands/ccg/) for clean /ccg invocation.
 */
async function _installCcgEntryCommand(ctx: InstallContext): Promise<void> {
  const srcFile = join(ctx.templateDir, 'commands', 'ccg.md')
  const destFile = join(ctx.installDir, 'commands', 'ccg.md')

  try {
    if (await fs.pathExists(srcFile)) {
      if (ctx.force || !(await fs.pathExists(destFile))) {
        let content = await fs.readFile(srcFile, 'utf-8')
        content = injectConfigVariables(content, ctx.config)
        content = replaceHomePathsInTemplate(content, ctx.installDir)
        await fs.writeFile(destFile, content, 'utf-8')
      }
      ctx.result.installedCommands.push('ccg (unified entry)')
    }
  }
  catch (error) {
    ctx.result.errors.push(`Failed to install /ccg entry: ${error}`)
  }
}

/**
 * Install engine files from templates/engine/ → ~/.claude/.ccg/engine/
 * Includes model-router.md, phase-guide.md, and strategy files.
 * All .md files receive variable injection + path replacement.
 */
async function installEngineFiles(ctx: InstallContext): Promise<void> {
  const engineSrcDir = join(ctx.templateDir, 'engine')
  if (!(await fs.pathExists(engineSrcDir))) return

  const engineDestDir = join(ctx.installDir, '.ccg', 'engine')

  try {
    // Copy top-level engine .md files (model-router.md, phase-guide.md)
    await copyMdTemplates(ctx, engineSrcDir, engineDestDir, { inject: true })

    // Copy strategy files
    const strategiesSrc = join(engineSrcDir, 'strategies')
    const strategiesDest = join(engineDestDir, 'strategies')
    if (await fs.pathExists(strategiesSrc)) {
      await copyMdTemplates(ctx, strategiesSrc, strategiesDest, { inject: true })
    }

    const toolsSrc = join(engineSrcDir, 'tools')
    const toolsDest = join(engineDestDir, 'tools')
    if (await fs.pathExists(toolsSrc)) {
      await copyTemplateTree(ctx, toolsSrc, toolsDest, { injectMd: true })
      if (process.platform !== 'win32') {
        for (const entry of ['command.mjs', 'manage.mjs']) {
          const executable = join(toolsDest, 'grok-intelligence', entry)
          if (await fs.pathExists(executable)) await fs.chmod(executable, 0o700)
        }
      }
    }
  }
  catch (error) {
    ctx.result.errors.push(`Failed to install engine files: ${error}`)
  }
}

// ═══════════════════════════════════════════════════════
// CCG 3.0 Hook installation
// ═══════════════════════════════════════════════════════

const HOOK_FILES = ['task-utils.js', 'workflow-state.js', 'session-start.js', 'subagent-context.js', 'skill-router.js']

/**
 * Install CCG hook scripts to ~/.claude/hooks/ccg/
 */
async function installHookScripts(ctx: InstallContext): Promise<void> {
  const hooksSrcDir = join(ctx.templateDir, 'hooks')
  if (!(await fs.pathExists(hooksSrcDir))) return

  const hooksDestDir = join(ctx.installDir, 'hooks', 'ccg')
  await fs.ensureDir(hooksDestDir)

  try {
    for (const file of HOOK_FILES) {
      const src = join(hooksSrcDir, file)
      const dest = join(hooksDestDir, file)
      if (await fs.pathExists(src)) {
        await fs.copy(src, dest, { overwrite: true })
      }
    }
  }
  catch (error) {
    ctx.result.errors.push(`Failed to install hook scripts: ${error}`)
  }
}

/**
 * Register CCG hooks in ~/.claude/settings.json.
 * Merges with existing hooks — does not overwrite user's other hooks.
 */
export function buildNodeHookCommand(
  scriptPath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const quoted = platform === 'win32'
    ? `"${scriptPath.replace(/"/g, '""')}"`
    : `"${scriptPath.replace(/["\\$`]/g, '\\$&')}"`
  return `node ${quoted}`
}

async function writePrivateJsonAtomic(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    if (process.platform !== 'win32')
      await fs.chmod(temporary, 0o600)
    await fs.move(temporary, path, { overwrite: true })
    if (process.platform !== 'win32')
      await fs.chmod(path, 0o600)
  }
  finally {
    await fs.remove(temporary)
  }
}

async function registerHooksInSettings(ctx: InstallContext): Promise<void> {
  const settingsPath = join(ctx.installDir, 'settings.json')
  const hooksDir = join(ctx.installDir, 'hooks', 'ccg')

  try {
    let settings: Record<string, unknown> = {}
    if (await fs.pathExists(settingsPath)) {
      try {
        const parsed = JSON.parse(await fs.readFile(settingsPath, 'utf-8'))
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
          throw new Error('root value must be an object')
        settings = parsed
      }
      catch (error) {
        throw new Error(`settings.json is malformed; original bytes were preserved: ${error}`)
      }
    }

    if (settings.hooks !== undefined && (!settings.hooks || typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)))
      throw new Error('settings.json hooks must be an object; original bytes were preserved.')
    const hooks = (settings.hooks || {}) as Record<string, unknown[]>

    const ccgHookDefs = {
      UserPromptSubmit: {
        hooks: [
          { type: 'command', command: buildNodeHookCommand(join(hooksDir, 'workflow-state.js')), timeout: 10000 },
          { type: 'command', command: buildNodeHookCommand(join(hooksDir, 'skill-router.js')), timeout: 5000 },
        ],
      },
      SessionStart: {
        matcher: 'startup|clear|compact',
        hooks: [{ type: 'command', command: buildNodeHookCommand(join(hooksDir, 'session-start.js')), timeout: 15000 }],
      },
      PreToolUse: {
        matcher: 'Bash|Agent',
        hooks: [{ type: 'command', command: buildNodeHookCommand(join(hooksDir, 'subagent-context.js')), timeout: 15000 }],
      },
    }

    for (const [event, def] of Object.entries(ccgHookDefs)) {
      const eventHooks = (hooks[event] || []) as Record<string, unknown>[]
      const existingIdx = eventHooks.findIndex((h) => {
        const hHooks = (h.hooks || []) as Record<string, unknown>[]
        return hHooks.some(hh => typeof hh.command === 'string' && hh.command.includes('hooks/ccg/'))
      })

      if (existingIdx >= 0) {
        eventHooks[existingIdx] = def
      }
      else {
        eventHooks.push(def)
      }
      hooks[event] = eventHooks
    }

    settings.hooks = hooks
    await writePrivateJsonAtomic(settingsPath, settings)
  }
  catch (error) {
    ctx.result.errors.push(`Failed to register hooks in settings.json: ${error}`)
  }
}

// ═══════════════════════════════════════════════════════
// Public API: install / uninstall
// ═══════════════════════════════════════════════════════

export async function installWorkflows(
  workflowIds: string[],
  installDir: string,
  force = false,
  config?: {
    routing?: {
      mode?: string
      frontend?: { models?: string[], primary?: string }
      backend?: { models?: string[], primary?: string }
      search?: { models?: string[], primary?: string }
      review?: { models?: string[] }
      geminiModel?: string
      grokModel?: string
    }
    liteMode?: boolean
    mcpProvider?: string
    skipImpeccable?: boolean
    /** Skip wrapper installation for callers that only need workflow assets (for example, isolated tests). */
    skipBinary?: boolean
  },
): Promise<InstallResult> {
  const ctx: InstallContext = {
    installDir,
    force,
    config: {
      routing: config?.routing as InstallConfig['routing'] || {
        mode: 'smart',
        frontend: { models: ['gemini'], primary: 'gemini' },
        backend: { models: ['codex'], primary: 'codex' },
        search: { models: ['grok'], primary: 'grok' },
      },
      liteMode: config?.liteMode || false,
      mcpProvider: config?.mcpProvider || 'fast-context',
      skipImpeccable: config?.skipImpeccable || false,
    },
    templateDir: join(PACKAGE_ROOT, 'templates'),
    result: {
      success: true,
      installedCommands: [],
      installedPrompts: [],
      errors: [],
      configPath: '',
    },
  }

  // ── Pre-flight: validate template directory exists ──
  // This is the #1 root cause of "silent install failure" on Windows:
  // if PACKAGE_ROOT resolved wrong, templateDir doesn't exist and every
  // sub-step silently returns empty results while reporting success.
  if (!(await fs.pathExists(ctx.templateDir))) {
    const errorMsg = `Template directory not found: ${ctx.templateDir} (PACKAGE_ROOT=${PACKAGE_ROOT}). `
      + `This usually means the npm package is incomplete or the cache is corrupted. `
      + `Try: npm cache clean --force && ccg init --force`
    ctx.result.errors.push(errorMsg)
    ctx.result.success = false
    return ctx.result
  }

  // Ensure base directories
  await fs.ensureDir(join(installDir, 'commands', 'ccg'))
  await fs.ensureDir(join(installDir, '.ccg'))
  await fs.ensureDir(join(installDir, '.ccg', 'prompts'))
  await fs.ensureDir(join(installDir, '.ccg', 'engine', 'strategies'))

  // Execute each install step
  await installCommandFiles(ctx, workflowIds)
  await installEngineFiles(ctx)
  await installHookScripts(ctx)
  await registerHooksInSettings(ctx)
  await installAgentFiles(ctx)
  await installPromptFiles(ctx)
  await installSkillFiles(ctx)
  await installSkillGeneratedCommands(ctx)
  await installRuleFiles(ctx)
  if (!config?.skipBinary) await installBinaryFile(ctx)

  // ── Post-flight: validate installation produced results ──
  // Catch the case where all sub-steps silently returned empty
  if (ctx.result.installedCommands.length === 0 && ctx.result.errors.length === 0) {
    ctx.result.errors.push(
      `No commands were installed (expected ${workflowIds.length}). `
      + `Template dir: ${ctx.templateDir}. `
      + `This may indicate a corrupted package or file permission issue.`,
    )
    ctx.result.success = false
  }
  if (ctx.result.errors.length > 0)
    ctx.result.success = false

  ctx.result.configPath = join(installDir, 'commands', 'ccg')
  return ctx.result
}

// ═══════════════════════════════════════════════════════
// Uninstall
// ═══════════════════════════════════════════════════════

export interface UninstallResult {
  success: boolean
  removedCommands: string[]
  removedPrompts: string[]
  removedAgents: string[]
  removedSkills: string[]
  removedRules: boolean
  removedHooks: boolean
  removedBin: boolean
  errors: string[]
}

/**
 * Uninstall workflows by removing their command files.
 * @param options.preserveBinary — when true, skip binary removal (used during update)
 */
export async function uninstallWorkflows(installDir: string, options?: { preserveBinary?: boolean }): Promise<UninstallResult> {
  const result: UninstallResult = {
    success: true,
    removedCommands: [],
    removedPrompts: [],
    removedAgents: [],
    removedSkills: [],
    removedRules: false,
    removedHooks: false,
    removedBin: false,
    errors: [],
  }

  const commandsDir = join(installDir, 'commands', 'ccg')
  const agentsDir = join(installDir, 'agents', 'ccg')
  const skillsDir = join(installDir, 'skills', 'ccg')
  const rulesDir = join(installDir, 'rules')
  const binDir = join(installDir, 'bin')
  const ccgConfigDir = join(installDir, '.ccg')

  // Remove CCG commands directory
  try {
    result.removedCommands = await removeDirCollectMdNames(commandsDir)
  }
  catch (error) {
    result.errors.push(`Failed to remove commands directory: ${error}`)
    result.success = false
  }

  // Remove CCG agents directory
  try {
    result.removedAgents = await removeDirCollectMdNames(agentsDir)
  }
  catch (error) {
    result.errors.push(`Failed to remove agents directory: ${error}`)
    result.success = false
  }

  // Remove CCG skills directory only (skills/ccg/) — preserves user's own skills
  if (await fs.pathExists(skillsDir)) {
    try {
      result.removedSkills = await collectSkillNames(skillsDir)
      await fs.remove(skillsDir)
    }
    catch (error) {
      result.errors.push(`Failed to remove skills: ${error}`)
      result.success = false
    }
  }

  // Remove CCG rules files
  if (await fs.pathExists(rulesDir)) {
    try {
      for (const ruleFile of ['ccg-skills.md', 'ccg-grok-search.md', 'ccg-skill-routing.md', 'ccg-codegraph.md']) {
        const rulePath = join(rulesDir, ruleFile)
        if (await fs.pathExists(rulePath)) {
          await fs.remove(rulePath)
          result.removedRules = true
        }
      }
    }
    catch (error) {
      result.errors.push(`Failed to remove rules: ${error}`)
    }
  }

  // Remove codeagent-wrapper binary (skip during update to avoid unnecessary re-download)
  if (!options?.preserveBinary && await fs.pathExists(binDir)) {
    try {
      const wrapperName = process.platform === 'win32' ? 'codeagent-wrapper.exe' : 'codeagent-wrapper'
      const wrapperPath = join(binDir, wrapperName)
      if (await fs.pathExists(wrapperPath)) {
        await fs.remove(wrapperPath)
        result.removedBin = true
      }
    }
    catch (error) {
      result.errors.push(`Failed to remove binary: ${error}`)
      result.success = false
    }
  }

  // Remove .ccg config directory (engine, prompts, strategies all live here)
  if (await fs.pathExists(ccgConfigDir)) {
    try {
      await fs.remove(ccgConfigDir)
      result.removedPrompts.push('ALL_PROMPTS_AND_CONFIGS')
    }
    catch (error) {
      result.errors.push(`Failed to remove .ccg directory: ${error}`)
    }
  }

  // Remove CCG hook scripts directory (hooks/ccg/) — added by the v3.0 engine.
  // Older uninstall logic predates the hook engine and left these behind.
  const hooksCcgDir = join(installDir, 'hooks', 'ccg')
  if (await fs.pathExists(hooksCcgDir)) {
    try {
      await fs.remove(hooksCcgDir)
      result.removedHooks = true
    }
    catch (error) {
      result.errors.push(`Failed to remove hooks directory: ${error}`)
      result.success = false
    }
  }

  // Deregister CCG hooks from settings.json — preserve the user's own hooks.
  // CCG hook entries are identified by a command path that points at hooks/ccg/.
  const settingsPath = join(installDir, 'settings.json')
  if (await fs.pathExists(settingsPath)) {
    try {
      const settings = JSON.parse(await fs.readFile(settingsPath, 'utf-8')) as Record<string, any>
      const hooks = settings.hooks as Record<string, any[]> | undefined
      if (hooks && typeof hooks === 'object') {
        const isCcgEntry = (h: any): boolean => {
          const hHooks = (h?.hooks || []) as any[]
          return hHooks.some(hh => typeof hh?.command === 'string' && /hooks[\\/]ccg[\\/]/.test(hh.command))
        }
        let modified = false
        for (const event of Object.keys(hooks)) {
          const arr = Array.isArray(hooks[event]) ? hooks[event] : []
          const filtered = arr.filter(h => !isCcgEntry(h))
          if (filtered.length !== arr.length) {
            modified = true
            if (filtered.length === 0) delete hooks[event]
            else hooks[event] = filtered
          }
        }
        if (modified) {
          if (Object.keys(hooks).length === 0) delete settings.hooks
          await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8')
          result.removedHooks = true
        }
      }
    }
    catch (error) {
      result.errors.push(`Failed to deregister hooks from settings.json: ${error}`)
    }
  }

  return result
}
