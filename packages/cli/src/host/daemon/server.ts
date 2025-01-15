import { randomUUID } from 'node:crypto'
import { type Server, type Socket, createServer } from 'node:net'
import { createTransportStream } from '@enkaku/node-streams-transport'
import { type ProcedureHandlers, serve } from '@enkaku/server'
import { tap } from '@enkaku/stream'

import { DEFAULT_SOCKET_PATH } from '../constants.js'
import { spawnServer } from '../mcp.js'
import type { ClientMessage, Protocol, ServerMessage } from '../protocol.js'
import { SocketTransport } from '../transport.js'

type HandlersContext = {
  events: EventTarget
  startedTime: string
}

function createHandlers({ events, startedTime }: HandlersContext): ProcedureHandlers<Protocol> {
  return {
    events: (ctx) => {
      const writer = ctx.writable.getWriter()

      const handleEvent = (event: Event) => {
        const e = event as CustomEvent<unknown>
        const msg = { type: e.type, data: e.detail }
        writer.write(msg)
      }
      events.addEventListener('message', handleEvent, { signal: ctx.signal })
      events.addEventListener('spawn', handleEvent, { signal: ctx.signal })

      return new Promise((resolve) => {
        ctx.signal.addEventListener('abort', () => {
          resolve()
        })
      })
    },
    info: () => ({ startedTime }),
    shutdown: async () => {
      // TODO: shutdown all spawned processes
    },
    spawn: async (ctx) => {
      const clientID = randomUUID()
      const spawned = await spawnServer(ctx.params.command, ctx.params.args)
      events.dispatchEvent(
        new CustomEvent('spawn', {
          detail: {
            clientID,
            time: Date.now(),
            command: ctx.params.command,
            args: ctx.params.args,
          },
        }),
      )

      // Connect channel streams to spawned process
      const stream = await createTransportStream(spawned)
      await Promise.all([
        ctx.readable
          .pipeThrough(
            tap((message) => {
              events.dispatchEvent(
                new CustomEvent('message', {
                  detail: { clientID, from: 'client', message, time: Date.now() },
                }),
              )
            }),
          )
          .pipeTo(stream.writable),
        stream.readable
          .pipeThrough(
            tap((message) => {
              events.dispatchEvent(
                new CustomEvent('message', {
                  detail: { clientID, from: 'server', message, time: Date.now() },
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
  const transport = new SocketTransport<ClientMessage, ServerMessage>({ socket })
  const socketServer = serve<Protocol>({ handlers, transport, public: true })
  socket.once('close', () => {
    socketServer.dispose()
  })
}

export type ServerParams = {
  socketPath?: string
}

export function startServer(params: ServerParams = {}): Promise<Server> {
  const socketPath = params.socketPath ?? DEFAULT_SOCKET_PATH

  const context: HandlersContext = {
    events: new EventTarget(),
    startedTime: new Date().toISOString(),
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
