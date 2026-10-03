import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  createFlowHandlers,
  createFlowService,
  createMonitorHandlers,
  createMonitorPresence,
  type FlowDesktopAdapter,
} from '@mokei/flow-host-node'
import { createDesktopInputSurface, createDesktopNotifier, openURL } from '@mokei/host-desktop'
import { composeHandlers, serveHostDaemon } from '@mokei/host-node'
import type { DaemonHandle } from '@tejika/process'

function createDesktopAdapter(): FlowDesktopAdapter {
  const surface = createDesktopInputSurface({ appName: 'mokei' })
  const notifier = createDesktopNotifier({ appName: 'mokei' })
  let disposal: Promise<void> | undefined
  return {
    canPrompt: (request) => surface.canPrompt(request),
    prompt: (request) => surface.prompt(request),
    notify: (message, options) => notifier.notify(message, options),
    dispose() {
      disposal ??= (async () => {
        const results = await Promise.allSettled([surface.dispose(), notifier.dispose()])
        const failures = results
          .filter((result) => result.status === 'rejected')
          .map((result) => result.reason)
        if (failures.length > 0)
          throw new AggregateError(failures, 'Desktop adapter disposal failed')
      })()
      return disposal
    },
  }
}

export async function startMokeiDaemon(params: {
  socketPath?: string
  pidPath?: string
  configPath?: string
  databasePath?: string
  handleSignals?: boolean
  desktop?: FlowDesktopAdapter
  openURL?: (url: string) => Promise<void>
}): Promise<DaemonHandle> {
  const events = new EventTarget()
  const presence = createMonitorPresence()
  const service = createFlowService({
    monitor: presence,
    openURL: params.openURL ?? ((url) => openURL(url)),
    configPath: params.configPath,
    databasePath: params.databasePath,
    desktop: params.desktop ?? createDesktopAdapter(),
    onEvent: ({ type, ...detail }) => events.dispatchEvent(new CustomEvent(type, { detail })),
  })
  let daemon: DaemonHandle
  try {
    daemon = await serveHostDaemon({
      events,
      socketPath: params.socketPath,
      pidPath: params.pidPath,
      handleSignals: params.handleSignals,
      // Telemetry has two bounded 10s phases; allow acquisition and admitted work to drain too.
      shutdownTimeoutMs: 60_000,
      handlers: composeHandlers(createFlowHandlers(service), createMonitorHandlers(presence)),
      flowStatus: () => service.status(),
      onShutdown: async () => {
        presence.dispose()
        await service.dispose()
      },
    })
  } catch (error) {
    presence.dispose()
    try {
      await service.dispose()
    } catch (cleanupError) {
      // biome-ignore lint/style/useErrorCause: AggregateError takes cause in its third argument.
      throw new AggregateError([error, cleanupError], 'Daemon boot and cleanup failed', {
        cause: error,
      })
    }
    throw error
  }
  // Flow startup cannot delay proxy admission or reject an already bound daemon.
  void service.start().catch((error: unknown) => console.error(error))
  return daemon
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      'socket-path': { type: 'string' },
      'pid-path': { type: 'string' },
      'config-path': { type: 'string' },
      'database-path': { type: 'string' },
    },
  })
  await startMokeiDaemon({
    socketPath: values['socket-path'],
    pidPath: values['pid-path'],
    configPath: values['config-path'],
    databasePath: values['database-path'],
  })
}
