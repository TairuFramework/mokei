import '@mantine/core/styles.css'
import { MantineProvider } from '@mantine/core'
import type { Protocol } from '@mokei/host-protocol'
import { Outlet, createRootRoute } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/router-devtools'

import { EnkakuProvider } from '../enkaku/Provider.js'
import { createClient } from '../host/client.js'

export const Route = createRootRoute({
  component: () => (
    <>
      <MantineProvider>
        <EnkakuProvider<Protocol> client={createClient('http://localhost:3001/api')}>
          <Outlet />
        </EnkakuProvider>
      </MantineProvider>
      <TanStackRouterDevtools />
    </>
  ),
})
