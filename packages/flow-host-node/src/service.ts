import { randomUUID } from 'node:crypto'
import type { FlowHost, TraceStore } from '@mokei/flow-host'
import { createFlowHost } from '@mokei/flow-host'
import type { FlowServiceStatus, HostEvent } from '@mokei/host-protocol'
import { NodeSession } from '@mokei/session-node'
import { getReporter } from '@sozai/log'

import { FlowConfigError, loadFlowConfig } from './config.js'
import { openFlowDatabase } from './database.js'
import type { FlowDesktopAdapter, FlowDesktopController } from './desktop.js'
import { createFlowDesktopController } from './desktop.js'
import { loadFlowDirs } from './flow-dirs.js'
import type { MonitorPresence } from './monitor-presence.js'
import { createMonitorSurface } from './monitor-surface.js'
import { createNativeSurface } from './native-surface.js'
import { startRetention } from './retention.js'
import { createSQLiteRunStore } from './sqlite-run-store.js'
import { createSQLiteTaskStore } from './sqlite-task-store.js'
import { createSQLiteTraceStore } from './sqlite-trace-store.js'
import { setupFlowTelemetry } from './telemetry.js'

export type { FlowServiceStatus } from '@mokei/host-protocol'
export type FlowResources = { host: FlowHost; traceStore: TraceStore }
export type FlowServiceParams = {
  configPath?: string
  databasePath?: string
  desktop?: FlowDesktopAdapter
  monitor?: MonitorPresence
  openURL?: (url: string) => Promise<void>
  onEvent(event: HostEvent): void
}
export type FlowService = {
  /** Last initialization state; shutdown independently closes admission. */
  status(): FlowServiceStatus
  resources(): FlowResources
  run<T>(work: (resources: FlowResources) => T | Promise<T>): Promise<T>
  start(): Promise<void>
  prompt(id: string, signal: AbortSignal): Promise<{ action: 'accept' | 'decline' | 'cancel' }>
  dispose(): Promise<void>
}
export class FlowServiceUnavailableError extends Error {
  #status: FlowServiceStatus

  constructor(params: { status: FlowServiceStatus; stopping?: boolean }) {
    super(params.stopping ? 'Flow service is shutting down' : 'Flow service is unavailable')
    this.name = 'FlowServiceUnavailableError'
    this.#status = structuredClone(params.status)
  }

