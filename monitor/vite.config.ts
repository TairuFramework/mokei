import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  test: { environment: 'jsdom', setupFiles: ['./test/setup.ts'] },
  plugins: [
    // Split routes for the build only: under Vitest, lazy route chunks race the tests' DOM queries.
    tanstackRouter({ target: 'react', autoCodeSplitting: process.env.VITEST == null }),
    react(),
  ],
  build: {
    rolldownOptions: {
      output: {
        // Vendor groups change less often than app code and keep every chunk under the warning limit.
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'mantine', test: /node_modules[\\/]@mantine[\\/]/ },
            { name: 'tanstack', test: /node_modules[\\/]@tanstack[\\/]/ },
          ],
        },
      },
    },
  },
})
