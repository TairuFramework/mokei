import '@mantine/core/styles.css'
import { type MantineColorsTuple, MantineProvider, createTheme } from '@mantine/core'
import type { Protocol } from '@mokei/host-protocol'
import { Outlet, createRootRoute } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/router-devtools'
import { Provider as JotaiProvider } from 'jotai'

import { EnkakuProvider } from '../enkaku/Provider.js'
import { createClient } from '../host/client.js'

const blueColor: MantineColorsTuple = [
  '#ebfbfe',
  '#d8f4fa',
  '#abe9f7',
  '#7eddf5',
  '#60d3f2',
  '#52cef1',
  '#49cbf2',
  '#3cb3d7',
  '#2d9fc0',
  '#048aa9',
]

const theme = createTheme({
  colors: {
    primary: blueColor,
  },
})

export const Route = createRootRoute({
  component: () => {
    const client = createClient(import.meta.env.VITE_API_URL || `${window.location.origin}/api`)

    return (
      <JotaiProvider>
        <MantineProvider theme={theme}>
          <EnkakuProvider<Protocol> client={client}>
            <Outlet />
          </EnkakuProvider>
        </MantineProvider>
        <TanStackRouterDevtools />
      </JotaiProvider>
    )
  },
})
