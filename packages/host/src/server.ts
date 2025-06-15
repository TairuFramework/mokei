import { randomUUID } from 'node:crypto'
import { type Server, type Socket, createServer } from 'node:net'
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
  events: EventTarget
  startedTime: number
  shutdown?: () => void | Promise<void>
}

function createEventMeta(contextID: string): HostEventMeta {
  return { contextID, eventID: randomUUID(), time: Date.now() }
}

function createHandlers({
  activeContexts,
  events,
  startedTime,
  shutdown,
}: HandlersContext): ProcedureHandlers<Protocol> {
  return {
    events: (ctx) => {
      const writer = ctx.writable.getWriter()

      const handleEvent = (event: Event) => {
        const e = event as CustomEvent<{ data?: unknown; meta: HostEventMeta }>
        const msg = { type: e.type, data: e.detail.data, meta: e.detail.meta }
        writer.write(msg)
      }
      events.addEventListener('context:message', handleEvent, { signal: ctx.signal })
      events.addEventListener('context:start', handleEvent, { signal: ctx.signal })
      events.addEventListener('context:stop', handleEvent, { signal: ctx.signal })

      return new Promise((resolve) => {
        ctx.signal.addEventListener('abort', () => {
          resolve()
        })
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
      events.dispatchEvent(
        new CustomEvent('context:start', {
          detail: {
            meta: createEventMeta(contextID),
            data: { transport: 'stdio', command: ctx.param.command, args: ctx.param.args },
          },
        }),
      )

      const stream = await createTransportStream(spawned.streams)

      ctx.signal.addEventListener('abort', () => {
        spawned.childProcess.kill()
        delete activeContexts[contextID]
        events.dispatchEvent(
          new CustomEvent('context:stop', { detail: { meta: createEventMeta(contextID) } }),
        )
      })

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
  const socketServer = serve<Protocol>({ handlers, transport, public: true })
  socket.once('close', () => {
    socketServer.dispose()
  })
}

export type ServerParams = {
  socketPath?: string
  shutdown?: () => void | Promise<void>
}

export function startServer(params: ServerParams = {}): Promise<Server> {
  const socketPath = params.socketPath ?? DEFAULT_SOCKET_PATH

  const context: HandlersContext = {
    activeContexts: {},
    events: new EventTarget(),
    startedTime: Date.now(),
    shutdown: params.shutdown,
  }
  const server = createServer((socket) => {
    serveSocket(socket, context)
  })

  return new Promise((resolve, reject) => {
    server.on('error', (err) => {
      reject(err)
    })
    server.listen(socketPath, () => {
      resolve(server)
    })
  })
}
