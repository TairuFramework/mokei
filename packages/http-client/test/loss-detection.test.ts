import { transportFailureOf } from '@mokei/context-client'
import { createRuntime } from '@sozai/runtime'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { AuthRequiredError } from '../src/errors.js'
import { type FetchLike, type FetchMiddleware, HTTPTransport } from '../src/transport.js'

const URL_MCP = 'https://example.test/mcp'

type Connection =
  | { type: 'failed'; error: { name: string; url: string } }
  | { type: 'session-expired' }
type Frame = { id?: unknown; error?: { code: number; message: string; data?: unknown } }

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

const ok = (id: number) => json({ jsonrpc: '2.0', id, result: {} })

function setup(
  fetch: (url: string, init?: RequestInit) => Promise<Response>,
  extra: { timeout?: number; fetchMiddleware?: FetchMiddleware } = {},
) {
  const transport = new HTTPTransport({
    url: URL_MCP,
    runtime: createRuntime({ fetch: fetch as typeof globalThis.fetch }),
    ...extra,
  })
  const events: Array<Connection> = []
  transport.connectionEvents.on('connection', (event) => {
    events.push(event as Connection)
  })
  const send = (id: number, method = 'tools/list') =>
    transport.write({ jsonrpc: '2.0', id, method } as never)
  const frame = async () => (await transport.read()).value as Frame
  return { transport, events, send, frame }
}

const reject = () => Promise.reject(new TypeError('fetch failed'))

