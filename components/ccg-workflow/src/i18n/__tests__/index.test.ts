import { afterEach, describe, expect, it } from 'vitest'
import { initI18n } from '..'

const originalSupportNotice = process.env.I18NEXT_NO_SUPPORT_NOTICE

afterEach(() => {
  if (originalSupportNotice === undefined)
    delete process.env.I18NEXT_NO_SUPPORT_NOTICE
  else
    process.env.I18NEXT_NO_SUPPORT_NOTICE = originalSupportNotice
})

describe('i18n machine output boundary', () => {
  it('disables the dependency support notice before initialization', async () => {
    delete process.env.I18NEXT_NO_SUPPORT_NOTICE

    await initI18n('en')

    expect(process.env.I18NEXT_NO_SUPPORT_NOTICE).toBe('1')
  })
})
