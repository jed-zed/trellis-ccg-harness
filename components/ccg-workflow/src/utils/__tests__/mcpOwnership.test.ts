import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  claimMcpOwnership,
  emptyMcpOwnershipLedger,
  readMcpOwnershipLedger,
  releaseMcpOwnership,
  writeMcpOwnershipLedger,
} from '../mcp-ownership'

const roots: string[] = []
const targets = ['claude', 'codex', 'gemini'] as const

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(root => rm(root, { recursive: true, force: true })),
  )
})

describe('per-entry MCP ownership', () => {
  it.each(targets)('%s refuses an unowned same-name collision by default', (target) => {
    const ledger = emptyMcpOwnershipLedger()
    expect(() => claimMcpOwnership({
      ledger,
      target,
      serverId: 'context7',
      current: { command: 'user-context7', args: [] },
      installed: { command: 'ccg-context7', args: [] },
    })).toThrow(/collision|unowned|adopt/i)
    expect(ledger.entries).toEqual([])
  })

  it.each(targets)('%s explicit adoption restores the byte-equivalent original entry', (target) => {
    const original = { command: 'user-tool', args: ['--user'] }
    const installed = { command: 'ccg-tool', args: ['--managed'] }
    const claimed = claimMcpOwnership({
      ledger: emptyMcpOwnershipLedger(),
      target,
      serverId: 'context7',
      current: original,
      installed,
      adoptExisting: true,
    })

    const released = releaseMcpOwnership({
      ledger: claimed.ledger,
      target,
      serverId: 'context7',
      current: installed,
    })
    expect(released.restored).toEqual(original)
    expect(released.ledger.entries).toEqual([])
  })

  it.each(targets)('%s repeated management preserves the first original baseline', (target) => {
    const original = { command: 'user-tool', args: ['--original'] }
    const first = { command: 'ccg-tool', args: ['--first'] }
    const second = { command: 'ccg-tool', args: ['--second'] }
    const claimed = claimMcpOwnership({
      ledger: emptyMcpOwnershipLedger(),
      target,
      serverId: 'fast-context',
      current: original,
      installed: first,
      adoptExisting: true,
    })
    const updated = claimMcpOwnership({
      ledger: claimed.ledger,
      target,
      serverId: 'fast-context',
      current: first,
      installed: second,
    })
    const released = releaseMcpOwnership({
      ledger: updated.ledger,
      target,
      serverId: 'fast-context',
      current: second,
    })

    expect(released.restored).toEqual(original)
  })

  it.each(targets)('%s preserves a post-install user edit and refuses mutation', (target) => {
    const installed = { command: 'ccg-tool', args: ['--managed'] }
    const claimed = claimMcpOwnership({
      ledger: emptyMcpOwnershipLedger(),
      target,
      serverId: 'context7',
      current: undefined,
      installed,
    })

    expect(() => releaseMcpOwnership({
      ledger: claimed.ledger,
      target,
      serverId: 'context7',
      current: { command: 'user-edited', args: [] },
    })).toThrow(/modified|digest|preserv/i)
    expect(claimed.ledger.entries).toHaveLength(1)
  })

  it('rejects a malformed persisted ledger without changing its bytes', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'ccg mcp ownership '))
    roots.push(homeDir)
    const ledgerPath = join(
      homeDir,
      '.claude',
      '.ccg',
      'mcp-ownership.json',
    )
    await writeMcpOwnershipLedger(homeDir, emptyMcpOwnershipLedger())
    const malformed = '{"schemaVersion":1,"entries":[{"target":"victim"}]}'
    await writeFile(ledgerPath, malformed)

    await expect(readMcpOwnershipLedger(homeDir)).rejects.toThrow(
      /ownership|schema|entry/i,
    )
    expect(await readFile(ledgerPath, 'utf8')).toBe(malformed)
  })
})
