/** mokei client ↔ official SDK v2 server, over stdio and Streamable HTTP, on both revisions. */
import type { ContextClient } from '@mokei/context-client'
import type { ProtocolVersion } from '@mokei/context-protocol'
import { spawnHostedContext } from '@mokei/host'
import { afterEach, describe, expect, test } from 'vitest'

import { checkMokeiClient } from '../support/interop/expectations.ts'
import {
  GREETING_TEXT,
  GREETING_URI,
  greetingMessage,
  HEADER_ECHO_INPUT_SCHEMA,
  HEADER_ECHO_UNANNOTATED_SCHEMA,
  type HeaderEchoSchema,
  headerEchoText,
  NON_ASCII_RESOURCE_REGISTERED_URI,
  NON_ASCII_RESOURCE_TEXT,
  NON_ASCII_RESOURCE_URI,
  SDK_RESOURCE_URIS,
  SDK_TOOL_NAMES,
} from '../support/interop/fixture.ts'
import {
  connectMokeiHTTPClient,
  type RunningHTTPServer,
  SDK_STDIO_SERVER_2026_07_28_PATH,
  SDK_STDIO_SERVER_PATH,
  startSDK20260728HTTPServer,
  startSDKHTTPServer,
} from '../support/interop/servers.ts'

/** One row per protocol revision, carrying only *how to connect*. */
type SDKServerRow = {
  protocolVersion: ProtocolVersion
  stdioServerPath: string
  startHTTPServer: () => Promise<RunningHTTPServer>
}

const ROWS: ReadonlyArray<SDKServerRow> = [
  {
    protocolVersion: '2025-11-25',
    stdioServerPath: SDK_STDIO_SERVER_PATH,
    startHTTPServer: startSDKHTTPServer,
  },
  {
    protocolVersion: '2026-07-28',
    // Single-revision on both transports, so a client that fell back to `2025-11-25` fails to
    // connect rather than passing every assertion below against the wrong revision.
    stdioServerPath: SDK_STDIO_SERVER_2026_07_28_PATH,
    startHTTPServer: startSDK20260728HTTPServer,
  },
]

const EXPECTATIONS = { resourceURIs: SDK_RESOURCE_URIS, toolNames: SDK_TOOL_NAMES }

/**
 * Run `body` with `globalThis.fetch` wrapped, collecting the headers of every request whose body
 * `match` accepts, in send order. Restores the original `fetch` even if `body` throws.
 *
 * Patching a global is safe only because vitest runs the tests within a file serially; under
 * `test.concurrent` this would capture — and restore under — its neighbours.
 */
async function captureFetch(
  match: (body: string) => boolean,
  body: () => Promise<void>,
): Promise<Array<Headers>> {
  const sent: Array<Headers> = []
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof init?.body === 'string' && match(init.body)) {
      sent.push(new Headers(init.headers))
    }
    return await original(input, init)
  }) as typeof globalThis.fetch
  try {
    await body()
  } finally {
    globalThis.fetch = original
  }
  return sent
}

describe.each(ROWS)('mokei client against the SDK v2 server on $protocolVersion', (row) => {
  let httpServer: RunningHTTPServer | null = null
  let client: ContextClient | null = null

  afterEach(async () => {
    if (client != null) {
      await client.dispose()
      client = null
    }
    if (httpServer != null) {
      await httpServer.dispose()
      httpServer = null
    }
  })

  test('over stdio', async () => {
    const context = await spawnHostedContext({
      command: process.execPath,
      args: [row.stdioServerPath],
      // Pinned rather than left to the host default. On the `2026-07-28` row the server serves
      // exactly one revision, so `'auto'` would make a probe failure look like a successful
      // fallback; the `2025-11-25` row's server (`sdk-stdio-server.ts`, the SDK default) answers
      // both revisions, so what actually makes that row sound is `checkMokeiClient`'s own
      // assertion that `initResult.protocolVersion === '2025-11-25'` — a silent fallback there
      // would fail the assertion instead of the connect.
      protocolVersion: row.protocolVersion,
    })
    try {
      await checkMokeiClient(context.client, {
        protocolVersion: row.protocolVersion,
        ...EXPECTATIONS,
      })
    } finally {
      await context.disposer.dispose()
    }
  })

  test('over Streamable HTTP', async () => {
    httpServer = await row.startHTTPServer()
    client = connectMokeiHTTPClient(httpServer.url, row.protocolVersion)
    await checkMokeiClient(client, { protocolVersion: row.protocolVersion, ...EXPECTATIONS })
  })
})

/**
 * Assertions that exist on `2026-07-28` and have no `2025-11-25` counterpart, so they stay out of
 * the table above rather than becoming configuration.
 *
 * `checkMokeiClient` skips its `initialize()` block on this revision — there is no handshake to
 * assert — so `server/discover` is asserted here instead.
 */
