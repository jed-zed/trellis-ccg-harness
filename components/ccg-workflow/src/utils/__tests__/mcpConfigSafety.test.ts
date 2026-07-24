import { constants } from 'node:fs'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import * as mcp from '../mcp'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Claude MCP configuration safety', () => {
  it('fails closed on malformed JSON without changing the original bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ccg malformed config '))
    roots.push(root)
    const configPath = join(root, '.claude.json')
    const original = Buffer.from('{"mcpServers": {"broken": true,}\n', 'utf8')
    await writeFile(configPath, original)

    await expect((mcp as any).readClaudeCodeConfigAt(configPath)).rejects.toThrow(/parse|json|malformed/i)
    expect(await readFile(configPath)).toEqual(original)
  })

  it('writes configuration atomically with owner-only permissions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ccg private config '))
    roots.push(root)
    const configPath = join(root, '.claude.json')

    await (mcp as any).writeClaudeCodeConfigAt(configPath, {
      mcpServers: {
        context7: { type: 'stdio', command: 'npx', args: ['context7@1.0.0'] },
      },
    })

    expect(JSON.parse(await readFile(configPath, 'utf8')).mcpServers.context7).toBeTruthy()
    if (process.platform !== 'win32')
      expect((await stat(configPath)).mode & 0o777).toBe(constants.S_IRUSR | constants.S_IWUSR)
  })

  it('creates owner-only backups', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ccg private backup '))
    roots.push(root)
    const configPath = join(root, '.claude.json')
    const backupDir = join(root, 'backup')
    await writeFile(configPath, '{}')

    const backupPath = await (mcp as any).backupClaudeCodeConfigAt(configPath, backupDir)

    expect(backupPath).toBeTruthy()
    if (process.platform !== 'win32')
      expect((await stat(backupPath)).mode & 0o777).toBe(constants.S_IRUSR | constants.S_IWUSR)
  })
})
