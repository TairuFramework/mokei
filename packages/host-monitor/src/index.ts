/**
 * Mokei Host monitor.
 *
 * ## Installation
 *
 * ```sh
 * npm install @mokei/host-monitor
 * ```
 *
 * @module host-monitor
 */

import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { createServerBridge } from '@enkaku/http-serve'
import { connectSocket, createTransportStream } from '@enkaku/socket'
import type { ClientMessage, Protocol, ServerMessage } from '@mokei/host-protocol'
import { Disposer, sleep } from '@sozai/async'
import { getSocketPath } from '@tejika/env'
import { createLocalServer, serveStaticSPA } from '@tejika/server'

import { createMonitorFilter, wireMonitorStreams } from './pipes.js'

export type MonitorParams = {
  socketPath?: string
  port?: number
}

export type Monitor = {
  disposer: Disposer
  port: number
  token: string
  url: string
}

class MonitorUnavailableError extends Error {
  constructor() {
    super(
      'The running daemon does not support the monitor. Restart it with `mokei daemon stop`, then rerun `mokei monitor`.',
    )
    this.name = 'MonitorUnavailableError'
  }
}

export async function startMonitor(params: MonitorParams = {}): Promise<Monitor> {
  const socketPath = params.socketPath ?? getSocketPath('mokei')
  const stop = new AbortController()
  const socketStream = await createTransportStream(
    connectSocket(socketPath, { signal: stop.signal }),
  )
  const {
    app,
    url: listeningURL,
    token,
    close,
  } = await createLocalServer({
    app: 'mokei',
    port: params.port,
  }).catch(async (error: unknown) => {
    await socketStream.writable.abort()
    throw error
  })
  if (token == null) {
    await Promise.all([close(), socketStream.writable.abort()])
    throw new Error('Expected a bearer token from the loopback monitor server')
  }
  const url = new URL(listeningURL).href
  const bodies = new Set<() => void>()

  function wrapSSE(response: Response, obsolete: boolean): Response {
    if (
      !response.headers.get('content-type')?.startsWith('text/event-stream') ||
      response.body == null
    ) {
      return response
    }
    const reader = response.body.getReader()
    let ended = false
    let finish = () => {}
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        finish = () => {
          if (ended) return
          ended = true
          bodies.delete(finish)
          controller.close()
          void reader.cancel().catch(() => {})
        }
        bodies.add(finish)
      },
      async pull(controller) {
        try {
          const chunk = await reader.read()
          if (ended) return
          if (chunk.done) finish()
          else controller.enqueue(chunk.value)
        } catch (error) {
          if (ended) return
          ended = true
          bodies.delete(finish)
          controller.error(error)
        }
      },
      cancel() {
        if (ended) return
        ended = true
        bodies.delete(finish)
        return reader.cancel().catch(() => {})
      },
    })
    if (obsolete) finish()
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }
  const endBodies = () => {
    for (const finish of bodies) finish()
  }

  function connect(stream: typeof socketStream) {
    let attachmentID = ''
    const rid = randomUUID()
    const attached = Promise.withResolvers<void>()
    // Attachment traffic shares the socket writer but never enters the browser bridge.
    let injectedController: ReadableStreamDefaultController<ClientMessage>
    const injected = new ReadableStream<ClientMessage>({
      start(controller) {
        injectedController = controller
        controller.enqueue({
          header: { typ: 'JWT', alg: 'none' },
          payload: { typ: 'stream', prc: 'monitor.attach', rid, prm: { url } },
        })
      },
    })
    const bridge = createServerBridge<Protocol>({
      allowedOrigin: [new URL(url).origin, `http://localhost:${new URL(url).port}`],
      onRequestAborted: ({ rid }) => {
        try {
          injectedController.enqueue({
            header: { typ: 'JWT', alg: 'none' },
            payload: { typ: 'abort', rid, rsn: 'ClientDisconnected' },
          })
        } catch {
          /* The old daemon connection has already ended. */
        }
      },
    })
    const readable = stream.readable.pipeThrough(
      new TransformStream<unknown, unknown>({
        transform(message, controller) {
          const msg = message as ServerMessage
          if (msg.payload.rid !== rid) {
            controller.enqueue(message)
          } else if (
            msg.payload.typ === 'receive' &&
            msg.payload.val.type === 'attached' &&
            'attachmentID' in msg.payload.val &&
            typeof msg.payload.val.attachmentID === 'string'
          ) {
            attachmentID = msg.payload.val.attachmentID
            attached.resolve()
          } else if (msg.payload.typ === 'error' || msg.payload.typ === 'result') {
            const unsupported =
              msg.payload.typ === 'error' &&
              (msg.payload.code === 'UNKNOWN_PROCEDURE' ||
                msg.payload.code === 'PROCEDURE_NOT_FOUND' ||
                msg.payload.code === 'INVALID_MESSAGE' ||
                msg.payload.code === 'MONITOR_UNAVAILABLE' ||
                (msg.payload.code === 'HANDLER_ERROR' &&
                  msg.payload.msg === 'No handler for procedure: monitor.attach'))
            attached.reject(
              unsupported
                ? new MonitorUnavailableError()
                : new Error(
                    msg.payload.typ === 'error' ? msg.payload.msg : 'Monitor attachment ended',
                  ),
            )
            void pipes.dispose()
          }
        },
      }),
    )
    const pipes = wireMonitorStreams({
      filter: createMonitorFilter(() => attachmentID),
      injected,
      socketReadable: readable,
      socketWritable: stream.writable,
      bridgeReadable: bridge.stream.readable,
      bridgeWritable: bridge.stream.writable,
    })
    void pipes.done.then(() =>
      attached.reject(new Error('Daemon connection closed before attachment')),
    )
    return {
      bridge,
      pipes,
      attached: attached.promise,
      get ready() {
        return attachmentID !== ''
      },
    }
  }

  let active: ReturnType<typeof connect> | undefined = connect(socketStream)
  app.all('/api', async (ctx) => {
    const connection = active
    if (connection == null || !connection.ready)
      return new Response('Daemon reconnecting', { status: 503 })
    const response = await connection.bridge.handleRequest(ctx.req.raw)
    return wrapSSE(response, active !== connection || stop.signal.aborted)
  })
  const distDir = join(import.meta.dirname, '../dist')
  serveStaticSPA(app, { dir: distDir, token })
  try {
    await active.attached
  } catch (error) {
    stop.abort()
    endBodies()
    await Promise.all([close(), active.pipes.dispose()])
    throw error
  }

  const reconnecting = (async () => {
    while (!stop.signal.aborted) {
      await active?.pipes.done
      active = undefined
      endBodies()
      let backoff = 250
      while (!stop.signal.aborted) {
        try {
          await sleep(backoff, stop.signal)
          const stream = await createTransportStream(
            connectSocket(socketPath, { signal: stop.signal }),
          )
          if (stop.signal.aborted) {
            await stream.writable.abort()
            break
          }
          const connection = connect(stream)
          active = connection
          await connection.attached
          break
        } catch (error) {
          await active?.pipes.dispose()
          active = undefined
          endBodies()
          if (error instanceof MonitorUnavailableError) {
            console.error(error.message)
            return
          }
          backoff = Math.min(backoff * 2, 5_000)
        }
      }
    }
  })()
  const disposer = new Disposer({
    dispose: async () => {
      stop.abort()
      endBodies()
      await Promise.all([close(), active?.pipes.dispose()])
      await reconnecting
    },
  })
  const port = Number.parseInt(new URL(url).port, 10)
  return { disposer, port, token, url }
}
