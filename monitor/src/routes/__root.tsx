import { EnkakuProvider } from '@enkaku/react'
import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import '@mantine/code-highlight/styles.css'
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
import { lazy, Suspense } from 'react'

import { AppHeader } from '../components/AppHeader.js'
import { ConnectionBanner } from '../components/ConnectionBanner.js'
import { NotificationPermissionButton } from '../components/NotificationPermissionButton.js'
import { FlowProvider, useFlow } from '../flow/FlowProvider.js'
import { HostConnectionProvider } from '../host/HostConnectionProvider.js'
import { PresenceProvider } from '../presence/PresenceProvider.js'

const TanStackRouterDevtools =
  process.env.NODE_ENV === 'production'
    ? () => null // Render nothing in production
    : lazy(() => {
        return import('@tanstack/router-devtools').then((res) => {
          return {
            default: res.TanStackRouterDevtools,
          }
        })
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
  const { client, restarted } = useFlow()
  if (restarted)
    return (
      <Center mih="100vh">
        <ConnectionBanner />
      </Center>
    )
  return (
    <EnkakuProvider client={client}>
      <AppShell header={{ height: 60 }} padding="md">
        <AppShell.Header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: '#04809d',
          }}>
          <AppHeader />
          <NotificationPermissionButton />
        </AppShell.Header>
        <AppShell.Main>
          <ConnectionBanner />
          <Outlet />
        </AppShell.Main>
      </AppShell>
    </EnkakuProvider>
  )
}

export const Route = createRootRoute({
  component: () => {
    return (
      <JotaiProvider>
        <MantineProvider theme={theme}>
          <Notifications />
          <HostConnectionProvider>
            <FlowProvider>
              <PresenceProvider>
                <MonitorApp />
              </PresenceProvider>
            </FlowProvider>
          </HostConnectionProvider>
        </MantineProvider>
        <Suspense>
          <TanStackRouterDevtools />
        </Suspense>
      </JotaiProvider>
    )
  },
})