describe('mokei client against the SDK v2 server on 2026-07-28', () => {
  let httpServer: RunningHTTPServer | null = null
  let client: ContextClient | null = null

  afterEach(async () => {
    if (client != null) {
      await client.dispose()
      client = null
    }
    if (httpServer != null) {
      await httpServer.dispose()
      httpServer = null
    }
  })

  test('answers server/discover over Streamable HTTP', async () => {
    httpServer = await startSDK20260728HTTPServer()
    client = connectMokeiHTTPClient(httpServer.url, '2026-07-28')

    const discovered = await client.discover()
    expect(discovered.supportedVersions).toEqual(['2026-07-28'])
    expect(discovered.capabilities.tools).toBeDefined()
  })

  test('answers server/discover over stdio', async () => {
    const context = await spawnHostedContext({
      command: process.execPath,
      args: [SDK_STDIO_SERVER_2026_07_28_PATH],
      protocolVersion: '2026-07-28',
    })
    try {
      const discovered = await context.client.discover()
      expect(discovered.supportedVersions).toEqual(['2026-07-28'])
      expect(discovered.capabilities.tools).toBeDefined()
    } finally {
      await context.disposer.dispose()
    }
  })

  // Every method the specification's standard request headers require an `Mcp-Name` on, and the
  // peer that actually enforces them. The three are not interchangeable: the header mirrors
  // `params.name` for `tools/call` and `prompts/get` but `params.uri` for `resources/read`, so a
  // client deriving the header from one field alone passes two of these and fails the third.
  test('sends Mcp-Name for every method that requires it', async () => {
    httpServer = await startSDK20260728HTTPServer()
    client = connectMokeiHTTPClient(httpServer.url, '2026-07-28')

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
  // raw makes the `new Headers()` inside `fetch` throw before the request leaves, so a client that
  // does not Base64-wrap it cannot read such a resource at all. Only a peer that runs `Mcp-Name`
  // through the sentinel decoder before cross-checking it against `params.uri` can show that the
  // wrapped form is also *accepted*: mokei's own server never reads the header back, so no
  // mokei-to-mokei test can distinguish the two.
  test('reads a resource whose URI no header value can carry raw', async () => {
    httpServer = await startSDK20260728HTTPServer()
    client = connectMokeiHTTPClient(httpServer.url, '2026-07-28')

    const read = await client.readResource({ uri: NON_ASCII_RESOURCE_URI })
    expect(read.contents).toEqual([
      {
        uri: NON_ASCII_RESOURCE_REGISTERED_URI,
        mimeType: 'text/plain',
        text: NON_ASCII_RESOURCE_TEXT,
      },
    ])
  })

  /**
   * The `Mcp-Param-*` cases. All four drive mokei's encoder into the SDK's decoder, which
   * validates every declared header against the body `arguments` before dispatch and answers a
   * disagreement `-32020` `HeaderMismatch` (HTTP 400) with the offending pair in `data.mismatch`.
   * So reaching the handler's echoed text at all *is* the assertion.
   *
   * Each case calls `listTools()` first, and must: mokei's transport reads the `x-mcp-header`
   * annotations off a tool `inputSchema` it caches from a `tools/list` result
   * (`packages/http-client/src/transport.ts:571-599`). Without that call no header is sent, the
   * SDK sees a body value with no header, and the case fails as `param-header-missing` — which
   * would be the right failure for the wrong reason.
   */
  test('mirrors a plain x-mcp-header argument into Mcp-Param-*', async () => {
    httpServer = await startSDK20260728HTTPServer()
    client = connectMokeiHTTPClient(httpServer.url, '2026-07-28')
    await client.listTools()

    const called = await client.callTool({ name: 'headerEcho', arguments: { tenant: 'acme' } })
    expect(called.content).toEqual([{ type: 'text', text: headerEchoText('acme', undefined) }])
  })

  // One layer below the `Mcp-Name` defect's shape: a value no header can carry raw, round-tripped
  // through a conformant decoder. mokei wraps it in the `=?base64?…?=` sentinel; the SDK decodes
  // the payload, rejects it if it is not canonical Base64 or not valid UTF-8, and compares the
  // decoded string against the body value.
  test('Base64-wraps a non-Latin-1 x-mcp-header argument', async () => {
    httpServer = await startSDK20260728HTTPServer()
    client = connectMokeiHTTPClient(httpServer.url, '2026-07-28')
    await client.listTools()

    const called = await client.callTool({ name: 'headerEcho', arguments: { tenant: '文書' } })
    expect(called.content).toEqual([{ type: 'text', text: headerEchoText('文書', undefined) }])
  })

  // An integer-typed declaration is compared numerically on the SDK side and written as canonical
  // decimal on mokei's — a distinct path from the string comparison above.
  test('writes an integer x-mcp-header argument as canonical decimal', async () => {
    httpServer = await startSDK20260728HTTPServer()
    client = connectMokeiHTTPClient(httpServer.url, '2026-07-28')
    await client.listTools()

    const called = await client.callTool({ name: 'headerEcho', arguments: { limit: 42 } })
    expect(called.content).toEqual([{ type: 'text', text: headerEchoText(undefined, 42) }])
  })

  test('sends Mcp-Method naming the method on every standard-header request', async () => {
    // Asserted on the outgoing request, not inferred from the peer accepting the call: a wrong
    // value fails, but a right one passing is equally consistent with the header being built
    // from some other field that happens to agree.
    httpServer = await startSDK20260728HTTPServer()
    client = connectMokeiHTTPClient(httpServer.url, '2026-07-28')
    const activeClient = client

    const sent = await captureFetch(
      (body) =>
        body.includes('"tools/call"') ||
        body.includes('"prompts/get"') ||
        body.includes('"resources/read"'),
      async () => {
        await activeClient.callTool({ name: 'echo', arguments: { text: 'hello interop' } })
        await activeClient.getPrompt({ name: 'greet', arguments: { name: 'Ada' } })
        await activeClient.readResource({ uri: GREETING_URI })
      },
    )

    expect(sent.map((headers) => headers.get('Mcp-Method'))).toEqual([
      'tools/call',
      'prompts/get',
      'resources/read',
    ])
  })

  /**
   * The absence case, and the one case the peer cannot fail for us: when the body value is absent
   * the SDK MUST NOT expect the header, and a header sent anyway is *ignored*. So this is asserted
   * on the outgoing request instead, by wrapping `globalThis.fetch` — the technique the
   * `Mcp-Session-Id` tripwire in `interop-2026-07-28-http.test.ts` already uses.
   *
   * Patching a global is safe only because vitest runs the tests within a file serially; under
   * `test.concurrent` this would capture (and restore under) its neighbours.
   */
  test('sends no Mcp-Param-* header for an omitted annotated argument', async () => {
    httpServer = await startSDK20260728HTTPServer()
    client = connectMokeiHTTPClient(httpServer.url, '2026-07-28')
    const activeClient = client
    await activeClient.listTools()

    const sent = await captureFetch(
      (body) => body.includes('"headerEcho"'),
      async () => {
        const called = await activeClient.callTool({ name: 'headerEcho', arguments: { limit: 7 } })
        expect(called.content).toEqual([{ type: 'text', text: headerEchoText(undefined, 7) }])
      },
    )

    expect(sent).toHaveLength(1)
    expect(sent[0]?.get('Mcp-Param-Limit')).toBe('7')
    expect(sent[0]?.get('Mcp-Param-Tenant')).toBeNull()
  })

  test('retries a tools/call after the peer schema gains an annotation', async () => {
    // The acceptance case for the stale-schema retry. The client lists an annotation-free
    // `headerEcho`, the peer gains the annotation behind its back, and the call that follows
    // carries a body value with no header — which the SDK answers `param-header-missing`.
    let schema: HeaderEchoSchema = HEADER_ECHO_UNANNOTATED_SCHEMA
    httpServer = await startSDK20260728HTTPServer({ headerEchoSchema: () => schema })
    client = connectMokeiHTTPClient(httpServer.url, '2026-07-28')
    const activeClient = client

    await activeClient.listTools()
    schema = HEADER_ECHO_INPUT_SCHEMA

    const sent = await captureFetch(
      (body) => body.includes('"headerEcho"') || body.includes('"tools/list"'),
      async () => {
        const called = await activeClient.callTool({
          name: 'headerEcho',
          arguments: { tenant: 'acme' },
        })
        // Reaching the handler's text at all is the assertion: the SDK validates every declared
        // header against the body before dispatch, so the handler runs only on the retry.
        expect(called.content).toEqual([{ type: 'text', text: headerEchoText('acme', undefined) }])
      },
    )

    // Bare call, the transport's own refresh, then the retry carrying the header.
    expect(sent).toHaveLength(3)
    expect(sent[0]?.get('Mcp-Param-Tenant')).toBeNull()
    expect(sent[1]?.get('Mcp-Method')).toBe('tools/list')
    expect(sent[2]?.get('Mcp-Param-Tenant')).toBe('acme')
    // Exactly the new header set, not merely a superset of it: `limit` was omitted from the
    // arguments, so its annotation must produce no header on the retry either.
    expect(sent[2]?.get('Mcp-Param-Limit')).toBeNull()
  })
})
