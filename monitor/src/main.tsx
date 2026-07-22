import { createRouter, RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { routeTree } from './routeTree.gen'

const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  // biome-ignore lint/style/useConsistentTypeDefinitions: extend interface
  interface Register {
    router: typeof router
  }
}

// biome-ignore lint/style/noNonNullAssertion: existing element
const rootElement = document.getElementById('root')!
createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
