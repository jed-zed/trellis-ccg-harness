import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts', 'tests/**/*.test.mjs'],
    // ponytail: one Windows thread avoids fork RPC stalls and shared fixture lock races.
    ...(process.platform === 'win32'
      ? { pool: 'threads', fileParallelism: false, maxWorkers: 1, minWorkers: 1 }
      : {}),
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/__tests__/**', 'src/types/**'],
    },
  },
})
