import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  createTraceReader,
  getTraceIndexStore,
  loadMokeiConfig,
  openMokeiDatabase,
  setupMokeiTelemetry,
} from '@mokei/app-node'
import {
  createFlowHandlers,
  createFlowService,
  createMonitorHandlers,
  createMonitorPresence,
  FLOW_REPORT_CATEGORY,
  type FlowDesktopAdapter,
  flowStoreDefinitions,
} from '@mokei/flow-host-node'
import { createDesktopInputSurface, createDesktopNotifier, openURL } from '@mokei/host-desktop'
import { composeHandlers, createTraceHandlers, serveHostDaemon } from '@mokei/host-node'
import { settleAll } from '@sozai/async'
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
        await settleAll(
          [() => surface.dispose(), () => notifier.dispose()],
          'Desktop adapter disposal failed',
        )
      })()
      return disposal
    },
  }
}

export type MokeiDaemonParams = {
  socketPath?: string
  pidPath?: string
  /** Path to `mokei.json`. */
  configPath?: string
  /** Path to `flows.json`. */
  flowsConfigPath?: string
  databasePath?: string
  handleSignals?: boolean
  desktop?: FlowDesktopAdapter
  openURL?: (url: string) => Promise<void>
}

/** Internal acquisition boundary for tests; deliberately not part of a package entry point. */
export type MokeiDaemonDependencies = {
  loadConfig: typeof loadMokeiConfig
  openDatabase: typeof openMokeiDatabase
  setupTelemetry: typeof setupMokeiTelemetry
}

async function release(steps: Array<() => void | Promise<void>>): Promise<Array<unknown>> {
  const errors: Array<unknown> = []
  for (const step of steps) {
    try {
      await step()
    } catch (error) {
      errors.push(error)
    }
  }
  return errors
}

export function startMokeiDaemon(params: MokeiDaemonParams): Promise<DaemonHandle> {
  return startMokeiDaemonWithDependencies(params, {
    loadConfig: loadMokeiConfig,
    openDatabase: openMokeiDatabase,
    setupTelemetry: setupMokeiTelemetry,
  })
}

export async function startMokeiDaemonWithDependencies(
  params: MokeiDaemonParams,
  dependencies: MokeiDaemonDependencies,
): Promise<DaemonHandle> {
  // A bad mokei.json rejects boot before any database file is created.
  const config = await dependencies.loadConfig(params.configPath)
  const database = await dependencies.openDatabase({
    path: params.databasePath,
    stores: flowStoreDefinitions,
  })
  // Acquired resources, released in reverse order on shutdown or a failed boot.
  const acquired: Array<() => void | Promise<void>> = [() => database.close()]
  const releaseAcquired = () => release([...acquired].reverse())
  try {
    const events = new EventTarget()
    const telemetry = dependencies.setupTelemetry({
      provider: database,
      onEvent: (event) => {
        events.dispatchEvent(
          new CustomEvent(event.type, {
            detail: { meta: { eventID: randomUUID(), time: Date.now() }, data: event.data },
          }),
        )
      },
      otlp: config.tracing.otlp,
      logs: config.logs,
      reportCategories: [FLOW_REPORT_CATEGORY],
    })
    acquired.push(() => telemetry.dispose())
    await telemetry.recorder.sweepInterrupted()
    const presence = createMonitorPresence()
    const service = createFlowService({
      database,
      tracing: { payloads: config.tracing.payloads },
      traceIndex: getTraceIndexStore,
      monitor: presence,
      openURL: params.openURL ?? ((url) => openURL(url)),
      configPath: params.flowsConfigPath,
      desktop: params.desktop ?? createDesktopAdapter(),
      onEvent: ({ type, ...detail }) => events.dispatchEvent(new CustomEvent(type, { detail })),
    })
    acquired.push(() => service.dispose())
    acquired.push(() => presence.dispose())
    const daemon = await serveHostDaemon({
      events,
      socketPath: params.socketPath,
      pidPath: params.pidPath,
      handleSignals: params.handleSignals,
      // Telemetry has two bounded 10s phases; allow acquisition and admitted work to drain too.
      shutdownTimeoutMs: 60_000,
      handlers: composeHandlers(
        createFlowHandlers(service),
        createMonitorHandlers(presence),
        createTraceHandlers({
          reader: createTraceReader({ provider: database, recorder: telemetry.recorder }),
        }),
      ),
      tracing: { payloads: config.tracing.payloads },
      tracingInfo: () => telemetry.recorder.info(),
      flowStatus: () => service.status(),
      onShutdown: async () => {
        // Presence, flow service, telemetry, then the database: no write lands on a closed database.
        const errors = await releaseAcquired()
        if (errors.length === 1) throw errors[0]
        if (errors.length > 1) throw new AggregateError(errors, 'Daemon shutdown failed')
      },
    })
    // Flow startup cannot delay proxy admission or reject an already bound daemon.
    void service.start().catch((error: unknown) => console.error(error))
    return daemon
  } catch (error) {
    const cleanupErrors = await releaseAcquired()
    if (cleanupErrors.length > 0) {
      // biome-ignore lint/style/useErrorCause: AggregateError takes cause in its third argument.
      throw new AggregateError([error, ...cleanupErrors], 'Daemon boot and cleanup failed', {
        cause: error,
      })
    }
    throw error
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      'socket-path': { type: 'string' },
      'pid-path': { type: 'string' },
      'config-path': { type: 'string' },
      'flows-config-path': { type: 'string' },
      'database-path': { type: 'string' },
    },
  })
  await startMokeiDaemon({
    socketPath: values['socket-path'],
    pidPath: values['pid-path'],
    configPath: values['config-path'],
    flowsConfigPath: values['flows-config-path'],
    databasePath: values['database-path'],
  })
}
