import { describe, expect, it } from 'vitest'
import { REGISTERED_MODEL_TYPES, STANDARD_ROUTING_ROLES } from '../../types'
import {
  createDefaultRoleRouting,
  normalizeModelRouting,
  setRoleProvider,
} from '../model-routing'

describe('model routing', () => {
  it('defines all four formal roles with registered defaults', () => {
    const routing = createDefaultRoleRouting()
    expect(Object.keys(routing).filter(key => STANDARD_ROUTING_ROLES.includes(key as any))).toEqual(
      STANDARD_ROUTING_ROLES,
    )
    expect(routing.frontend.primary).toBe('gemini')
    expect(routing.backend.primary).toBe('codex')
    expect(routing.search.primary).toBe('grok')
    expect(routing['product-manager'].primary).toBe('claude')
  })

  it('normalizes legacy routing and supplies search and product-manager roles', () => {
    const routing = normalizeModelRouting({
      frontend: { models: ['antigravity'], primary: 'antigravity', strategy: 'fallback' },
      backend: { models: ['grok'], primary: 'grok', strategy: 'fallback' },
      review: { models: ['gemini', 'codex'], strategy: 'parallel' },
      mode: 'smart',
    } as any)

    expect(routing.frontend.primary).toBe('antigravity')
    expect(routing.backend.primary).toBe('grok')
    expect(routing.search.primary).toBe('grok')
    expect(routing['product-manager'].primary).toBe('claude')
    expect(routing).not.toHaveProperty('review')
  })

  it('changes only the requested role', () => {
    const before = createDefaultRoleRouting()
    const after = setRoleProvider(before, 'product-manager', 'gemini')

    expect(after['product-manager']).toMatchObject({ primary: 'gemini', models: ['gemini'] })
    for (const role of STANDARD_ROUTING_ROLES) {
      if (role !== 'product-manager')
        expect(after[role]).toEqual(before[role])
    }
  })

  it('allows every role to select every registered provider', () => {
    for (const role of STANDARD_ROUTING_ROLES) {
      for (const provider of REGISTERED_MODEL_TYPES) {
        const before = createDefaultRoleRouting()
        const after = setRoleProvider(before, role, provider)

        expect(after[role]).toMatchObject({ primary: provider, models: [provider] })
        for (const otherRole of STANDARD_ROUTING_ROLES) {
          if (otherRole !== role)
            expect(after[otherRole]).toEqual(before[otherRole])
        }
      }
    }
  })

  it('rejects providers that are not registered', () => {
    expect(() => setRoleProvider(createDefaultRoleRouting(), 'product-manager', 'unknown' as any))
      .toThrow('must be a registered provider')
  })
})
