import type { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createTransportStream } from '@enkaku/node-streams'
import { HandlerError, type ProcedureHandlers, serve } from '@enkaku/server'
import type {
  ActiveContextInfo,
  BaseProtocol,
  FlowProcedure,
  FlowServiceStatus,
  HostEvent,
  HostEventMeta,
  Protocol,
} from '@mokei/host-protocol'
import { tap } from '@sozai/stream'
import { type DaemonHandle, runDaemon as tejikaRunDaemon } from '@tejika/process'

import { spawnContextServer } from './spawn.js'

export type HandlersContext = {
  activeContexts: Record<string, ActiveContextInfo>
  children: Map<string, ChildProcess>
  events: EventTarget
  startedTime: number
  shutdown?: () => void | Promise<void>
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
}: HandlersContext): ProcedureHandlers<BaseProtocol> {
  return {
    events: async (ctx) => {
      if (ctx.signal.aborted) return
      const writer = ctx.writable.getWriter()
      const sub = new AbortController()
      const handleEvent = (event: Event) => {
        const e = event as CustomEvent<Omit<HostEvent, 'type'>>
        const message = { type: e.type, ...e.detail } as HostEvent
        void writer.write(message).catch(() => sub.abort())
      }
      try {
        await new Promise<void>((resolve) => {
          sub.signal.addEventListener('abort', () => resolve(), { once: true })
          ctx.signal.addEventListener('abort', () => sub.abort(), {
            signal: sub.signal,
            once: true,
          })
          for (const type of EVENT_TYPES) {
            events.addEventListener(type, handleEvent, { signal: sub.signal })
          }
          if (ctx.signal.aborted) sub.abort()
        })
      } finally {
        sub.abort()
        writer.releaseLock()
      }
    },
    info: () => ({ activeContexts, startedTime, flowService: flowStatus() }),
    shutdown: async () => {
      await shutdown?.()
    },
    spawn: async (ctx) => {
      const contextID = randomUUID()
      const spawned = await spawnContextServer(ctx.param)
      activeContexts[contextID] = { startedTime: Date.now() }
      children.set(contextID, spawned.childProcess)
      events.dispatchEvent(
        new CustomEvent('context:start', {
          detail: {
            meta: createEventMeta(contextID),
            data: { transport: 'stdio', command: ctx.param.command, args: ctx.param.args ?? [] },
          },
        }),
      )

      const stream = await createTransportStream(spawned.streams)

      let stopped = false
      const stopContext = () => {
        if (stopped) {
          return
        }
        stopped = true
        spawned.childProcess.kill()
        delete activeContexts[contextID]
        children.delete(contextID)
        events.dispatchEvent(
          new CustomEvent('context:stop', { detail: { meta: createEventMeta(contextID) } }),
        )
      }

      // A child that exits on its own must leave activeContexts and notify
      // proxy clients, exactly as an explicit abort would.
      spawned.childProcess.once('exit', stopContext)
      ctx.signal.addEventListener('abort', stopContext)

      await Promise.all([
        ctx.readable
          .pipeThrough(
            tap((message) => {
              events.dispatchEvent(
                new CustomEvent('context:message', {
                  detail: {
                    meta: createEventMeta(contextID),
                    data: { from: 'client', message },
                  },
                }),
              )
            }),
          )
          .pipeTo(stream.writable),
        stream.readable
          .pipeThrough(
            tap((message) => {
              events.dispatchEvent(
                new CustomEvent('context:message', {
                  detail: {
                    meta: createEventMeta(contextID),
                    data: { from: 'server', message },
                  },
                }),
              )
            }),
          )
          .pipeTo(ctx.writable),
      ])
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
  flowStatus?: () => FlowServiceStatus
  onShutdown?: () => Promise<void>
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
  let daemon: DaemonHandle | undefined
  let shutdownScheduled = false
  const baseHandlers = createHandlers({
    activeContexts: {},
    children,
    events: params.events,
    startedTime: Date.now(),
    flowStatus: params.flowStatus,
    shutdown: () => {
      if (shutdownScheduled) return
      shutdownScheduled = true
      // Let Enkaku send the acknowledgement before closing its transport.
      setTimeout(() => {
        void daemon?.close().catch(() => {})
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
    serve: (transport) => serve<Protocol>({ handlers, transport, requireAuth: false }),
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
