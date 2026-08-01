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

import { createSSEStream, SSE_RESPONSE_HEADERS } from './sse-stream.js'
import { SSEWriter } from './sse-writer.js'

/**
 * JSON-RPC error codes the specification maps to HTTP `400` on the Streamable HTTP
 * transport (specification/2026-07-28/basic/transports). A `2026-07-28` `'auto'` client
 * inspects the body of a `400` to tell a `2026-07-28` server from a `2025-11-25` one, so
 * these must arrive as a real `400` carrying the JSON-RPC error object — not tunnelled
 * inside a `200` SSE stream, which is where every other server-side error still goes.
 */
export const BAD_REQUEST_CODES: ReadonlySet<number> = new Set([
  INVALID_PARAMS,
  MISSING_REQUIRED_CLIENT_CAPABILITY,
  UNSUPPORTED_PROTOCOL_VERSION,
])

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
  /** `null` for a notification or a response, which expect no reply. */
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
  const { message, requestID, createServer, replayBufferSize, timeoutMs, signal } = params

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
    // otherwise hang until the timeout fires. A no-op once a response is already settled.
    settle(new Response(null, { status: 503 }))
  }

  function onAbort(): void {
    finish()
  }

  const writable = new WritableStream<ServerMessage>({
    async write(outgoing) {
      const record = outgoing as unknown as Record<string, unknown>
      const isOwnResponse = requestID != null && record.id === requestID && !('method' in record)

      // Held in a local: `sse` is a closure variable from an enclosing scope, which
      // TypeScript will not keep narrowed across the assignment below.
      let writer = sse
      if (writer == null) {
        if (isOwnResponse) {
          const code = (record.error as { code?: unknown } | undefined)?.code
          if (typeof code === 'number' && BAD_REQUEST_CODES.has(code)) {
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
        })
        sse = writer
        settle(new Response(stream.readable, { status: 200, headers: SSE_RESPONSE_HEADERS }))
        await writer.writePrimingEvent()
      }

      await writer.writeEvent({ data: JSON.stringify(outgoing) })
      if (isOwnResponse) {
        finish()
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
    // A notification or a response on a sessionless POST. It is acknowledged but never
    // dispatched: the server that would receive it exists for this POST alone and is
    // discarded with it, so no state it could mutate outlives the exchange, and with no
    // request in flight there is nothing for it to correlate against either.
    finish()
    return Promise.resolve(new Response(null, { status: 202 }))
  }

  signal?.addEventListener('abort', onAbort, { once: true })

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
