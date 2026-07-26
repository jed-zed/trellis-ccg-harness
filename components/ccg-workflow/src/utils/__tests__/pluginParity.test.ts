import fs from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

function readJson(path: string): any {
  return JSON.parse(fs.readFileSync(path, 'utf8'))
}

describe('Codex plugin release parity', () => {
  it('keeps plugin marketplace versions aligned with the package release', () => {
    const packageVersion = readJson(join(root, 'package.json')).version
    const pluginVersion = readJson(join(root, 'plugins', 'ccg', '.codex-plugin', 'plugin.json')).version
    const codexMarketplaceVersion = readJson(join(root, '.codex-plugin', 'marketplace.json')).plugins[0].version
    const claudeMarketplaceVersion = readJson(join(root, '.claude-plugin', 'marketplace.json')).plugins[0].version

    expect(pluginVersion.split('+', 1)[0]).toBe(packageVersion)
    expect(pluginVersion).toMatch(
      new RegExp(`^${packageVersion.replaceAll('.', '\\.')}\\+codex\\.[a-z0-9-]+$`),
    )
    expect(codexMarketplaceVersion).toBe(packageVersion)
    expect(claudeMarketplaceVersion).toBe(packageVersion)
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
