import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 120_000,
    projects: [
      {
        extends: true,
        test: {
          name: 'system-one',
          include: ['suites/system-one*.test.ts'],
          globalSetup: ['support/system-one-setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'default',
          include: ['suites/**/*.test.ts'],
          exclude: ['suites/system-one*.test.ts'],
        },
      },
    ],
  },
})
