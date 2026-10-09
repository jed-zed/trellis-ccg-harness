import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import fs from 'fs-extra'
import { parse, stringify } from 'smol-toml'
import { afterEach, describe, expect, it } from 'vitest'
import { configureProviderRouting } from '../../commands/config-routing'
import { readCcgConfigAt } from '../config'
import { injectConfigVariables } from '../installer-template'
import { createDefaultRoleRouting, normalizeModelRouting, setRoleProvider } from '../model-routing'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0))
    await fs.remove(root)
})

describe('optional provider routing', () => {
  it('normalizes persisted models and preserves provider defaults', () => {
    const before = createDefaultRoleRouting()
    const routing = normalizeModelRouting({ ...before, kimiModel: ' kimi-for-coding ', opencodeModel: ' provider/model ' })
    expect(routing).toMatchObject({ kimiModel: 'kimi-for-coding', opencodeModel: 'provider/model' })
    expect(routing.frontend).toEqual(before.frontend)
    expect(routing.backend).toEqual(before.backend)
    expect(routing.search).toEqual(before.search)
    expect(routing['product-manager']).toEqual(before['product-manager'])
  })

  it.each(['kimi', 'opencode'] as const)('allows %s only in frontend/backend', (provider) => {
    const before = createDefaultRoleRouting()
    expect(setRoleProvider(before, 'frontend', provider).frontend.primary).toBe(provider)
    expect(setRoleProvider(before, 'backend', provider).backend.primary).toBe(provider)
    expect(() => setRoleProvider(before, 'search', provider)).toThrow('not supported')
    expect(() => setRoleProvider(before, 'product-manager', provider)).toThrow('not supported')
  })

  it('reads and writes both models while preserving unrelated TOML and role configuration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ccg-provider-routing-'))
    roots.push(root)
    const path = join(root, 'config.toml')
    const original = { general: { version: 'user-version', language: 'en' }, routing: { ...createDefaultRoleRouting(), kimiModel: 'old-kimi', opencodeModel: 'old/model' }, custom: { keep: true } }
    await fs.writeFile(path, stringify(original))
    await configureProviderRouting('kimi', { configPath: path, model: ' new-kimi ', role: 'backend' })
    const parsed = parse(await fs.readFile(path, 'utf8')) as any
    expect(parsed.custom).toEqual({ keep: true })
    expect(parsed.general).toEqual(original.general)
    expect(parsed.routing.opencodeModel).toBe('old/model')
    expect(parsed.routing.kimiModel).toBe('new-kimi')
    expect(parsed.routing.frontend).toEqual(original.routing.frontend)
    expect(parsed.routing.search).toEqual(original.routing.search)
    expect(parsed.routing['product-manager']).toEqual(original.routing['product-manager'])
    const read = await readCcgConfigAt(path, { persistMigration: false })
    expect(read?.routing.backend.primary).toBe('kimi')
    expect(read?.routing.kimiModel).toBe('new-kimi')
    await configureProviderRouting('opencode', { configPath: path, model: '' })
    expect((await readCcgConfigAt(path))?.routing.opencodeModel).toBe('')
  })

  it('requires an explicit requested change and rejects unsupported roles/control characters', async () => {
    await expect(configureProviderRouting('kimi', {})).rejects.toThrow('explicit')
    await expect(configureProviderRouting('opencode', { role: 'search' })).rejects.toThrow('frontend or backend')
    expect(() => normalizeModelRouting({ kimiModel: 'model\nsecret' })).toThrow('single-line')
    expect(() => normalizeModelRouting({ opencodeModel: true as any })).toThrow('single-line')
  })

  it('injects only the matching provider flag and preserves native defaults for blank models', () => {
    const routing = { ...createDefaultRoleRouting(), frontend: { models: ['opencode'], primary: 'opencode', strategy: 'fallback' as const }, backend: { models: ['kimi'], primary: 'kimi', strategy: 'fallback' as const }, kimiModel: 'kimi-code', opencodeModel: 'provider/model' }
    const input = '--backend {{BACKEND_PRIMARY}} {{KIMI_MODEL_FLAG}}{{OPENCODE_MODEL_FLAG}}task\n--backend {{FRONTEND_PRIMARY}} {{KIMI_MODEL_FLAG}}{{OPENCODE_MODEL_FLAG}}task\n--backend codex {{KIMI_MODEL_FLAG}}{{OPENCODE_MODEL_FLAG}}task'
    expect(injectConfigVariables(input, { routing })).toBe('--backend kimi --kimi-model kimi-code task\n--backend opencode --opencode-model provider/model task\n--backend codex task')
    expect(injectConfigVariables(input, { routing: { ...routing, kimiModel: '', opencodeModel: '' } })).toBe('--backend kimi task\n--backend opencode task\n--backend codex task')
  })

  it('rejects shell injection in generated commands and leaves direct argv model configuration available', () => {
    for (const model of ['model; touch file', '$(secret)', '`secret`', 'model"', 'model\nnext']) {
      expect(() => injectConfigVariables('{{KIMI_MODEL_FLAG}}', { routing: { ...createDefaultRoleRouting(), kimiModel: model } })).toThrow()
    }
    expect(normalizeModelRouting({ kimiModel: 'custom model' }).kimiModel).toBe('custom model')
  })
})
