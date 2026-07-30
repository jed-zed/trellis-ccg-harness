import { describe, expect, it } from 'vitest'
import { AUXILIARY_MCPS } from '../config-mcp'

describe('auxiliary MCP catalog', () => {
  it('uses reviewed stdio pins and official remote endpoints', () => {
    const candidates = new Map(AUXILIARY_MCPS.map(candidate => [candidate.id, candidate]))

    expect([...candidates.keys()]).toEqual([
      'context7',
      'playwright',
      'deepwiki',
      'exa',
    ])
    expect(candidates.get('context7')).toMatchObject({
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@upstash/context7-mcp@3.2.4'],
    })
    expect(candidates.get('playwright')).toMatchObject({
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@playwright/mcp@0.0.78'],
    })
    expect(candidates.get('deepwiki')).toMatchObject({
      transport: 'http',
      url: 'https://mcp.deepwiki.com/mcp',
    })
    expect(candidates.get('exa')).toMatchObject({
      transport: 'http',
      url: 'https://mcp.exa.ai/mcp',
      apiKeyUrl: 'https://dashboard.exa.ai/api-keys',
      local: {
        command: 'npx',
        args: ['-y', 'exa-mcp-server@3.2.1'],
        apiKeyEnv: 'EXA_API_KEY',
      },
    })
  })

  it('does not expose the obsolete unofficial DeepWiki npm package', () => {
    expect(JSON.stringify(AUXILIARY_MCPS)).not.toContain('mcp-deepwiki')
  })
})