describe('connection loss detection', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test('a network failure on the MCP URL brands the frame and emits failed', async () => {
    const { transport, events, send, frame } = setup(reject)
    await send(1)
    const value = await frame()
    expect(transportFailureOf(value.error)).toEqual({ kind: 'network' })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'failed',
      error: { name: 'NetworkError', url: URL_MCP },
    })
    await transport.dispose()
  })

  test('an OAuth subrequest failure is not loss', async () => {
    const middleware: FetchMiddleware = (next) => async (url, init) => {
      await next('https://as.example/token')
      return next(url, init)
    }
    const { transport, events, send, frame } = setup(reject, { fetchMiddleware: middleware })
    await send(1)
    const value = await frame()
    expect(transportFailureOf(value.error)).toBeUndefined()
    expect(events).toEqual([])
    await transport.dispose()
  })

  test('a middleware throw is not loss', async () => {
    const middleware: FetchMiddleware = () => async () => {
      throw new Error('store broken')
    }
    const { transport, events, send, frame } = setup(reject, { fetchMiddleware: middleware })
    await send(1)
    const value = await frame()
    expect(transportFailureOf(value.error)).toBeUndefined()
    expect(events).toEqual([])
    await transport.dispose()
  })

  test('an AuthRequiredError from a middleware brands auth-required without an event', async () => {
    const middleware: FetchMiddleware = () => async () => {
      throw new AuthRequiredError('sign in needed')
    }
    const { transport, events, send, frame } = setup(reject, { fetchMiddleware: middleware })
    await send(1)
    const value = await frame()
    expect(transportFailureOf(value.error)).toEqual({ kind: 'auth-required' })
    expect(events).toEqual([])
    await transport.dispose()
  })

  describe('caller abort, timeout and dispose are not loss', () => {
    const hang = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, rejectFn) => {
        init?.signal?.addEventListener('abort', () =>
          rejectFn(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        )
      })

    test('abort', async () => {
      // write() serializes sends, so a cancellation cannot overtake a pending POST. The abort is
      // driven where a caller's signal really reaches the raw fetch: a middleware that swaps in
      // its own controller and aborts it while the request is pending.
      const callerAbort = new AbortController()
      const middleware: FetchMiddleware = (next) => (url, init) => {
        setTimeout(() => callerAbort.abort(), 5)
        return next(url, { ...init, signal: callerAbort.signal })
      }
      const { transport, events, send, frame } = setup(hang, { fetchMiddleware: middleware })
      await send(1)
      const value = await frame()
      expect(callerAbort.signal.aborted).toBe(true)
      expect(transportFailureOf(value.error)).toBeUndefined()
      expect(events).toEqual([])
      await transport.dispose()
    })

    test('timeout', async () => {
      const { transport, events, send, frame } = setup(hang, { timeout: 20 })
      await send(1)
      const value = await frame()
      expect(transportFailureOf(value.error)).toEqual({ kind: 'timeout' })
      expect(events).toEqual([])
      await transport.dispose()
    })

    test('dispose mid-request', async () => {
      const { transport, events, send } = setup(hang)
      const pending = send(1)
      await Promise.resolve()
      await transport.dispose()
      await pending
      expect(events).toEqual([])
    })
  })

  test('5xx is http, not loss', async () => {
    const { transport, events, send, frame } = setup(
      async () => new Response('down', { status: 503 }),
    )
    await send(1)
    const value = await frame()
    expect(transportFailureOf(value.error)).toEqual({ kind: 'http', status: 503 })
    expect(events).toEqual([])
    await transport.dispose()
  })

  test('session 404 brands session-expired and emits', async () => {
    let calls = 0
    const { transport, events, send, frame } = setup(async () => {
      calls += 1
      return calls === 1
        ? json({ jsonrpc: '2.0', id: 1, result: {} }, 200, { 'Mcp-Session-Id': 'abc' })
        : new Response('gone', { status: 404 })
    })
    await send(1)
    await frame()
    await send(2)
    const value = await frame()
    expect(transportFailureOf(value.error)).toEqual({ kind: 'session-expired' })
    expect(events).toEqual([{ type: 'session-expired' }])
    await transport.dispose()
  })

  test('server-sent data never reads as a transport failure', async () => {
    const { transport, events, send, frame } = setup(async () =>
      json(
        {
          jsonrpc: '2.0',
          id: 1,
          error: {
            code: -32000,
            message: 'x',
            data: { 'dev.mokei/transport': { kind: 'network' } },
          },
        },
        400,
      ),
    )
    await send(1)
    const value = await frame()
    expect(transportFailureOf(value.error)).toBeUndefined()
    expect(events).toEqual([])
    await transport.dispose()
  })

  test('listen reports after two consecutive network failures', async () => {
    let mode: 'fail' | 'ok' = 'fail'
    const { transport, events, send, frame } = setup(async () =>
      mode === 'fail' ? reject() : ok(0),
    )
    await send(1, 'subscriptions/listen')
    await frame()
    expect(events).toEqual([])
    await send(2, 'subscriptions/listen')
    await frame()
    expect(events).toHaveLength(1)

    // A success between failures resets the count.
    const second = setup(async () => (mode === 'fail' ? reject() : ok(3)))
    await second.send(1, 'subscriptions/listen')
    await second.frame()
    mode = 'ok'
    await second.send(2, 'subscriptions/listen')
    await second.frame()
    mode = 'fail'
    await second.send(3, 'subscriptions/listen')
    await second.frame()
    expect(second.events).toEqual([])
    await second.transport.dispose()

    // Any other method reports on the first failure.
    const other = setup(reject)
    await other.send(1, 'tools/list')
    await other.frame()
    expect(other.events).toHaveLength(1)
    await other.transport.dispose()
    await transport.dispose()
  })

  describe('GET stream', () => {
    function stream(get: FetchLike) {
      const fetch: FetchLike = async (url, init) => {
        if (init?.method === 'GET') return get(url, init)
        return new Response(null, { status: 202, headers: { 'Mcp-Session-Id': 'sess' } })
      }
      return setup(fetch as never)
    }

    test('reports after two consecutive network failures', async () => {
      vi.useFakeTimers()
      const get = vi.fn<FetchLike>(reject)
      const { transport, events } = stream(get)
      await transport.write({ jsonrpc: '2.0', method: 'notifications/initialized' } as never)
      await vi.advanceTimersByTimeAsync(0)
      expect(get).toHaveBeenCalledTimes(1)
      expect(events).toEqual([])
      await vi.advanceTimersByTimeAsync(1_100)
      expect(get).toHaveBeenCalledTimes(2)
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({ type: 'failed' })
      await transport.dispose()
    })

    test('405 emits nothing', async () => {
      vi.useFakeTimers()
      const get = vi.fn<FetchLike>(async () => new Response('', { status: 405 }))
      const { transport, events } = stream(get)
      await transport.write({ jsonrpc: '2.0', method: 'notifications/initialized' } as never)
      await vi.advanceTimersByTimeAsync(5_000)
      expect(get).toHaveBeenCalledTimes(1)
      expect(events).toEqual([])
      await transport.dispose()
    })

    test('404 on a live session reports session-expired', async () => {
      vi.useFakeTimers()
      const get = vi.fn<FetchLike>(async () => new Response('', { status: 404 }))
      const { transport, events } = stream(get)
      await transport.write({ jsonrpc: '2.0', method: 'notifications/initialized' } as never)
      await vi.advanceTimersByTimeAsync(0)
      expect(events).toEqual([{ type: 'session-expired' }])
      await transport.dispose()
    })
  })
})
