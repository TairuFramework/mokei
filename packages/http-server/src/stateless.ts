import { Transport } from '@enkaku/transport'
import {
  type ClientMessage,
  INVALID_PARAMS,
  META_PROTOCOL_VERSION,
  MISSING_REQUIRED_CLIENT_CAPABILITY,
  type ServerMessage,
  UNSUPPORTED_PROTOCOL_VERSION,
} from '@mokei/context-protocol'
import type { ContextServer, ServerTransport } from '@mokei/context-server'
import { getMokeiLogger, type Logger } from '@mokei/logger'

import { createSSEStream, SSE_RESPONSE_HEADERS } from './sse-stream.js'
import { SSEWriter } from './sse-writer.js'

/**
 * JSON-RPC error codes the specification maps to HTTP `400` on the Streamable HTTP
 * transport (specification/2026-07-28/basic/transports). A `2026-07-28` `'auto'` client
 * inspects the body of a `400` to tell a `2026-07-28` server from a `2025-11-25` one, so
 * these must arrive as a real `400` carrying the JSON-RPC error object — not tunnelled
 * inside a `200` SSE stream, which is where every other server-side error still goes.
 *
 * Not the whole rule: `isEnvelopeFailure` is the predicate the transport actually applies,
 * and it recognises one condition this set deliberately cannot express — see there. In
 * practice that condition is the one `ContextServer` raises, so nothing currently reaching a
 * client is classified by this set alone.
 */
export const BAD_REQUEST_CODES: ReadonlySet<number> = new Set([
  MISSING_REQUIRED_CLIENT_CAPABILITY,
  UNSUPPORTED_PROTOCOL_VERSION,
])

/**
 * `INVALID_PARAMS` is deliberately not in {@link BAD_REQUEST_CODES}: `ContextServer` raises
 * it both for an envelope violation (a missing required `_meta` key — an HTTP `400`) and for
 * an ordinary application error (an unknown tool name, invalid tool arguments — an HTTP
 * `200` carrying a JSON-RPC error, same as every other revision). Only the first is a
 * transport-level failure, and the two are told apart by the message the server's protocol
 * resolution itself writes, which always reports the `_meta` key it could not find.
 *
 * Matched as a prefix, not a substring: a tool or prompt *name* reaches the message of an
 * application error verbatim (`Tool <name> not found`), so a client could otherwise pick its
 * own HTTP status by naming a tool `io.modelcontextprotocol/…`. Only the leading `Missing "`
 * is beyond a caller's reach.
 */
function isEnvelopeFailure(error: { code?: unknown; message?: unknown }): boolean {
  if (error.code === INVALID_PARAMS) {
    return (
      typeof error.message === 'string' &&
      error.message.startsWith('Missing "io.modelcontextprotocol/')
    )
  }
  return typeof error.code === 'number' && BAD_REQUEST_CODES.has(error.code)
}

/** How long a stateless exchange waits for its server to write anything at all. */
export const DEFAULT_STATELESS_TIMEOUT_MS = 30_000

/**
 * Reads the revision a request declares in its own `_meta`. This — not the
 * `MCP-Protocol-Version` header — is what selects the stateless path, because it is what
 * `ContextServer` itself resolves the revision from, so the transport and the server can
 * never disagree about which revision a message belongs to.
 */
export function readRequestProtocolVersion(body: Record<string, unknown>): string | null {
  const params = body.params
  if (params == null || typeof params !== 'object') {
    return null
  }
  const meta = (params as Record<string, unknown>)._meta
  if (meta == null || typeof meta !== 'object') {
    return null
  }
  const version = (meta as Record<string, unknown>)[META_PROTOCOL_VERSION]
  return typeof version === 'string' ? version : null
}

export type StatelessExchangeParams = {
  message: ClientMessage
  /**
   * The `id` of the frame being exchanged, or `null` when it carries none — a notification.
   *
   * Read off `body.id`, so it says nothing about the frame's *kind*: a JSON-RPC response also
   * carries an id and would be treated as a request here. Unreachable rather than handled — the
   * handler routes a POST here only on a `params._meta` protocol version, and a response has no
   * `params` — but it is the id, not the kind, that this field reports.
   */
  requestID: string | number | null
  createServer: (transport: ServerTransport) => ContextServer
  replayBufferSize: number
  timeoutMs: number
  /**
   * The incoming request's abort signal, honoured as the exchange's cancellation channel.
   * A stateless exchange has no session, so a `notifications/cancelled` arriving on a
   * separate POST cannot prove it owns the request it names: JSON-RPC request ids are
   * per-client, not global, and two concurrent callers routinely both use `1`. The client
   * hanging up is the only cancellation signal this transport genuinely provides.
   */
  signal?: AbortSignal
  /**
   * Called with this exchange's teardown function once it is running, and again with the
   * same function when it ends, so the handler can track what is in flight and end it on
   * shutdown. The handle is deliberately opaque and unkeyed: nothing a client sends can
   * name it, so it cannot become a channel for cancelling somebody else's exchange.
   */
  onStart?: (teardown: () => void) => void
  onEnd?: (teardown: () => void) => void
  /** Optional logger (defaults to the `mokei:http-server` logger) */
  logger?: Logger
}