  get status(): FlowServiceStatus {
    return structuredClone(this.#status)
  }
}

/** Internal acquisition boundary; deliberately omitted from the package entry point. */
export type FlowServiceDependencies = {
  loadConfig: typeof loadFlowConfig
  loadFlows: typeof loadFlowDirs
  openDatabase: typeof openFlowDatabase
  setupTelemetry: typeof setupFlowTelemetry
  createSession(): NodeSession
  createHost: typeof createFlowHost
  startRetention: typeof startRetention
  report(error: unknown): void
}

function failedStatus(error: unknown, stage: string): FlowServiceStatus {
  if (error instanceof FlowConfigError) {
    // Parser excerpts and arbitrary object keys can contain credentials.
    const fields = new Set([
      'siblings',
      'flowDirs',
      'approval',
      'allow',
      'tracing',
      'otlp',
      'endpoint',
      'headers',
      'logs',
      'level',
      'retention',
      'days',
      'desktop',
      'notifications',
      'command',
      'args',
      'env',
    ])
    return {
      state: 'failed',
      error: {
        type: 'FlowConfigError',
        message: 'Invalid flow configuration',
        path: error.path,
        issues: error.issues.map((issue) =>
          issue.startsWith('JSON:')
            ? 'Invalid JSON'
            : issue
                .split('.')
                .map((part) => (fields.has(part) ? part : '*'))
                .join('.'),
        ),
      },
    }
  }
  return { state: 'failed', error: { type: 'FlowStartupError', message: `Failed to ${stage}` } }
}

export function createFlowService(params: FlowServiceParams): FlowService {
  const report = getReporter(['mokei', 'flow-host', 'capture'], '@mokei/flow-host-node')
  return createFlowServiceWithDependencies(params, {
    loadConfig: loadFlowConfig,
    loadFlows: loadFlowDirs,
    openDatabase: openFlowDatabase,
    setupTelemetry: setupFlowTelemetry,
    createSession: () => new NodeSession({ elicit: true }),
    createHost: createFlowHost,
    startRetention: startRetention,
    report: (error) => report('Flow service error', error),
  })
}

export function createFlowServiceWithDependencies(
  params: FlowServiceParams,
  dependencies: FlowServiceDependencies,
): FlowService {
  let status: FlowServiceStatus = { state: 'starting' }
  let stopping = false
  let starting: Promise<void> | undefined
  let disposal: Promise<void> | undefined
  let cleanup: Promise<void> | undefined
  let desktopDisposal: Promise<void> | undefined
  let database: ReturnType<typeof openFlowDatabase> | undefined
  let telemetry: ReturnType<typeof setupFlowTelemetry> | undefined
  let session: NodeSession | undefined
  let host: FlowHost | undefined
  let desktop: FlowDesktopController | undefined
  let retention: ReturnType<typeof startRetention> | undefined
  let resources: FlowResources | undefined
  const operations = new Set<Promise<unknown>>()
  const cleanupErrors: Array<unknown> = []

  function emit(event: HostEvent): void {
    try {
      params.onEvent(event)
    } catch (error) {
      dependencies.report(error)
    }
  }
  function publishStatus(): void {
    emit({
      type: 'service:status',
      meta: { eventID: randomUUID(), time: Date.now() },
      data: { service: 'flow', status: structuredClone(status) },
    })
  }
  async function attempt(work: () => void | Promise<void>): Promise<void> {
    try {
      await work()
    } catch (error) {
      cleanupErrors.push(error)
      dependencies.report(error)
    }
  }
  function disposeDesktop(): Promise<void> {
    desktopDisposal ??= attempt(() => (desktop ? desktop.dispose() : params.desktop?.dispose()))
    return desktopDisposal
  }
  function cleanupResources(): Promise<void> {
    cleanup ??= (async () => {
      await disposeDesktop()
      await Promise.allSettled([...operations])
      await attempt(() => retention?.stop())
      await attempt(() => host?.dispose())
      await attempt(() => session?.dispose())
      await attempt(() => telemetry?.dispose())
      await attempt(() => database?.close())
      resources = undefined
    })()
    return cleanup
  }
  async function initialize(): Promise<void> {
    if (stopping) return
    let stage = 'load configuration'
    publishStatus()
    try {
      if (stopping) return
      const config = await dependencies.loadConfig(params.configPath)
      if (stopping) return
      stage = 'load flow files'
      const { flows } = await dependencies.loadFlows(config.flowDirs)
      if (stopping) return
      stage = 'open the flow database'
      database = dependencies.openDatabase({ path: params.databasePath })
      const runStore = createSQLiteRunStore(database.db)
      const taskStore = createSQLiteTaskStore(database.db)
      const traceStore = createSQLiteTraceStore(database.db)
      stage = 'install flow telemetry'
      telemetry = dependencies.setupTelemetry({
        traceStore,
        otlp: config.tracing.otlp,
        logs: config.logs,
      })
      if (stopping) return
      stage = 'create the flow session'
      session = dependencies.createSession()
      const native = createNativeSurface({
        adapter: params.desktop,
        notifications: config.desktop.notifications,
        monitorURL: () => params.monitor?.currentURL(),
        openURL: params.openURL,
        host: () => {
          if (host == null) throw new FlowServiceUnavailableError({ status, stopping })
          return host
        },
        onError: dependencies.report,
      })
      desktop = createFlowDesktopController({
        surfaces:
          params.monitor == null ? [native] : [createMonitorSurface(params.monitor), native],
        native,
        host: () => {
          if (host == null) throw new FlowServiceUnavailableError({ status, stopping })
          return host
        },
        onError: dependencies.report,
      })
      stage = 'connect sibling servers'
      for (const [key, sibling] of Object.entries(config.siblings)) {
        await session.addContext({ key, ...sibling })
        if (stopping) return
      }
      stage = 'register and recover flows'
      host = await dependencies.createHost({
        session,
        flows,
        approval: config.approval,
        runStore,
        taskStore,
        listeners: {
          'run:state': (data) =>
            emit({ type: 'run:state', meta: { eventID: randomUUID(), time: Date.now() }, data }),
          'inbox:added': (data) => {
            desktop?.added(data)
            emit({ type: 'inbox:added', meta: { eventID: randomUUID(), time: Date.now() }, data })
          },
          'inbox:settled': (data) => {
            desktop?.settled(data.item, data.outcome)
            emit({ type: 'inbox:settled', meta: { eventID: randomUUID(), time: Date.now() }, data })
          },
        },
      })
      if (stopping) return
      stage = 'start retention'
      retention = dependencies.startRetention({
        runStore,
        taskStore,
        traceStore,
        days: config.retention.days,
      })
      if (stopping) return
      resources = { host, traceStore }
      status = { state: 'ready' }
      publishStatus()
      // Establish the boundary before admitted operations run in their next microtask.
      if (!stopping) desktop.restored(host.inbox.list())
    } catch (error) {
      dependencies.report(error)
      if (!stopping) {
        status = failedStatus(error, stage)
        publishStatus()
      }
      await cleanupResources()
    }
  }
  function requireResources(): FlowResources {
    if (stopping || status.state !== 'ready' || resources == null) {
      throw new FlowServiceUnavailableError({ status, stopping })
    }
    return resources
  }
  async function run<T>(work: (resources: FlowResources) => T | Promise<T>): Promise<T> {
    const available = requireResources()
    const operation = Promise.resolve().then(() => work(available))
    operations.add(operation)
    try {
      return await operation
    } finally {
      operations.delete(operation)
    }
  }
  return {
    status: () => structuredClone(status),
    resources: requireResources,
    run,
    start() {
      starting ??= stopping ? Promise.resolve() : Promise.resolve().then(initialize)
      return starting
    },
    prompt(id, signal) {
      return run(() => {
        if (desktop == null) throw new FlowServiceUnavailableError({ status, stopping })
        return desktop.prompt(id, signal)
      })
    },
    dispose() {
      if (disposal == null) {
        stopping = true
        // Abort dialogs before draining operations that may be waiting on them.
        void disposeDesktop()
        disposal = (async () => {
          await starting
          await cleanupResources()
          if (cleanupErrors.length > 0)
            throw new AggregateError(cleanupErrors, 'Failed to dispose flow service')
        })()
      }
      return disposal
    },
  }
}
