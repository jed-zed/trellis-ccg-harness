import { describe, expect, it } from 'vitest'
import { buildGrokDoctorArguments, execSafe, formatGrokDoctorFailure, getGrokDoctorTimeout, validateIntelligenceDoctorConfig } from '../../commands/doctor'

describe('doctor command helpers', () => {
  it('executes child commands from the ESM CLI', () => {
    expect(execSafe(`"${process.execPath}" --version`)).toBe(process.version)
  })

  it('keeps local and paid Grok doctor modes explicitly split', () => {
    expect(buildGrokDoctorArguments({ grok: true })).toEqual(['doctor', '--json'])
    expect(buildGrokDoctorArguments({ grokLive: true })).toEqual(['doctor', '--json', '--live'])
    expect(buildGrokDoctorArguments({ grok: true, grokCleanup: true })).toEqual(['doctor', '--json', '--cleanup'])
    expect(buildGrokDoctorArguments({ grok: true }, {
      artifact_root: '.private/intelligence',
      retention_days: 3,
      max_bundle_bytes: 4096,
    } as any)).toEqual([
      'doctor',
      '--json',
      '--artifact-root',
      '.private/intelligence',
      '--retention-days',
      '3',
      '--max-bundle-bytes',
      '4096',
    ])
  })

  it('allows enough time for model discovery plus the bounded ACP handshake', () => {
    expect(getGrokDoctorTimeout({ grok: true })).toBe(180_000)
    expect(getGrokDoctorTimeout({ grokLive: true })).toBe(600_000)
  })

  it('rejects provider fallback and incompatible intelligence config', () => {
    expect(validateIntelligenceDoctorConfig({
      provider: 'grok-cli',
      transport: 'acp',
      auth_mode: 'browser_oauth',
      legacy_search_provider: 'grok-search-mcp',
      allow_provider_fallback: false,
    })).toEqual([])
    expect(validateIntelligenceDoctorConfig({
      provider: 'other',
      transport: 'headless',
      auth_mode: 'cookie',
      legacy_search_provider: 'other',
      allow_provider_fallback: true,
    })).toHaveLength(5)
  })

  it('shows a bounded redacted Grok failure instead of a misleading login instruction', () => {
    const detail = formatGrokDoctorFailure('Required X evidence failed; token=xai-secret-value\n')
    expect(detail).toContain('Required X evidence failed')
    expect(detail).not.toContain('xai-secret-value')
    expect(detail.length).toBeLessThanOrEqual(400)
  })
})
