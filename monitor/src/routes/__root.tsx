import '@mantine/core/styles.css'
import {
  AppShell,
  Box,
  Group,
  Image,
  type MantineColorsTuple,
  MantineProvider,
  Title,
  createTheme,
} from '@mantine/core'
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
            <AppShell header={{ height: 60 }} padding="md">
              <AppShell.Header style={{ backgroundColor: '#04809d' }}>
                <Group p="10px" align="center">
                  <Image
                    src="/logo.svg"
                    alt="Mokei logo"
                    h={40}
                    w={40}
                    style={{ border: '2px solid white', borderRadius: 20 }}
                  />
                  <Title c="white" order={3}>
                    Mokei Monitor
                  </Title>
                </Group>
              </AppShell.Header>
              <AppShell.Main>
                <Outlet />
              </AppShell.Main>
            </AppShell>
          </EnkakuProvider>
        </MantineProvider>
        <TanStackRouterDevtools />
      </JotaiProvider>
    )
  },
})
