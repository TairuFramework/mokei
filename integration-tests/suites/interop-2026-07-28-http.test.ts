/**
 * mokei client ↔ mokei server on `2026-07-28`, over Streamable HTTP.
 *
 * Not an SDK interop suite, deliberately: SDK `2.0.0`'s `LATEST_PROTOCOL_VERSION` is
 * `2025-11-25` and every `2026-07-28` string in its distribution is JSDoc, so there is no
 * peer to test against on this revision. The `2025-11-25` HTTP combinations in
 * `interop-sdk-client.test.ts` and `interop-sdk-server.test.ts` remain the SDK evidence.
 */
import type { ContextClient } from '@mokei/context-client'
import { META_CLIENT_CAPABILITIES, META_PROTOCOL_VERSION } from '@mokei/context-protocol'
import { afterEach, describe, expect, test } from 'vitest'

import { checkMokeiClient } from '../support/interop/expectations.ts'
import {
  type BlockingHTTPServer,
  connectMokeiHTTPClient,
  type RunningHTTPServer,
  startBlockingHTTPServer,
  startMokeiHTTPServer,
} from '../support/interop/servers.ts'

describe('mokei over Streamable HTTP on 2026-07-28', () => {
  let server: RunningHTTPServer | null = null
  let client: ContextClient | null = null

  afterEach(async () => {
    await client?.dispose()
    client = null
    await server?.dispose()
    server = null
  })

  test('serves the shared fixture surface', async () => {
    server = await startMokeiHTTPServer(['2026-07-28'])
    client = connectMokeiHTTPClient(server.url, '2026-07-28')
    // `2026-07-28` has no handshake, so `checkMokeiClient` skips its `initialize()` block and
    // this suite asserts `discover()` separately below.
    await checkMokeiClient(client, { protocolVersion: '2026-07-28' })
  })

  test('answers server/discover', async () => {
    server = await startMokeiHTTPServer(['2026-07-28'])
    client = connectMokeiHTTPClient(server.url, '2026-07-28')

    const discovered = await client.discover()
    expect(discovered.resultType).toBe('complete')
    expect(discovered.supportedVersions).toEqual(['2026-07-28'])
    expect(discovered.capabilities.tools).toBeDefined()
  })

  test('carries the required result envelope and caching hints', async () => {
    server = await startMokeiHTTPServer(['2026-07-28'])
    client = connectMokeiHTTPClient(server.url, '2026-07-28')

    const listed = (await client.listTools()) as unknown as Record<string, unknown>
    expect(listed.resultType).toBe('complete')
    expect(listed.ttlMs).toBe(0)
    expect(listed.cacheScope).toBe('private')
  })

  test('never mints a session', async () => {
    server = await startMokeiHTTPServer(['2026-07-28'])
    const responses: Array<Response> = []
    const original = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await original(input, init)
      responses.push(response)
      return response
    }) as typeof globalThis.fetch
    try {
      client = connectMokeiHTTPClient(server.url, '2026-07-28')
      await client.listTools()
    } finally {
      globalThis.fetch = original
    }
    expect(responses.length).toBeGreaterThan(0)
    for (const response of responses) {
      expect(response.headers.get('Mcp-Session-Id')).toBeNull()
    }
  })

  test('tears the exchange down when the caller hangs up', async () => {
    // Hanging up is a stateless exchange's only cancellation channel, and the whole chain that
    // carries it — `@hono/node-server` closing the socket, `serveHTTP` passing `ctx.req.raw`
    // through, `runStatelessExchange` listening on `request.signal` — has no other coverage.
    // Driven with a raw `fetch` rather than a `ContextClient` so the abort is a genuine client
    // disconnect and nothing else is sent on the way out.
    //
    // What is observed is the throwaway `ContextServer` being disposed. The in-flight tool
    // handler's own `signal` is *not* aborted by that disposal, so a handler that ignores its
    // signal keeps running until it returns; releasing it is what `dispose()` below is for.
    let blocking: BlockingHTTPServer | null = null
    try {
      blocking = await startBlockingHTTPServer()
      const controller = new AbortController()
      const pending = fetch(blocking.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: blocking.toolName,
            arguments: {},
            _meta: {
              [META_PROTOCOL_VERSION]: '2026-07-28',
              [META_CLIENT_CAPABILITIES]: {},
            },
          },
        }),
        signal: controller.signal,
      })
      // The abort below rejects it; without a handler that becomes an unhandled rejection.
      pending.catch(() => {})

      await blocking.toolCalled
      controller.abort()

      // Well inside `DEFAULT_STATELESS_TIMEOUT_MS` (30s), so a pass cannot come from the
      // exchange's own timeout firing.
      const outcome = await Promise.race([
        blocking.serverDisposed.then(() => 'disposed'),
        new Promise((resolve) => setTimeout(() => resolve('still running'), 3000)),
      ])
      expect(outcome).toBe('disposed')
    } finally {
      await blocking?.dispose()
    }
  })
})
