import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test-d.ts'],
    environment: 'node',
  },
})