/**
 * Runs one `2026-07-28` request against a throwaway `ContextServer` and returns its HTTP
 * response.
 *
 * The response shape is decided by the *first* thing the server writes, not by waiting for
 * the whole exchange: every `400`-worthy condition (missing `_meta`, unsupported revision,
 * undeclared capability) is raised by `ContextServer` before any handler runs, so it is
 * always the first write. Anything else opens the SSE stream immediately, which is what
 * keeps request-scoped progress and log notifications streaming during a long tool call
 * instead of being buffered until it finishes.
 */
export function runStatelessExchange(params: StatelessExchangeParams): Promise<Response> {
  const {
    message,
    requestID,
    createServer,
    replayBufferSize,
    timeoutMs,
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
  let timer: ReturnType<typeof setTimeout> | null = null

  let resolveResponse!: (response: Response) => void
  const response = new Promise<Response>((resolve) => {
    resolveResponse = resolve
  })

  function settle(value: Response): void {
    if (settled) {
      return
    }
    settled = true
    if (timer != null) {
      clearTimeout(timer)
      timer = null
    }
    resolveResponse(value)
  }

  function finish(): void {
    if (finished) {
      return
    }
    finished = true
    if (timer != null) {
      clearTimeout(timer)
      timer = null
    }
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
    // Settle unconditionally. When the exchange ends before the server has written anything
    // — the client hung up, or the handler was disposed — whoever awaits this promise would
    // otherwise hang until the timeout fires. A no-op once a response is already settled,
    // which is every path that produced a real answer: `200` once the SSE stream opened,
    // `400` for a bad request, `504` on timeout. So `503` is only ever seen by a caller
    // whose exchange ended with nothing written, and in both of those cases — disconnect
    // and shutdown — there is no client left to read it.
    settle(new Response(null, { status: 503 }))
    onEnd?.(finish)
  }

  function onAbort(): void {
    finish()
  }

  const writable = new WritableStream<ServerMessage>({
    async write(outgoing) {
      // Every path out of this sink has to reach `finish()`, including the throwing ones.
      // `settle()` clears the timeout, so once the SSE stream is open nothing else will ever
      // end this exchange: an unserializable payload (a `BigInt` in a tool result is enough),
      // or a faulted SSE writer, would leave its throwaway `ContextServer` undisposed and its
      // teardown registered forever. That used to be stale bookkeeping; with the concurrency
      // cap it is a permanently held slot, and enough of them refuse every later request.
      //
      // The error is rethrown unchanged: a rejected sink write is what the writer already sees
      // today, and only the cleanup is new.
      try {
        const record = outgoing as unknown as Record<string, unknown>
        const isOwnResponse = requestID != null && record.id === requestID && !('method' in record)

        // Held in a local: `sse` is a closure variable from an enclosing scope, which
        // TypeScript will not keep narrowed across the assignment below.
        let writer = sse
        if (writer == null) {
          if (finished) {
            // The exchange already tore down — the client hung up, the handler was
            // disposed, or the timeout fired — and whoever was waiting on `response` has
            // already gotten an answer. Building a fresh SSE stream here would create one
            // nobody will ever read.
            return
          }
          if (isOwnResponse) {
            const error = record.error as { code?: unknown; message?: unknown } | undefined
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
          // `replayBufferSize` is passed through rather than zeroed: `SSEWriter`'s ring
          // buffer indexes modulo its size, so 0 would produce a NaN index. Nothing replays
          // a stateless exchange — the buffer is simply unused.
          writer = new SSEWriter({
            writable: stream.writable,
            streamID: `stateless-${requestID ?? 'notification'}`,
            replayBufferSize,
            logger,
          })
          sse = writer
          settle(new Response(stream.readable, { status: 200, headers: SSE_RESPONSE_HEADERS }))
          await writer.writePrimingEvent()
        }

        await writer.writeEvent({ data: JSON.stringify(outgoing) })
        if (isOwnResponse) {
          finish()
        }
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
    server = createServer(transport as ServerTransport)
  } catch {
    finish()
    return Promise.resolve(new Response('Server initialization failed', { status: 500 }))
  }

  if (requestID == null) {
    // An id-less frame on a sessionless POST — in practice a notification. It is acknowledged
    // but never dispatched: the server that would receive it exists for this POST alone and is
    // discarded with it, so no state it could mutate outlives the exchange, and with no
    // request in flight there is nothing for it to correlate against either.
    finish()
    return Promise.resolve(new Response(null, { status: 202 }))
  }

  signal?.addEventListener('abort', onAbort, { once: true })
  onStart?.(finish)

  timer = setTimeout(() => {
    settle(new Response('Request timed out', { status: 504 }))
    finish()
  }, timeoutMs)
  // A pending exchange must not hold the process open.
  if (typeof timer === 'object' && 'unref' in timer) {
    timer.unref()
  }

  controller.enqueue(message)

  return response
}
