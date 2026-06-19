import type { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { chmodSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { createTransportStream } from '@enkaku/node-streams-transport'
import { type ProcedureHandlers, serve } from '@enkaku/server'
import { SocketTransport } from '@enkaku/socket-transport'
import { tap } from '@enkaku/stream'
import {
  type ActiveContextInfo,
  DEFAULT_SOCKET_PATH,
  type ClientMessage as HostClientMessage,
  type HostEventMeta,
  type ServerMessage as HostServerMessage,
  type Protocol,
} from '@mokei/host-protocol'

import { spawnContextServer } from './spawn.js'

type HandlersContext = {
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

function createHandlers({
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

function serveSocket(socket: Socket, context: HandlersContext): void {
  const handlers = createHandlers(context)
  const transport = new SocketTransport<HostClientMessage, HostServerMessage>({ socket })
  const socketServer = serve<Protocol>({ handlers, transport, requireAuth: false })
  socket.once('close', () => {
    socketServer.dispose()
  })
}

export type ServerParams = {
  socketPath?: string
  shutdown?: () => void | Promise<void>
}

export type RunningServer = {
  server: Server
  dispose: () => Promise<void>
}

export function startServer(params: ServerParams = {}): Promise<RunningServer> {
  const socketPath = params.socketPath ?? DEFAULT_SOCKET_PATH

  const children = new Map<string, ChildProcess>()
  let disposed = false
  const dispose = async (): Promise<void> => {
    if (disposed) {
      return
    }
    disposed = true
    killChildren(children)
    await params.shutdown?.()
  }

  const context: HandlersContext = {
    activeContexts: {},
    children,
    events: new EventTarget(),
    startedTime: Date.now(),
    // The RPC `shutdown` channel runs the same path as a signal-driven dispose.
    shutdown: dispose,
  }
  const server = createServer((socket) => {
    serveSocket(socket, context)
  })

  return new Promise((resolve, reject) => {
    server.on('error', (err) => {
      reject(err)
    })
    server.listen(socketPath, () => {
      try {
        // Same-OS-user trust boundary: only the owner may drive the spawn channel.
        chmodSync(socketPath, 0o600)
      } catch (err) {
        server.close()
        reject(err)
        return
      }
      resolve({ server, dispose })
    })
  })
}
