import type { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createTransportStream } from '@enkaku/node-streams'
import { HandlerError, type ProcedureHandlers, serve } from '@enkaku/server'
import { type PayloadCapture, sanitizeMessage, type TerminationReason } from '@mokei/context-client'
import type {
  ActiveContextInfo,
  BaseProtocol,
  FlowProcedure,
  FlowServiceStatus,
  HostEvent,
  HostEventMeta,
  MonitorProcedure,
  Protocol,
  TracingInfo,
} from '@mokei/host-protocol'
import { protocol } from '@mokei/host-protocol'
import { tap } from '@sozai/stream'
import { type DaemonHandle, runDaemon as tejikaRunDaemon } from '@tejika/process'

import { createProxyTracing } from './proxy-tracing.js'
import { spawnContextServer } from './spawn.js'

export type HandlersContext = {
  activeContexts: Record<string, ActiveContextInfo>
  children: Map<string, ChildProcess>
  events: EventTarget
  startedTime: number
  shutdown?: () => void | Promise<void>
  tracing?: { payloads?: PayloadCapture }
  tracingInfo?: () => TracingInfo
  eventBufferLimit?: number
  flowStatus?: () => FlowServiceStatus
}

function createEventMeta(contextID: string): HostEventMeta {
  return { contextID, eventID: randomUUID(), time: Date.now() }
}

/** Kill every tracked child process and clear the map. */
export function killChildren(children: Map<string, ChildProcess>): void {
  for (const child of children.values()) {
    try {
      child.kill()
    } catch {
      // Child may already be gone; ignore.
    }
  }
  children.clear()
}

export function createHandlers({
  activeContexts,
  children,
  events,
  startedTime,
  shutdown,
  flowStatus = unavailableStatus,
  tracing,
  tracingInfo,
  eventBufferLimit = 2000,
}: HandlersContext): ProcedureHandlers<BaseProtocol> {
  return {
    events: async (ctx) => {
      if (ctx.signal.aborted) return
      const writer = ctx.writable.getWriter()
      const sub = new AbortController()
      let pendingWrites = 0
      const abortSubscription = () => sub.abort()
      const handleEvent = (event: Event) => {
        if (sub.signal.aborted) return
        const desiredSize = writer.desiredSize
        if (
          pendingWrites >= eventBufferLimit ||
          desiredSize == null ||
          desiredSize <= -eventBufferLimit
        ) {
          sub.abort()
          return
        }
        const e = event as CustomEvent<Omit<HostEvent, 'type'>>
        const message = { type: e.type, ...e.detail } as HostEvent
        pendingWrites++
        void writer
          .write(message)
          .catch(() => sub.abort())
          .finally(() => {
            pendingWrites--
          })
      }
      try {
        await new Promise<void>((resolve) => {
          sub.signal.addEventListener('abort', () => resolve(), { once: true })
          ctx.signal.addEventListener('abort', abortSubscription, { once: true })
          for (const type of EVENT_TYPES) {
            events.addEventListener(type, handleEvent)
          }
          if (ctx.signal.aborted) sub.abort()
        })
      } finally {
        sub.abort()
        ctx.signal.removeEventListener('abort', abortSubscription)
        for (const type of EVENT_TYPES) {
          events.removeEventListener(type, handleEvent)
        }
        // Do not wait for a stalled consumer to settle its outstanding writes.
        void writer.abort().catch(() => {})
        writer.releaseLock()
      }
    },
    info: () => ({
      activeContexts,
      startedTime,
      flowService: flowStatus(),
      ...(tracingInfo == null ? {} : { tracing: tracingInfo() }),
    }),
    shutdown: async () => {
      await shutdown?.()
    },
    spawn: async (ctx) => {
      if (ctx.signal.aborted) return
      const contextID = randomUUID()
      const spawned = await spawnContextServer(ctx.param)
      if (ctx.signal.aborted) {
        spawned.childProcess.kill()
        return
      }
      const proxyTracing = createProxyTracing({
        contextID,
        command: ctx.param.command,
        args: ctx.param.args ?? [],
        payloads: tracing?.payloads,
      })
      const controller = new AbortController()
      let stopped = false
      const stopContext = (reason: TerminationReason) => {
        if (stopped) return
        stopped = true
        proxyTracing.end(reason)
        controller.abort()
        spawned.childProcess.off('exit', onExit)
        ctx.signal.removeEventListener('abort', onAbort)
        try {
          spawned.childProcess.kill()
        } finally {
          delete activeContexts[contextID]
          children.delete(contextID)
          events.dispatchEvent(
            new CustomEvent('context:stop', { detail: { meta: createEventMeta(contextID) } }),
          )
        }
      }
      const onExit = () => stopContext(ctx.signal.aborted ? 'stopped' : 'lost')
      const onAbort = () => stopContext('stopped')
      activeContexts[contextID] = { startedTime: Date.now() }
      children.set(contextID, spawned.childProcess)
      // Own cancellation before transport conversion can yield.
      spawned.childProcess.once('exit', onExit)
      ctx.signal.addEventListener('abort', onAbort, { once: true })
      try {
        events.dispatchEvent(
          new CustomEvent('context:start', {
            detail: {
              meta: createEventMeta(contextID),
              data: { transport: 'stdio', command: ctx.param.command, args: ctx.param.args ?? [] },
            },
          }),
        )
        const stream = await createTransportStream(spawned.streams)
        if (stopped) {
          await Promise.allSettled([stream.readable.cancel(), stream.writable.abort()])
          return
        }
        await Promise.all([
          ctx.readable
            .pipeThrough(
              tap((message) => {
                proxyTracing.observe('client', message)
                events.dispatchEvent(
                  new CustomEvent('context:message', {
                    detail: {
                      meta: createEventMeta(contextID),
                      data: {
                        from: 'client',
                        message: sanitizeMessage(message, tracing?.payloads),
                      },
                    },
                  }),
                )
              }),
            )
            .pipeTo(stream.writable, { signal: controller.signal }),
          stream.readable
            .pipeThrough(
              tap((message) => {
                proxyTracing.observe('server', message)
                events.dispatchEvent(
                  new CustomEvent('context:message', {
                    detail: {
                      meta: createEventMeta(contextID),
                      data: {
                        from: 'server',
                        message: sanitizeMessage(message, tracing?.payloads),
                      },
                    },
                  }),
                )
              }),
            )
            .pipeTo(ctx.writable, { signal: controller.signal }),
        ])
      } finally {
        stopContext(ctx.signal.aborted ? 'stopped' : 'lost')
      }
    },
  }
}

