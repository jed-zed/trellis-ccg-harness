import { describe, expect, it } from 'vitest'
import * as resolver from '../python-resolver'

describe('Python 3.9+ resolver', () => {
  it('selects python3 when python is too old', () => {
    const selected = (resolver as any).resolvePythonInvocation({
      platform: 'linux',
      probe: (command: string) => command === 'python'
        ? { ok: true, version: '3.8.18' }
        : { ok: true, version: '3.11.9' },
      locate: (command: string) => `/opt/Python Tools/${command}`,
    })
    expect(selected.command).toBe('/opt/Python Tools/python3')
    expect(selected.version).toBe('3.11.9')
  })

  it('supports the Windows py -3 launcher', () => {
    const selected = (resolver as any).resolvePythonInvocation({
      platform: 'win32',
      probe: (command: string, args: string[]) => ({
        ok: command === 'py' && args[0] === '-3',
        version: '3.12.4',
      }),
      locate: () => String.raw`C:\Windows\py.exe`,
    })
    expect(selected.argsPrefix).toEqual(['-3'])
    expect((resolver as any).formatPythonCommand(selected, 'win32'))
      .toBe(String.raw`"C:\Windows\py.exe" -3`)
  })

  it('rejects environments without Python 3.9 or newer', () => {
    expect(() => (resolver as any).resolvePythonInvocation({
      platform: 'linux',
      probe: () => ({ ok: true, version: '3.8.0' }),
      locate: (command: string) => command,
    })).toThrow(/3\.9/)
  })
})
