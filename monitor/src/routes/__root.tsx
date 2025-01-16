import '@mantine/core/styles.css'
import { MantineProvider } from '@mantine/core'
import { Outlet, createRootRoute } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/router-devtools'

import { HostProvider } from '../host/context.js'

export const Route = createRootRoute({
  component: () => (
    <>
      <MantineProvider>
        <HostProvider>
          <Outlet />
        </HostProvider>
      </MantineProvider>
      <TanStackRouterDevtools />
    </>
  ),
})
