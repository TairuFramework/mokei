import { Transport } from '@enkaku/transport'
import {
  type ClientMessage,
  ENVELOPE_VIOLATION,
  INVALID_PARAMS,
  type ServerMessage,
} from '@mokei/context-protocol'
import type { ContextServer, ServerTransport, SubscriptionHub } from '@mokei/context-server'
import { getMokeiLogger, type Logger } from '@mokei/logger'
import { createRuntime, type Runtime } from '@sozai/runtime'

import { createSSEStream, SSE_RESPONSE_HEADERS } from './sse-stream.js'
import { SSEWriter } from './sse-writer.js'
import { BAD_REQUEST_CODES } from './stateless.js'

/**
 * Same classification `runStatelessExchange` applies (see `./stateless.ts`'s
 * `isEnvelopeFailure` for the full rationale) -- duplicated rather than imported because it is
 * not exported: this exchange is a fork, not a wrapper, of that one.
 */
function isEnvelopeFailure(error: { code?: unknown; data?: unknown }): boolean {
  if (error.code === INVALID_PARAMS) {
    return (
      error.data != null &&
      typeof error.data === 'object' &&
      (error.data as Record<string, unknown>)[ENVELOPE_VIOLATION] === true
    )
  }
  return typeof error.code === 'number' && BAD_REQUEST_CODES.has(error.code)
}

export type SubscriptionExchangeParams = {
  message: ClientMessage
  /** The `id` of the `subscriptions/listen` request being exchanged. */
  requestID: string | number | null
  /**
   * Builds the transport-isolated `ContextServer` for this exchange. Takes the factory-object
   * form deliberately: Task 13 owns the final factory signature (whatever else the HTTP layer
   * ends up threading through), so this is kept to the minimal shape `ContextServer` itself
   * already accepts today -- this exchange's isolated `transport`, the borrowed
   * `subscriptionHub`, and the `connectionID` minted for it.
   */
  createServer: (params: {
    transport: ServerTransport
    subscriptionHub: SubscriptionHub
    connectionID: string
  }) => ContextServer
  /**
   * The shared hub this exchange's throwaway server borrows. Owned, and disposed, by whoever
   * drives the durable side of subscriptions (Task 13) -- this exchange only ever registers
   * against it via the server it builds, never creates or tears it down itself.
   */
  subscriptionHub: SubscriptionHub
  replayBufferSize: number
  /**
   * RN-safe id source (`@sozai/runtime`) this exchange mints its `connectionID` from. Defaults
   * via `createRuntime()` when omitted; Task 13 threads its own instance from the handler.
   */
  runtime?: Partial<Runtime>
  /**
   * The incoming request's abort signal. As with `runStatelessExchange`, the client hanging up
   * is this exchange's cancellation channel -- but here it is the *only* teardown trigger short
   * of a graceful `complete()` on the subscription itself: there is no response timeout to fall
   * back on (see `runSubscriptionExchange`'s own doc comment).
   */
  signal?: AbortSignal
  /**
   * Called with this exchange's teardown function once it is running, and again with the same
   * function when it ends, so the handler can track what is in flight and end it on shutdown.
   */
  onStart?: (teardown: () => void) => void
  onEnd?: (teardown: () => void) => void
  /** Optional logger (defaults to the `mokei:http-server` logger) */
  logger?: Logger
}

/**
 * Runs one `subscriptions/listen` request against a throwaway, transport-isolated
 * `ContextServer` that borrows a shared `SubscriptionHub`, and returns its HTTP response.
 *
 * Forked from `runStatelessExchange` (`./stateless.ts`) rather than sharing it, because a listen
 * exchange's response lifecycle is fundamentally different from an ordinary stateless one:
 *
 * - No response timeout. `runStatelessExchange`'s `DEFAULT_STATELESS_TIMEOUT_MS` timer exists
 *   because a stateless request is expected to answer promptly; a listen has no such deadline --
 *   it is meant to sit open for as long as the subscription lives, which can be indefinitely.
 * - No close-after-ack, and no close-on-terminal either. `runStatelessExchange` calls `finish()`
 *   (which closes the SSE stream and disposes the server) the moment it writes what it
 *   recognises as the request's own response. For a listen, the acknowledgement is a
 *   *notification*, not the response, so it was never `isOwnResponse` to begin with -- but even
 *   the eventual held terminal (`ContextServer#listen`'s `_holdResponse`, which *does* satisfy
 *   `isOwnResponse` once it writes) must not trigger `finish()` here: the terminal result flows
 *   through the serving server's own RPC write path, same as every notification before it, and
 *   this exchange has no business intercepting it to decide the stream is now done. Closing the
 *   stream once nothing more will ever be written is Task 13's seam (it owns the durable-side
 *   routing that knows when that is true) -- this fork deliberately leaves it open rather than
 *   guessing.
 * - Abort/finish wiring is otherwise unchanged: a client disconnect or request abort still tears
 *   the exchange down, disposes its throwaway server, and settles a `503` for anyone still
 *   awaiting the response promise (which, in practice, nobody is once the SSE stream has opened).
 */
