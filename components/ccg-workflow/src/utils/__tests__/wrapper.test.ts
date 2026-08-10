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

  it('accepts registered providers and rejects ambiguous or unknown backends', () => {
    expect(parseWrapperBackend(['--backend=codex'])).toBe('codex')
    expect(parseWrapperBackend(['--backend=gemini'])).toBe('gemini')
    expect(parseWrapperBackend(['--backend', 'claude'])).toBe('claude')
    expect(() => parseWrapperBackend([])).toThrow('exactly one explicit')
    expect(() => parseWrapperBackend(['--backend', 'codex', '--backend=grok'])).toThrow('exactly one explicit')
    expect(() => parseWrapperBackend(['--backend=unknown'])).toThrow('Unknown wrapper backend')
  })

  it('passes the validated Claude executable only through the wrapper child environment', async () => {
    let invocation: { options: { env?: NodeJS.ProcessEnv } } | undefined
    const child = new EventEmitter()
    const spawn = ((_command: string, _args: string[], options: { env?: NodeJS.ProcessEnv }) => {
      invocation = { options }
      queueMicrotask(() => child.emit('exit', 0, null))
      return child
    }) as any

    await expect(spawnWrapperProcess(
      'C:/wrapper.exe',
      ['--backend', 'claude', '-'],
      spawn,
      { CCG_CLAUDE_EXECUTABLE: 'C:/trusted/claude.exe' },
    )).resolves.toBe(0)
    expect(invocation?.options.env).toMatchObject({
      CCG_CODEX_MANAGED_WRAPPER: '1',
      CCG_CLAUDE_EXECUTABLE: 'C:/trusted/claude.exe',
    })
  })
})
