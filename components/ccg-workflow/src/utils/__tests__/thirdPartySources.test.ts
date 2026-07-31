import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import fs from 'fs-extra'
import * as sourceRegistry from '../third-party-sources'

function findPackageRoot(): string {
  let dir = import.meta.dirname
  for (let index = 0; index < 10; index++) {
    if (fs.existsSync(join(dir, 'package.json')))
      return dir
    dir = join(dir, '..')
  }
  throw new Error('Could not find package root')
}

const PACKAGE_ROOT = findPackageRoot()
const MANIFEST_PATH = join(PACKAGE_ROOT, 'third-party-sources.json')

function readManifest(): any {
  if (!fs.existsSync(MANIFEST_PATH))
    return {}
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
}

describe('trusted executable source inventory', () => {
  it('ships a machine-readable third-party source manifest', () => {
    expect(fs.existsSync(MANIFEST_PATH)).toBe(true)
  })

  it('uses latest only for the approved add-on allowlist', () => {
    const packages = readManifest().npmExecutables || {}
    const required = [
      'ace-tool',
      'ace-tool-rs',
      '@hsingjui/contextweaver',
      'fast-context-mcp',
      '@colbymchenry/codegraph',
      '@upstash/context7-mcp',
      '@playwright/mcp',
      'exa-mcp-server',
      '@fission-ai/openspec',
      'ccusage',
      '@cometix/ccline',
      '@anthropic-ai/claude-code',
    ]

    expect(Object.keys(packages).sort()).toEqual(required.sort())
    expect(packages).not.toHaveProperty('mcp-deepwiki')
    const latest = new Set([
      'fast-context-mcp',
      '@colbymchenry/codegraph',
      '@upstash/context7-mcp',
      '@playwright/mcp',
      'exa-mcp-server',
    ])
    for (const [name, source] of Object.entries(packages) as Array<[string, any]>) {
      expect(source.package).toBe(name)
      if (latest.has(name)) {
        expect(source).toMatchObject({ channel: 'latest', selector: `${name}@latest` })
        expect(source).not.toHaveProperty('version')
        expect(source).not.toHaveProperty('integrity')
      }
      else {
        expect(source.version).toMatch(/^\d+\.\d+\.\d+(?:[-+][0-9a-z.-]+)?$/i)
        expect(source.integrity).toMatch(/^sha512-[A-Za-z0-9+/]+=*$/)
        expect(source.selector).toBe(`${name}@${source.version}`)
      }
    }
  })

  it('pins the optional GrokSearch source to an immutable commit', () => {
    const source = readManifest().gitExecutables?.grokSearch
    expect(source.repository).toBe('https://github.com/GuDaStudio/GrokSearch.git')
    expect(source.commit).toMatch(/^[a-f0-9]{40}$/)
    expect(source.selector).toContain(source.commit)
    expect(source.selector).not.toContain('grok-with-tavily')
  })

  it('rejects registry metadata that does not match the reviewed integrity', () => {
    expect((sourceRegistry as any).assertNpmExecutableIntegrity).toBeTypeOf('function')
    expect(() => (sourceRegistry as any).assertNpmExecutableIntegrity(
      'ace-tool',
      'sha512-unreviewed',
    )).toThrow(/integrity/i)
  })

  it('accepts approved latest selectors and rejects bare package selectors', async () => {
    expect((sourceRegistry as any).verifyPinnedNpmCommand).toBeTypeOf('function')
    const lookup = async () => {
      throw new Error('lookup must not run for an approved latest selector')
    }
    await expect((sourceRegistry as any).verifyPinnedNpmCommand(
      'npx',
      ['-y', '@upstash/context7-mcp@latest'],
      lookup,
    )).resolves.toBeUndefined()
    await expect((sourceRegistry as any).verifyPinnedNpmCommand(
      'npx',
      ['-y', '@upstash/context7-mcp'],
      lookup,
    )).rejects.toThrow(/trusted|exact|pinned/i)
  })

  it('rejects a mutable Git branch selector before uvx can be configured', async () => {
    expect((sourceRegistry as any).verifyPinnedExecutableCommand).toBeTypeOf('function')
    await expect((sourceRegistry as any).verifyPinnedExecutableCommand(
      'uvx',
      ['--from', 'git+https://github.com/GuDaStudio/GrokSearch@grok-with-tavily', 'grok-search'],
    )).rejects.toThrow(/immutable|commit|trusted|pinned/i)
  })

  it('contains no mutable or automatic privileged install command in executable configuration', () => {
    const files = [
      'src/commands/config-mcp.ts',
      'src/commands/init.ts',
      'src/commands/menu.ts',
      'src/commands/update.ts',
      'src/utils/installer-mcp.ts',
      'src/utils/installer.ts',
      'plugins/ccg/.mcp.json',
      'templates/commands/spec-init.md',
    ]
    const content = files
      .map(file => readFileSync(join(PACKAGE_ROOT, file), 'utf8'))
      .join('\n')

    for (const selector of content.match(/[\w@/-]+@latest\b/g) || []) {
      expect([
        'fast-context-mcp@latest',
        '@colbymchenry/codegraph@latest',
        '@upstash/context7-mcp@latest',
        '@playwright/mcp@latest',
        'exa-mcp-server@latest',
      ]).toContain(selector)
    }
    expect(content).not.toMatch(/\bsudo\s+npm\b/)
    expect(content).not.toContain('ccg-workflow@latest')
  })
})
