import { randomUUID } from 'node:crypto'
import { type Server, type Socket, createServer } from 'node:net'
import { createTransportStream } from '@enkaku/node-streams-transport'
import { type ProcedureHandlers, serve } from '@enkaku/server'
import { SocketTransport } from '@enkaku/socket-transport'
import { tap } from '@enkaku/stream'
import {
  type ClientMessage,
  DEFAULT_SOCKET_PATH,
  type Protocol,
  type ServerMessage,
} from '@mokei/host-protocol'

import { spawnContextServer } from './context-spawn.js'

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
      events.addEventListener('context:message', handleEvent, { signal: ctx.signal })
      events.addEventListener('context:spawn', handleEvent, { signal: ctx.signal })

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
      const contextID = randomUUID()
      const spawned = await spawnContextServer(ctx.param.command, ctx.param.args)
      events.dispatchEvent(
        new CustomEvent('context:spawn', {
          detail: {
            contextID,
            time: Date.now(),
            command: ctx.param.command,
            args: ctx.param.args,
          },
        }),
      )

      // Connect channel streams to spawned process
      const stream = await createTransportStream(spawned.streams)
      await Promise.all([
        ctx.readable
          .pipeThrough(
            tap((message) => {
              events.dispatchEvent(
                new CustomEvent('context:message', {
                  detail: { contextID, from: 'client', message, time: Date.now() },
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
                  detail: { contextID, from: 'server', message, time: Date.now() },
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
