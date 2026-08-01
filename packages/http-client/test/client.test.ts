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

  test('a 2026-07-28 cancellation is still sent, undecorated', async () => {
    // Pins current behaviour, not desired behaviour. `decorateRequest` runs on requests only,
    // so a notification carries no protocol `_meta` and therefore no revision at all — neither
    // in the body a stateless server routes on nor in the derived header. A server answers
    // such a POST with `400`. Nothing here should be read as an endorsement: the assertions
    // exist so that suppressing these sends is a visible change to this file rather than a
    // silent one.
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
    expect(body.params?._meta).toBeUndefined()
    expect(call[1].headers['MCP-Protocol-Version']).toBeUndefined()

    await client.dispose()
  })
})
