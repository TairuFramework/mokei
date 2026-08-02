/**
 * `2026-07-28` over Streamable HTTP, against both peers: mokei's own server, and the official
 * SDK.
 *
 * SDK `2.0.0`'s `LATEST_PROTOCOL_VERSION` is `2025-11-25`, but that constant only names the
 * revision its *handshake* negotiates. `2026-07-28` needs no handshake, and the SDK serves it
 * from a separate entry — `createMcpHandler`, a public export backed by runtime code
 * (`SUPPORTED_MODERN_PROTOCOL_VERSIONS`, a wire codec for the revision, envelope-meta
 * validation and a `server/discover` handler), not by documentation. So a real cross-stack peer
 * does exist on this revision, and the second block below is genuine conformance evidence
 * rather than mokei confirming its own behaviour.
 */
import type { ContextClient } from '@mokei/context-client'
import { META_CLIENT_CAPABILITIES, META_PROTOCOL_VERSION } from '@mokei/context-protocol'
import { afterEach, describe, expect, test } from 'vitest'

import { checkMokeiClient } from '../support/interop/expectations.ts'
import {
  GREETING_TEXT,
  GREETING_URI,
  greetingMessage,
  NON_ASCII_RESOURCE_REGISTERED_URI,
  NON_ASCII_RESOURCE_TEXT,
  NON_ASCII_RESOURCE_URI,
} from '../support/interop/fixture.ts'
import {
  type BlockingHTTPServer,
  connectMokeiHTTPClient,
  type RunningHTTPServer,
  startBlockingHTTPServer,
  startMokeiHTTPServer,
  startSDK20260728HTTPServer,
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

  // Tripwire, not proof. Read the name literally: it asserts that nothing on this exchange
  // came back carrying `Mcp-Session-Id`, and no more than that.
  //
  // The only code that ever writes that response header is the handler's `initialize` branch,
  // and a `2026-07-28` `ContextClient` never sends `initialize` (`ContextClient#initialize`
  // throws when the revision needs no handshake), so the branch is not reachable from here at
  // all. The invariant that a stateless exchange's response has no session header is carried
  // at the unit level by `packages/http-server/test/stateless.test.ts`, which can construct the
  // response directly; this test cannot fail unless something starts inventing the header out
  // of a path nothing currently takes. Keep it for that, do not read it as evidence that
  // sessionless operation is enforced, and do not "strengthen" it — the public API offers
  // nothing here that the unit test does not already cover better.
  test('no response on the exchange carries Mcp-Session-Id', async () => {
    server = await startMokeiHTTPServer(['2026-07-28'])
    const responses: Array<Response> = []
    // Patching a global is safe only because vitest runs the tests within a file serially;
    // under `test.concurrent` this would capture (and restore under) its neighbours.
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
    // disconnect and nothing else is sent on the way out. A `ContextClient` cannot stand in
    // here: aborting one makes it emit `notifications/cancelled`, and on this revision an
    // outgoing notification carries no protocol version in its `_meta` (only requests are
    // decorated), so that POST misses the sessionless route and comes back `400`. The failure
    // would look like a bug in this test rather than what it is. Leave the raw `fetch`.
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

describe('mokei client against an SDK server over Streamable HTTP on 2026-07-28', () => {
  let server: RunningHTTPServer | null = null
  let client: ContextClient | null = null

  afterEach(async () => {
    await client?.dispose()
    client = null
    await server?.dispose()
    server = null
  })

  test('discovers, lists and calls across the two stacks', async () => {
    server = await startSDK20260728HTTPServer()
    client = connectMokeiHTTPClient(server.url, '2026-07-28')

    const discovered = await client.discover()
    expect(discovered.supportedVersions).toEqual(['2026-07-28'])
    expect(discovered.capabilities.tools).toBeDefined()

    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name).sort()).toEqual(['echo', 'sum'])

    const echoed = await client.callTool({ name: 'echo', arguments: { text: 'hello interop' } })
    expect(echoed.content).toEqual([{ type: 'text', text: 'hello interop' }])

    const summed = await client.callTool({ name: 'sum', arguments: { a: 2, b: 3 } })
    expect(summed.structuredContent).toEqual({ total: 5 })
  })

  // Every method the specification's standard request headers require an `Mcp-Name` on, and
  // the peer that actually enforces them. The three are not interchangeable: the header mirrors
  // `params.name` for `tools/call` and `prompts/get` but `params.uri` for `resources/read`, so
  // a client deriving the header from one field alone passes two of these and fails the third.
  test('sends Mcp-Name for every method that requires it', async () => {
    server = await startSDK20260728HTTPServer()
    client = connectMokeiHTTPClient(server.url, '2026-07-28')

    const called = await client.callTool({ name: 'echo', arguments: { text: 'hello interop' } })
    expect(called.content).toEqual([{ type: 'text', text: 'hello interop' }])

    const prompt = await client.getPrompt({ name: 'greet', arguments: { name: 'Ada' } })
    expect(prompt.messages).toEqual([
      { role: 'user', content: { type: 'text', text: greetingMessage('Ada') } },
    ])

    const read = await client.readResource({ uri: GREETING_URI })
    expect(read.contents).toEqual([
      { uri: GREETING_URI, mimeType: 'text/plain', text: GREETING_TEXT },
    ])
  })

  // A resource URI is unconstrained text; an HTTP header value is a ByteString. Sending the URI
  // raw makes the `new Headers()` inside `fetch` throw before the request leaves, so a client
  // that does not Base64-wrap it cannot read such a resource at all. Only a peer that runs
  // `Mcp-Name` through the sentinel decoder before cross-checking it against `params.uri` can
  // show that the wrapped form is also *accepted*: mokei's own server never reads the header
  // back, so no mokei-to-mokei test can distinguish the two.
  test('reads a resource whose URI no header value can carry raw', async () => {
    server = await startSDK20260728HTTPServer()
    client = connectMokeiHTTPClient(server.url, '2026-07-28')

    const read = await client.readResource({ uri: NON_ASCII_RESOURCE_URI })
    expect(read.contents).toEqual([
      {
        uri: NON_ASCII_RESOURCE_REGISTERED_URI,
        mimeType: 'text/plain',
        text: NON_ASCII_RESOURCE_TEXT,
      },
    ])
  })
})
