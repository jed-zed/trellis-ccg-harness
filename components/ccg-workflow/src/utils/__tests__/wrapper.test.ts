import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { parseWrapperBackend, spawnWrapperProcess } from '../../commands/wrapper'

describe('Codex wrapper command', () => {
  it('inherits stdio and passes Antigravity arguments without injecting lite mode', async () => {
    let invocation: { command: string, args: string[], options: Record<string, unknown> } | undefined
    const child = new EventEmitter()
    const spawn = ((command: string, args: string[], options: Record<string, unknown>) => {
      invocation = { command, args, options }
      queueMicrotask(() => child.emit('exit', 0, null))
      return child
    }) as any
    const args = ['--backend', 'antigravity', 'build a page', 'I:/work']

    expect(parseWrapperBackend(args)).toBe('antigravity')
    await expect(spawnWrapperProcess('C:/wrapper.exe', args, spawn)).resolves.toBe(0)
    expect(invocation).toMatchObject({
      command: 'C:/wrapper.exe',
      args,
      options: {
        env: { CCG_CODEX_MANAGED_WRAPPER: '1' },
        shell: false,
        stdio: 'inherit',
      },
    })
    expect(invocation?.args).not.toContain('--lite')
  })

  it('rejects ambiguous, unknown, and ordinary Claude backends', () => {
    expect(parseWrapperBackend(['--backend=codex'])).toBe('codex')
    expect(parseWrapperBackend(['--backend=gemini'])).toBe('gemini')
    expect(() => parseWrapperBackend([])).toThrow('exactly one explicit')
    expect(() => parseWrapperBackend(['--backend', 'codex', '--backend=grok'])).toThrow('exactly one explicit')
    expect(() => parseWrapperBackend(['--backend=unknown'])).toThrow('Unknown wrapper backend')
    expect(() => parseWrapperBackend(['--backend', 'claude'])).toThrow('product-manager')
  })
})
