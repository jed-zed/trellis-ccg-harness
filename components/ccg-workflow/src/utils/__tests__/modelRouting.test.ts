import { describe, expect, it } from 'vitest'
import { STANDARD_ROUTING_ROLES } from '../../types'
import {
  allowedProvidersForRole,
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
      review: { models: ['gemini', 'codex'], strategy: 'parallel' } as any,
      mode: 'smart',
    } as any)

    expect(routing.frontend.primary).toBe('antigravity')
    expect(routing.backend.primary).toBe('grok')
    expect(routing.search.primary).toBe('grok')
    expect(routing['product-manager'].primary).toBe('claude')
    expect(routing).not.toHaveProperty('analysis')
    expect(routing).not.toHaveProperty('planning')
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

  it('allows pi to be selected for frontend without changing defaults', () => {
    const before = createDefaultRoleRouting()
    const after = setRoleProvider(before, 'frontend', 'pi')

    expect(after.frontend).toMatchObject({ primary: 'pi', models: ['pi'] })
    expect(before.frontend.primary).toBe('gemini')
    for (const role of STANDARD_ROUTING_ROLES) {
      if (role !== 'frontend')
        expect(after[role]).toEqual(before[role])
    }
  })

  it('allows only providers supported by each role', () => {
    const expected = {
      frontend: ['codex', 'gemini', 'antigravity', 'grok', 'pi'],
      backend: ['codex', 'gemini', 'antigravity', 'grok', 'pi'],
      search: ['codex', 'grok'],
      'product-manager': ['codex', 'gemini', 'claude'],
    } as const

    for (const role of STANDARD_ROUTING_ROLES) {
      expect(allowedProvidersForRole(role)).toEqual(expected[role])
      for (const provider of expected[role]) {
        const before = createDefaultRoleRouting()
        const after = setRoleProvider(before, role, provider)

        expect(after[role]).toMatchObject({ primary: provider, models: [provider] })
        for (const otherRole of STANDARD_ROUTING_ROLES) {
          if (otherRole !== role)
            expect(after[otherRole]).toEqual(before[otherRole])
        }
      }
    }

    expect(() => setRoleProvider(createDefaultRoleRouting(), 'frontend', 'claude'))
      .toThrow('is not supported for role frontend')
    expect(() => setRoleProvider(createDefaultRoleRouting(), 'search', 'antigravity'))
      .toThrow('is not supported for role search')
    expect(() => normalizeModelRouting({
      ...createDefaultRoleRouting(),
      'product-manager': { models: ['pi'], primary: 'pi', strategy: 'fallback' },
    })).toThrow('is not supported for role product-manager')
  })

  it('rejects providers that are not registered by the wrapper', () => {
    expect(() => setRoleProvider(createDefaultRoleRouting(), 'product-manager', 'unknown' as any))
      .toThrow('must be a registered provider')
  })
})
