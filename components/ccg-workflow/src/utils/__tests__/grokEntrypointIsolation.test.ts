import { EventEmitter } from 'node:events'
import { join } from 'pathe'
import { afterEach, expect, it, vi } from 'vitest'
import { PACKAGE_ROOT } from '../installer-template'
import { grokAccount } from '../../commands/grok'

const { spawn, pathExists } = vi.hoisted(() => ({ spawn: vi.fn(), pathExists: vi.fn(() => true) }))
vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn,
}))
vi.mock('fs-extra', async (importOriginal) => {
  const original = await importOriginal<{ default: typeof import('fs-extra') }>()
  return { ...original, default: { ...original.default, pathExists } }
})
vi.mock('node:os', async importOriginal => ({
  ...await importOriginal<typeof import('node:os')>(),
  homedir: () => 'C:/synthetic-legacy-home',
}))
afterEach(() => vi.clearAllMocks())

it('direct Grok account calls launch the packaged manager without probing the other host', async () => {
  spawn.mockImplementation(() => {
    const child = new EventEmitter()
    queueMicrotask(() => child.emit('close', 0))
    return child
  })
  await grokAccount('status', { json: true })
  expect(spawn).toHaveBeenCalledWith(process.execPath,    [join(PACKAGE_ROOT, 'templates', 'engine', 'tools', 'grok-intelligence', 'manage.mjs'), 'status', '--json'],    expect.objectContaining({ shell: false, windowsHide: true }))
  expect(pathExists).not.toHaveBeenCalled()
})
