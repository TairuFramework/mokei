import { ContextClient } from '@mokei/context-client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { createHTTPClient } from '../src/index.js'

const TEST_URL = 'http://localhost:3000/mcp'

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

  test('speaks the revision it is given rather than a fixed one', async () => {
    // The POST is answered with 202 so nothing is enqueued and the request stays open;
    // only the outgoing frame is under test here.
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }))

    const client = createHTTPClient({ url: TEST_URL, protocolVersion: '2026-07-28' })
    void client.request('tools/list', {}).catch(() => {})
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })

    const [, options] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }]
    expect(options.headers['MCP-Protocol-Version']).toBe('2026-07-28')

    await client.dispose()
  })

  test('a 400 carrying a malformed error frame still settles the caller', async () => {
    // End-to-end counterpart to the transport-level fallback tests. The RPC layer drops an
    // inbound response its validator rejects and nothing times an ordinary request out, so a
    // frame passed through too permissively strands this `await` forever rather than failing
    // it. The body below is a plausible error frame missing only `error.message`.
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 0, error: { code: -32022 } }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const client = createHTTPClient({ url: TEST_URL, protocolVersion: '2026-07-28' })
    await expect(client.request('tools/list', {})).rejects.toThrow(/HTTP 400/)

    await client.dispose()
  })

  test('a 2026-07-28 cancellation is sent carrying its protocol version', async () => {
    // The POST that carries a cancellation has no session to be placed by, so the only thing
    // that tells a stateless server which revision it belongs to is the version in its own
    // `_meta` — the same key the routing gate reads off a request. Without it the POST is
    // answered `400` instead of being routed; with it the server acknowledges it `202`.
    // Asserting the key here, rather than only that the POST happened, is the point: the send
    // existing proves nothing if it cannot be placed.
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }))

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
