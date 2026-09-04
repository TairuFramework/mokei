import { afterEach, describe, expect, test, vi } from 'vitest'

import { type FetchMiddleware, HTTPTransport } from '../src/transport.js'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('fetchMiddleware', () => {
  afterEach(() => vi.unstubAllGlobals())

  test('routes POST sends through the supplied middleware', async () => {
    const seen: Array<string> = []
    const middleware: FetchMiddleware = (next) => async (url, init) => {
      seen.push(String((JSON.parse(String(init?.body)) as { method?: string }).method))
      return next(url, init)
    }
    const global = vi.fn(async () => jsonResponse({ jsonrpc: '2.0', id: 0, result: {} }))
    vi.stubGlobal('fetch', global)

    const transport = new HTTPTransport({
      url: 'https://example.test/mcp',
      fetchMiddleware: middleware,
    })
    await transport.write({ jsonrpc: '2.0', id: 0, method: 'ping' } as never)

    expect(seen).toContain('ping')
    expect(global).toHaveBeenCalledOnce()
    await transport.dispose()
  })

  test('throws when static auth and an Authorization-setting middleware both given', () => {
    const middleware: FetchMiddleware = (next) => next
    expect(
      () =>
        new HTTPTransport({
          url: 'https://example.test/mcp',
          auth: { type: 'bearer', token: 'x' },
          fetchMiddleware: middleware,
        }),
    ).toThrow(/mutually exclusive|both/i)
  })
})
