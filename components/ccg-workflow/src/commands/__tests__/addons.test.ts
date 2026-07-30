import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildCompanionAddonReport,
  formatCompanionAddonReport,
  formatCompanionAddonReportJson,
} from '../addons'

describe('companion add-on discovery', () => {
  it('keeps every recommendation unselected and read-only', () => {
    const report = buildCompanionAddonReport()

    expect(report.schemaVersion).toBe(1)
    expect(report.defaultAction).toBe('skip')
    expect(report.operation).toEqual({
      mode: 'read-only',
      writes: false,
      executes: false,
      network: false,
    })
    expect(report.candidates.length).toBeGreaterThanOrEqual(8)
    expect(report.candidates.every(candidate => candidate.selected === false)).toBe(true)
  })

  it('pins external companion sources and exposes Ponytail approval dependencies', () => {
    const report = buildCompanionAddonReport()
    const ponytail = report.candidates.find(candidate => candidate.id === 'ponytail.install')
    const hooks = report.candidates.find(candidate => candidate.id === 'ponytail.hooks')
    const fullDefault = report.candidates.find(candidate => candidate.id === 'ponytail.default-full')
    const caveman = report.candidates.find(candidate => candidate.id === 'caveman')

    expect(ponytail?.source?.commit).toMatch(/^[a-f0-9]{40}$/)
    expect(ponytail?.source?.gitTree).toMatch(/^[a-f0-9]{40}$/)
    expect(caveman?.source?.commit).toMatch(/^[a-f0-9]{40}$/)
    expect(hooks?.dependencies).toEqual(['ponytail.install'])
    expect(fullDefault?.dependencies).toEqual(['ponytail.install'])
    expect(hooks?.effects.hooks).toBe(true)
    expect(ponytail?.action.status).toBe('manual-pending')
  })

  it('routes CCG-managed MCPs to existing commands instead of another installer', () => {
    const report = buildCompanionAddonReport()
    const managed = new Map(report.candidates.map(candidate => [candidate.id, candidate]))

    expect(managed.get('fast-context')?.action.command).toBe('ccg init')
    expect(managed.get('context7')?.action.command).toBe('ccg config mcp')
    expect(managed.get('playwright')?.action.command).toBe('ccg config mcp')
    expect(managed.get('deepwiki')?.action.command).toBe('ccg config mcp')
    expect(managed.get('exa')?.action.command).toBe('ccg config mcp')
    expect(managed.get('codegraph')?.action.command).toBe('ccg init')
    expect([...managed.values()].some(candidate => candidate.action.command?.includes('pnpm addons'))).toBe(false)
  })

  it('publishes the four auxiliary MCPs with official pinned or remote sources', () => {
    const report = buildCompanionAddonReport()
    const candidates = new Map(report.candidates.map(candidate => [candidate.id, candidate]))

    expect(candidates.get('context7')?.source?.selector).toBe('@upstash/context7-mcp@3.2.4')
    expect(candidates.get('playwright')?.source?.selector).toBe('@playwright/mcp@0.0.78')
    expect(candidates.get('deepwiki')?.source?.endpoint).toBe('https://mcp.deepwiki.com/mcp')
    expect(candidates.get('exa')?.source?.endpoint).toBe('https://mcp.exa.ai/mcp')
    expect(candidates.get('exa')?.source?.apiKeys).toBe('https://dashboard.exa.ai/api-keys')

    for (const id of ['context7', 'playwright', 'deepwiki', 'exa']) {
      expect(candidates.get(id)?.recommended).toBe(true)
      expect(candidates.get(id)?.selected).toBe(false)
    }
  })

  it('renders deterministic human and JSON evidence with explicit default skip', () => {
    const report = buildCompanionAddonReport()
    const human = formatCompanionAddonReport(report, 'en')
    const json = formatCompanionAddonReportJson(report)

    expect(human).toContain('Default: skip')
    expect(human).toContain('Ponytail plugin')
    expect(human).toContain('manual-pending')
    expect(human).toContain('https://mcp.deepwiki.com/mcp')
    expect(human).toContain('https://mcp.exa.ai/mcp')
    expect(human).toContain('api-keys: https://dashboard.exa.ai/api-keys')
    expect(JSON.parse(json)).toEqual(report)
    expect(json.endsWith('\n')).toBe(true)
  })

  it('keeps the public CLI and AI installation entry points visible', () => {
    const packageRoot = join(import.meta.dirname, '..', '..', '..')
    const cli = readFileSync(join(packageRoot, 'src', 'cli-setup.ts'), 'utf8')
    const readme = readFileSync(join(packageRoot, 'README.md'), 'utf8')
    const readmeZh = readFileSync(join(packageRoot, 'README.zh-CN.md'), 'utf8')
    const aiInstall = readFileSync(join(packageRoot, 'AI_INSTALL.md'), 'utf8')
    const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))

    expect(cli).toContain(".command('addons'")
    expect(readme).toContain('AI_INSTALL.md')
    expect(readmeZh).toContain('AI_INSTALL.md')
    expect(aiInstall).toContain('ccg addons --json')
    expect(aiInstall).toMatch(/repository URL.+(?:does not authorize|is not approval)/i)
    expect(packageJson.files).toContain('AI_INSTALL.md')
  })
})
