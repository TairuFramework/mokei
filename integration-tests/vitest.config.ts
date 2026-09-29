import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 120_000,
    projects: [
      {
        extends: true,
        test: {
          name: 'laya',
          include: ['suites/laya*.test.ts'],
          globalSetup: ['support/laya-setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'default',
          include: ['suites/**/*.test.ts'],
          exclude: ['suites/laya*.test.ts'],
        },
      },
    ],
  },
})
