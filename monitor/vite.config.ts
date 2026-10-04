import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  test: { environment: 'jsdom', setupFiles: ['./test/setup.ts'] },
  plugins: [tanstackRouter(), react()],
})