export function runSubscriptionExchange(params: SubscriptionExchangeParams): Promise<Response> {
  const {
    message,
    requestID,
    createServer,
    subscriptionHub,
    replayBufferSize,
    runtime: runtimeOverrides,
    signal,
    onStart,
    onEnd,
    logger = getMokeiLogger('http-server'),
  } = params

  if (signal?.aborted) {
    // The client is already gone: standing a server up for it would only create work to
    // tear straight back down.
    return Promise.resolve(new Response(null, { status: 499 }))
  }

  const runtime = createRuntime(runtimeOverrides)
  const connectionID = runtime.getRandomID()

  let controller!: ReadableStreamDefaultController<ClientMessage>
  const readable = new ReadableStream<ClientMessage>({
    start(c) {
      controller = c
    },
  })

  let sse: SSEWriter | null = null
  let settled = false
  let finished = false
  let server: ContextServer | null = null

  let resolveResponse!: (response: Response) => void
  const response = new Promise<Response>((resolve) => {
    resolveResponse = resolve
  })

  function settle(value: Response): void {
    if (settled) {
      return
    }
    settled = true
    resolveResponse(value)
  }

  function finish(): void {
    if (finished) {
      return
    }
    finished = true
    signal?.removeEventListener('abort', onAbort)
    sse?.close()
    try {
      controller.close()
    } catch {
      // Already closed by a concurrent finish(); nothing to release.
    }
    void server?.dispose().catch(() => {
      // The exchange is over either way; a dispose failure has nobody to report to.
    })
    // Settle unconditionally, same rationale as `runStatelessExchange`: a caller awaiting the
    // response promise must not hang forever when the exchange ends before anything was ever
    // written -- the client hung up, or the handler was disposed, before the ack.
    settle(new Response(null, { status: 503 }))
    onEnd?.(finish)
  }

  function onAbort(): void {
    finish()
  }

  const writable = new WritableStream<ServerMessage>({
    async write(outgoing) {
      try {
        const record = outgoing as unknown as Record<string, unknown>
        const isOwnResponse = requestID != null && record.id === requestID && !('method' in record)

        // Held in a local: `sse` is a closure variable from an enclosing scope, which
        // TypeScript will not keep narrowed across the assignment below.
        let writer = sse
        if (writer == null) {
          if (finished) {
            // The exchange already tore down -- the client hung up or the handler was
            // disposed -- and whoever was waiting on `response` has already gotten an answer.
            // Building a fresh SSE stream here would create one nobody will ever read.
            return
          }
          if (isOwnResponse) {
            const error = record.error as { code?: unknown; data?: unknown } | undefined
            if (error != null && isEnvelopeFailure(error)) {
              settle(
                new Response(JSON.stringify(outgoing), {
                  status: 400,
                  headers: { 'Content-Type': 'application/json' },
                }),
              )
              finish()
              return
            }
          }
          const stream = createSSEStream()
          writer = new SSEWriter({
            writable: stream.writable,
            streamID: `subscription-${requestID ?? 'notification'}`,
            replayBufferSize,
            logger,
          })
          sse = writer
          settle(new Response(stream.readable, { status: 200, headers: SSE_RESPONSE_HEADERS }))
          await writer.writePrimingEvent()
        }

        await writer.writeEvent({ data: JSON.stringify(outgoing) })
        // Deliberately no `finish()` here, even when `isOwnResponse` -- see this function's doc
        // comment for why the held terminal writing is not, by itself, reason to close the
        // stream.
      } catch (error) {
        finish()
        throw error
      }
    },
  })

  const transport = new Transport<ClientMessage, ServerMessage>({
    stream: { readable, writable },
  })

  try {
    server = createServer({
      transport: transport as ServerTransport,
      subscriptionHub,
      connectionID,
    })
  } catch {
    finish()
    return Promise.resolve(new Response('Server initialization failed', { status: 500 }))
  }

  if (requestID == null) {
    // An id-less frame -- unreachable for a real `subscriptions/listen` request, which always
    // carries an id, but handled the same way `runStatelessExchange` handles a notification for
    // consistency: acknowledged and discarded rather than left to hang.
    finish()
    return Promise.resolve(new Response(null, { status: 202 }))
  }

  signal?.addEventListener('abort', onAbort, { once: true })
  onStart?.(finish)

  controller.enqueue(message)

  return response
}
