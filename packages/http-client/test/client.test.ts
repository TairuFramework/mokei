import { ContextClient } from '@mokei/context-client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { createHTTPClient } from '../src/index.js'

const TEST_URL = 'http://localhost:3000/mcp'

const DISCOVER_RESULT = {
  resultType: 'complete',
  supportedVersions: ['2026-07-28'],
  capabilities: { tools: {} },
  ttlMs: 0,
  cacheScope: 'private',
}

type PostedMessage = { id?: number; method?: string }

/**
 * A `fetch` implementation that answers setup's `server/discover` with a real result and hands
 * every other POST to `otherwise`, which receives the parsed request body so it can echo the id.
 *
 * A client on a revision with no handshake opens with one bounded `server/discover` — its
 * liveness check, standing in for the handshake — so a mock that leaves it unanswered stalls
 * setup and nothing the test is actually about ever reaches the wire.
 */
function answerDiscover(
  otherwise: (message: PostedMessage) => Response,
): (url: string, init: { body?: string }) => Response {
  return (_url, init) => {
    const message: PostedMessage = init.body == null ? {} : JSON.parse(init.body)
    if (message.method !== 'server/discover') {
      return otherwise(message)
    }
    return new Response(
      JSON.stringify({ jsonrpc: '2.0', id: message.id, result: DISCOVER_RESULT }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }
}

describe('createHTTPClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('returns a ContextClient instance', () => {
    const client = createHTTPClient({ url: TEST_URL, protocolVersion: '2025-11-25' })
    expect(client).toBeInstanceOf(ContextClient)
  })

  // The capability `protocolVersionHeader` restores: previously it collided with
  // `protocolVersion` in the intersected params type and was stripped before reaching
  // `HTTPTransport`, so the seed never reached the wire through this entry point.
  test('forwards protocolVersionHeader to the transport, seeding the initialize request', async () => {
    fetchMock.mockImplementation((_url: string, init: { body?: string }) => {
      const message: PostedMessage = init.body == null ? {} : JSON.parse(init.body)
      if (message.method === 'notifications/initialized') {
        return new Response(null, { status: 202 })
      }
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            serverInfo: { name: 'test-server', version: '1.0' },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    })

    const client = createHTTPClient({
      url: TEST_URL,
      protocolVersion: '2025-11-25',
      protocolVersionHeader: '2024-11-05',
    })
    await client.initialize()

    const [, options] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }]
    expect(options.headers['MCP-Protocol-Version']).toBe('2024-11-05')

    await client.dispose()
  })

  test('speaks the revision it is given rather than a fixed one', async () => {
    // The `tools/list` POST is answered with 202 so nothing is enqueued and the request stays
    // open; only the outgoing frame is under test here.
    fetchMock.mockImplementation(answerDiscover(() => new Response(null, { status: 202 })))

    const client = createHTTPClient({ url: TEST_URL, protocolVersion: '2026-07-28' })
    void client.request('tools/list', {}).catch(() => {})
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(1)
    })

    for (const [, options] of fetchMock.mock.calls as Array<
      [string, { headers: Record<string, string> }]
    >) {
      expect(options.headers['MCP-Protocol-Version']).toBe('2026-07-28')
    }

    await client.dispose()
  })

  test('a 400 carrying a malformed error frame still settles the caller', async () => {
    // End-to-end counterpart to the transport-level fallback tests. The RPC layer drops an
    // inbound response its validator rejects and nothing times an ordinary request out, so a
    // frame passed through too permissively strands this `await` forever rather than failing
    // it. The body below is a plausible error frame missing only `error.message`.
    fetchMock.mockImplementation(
      answerDiscover(
        (message) =>
          new Response(
            JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32022 } }),
            {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
      ),
    )

    const client = createHTTPClient({ url: TEST_URL, protocolVersion: '2026-07-28' })
    await expect(client.request('tools/list', {})).rejects.toThrow(/HTTP 400/)

    await client.dispose()
  })

  // The mirror image of the test above, and the case the wire schema was widened for: a peer is
  // free to put any JSON value in `error.data`, and this one is what an SDK server answers an
  // unsupported revision with. Too strict anywhere along the path and the frame is dropped
  // rather than rejected, leaving this `await` hanging with nothing to time it out.
  test.each([
    ['a string', 'only 2025-11-25'],
    ['null', null],
    ['an array', ['2025-11-25']],
  ])('a 400 whose error.data is %s rejects the caller with the server error', async (_l, data) => {
    fetchMock.mockImplementation(
      answerDiscover(
        (message) =>
          new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: message.id,
              error: { code: -32022, message: 'Unsupported protocol version', data },
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    )

    const client = createHTTPClient({ url: TEST_URL, protocolVersion: '2026-07-28' })
    // The server's own message, not the synthesized `HTTP 400:` fallback — the code and `data`
    // an `'auto'` client reads survive the trip.
    await expect(client.request('tools/list', {})).rejects.toThrow('Unsupported protocol version')

    await client.dispose()
  })

  test('a 2026-07-28 cancellation is sent carrying its protocol version', async () => {
    // The POST that carries a cancellation has no session to be placed by, so the only thing
    // that tells a stateless server which revision it belongs to is the version in its own
    // `_meta` — the same key the routing gate reads off a request. Without it the POST is
    // answered `400` instead of being routed; with it the server acknowledges it `202`.
    // Asserting the key here, rather than only that the POST happened, is the point: the send
    // existing proves nothing if it cannot be placed.
    fetchMock.mockImplementation(answerDiscover(() => new Response(null, { status: 202 })))

    const client = createHTTPClient({ url: TEST_URL, protocolVersion: '2026-07-28' })
    const controller = new AbortController()
    const pending = client.request('tools/list', {}, { signal: controller.signal })
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })
    controller.abort()
    await expect(pending).rejects.toThrow()

    type Call = [string, { headers: Record<string, string>; body?: string }]
    const findCancelled = (): Call | undefined =>
      (fetchMock.mock.calls as Array<Call>).find((call) => {
        const body = call[1].body
        return (
          body != null &&
          (JSON.parse(body) as { method?: string }).method === 'notifications/cancelled'
        )
      })

    await vi.waitFor(() => {
      expect(findCancelled()).toBeDefined()
    })
    const call = findCancelled() as Call
    const body = JSON.parse(call[1].body as string) as { params?: Record<string, unknown> }
    const meta = body.params?._meta as Record<string, unknown> | undefined
    expect(meta?.['io.modelcontextprotocol/protocolVersion']).toBe('2026-07-28')
    // The request envelope stays off it — only what the routing gate needs is stamped.
    expect(meta).not.toHaveProperty('io.modelcontextprotocol/clientCapabilities')
    // The header is derived from that same key, so it now agrees rather than being absent.
    expect(call[1].headers['MCP-Protocol-Version']).toBe('2026-07-28')

    await client.dispose()
  })
})
