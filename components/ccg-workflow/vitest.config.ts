import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Keep transform cache in this checkout, including when dependencies are linked.
  cacheDir: '.vitest-cache',
  test: {
    include: ['src/**/__tests__/**/*.test.ts', 'tests/**/*.test.mjs'],
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/__tests__/**', 'src/types/**'],
    },
  },
})
