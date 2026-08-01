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

  test('a 2026-07-28 cancellation is not sent at all', async () => {
    // `decorateRequest` runs on requests only, so a notification carries no protocol `_meta`
    // and therefore names no revision — neither in the body a stateless server routes on nor
    // in the header derived from it, which earns a `400` rather than a cancellation. The
    // client drops it instead: `2026-07-28`'s `clientNotifications` is empty, because a
    // cancellation cannot prove it owns the request ID it names once it travels as an exchange
    // of its own. The second request is the sentinel that makes the absence observable —
    // requests go out in order, so once it has been posted, a cancellation that was going to
    // be posted already would be.
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
    const methodsPosted = (): Array<string | undefined> =>
      (fetchMock.mock.calls as Array<Call>)
        .filter((call) => call[1].body != null)
        .map((call) => (JSON.parse(call[1].body as string) as { method?: string }).method)

    void client.request('prompts/list', {}).catch(() => {})
    await vi.waitFor(() => {
      expect(methodsPosted()).toContain('prompts/list')
    })
    expect(methodsPosted()).toEqual(['tools/list', 'prompts/list'])

    await client.dispose()
  })
})
