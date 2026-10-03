import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const parserPath = createRequire(import.meta.url).resolve('smol-toml')

function parseInChild(input: string) {
  // Bound parser hangs without blocking the test runner itself.
  return spawnSync(process.execPath, [
    '--eval',
    `const { parse, TomlError } = require(process.argv[1]);
     try {
       process.stdout.write(JSON.stringify(parse(process.argv[2])));
     } catch (error) {
       if (!(error instanceof TomlError)) throw error;
       process.stdout.write('TomlError');
       process.exitCode = 1;
     }`,
    parserPath,
    input,
  ], { encoding: 'utf8', timeout: 5_000 })
}

describe('TOML parser availability', () => {
  it.each([
    'a=[1 #',
    'a={b=1 #',
  ])('rejects an unterminated comment in %s without hanging', (input) => {
    const child = parseInChild(input)
    expect(child.error).toBeUndefined()
    expect(child.status).toBe(1)
    expect(child.stdout).toBe('TomlError')
    expect(child.stderr).toBe('')
  })

  it('preserves valid arrays and inline tables', () => {
    const child = parseInChild('a=[1, 2]\nb={c=3}')
    expect(child.error).toBeUndefined()
    expect(child.status).toBe(0)
    expect(JSON.parse(child.stdout)).toEqual({ a: [1, 2], b: { c: 3 } })
    expect(child.stderr).toBe('')
  })
})
