import { createRuntime } from '@sozai/runtime'
import { describe, expect, test, vi } from 'vitest'

import type { HTTPAuthOptions } from '../src/auth.js'
import { type FetchMiddleware, HTTPTransport } from '../src/transport.js'

const URL = 'https://mcp.example.com/mcp'

type Frame = { error?: { message?: string }; result?: unknown }

function ok(): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function setup(
  params: {
    auth?: HTTPAuthOptions
    headers?: Record<string, string>
    fetchMiddleware?: FetchMiddleware
    respond?: () => Response
  } = {},
) {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => (params.respond ?? ok)())
  const transport = new HTTPTransport({
    url: URL,
    auth: params.auth,
    headers: params.headers,
    fetchMiddleware: params.fetchMiddleware,
    runtime: createRuntime({ fetch: fetch as unknown as typeof globalThis.fetch }),
  })
  async function ping(): Promise<Frame> {
    await transport.write({ jsonrpc: '2.0', id: 1, method: 'ping' } as never)
    const { value } = await transport.read()
    return value as Frame
  }
  const redirectOf = (call = 0) => fetch.mock.calls[call]?.[1]?.redirect
  return { fetch, transport, ping, redirectOf }
}

describe('credential redirect safety', () => {
  test('credentialed request is sent with redirect manual', async () => {
    const { transport, ping, redirectOf } = setup({ auth: { type: 'bearer', token: 't' } })
    await ping()
    expect(redirectOf()).toBe('manual')
    await transport.dispose()
  })

  test('custom header counts as a credential', async () => {
    const { transport, ping, redirectOf } = setup({ headers: { 'X-API-Key': 'k' } })
    await ping()
    expect(redirectOf()).toBe('manual')
    await transport.dispose()
  })

  test('a redirect response fails the request', async () => {
    const { fetch, transport, ping } = setup({
      auth: { type: 'header', name: 'X-API-Key', value: 'k' },
      respond: () =>
        new Response(null, { status: 302, headers: { Location: 'https://evil.example/' } }),
    })
    const frame = await ping()
    expect(frame.error?.message).toBe(
      'Request failed: refused to follow a redirect with credentials (status 302)',
    )
    expect(fetch).toHaveBeenCalledOnce()
    await transport.dispose()
  })

  test('opaqueredirect fails the same way', async () => {
    const { transport, ping } = setup({
      auth: { type: 'bearer', token: 't' },
      respond: () =>
        ({
          type: 'opaqueredirect',
          status: 0,
          ok: false,
          headers: new Headers(),
          body: null,
        }) as unknown as Response,
    })
    const frame = await ping()
    expect(frame.error?.message).toBe(
      'Request failed: refused to follow a redirect with credentials (status 0)',
    )
    await transport.dispose()
  })

  test('uncredentialed request keeps the default', async () => {
    const { transport, ping, redirectOf } = setup()
    await ping()
    expect(redirectOf()).toBeUndefined()
    await transport.dispose()
  })

  test('OAuth bearer from the middleware counts', async () => {
    const { transport, ping, redirectOf } = setup({
      fetchMiddleware: (next) => (url, init) => {
        const headers = new Headers(init?.headers)
        headers.set('Authorization', 'Bearer from-middleware')
        return next(url, { ...init, headers })
      },
    })
    await ping()
    expect(redirectOf()).toBe('manual')
    await transport.dispose()
  })

  test('caller redirect error is kept', async () => {
    const { transport, ping, redirectOf } = setup({
      auth: { type: 'header', name: 'X-API-Key', value: 'k' },
      fetchMiddleware: (next) => (url, init) => next(url, { ...init, redirect: 'error' }),
    })
    await ping()
    expect(redirectOf()).toBe('error')
    await transport.dispose()
  })

  test('an explicit follow on a credentialed request is overridden', async () => {
    const { transport, ping, redirectOf } = setup({
      auth: { type: 'header', name: 'X-API-Key', value: 'k' },
      fetchMiddleware: (next) => (url, init) => next(url, { ...init, redirect: 'follow' }),
    })
    await ping()
    expect(redirectOf()).toBe('manual')
    await transport.dispose()
  })
})
