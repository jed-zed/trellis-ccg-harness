import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const roots: string[] = []

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(root => rm(root, { recursive: true, force: true })),
  )
})

describe('diagnose-mcp CLI failure propagation', () => {
  it('returns nonzero for malformed MCP JSON even when smoke is requested', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'ccg malformed mcp '))
    roots.push(homeDir)
    const configPath = join(homeDir, '.claude.json')
    const malformed = '{"mcpServers":'
    await writeFile(configPath, malformed)

    const result = spawnSync(
      process.execPath,
      [
        join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
        join(ROOT, 'src', 'cli.ts'),
        'diagnose-mcp',
        '--smoke',
      ],
      {
        cwd: ROOT,
        encoding: 'utf8',
        windowsHide: true,
        env: {
          ...process.env,
          HOME: homeDir,
          USERPROFILE: homeDir,
        },
      },
    )

    expect(result.status).not.toBe(0)
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/parse|malformed/i)
    expect(await readFile(configPath, 'utf8')).toBe(malformed)
  }, 30_000)
})
