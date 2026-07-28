import fs from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

function readJson(path: string): any {
  return JSON.parse(fs.readFileSync(path, 'utf8'))
}

describe('Codex plugin release parity', () => {
  it('keeps plugin marketplace and config template versions aligned with the package release', () => {
    const packageVersion = readJson(join(root, 'package.json')).version
    const pluginVersion = readJson(join(root, 'plugins', 'ccg', '.codex-plugin', 'plugin.json')).version
    const codexMarketplaceVersion = readJson(join(root, '.codex-plugin', 'marketplace.json')).plugins[0].version
    const claudeMarketplaceVersion = readJson(join(root, '.claude-plugin', 'marketplace.json')).plugins[0].version
    const configTemplate = fs.readFileSync(join(root, 'templates', 'codex', 'ccg-config.toml'), 'utf8')
    const configTemplateVersion = configTemplate.match(/^version = "([^"]+)"$/m)?.[1]

    expect(pluginVersion.split('+', 1)[0]).toBe(packageVersion)
    expect(pluginVersion).toMatch(
      new RegExp(`^${packageVersion.replaceAll('.', '\\.')}\\+codex\\.[a-z0-9-]+$`),
    )
    expect(codexMarketplaceVersion).toBe(packageVersion)
    expect(claudeMarketplaceVersion).toBe(packageVersion)
    expect(configTemplateVersion).toBe(packageVersion)
  })

  it('keeps the repository preview helper at feature parity with the installed live preview', () => {
    const preview = fs.readFileSync(
      join(root, 'plugins', 'ccg', 'skills', 'ccg-executor', 'scripts', 'invoke_gemini_preview.py'),
      'utf8',
    )

    expect(preview).toContain('preview_session_id')
    expect(preview).toContain('/api/sessions')
    expect(preview).toContain('/api/stream/')
    expect(preview).toContain('STATE.complete(')
  })

  it('keeps the Grok routing runtime and coverage manifest byte-identical across distributions', () => {
    const pairs = [
      [
        join(root, 'templates', 'engine', 'tools', 'grok-intelligence', 'route.mjs'),
        join(root, 'plugins', 'ccg', 'skills', 'ccg-grok-intel', 'scripts', 'grok-intelligence', 'route.mjs'),
      ],
      [
        join(root, 'templates', 'engine', 'tools', 'grok-intelligence', 'workflow-coverage.json'),
        join(root, 'plugins', 'ccg', 'skills', 'ccg-grok-intel', 'scripts', 'grok-intelligence', 'workflow-coverage.json'),
      ],
    ]
    for (const [template, plugin] of pairs)
      expect(fs.readFileSync(plugin, 'utf8'), plugin).toBe(fs.readFileSync(template, 'utf8'))
  })

  it('keeps every Codex plugin surface independent from Claude runtime and evidence gates', () => {
    const pluginRoot = join(root, 'plugins', 'ccg')
    const pending = [pluginRoot]
    const offenders: Array<{ path: string, pattern: string }> = []
    const forbidden = [
      '~/.claude',
      '.claude/',
      '.claude/plan',
      '--backend claude',
      '--require-claude-evidence',
      'claudeEvidenceStatus',
    ]
    while (pending.length > 0) {
      const current = pending.pop()!
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const path = join(current, entry.name)
        if (entry.isDirectory()) {
          pending.push(path)
          continue
        }
        if (!/\.(?:md|json|toml|py|mjs)$/.test(entry.name))
          continue
        const content = fs.readFileSync(path, 'utf8')
        for (const pattern of forbidden) {
          if (content.includes(pattern)) {
            offenders.push({
              path: path.slice(pluginRoot.length + 1).replace(/\\/g, '/'),
              pattern,
            })
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('ships the Trellis-first product-manager event boundary and all 44 command mappings', async () => {
    const rule = fs.readFileSync(
      join(root, 'plugins', 'ccg', 'rules', 'ccg-product-manager.md'),
      'utf8',
    )
    const phaseGuide = fs.readFileSync(
      join(root, 'templates', 'engine', 'phase-guide.md'),
      'utf8',
    )
    const { PRODUCT_MANAGER_COMMAND_GROUPS } = await import('../../product-manager/event-mapping')
    const commands = Object.values(PRODUCT_MANAGER_COMMAND_GROUPS).flat()

    expect(commands).toHaveLength(44)
    expect(new Set(commands).size).toBe(44)
    expect(rule).toContain('Trellis remains the task')
    expect(rule).toContain('Never create `.ccg/tasks`')
    expect(phaseGuide).toContain('Product-manager event boundary')
    expect(phaseGuide).toContain('Trellis remains the only task')
  })

  it('ships no pre-approved executable MCP or automatic semantic-search route', () => {
    const pluginRoot = join(root, 'plugins', 'ccg')
    const mcpManifest = readJson(join(pluginRoot, '.mcp.json'))
    expect(mcpManifest).toEqual({ mcpServers: {} })
    expect(JSON.stringify(mcpManifest)).not.toMatch(/\bnpx\b/i)

    const routingSurfaces = [
      'rules/ccg-fast-context.md',
      'skills/ccg-plan/SKILL.md',
      'skills/ccg-executor/SKILL.md',
      'skills/ccg-feat/SKILL.md',
    ]
    for (const relativePath of routingSurfaces) {
      const content = fs.readFileSync(join(pluginRoot, relativePath), 'utf8')
      expect(content, relativePath).toContain('explicit')
      expect(content, relativePath).not.toMatch(/mcp__(?:ace-tool|fast-context)/i)
      expect(content, relativePath).toMatch(/(?:Do not run\s+`codegraph init`\s+automatically|create\s+a\s+CodeGraph index automatically)/i)
    }
  })

  it('runs offline CI on Linux and Windows while keeping paid Grok smoke manual', () => {
    const ci = fs.readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8')
    expect(ci.match(/os:\s*\[ubuntu-latest, windows-latest\]/g)).toHaveLength(2)
    expect(ci).toContain("runner.os == 'Linux' && matrix.node-version == 22")
    expect(ci).toContain("runner.os == 'Windows' && matrix.node-version == 22")
    expect(ci).not.toContain('/dev/null')

    const live = fs.readFileSync(join(root, '.github', 'workflows', 'grok-live-smoke.yml'), 'utf8')
    expect(live).toContain('workflow_dispatch:')
    expect(live).toContain('environment: grok-live-smoke')
    expect(live).toContain('secrets.XAI_API_KEY')
    expect(live).toContain('@xai-official/grok')
    expect(live).toContain('manage.mjs doctor --live --json')
    expect(live).toContain('--trigger final_diff_verify')
    expect(live.match(/--official-domain x\.ai/g)).toHaveLength(2)
    expect(live).toContain("investigation_mode -ne 'incident'")
    expect(live).toContain('qualifying_claims')
    expect(live).not.toMatch(/upload-artifact|\.codex\/ccg\/intelligence.*artifact/i)
  })
})
