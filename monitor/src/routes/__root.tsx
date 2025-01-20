import '@mantine/core/styles.css'
import { MantineProvider } from '@mantine/core'
import { Outlet, createRootRoute } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/router-devtools'

import { EnkakuProvider } from '../host/context.js'

export const Route = createRootRoute({
  component: () => (
    <>
      <MantineProvider>
        <EnkakuProvider>
          <Outlet />
        </EnkakuProvider>
      </MantineProvider>
      <TanStackRouterDevtools />
    </>
  ),
})