const EVENT_TYPES = [
  'context:message',
  'context:start',
  'context:stop',
  'service:status',
  'run:state',
  'inbox:added',
  'inbox:settled',
  'span:start',
  'span:end',
  'log',
  'trace:summary',
] as const

const FLOW_PROCEDURES = [
  'flows.list',
  'flows.check',
  'runs.start',
  'runs.get',
  'runs.list',
  'runs.cancel',
  'runs.trace',
  'inbox.list',
  'inbox.get',
  'inbox.answer',
  'inbox.decline',
  'inbox.cancel',
  'inbox.prompt',
] as const satisfies Array<FlowProcedure>

const MONITOR_PROCEDURES = [
  'monitor.attach',
  'monitor.presence',
] as const satisfies Array<MonitorProcedure>

function unavailableStatus(): Extract<FlowServiceStatus, { state: 'failed' }> {
  return {
    state: 'failed',
    error: {
      type: 'FlowUnavailable',
      message:
        'Flow service is unavailable. Select a composed application entry with runDaemon({ entry }).',
    },
  }
}

export type HostDaemonParams = {
  events: EventTarget
  socketPath?: string
  pidPath?: string
  signal?: AbortSignal
  handleSignals?: boolean
  shutdownTimeoutMs?: number
  handlers?: Partial<ProcedureHandlers<Protocol>>
  tracing?: { payloads?: PayloadCapture }
  tracingInfo?: () => TracingInfo
  eventBufferLimit?: number
  flowStatus?: () => FlowServiceStatus
  onShutdown?: () => Promise<void>
  onError?: (error: unknown) => void
}

export function composeHandlers(
  ...sets: Array<Partial<ProcedureHandlers<Protocol>>>
): Partial<ProcedureHandlers<Protocol>> {
  const handlers: Partial<ProcedureHandlers<Protocol>> = {}
  for (const set of sets) {
    for (const procedure of Object.keys(set)) {
      if (Object.hasOwn(handlers, procedure)) {
        throw new Error(`Duplicate procedure: ${procedure}`)
      }
    }
    Object.assign(handlers, set)
  }
  return handlers
}

export async function serveHostDaemon(params: HostDaemonParams): Promise<DaemonHandle> {
  const children = new Map<string, ChildProcess>()
  const onError =
    params.onError ??
    ((error: unknown) => {
      console.error(error)
    })
  let daemon: DaemonHandle | undefined
  let shutdownScheduled = false
  const baseHandlers = createHandlers({
    activeContexts: {},
    children,
    events: params.events,
    startedTime: Date.now(),
    flowStatus: params.flowStatus,
    tracing: params.tracing,
    tracingInfo: params.tracingInfo,
    eventBufferLimit: params.eventBufferLimit,
    shutdown: () => {
      if (shutdownScheduled) return
      shutdownScheduled = true
      // Let Enkaku send the acknowledgement before closing its transport.
      setTimeout(() => {
        void daemon?.close().catch(onError)
      }, 0)
    },
  })
  const unavailable: Partial<ProcedureHandlers<Protocol>> = {}
  for (const procedure of FLOW_PROCEDURES) {
    if (params.handlers?.[procedure] == null) {
      unavailable[procedure] = () => {
        throw new HandlerError({
          code: 'FLOW_UNAVAILABLE',
          message: unavailableStatus().error.message,
        })
      }
    }
  }
  for (const procedure of MONITOR_PROCEDURES) {
    if (params.handlers?.[procedure] == null) {
      unavailable[procedure] = () => {
        throw new HandlerError({
          code: 'MONITOR_UNAVAILABLE',
          message: 'Monitor presence is unavailable in this daemon entry.',
        })
      }
    }
  }
  const handlers = composeHandlers(
    baseHandlers,
    params.handlers ?? {},
    unavailable,
  ) as ProcedureHandlers<Protocol>
  let cleanup: Promise<void> | undefined
  daemon = await tejikaRunDaemon<Protocol>({
    app: 'mokei',
    socketPath: params.socketPath,
    pidPath: params.pidPath,
    signal: params.signal,
    handleSignals: params.handleSignals,
    shutdownTimeoutMs: params.shutdownTimeoutMs,
    onError,
    serve: (transport) => serve<Protocol>({ protocol, handlers, transport, requireAuth: false }),
    onShutdown: () => {
      cleanup ??= (async () => {
        killChildren(children)
        try {
          await params.onShutdown?.()
        } finally {
          killChildren(children)
        }
      })()
      return cleanup
    },
  })
  return daemon
}
