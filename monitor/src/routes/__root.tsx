import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import {
  AppShell,
  Center,
  createTheme,
  type MantineColorsTuple,
  MantineProvider,
} from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { createRootRoute, Outlet } from '@tanstack/react-router'
import { Provider as JotaiProvider } from 'jotai'
import { lazy, Suspense, useMemo } from 'react'

import { AppHeader } from '../components/AppHeader.js'
import { ConnectionBanner } from '../components/ConnectionBanner.js'
import { EnvironmentContext } from '../enkaku/context.js'
import { FlowProvider, useFlow } from '../flow/FlowProvider.js'

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

function MonitorApp() {
  const { client, connected, restarted } = useFlow()
  const environment = useMemo(
    () =>
      connected
        ? { status: 'connected' as const, client }
        : { status: 'disconnected' as const, connect: () => window.location.reload() },
    [client, connected],
  )
  if (restarted)
    return (
      <Center mih="100vh">
        <ConnectionBanner />
      </Center>
    )
  return (
    <EnvironmentContext value={environment}>
      <AppShell header={{ height: 60 }} padding="md">
        <AppShell.Header style={{ backgroundColor: '#04809d' }}>
          <AppHeader />
        </AppShell.Header>
        <AppShell.Main>
          <ConnectionBanner />
          <Outlet />
        </AppShell.Main>
      </AppShell>
    </EnvironmentContext>
  )
}

export const Route = createRootRoute({
  component: () => {
    return (
      <JotaiProvider>
        <MantineProvider theme={theme}>
          <Notifications />
          <FlowProvider>
            <MonitorApp />
          </FlowProvider>
        </MantineProvider>
        <Suspense>
          <TanStackRouterDevtools />
        </Suspense>
      </JotaiProvider>
    )
  },
})
