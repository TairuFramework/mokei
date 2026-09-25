import '@mantine/core/styles.css'
import {
  AppShell,
  createTheme,
  Group,
  Image,
  type MantineColorsTuple,
  MantineProvider,
  Title,
} from '@mantine/core'
import type { Protocol } from '@mokei/host-protocol'
import { createRootRoute, Outlet } from '@tanstack/react-router'
import { Provider as JotaiProvider } from 'jotai'
import { lazy, Suspense } from 'react'

import { EnkakuProvider } from '../enkaku/Provider.js'
import { createHostClient, type HostClient } from '../host/client.js'

const TanStackRouterDevtools =
  process.env.NODE_ENV === 'production'
    ? () => null // Render nothing in production
    : lazy(() => {
        return import('@tanstack/router-devtools').then((res) => ({
          default: res.TanStackRouterDevtools,
        }))
      })

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

function createClient(): HostClient {
  return createHostClient(import.meta.env.VITE_API_URL || `${window.location.origin}/api`)
}

export const Route = createRootRoute({
  component: () => {
    return (
      <JotaiProvider>
        <MantineProvider theme={theme}>
          <EnkakuProvider<Protocol> createClient={createClient}>
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
        <Suspense>
          <TanStackRouterDevtools />
        </Suspense>
      </JotaiProvider>
    )
  },
})
