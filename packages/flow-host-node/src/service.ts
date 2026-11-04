import { randomUUID } from 'node:crypto'
import type { StoreProvider } from '@hozon/db'
import type { FlowHost, TraceStore } from '@mokei/flow-host'
import { createFlowHost, RegisteredFlowError } from '@mokei/flow-host'
import { NodeContextHost } from '@mokei/host-node'
import type { FlowServiceStatus, HostEvent } from '@mokei/host-protocol'
import { NodeSession } from '@mokei/session-node'
import { lazy } from '@sozai/async'

import { FlowConfigError, loadFlowConfig } from './config.js'
import type { FlowDesktopAdapter, FlowDesktopController } from './desktop.js'
import { createFlowDesktopController } from './desktop.js'
import { FlowFileError, loadFlowDirs } from './flow-dirs.js'
import type { MonitorPresence } from './monitor-presence.js'
import { createMonitorSurface } from './monitor-surface.js'
import { createNativeSurface } from './native-surface.js'
import { getFlowReporter } from './report.js'
import { startRetention } from './retention.js'
import { getFlowRunStore } from './run-store.js'
import { getFlowTaskStore } from './task-store.js'
import { createFlowTraceStore, type FlowTraceStoreParams } from './trace-store.js'

export type { FlowServiceStatus } from '@mokei/host-protocol'

export { FLOW_REPORT_CATEGORY } from './report.js'
export type FlowResources = { host: FlowHost; traceStore: TraceStore }
export type FlowServiceParams = {
  configPath?: string
  database: StoreProvider
  tracing?: { payloads?: 'on' | 'off' | number; parentFrom?: 'context' | 'meta' }
  traceIndex?: FlowTraceStoreParams['index']
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
export type FlowServiceUnavailableErrorParams = {
  status: FlowServiceStatus
  stopping?: boolean
}

export class FlowServiceUnavailableError extends Error {
  #status: FlowServiceStatus

  constructor(params: FlowServiceUnavailableErrorParams) {
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
  createSession(): NodeSession
  createHost: typeof createFlowHost
  startRetention: typeof startRetention
  /** `message` describes where the error happened; it defaults to a generic service label. */
  report(error: unknown, message?: string): void
}

// Flow definition field names that may appear in a checker issue path.
const DEFINITION_FIELDS = new Set([
  'id',
  'name',
  'version',
  'start',
  'nodes',
  'flows',
  'kind',
  'flow',
  'tool',
  'args',
  'schema',
  'prompt',
  'next',
  'cases',
  'default',
  'decline',
  'retry',
  'result',
  'input',
  'output',
  'outcome',
  'state',
  'value',
  'ref',
])

function failedStatus(error: unknown, stage: string, file?: string): FlowServiceStatus {
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
        issues: error.issues.map((issue) => {
          return issue.startsWith('JSON:')
            ? 'Invalid JSON'
            : issue
                .split('.')
                .map((part) => (fields.has(part) ? part : '*'))
                .join('.')
        }),
      },
    }
  }
  if (error instanceof FlowFileError) {
    // The JSON parser message can quote file content, so only the path and reason are kept.
    return {
      state: 'failed',
      error: {
        type: 'FlowFileError',
        message: error.reason === 'invalid_json' ? 'Invalid flow JSON' : 'Cannot read flow files',
        path: error.path,
      },
    }
  }
  if (error instanceof RegisteredFlowError) {
    // Flow ids, node ids and some checker messages are flow-authored text. Keep issue codes and
    // definition field names only; the full issues go to the log.
    return {
      state: 'failed',
      error: {
        type: 'FlowDefinitionError',
        message: 'Invalid flow definition',
        ...(file === undefined ? {} : { path: file }),
        issues: error.issues.map((issue) => {
          const path = (issue.path ?? [])
            .map((part) => {
              const key = typeof part === 'object' ? part.key : part
              if (typeof key === 'number') return key
              return typeof key === 'string' && DEFINITION_FIELDS.has(key) ? key : '*'
            })
            .join('.')
          return path === '' ? issue.code : `${path}: ${issue.code}`
        }),
      },
    }
  }
  return { state: 'failed', error: { type: 'FlowStartupError', message: `Failed to ${stage}` } }
}

/** The last loaded file declaring `flowID`; a duplicate id names the file that collided. */
function flowFile(
  loaded: { files: Array<string>; flows: Array<unknown> } | undefined,
  flowID: string,
): string | undefined {
  if (loaded === undefined) return undefined
  for (let index = loaded.flows.length - 1; index >= 0; index--) {
    const flow = loaded.flows[index]
    if (typeof flow === 'object' && flow !== null && (flow as { id?: unknown }).id === flowID) {
      return loaded.files[index]
    }
  }
  return undefined
}

export function createFlowService(params: FlowServiceParams): FlowService {
  const report = getFlowReporter('@mokei/flow-host-node')
  return createFlowServiceWithDependencies(params, {
    loadConfig: loadFlowConfig,
    loadFlows: loadFlowDirs,
    createSession: () => {
      return new NodeSession({
        contextHost: new NodeContextHost({ elicit: true, tracing: params.tracing }),
      })
    },
    createHost: createFlowHost,
    startRetention: startRetention,
    report: (error, message = 'Flow service error') => report(message, error),
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
  let desktopDisposal: Promise<void> | undefined
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
  const cleanup = lazy(async () => {
    await disposeDesktop()
    await Promise.allSettled([...operations])
    await attempt(() => retention?.stop())
    await attempt(() => host?.dispose())
    await attempt(() => session?.dispose())
    resources = undefined
  })
  async function initialize(): Promise<void> {
    if (stopping) return
    let stage = 'load configuration'
    let loaded: Awaited<ReturnType<typeof loadFlowDirs>> | undefined
    publishStatus()
    try {
      if (stopping) return
      const config = await dependencies.loadConfig(params.configPath)
      if (stopping) return
      stage = 'load flow files'
      loaded = await dependencies.loadFlows(config.flowDirs)
      const { flows } = loaded
      if (stopping) return
      stage = 'open the flow stores'
      const runStore = await getFlowRunStore(params.database)
      const taskStore = await getFlowTaskStore(params.database)
      const traceStore = createFlowTraceStore(params.database, { index: params.traceIndex })
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
          'run:state': (data) => {
            return emit({
              type: 'run:state',
              meta: { eventID: randomUUID(), time: Date.now() },
              data,
            })
          },
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
      const file = error instanceof RegisteredFlowError ? flowFile(loaded, error.flowID) : undefined
      dependencies.report(
        error,
        `Flow service failed to ${stage}${file === undefined ? '' : ` (${file})`}`,
      )
      if (!stopping) {
        status = failedStatus(error, stage, file)
        publishStatus()
      }
      await cleanup
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
          await cleanup
          if (cleanupErrors.length > 0)
            throw new AggregateError(cleanupErrors, 'Failed to dispose flow service')
        })()
      }
      return disposal
    },
  }
}
