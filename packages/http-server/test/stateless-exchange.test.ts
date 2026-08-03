import type { ClientMessage, ServerMessage } from '@mokei/context-protocol'
import type { ContextServer, ServerTransport } from '@mokei/context-server'
import { describe, expect, test, vi } from 'vitest'

const createSSEStreamSpy = vi.fn()

vi.mock('../src/sse-stream.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/sse-stream.js')>()
  return {
    ...actual,
    createSSEStream: (...args: Parameters<typeof actual.createSSEStream>) => {
      createSSEStreamSpy(...args)
      return actual.createSSEStream(...args)
    },
  }
})

// Imported from the package's public entry point rather than `../src/stateless.js`
// directly: `runStatelessExchange` used to be un-exported there while its own params
// type was, so this import also stands in as the regression test for that mismatch.
const { runStatelessExchange } = await import('../src/index.js')

describe('runStatelessExchange', () => {
  // The bug: a write arriving after the exchange has already torn down (client hung up,
  // handler disposed, or the timeout fired) used to fall into the same `writer == null`
  // branch as a first-ever write, building a brand new SSE stream that nobody — the
  // caller already got its 503 — will ever read. Guarded by checking `finished` before
  // building anything.
  test('a write arriving after teardown does not build an orphan SSE stream', async () => {
    let transport: ServerTransport | undefined
    // `dispose` is the only member `runStatelessExchange` calls on the server it is
    // given; `ContextServer` has private fields so it cannot be satisfied structurally,
    // hence the cast.
    const fakeServer = { dispose: () => Promise.resolve() } as unknown as ContextServer

    const message = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    } as unknown as ClientMessage

    const abort = new AbortController()

    const responsePromise = runStatelessExchange({
      message,
      requestID: 1,
      createServer: (t) => {
        transport = t
        return fakeServer
      },
      replayBufferSize: 4,
      timeoutMs: 1000,
      signal: abort.signal,
    })

    // Everything up to the abort listener registration runs synchronously inside
    // `runStatelessExchange`, so `transport` is already assigned here.
    expect(transport).toBeDefined()
    abort.abort()

    const response = await responsePromise
    expect(response.status).toBe(503)
    expect(createSSEStreamSpy).not.toHaveBeenCalled()

    // The throwaway server writes its (late) result straight onto the transport, well
    // after teardown.
    await transport?.write({
      jsonrpc: '2.0',
      id: 1,
      result: { resultType: 'complete', tools: [] },
    } as unknown as ServerMessage)

    expect(createSSEStreamSpy).not.toHaveBeenCalled()
  })
})
