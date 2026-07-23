import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function findPackageRoot(): string {
  let dir = import.meta.dirname
  for (let i = 0; i < 10; i++) {
    try {
      readFileSync(join(dir, 'package.json'))
      return dir
    }
    catch {
      dir = join(dir, '..')
    }
  }
  throw new Error('Could not find package root')
}

describe('Codex Gemini preview template', () => {
  it('keeps the original codeagent-wrapper Live Output page shape', () => {
    const packageRoot = findPackageRoot()
    const helper = readFileSync(
      join(packageRoot, 'plugins', 'ccg', 'skills', 'ccg-executor', 'scripts', 'invoke_gemini_preview.py'),
      'utf8',
    )

    expect(helper).toContain('<title>Gemini - Live Output</title>')
    expect(helper).toContain('class="output-area"')
    expect(helper).toContain('class="panel-icon"')
    expect(helper).toContain('<div class="title">Gemini</div>')
    expect(helper).not.toContain('Gemini Preview -')
    expect(helper).not.toContain('Raw stream-json / stderr log')
    expect(helper).toContain('STATE.append_raw(line)')
    expect(helper).toContain('output_file.write(line)')
    expect(helper).toContain('output_file.flush()')
  })
})
