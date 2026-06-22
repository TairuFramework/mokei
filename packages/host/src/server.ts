import type { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { createTransportStream } from '@enkaku/node-streams'
import { type ProcedureHandlers, serve } from '@enkaku/server'
import type { ActiveContextInfo, HostEventMeta, Protocol } from '@mokei/host-protocol'
import { tap } from '@sozai/stream'
import { runDaemon as tejikaRunDaemon } from '@tejika/process'

import { spawnContextServer } from './spawn.js'

export type HandlersContext = {
  activeContexts: Record<string, ActiveContextInfo>
  children: Map<string, ChildProcess>
  events: EventTarget
  startedTime: number
  shutdown?: () => void | Promise<void>
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
}: HandlersContext): ProcedureHandlers<Protocol> {
  return {
    events: (ctx) => {
      const writer = ctx.writable.getWriter()
      const sub = new AbortController()
      ctx.signal.addEventListener('abort', () => sub.abort(), { once: true })

      const handleEvent = (event: Event) => {
        const e = event as CustomEvent<{ data?: unknown; meta: HostEventMeta }>
        const msg = { type: e.type, data: e.detail.data, meta: e.detail.meta }
        writer.write(msg).catch(() => sub.abort())
      }
      events.addEventListener('context:message', handleEvent, { signal: sub.signal })
      events.addEventListener('context:start', handleEvent, { signal: sub.signal })
      events.addEventListener('context:stop', handleEvent, { signal: sub.signal })

      return new Promise((resolve) => {
        ctx.signal.addEventListener('abort', () => resolve())
      })
    },
    info: () => ({ activeContexts, startedTime }),
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
            data: { transport: 'stdio', command: ctx.param.command, args: ctx.param.args },
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

// ---------------------------------------------------------------------------
// Daemon entry — runs only when this module is the main process entry point.
// Spawned by @tejika/process spawnDaemon with `--socket-path <path>`.
// The socket bind, chmod 0600, pidfile, and lifecycle are owned by
// @tejika/process; this module only supplies the request handlers.
// ---------------------------------------------------------------------------
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: { 'socket-path': { type: 'string', short: 'p' } },
    strict: false,
  })
  const socketPath = typeof values['socket-path'] === 'string' ? values['socket-path'] : undefined

  const children = new Map<string, ChildProcess>()

  await tejikaRunDaemon<Protocol>({
    app: 'mokei',
    socketPath,
    serve: (transport) => {
      const context: HandlersContext = {
        activeContexts: {},
        children,
        events: new EventTarget(),
        startedTime: Date.now(),
        shutdown: () => {
          // RPC-triggered shutdown: kill children and let SIGTERM clean up the rest.
          killChildren(children)
          process.kill(process.pid, 'SIGTERM')
        },
      }
      const handlers = createHandlers(context)
      return serve<Protocol>({ handlers, transport, requireAuth: false })
    },
    onShutdown: async () => {
      killChildren(children)
    },
  })
}
