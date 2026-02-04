# Streamable HTTP Transport Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add spec-compliant MCP Streamable HTTP transport (2025-11-25) as two new packages: `@mokei/http-client` and `@mokei/http-server`.

**Architecture:** Client transport extends `Transport<ServerMessage, ClientMessage>` from `@enkaku/transport`, using `fetch` for POST/GET/DELETE and `parse-sse` for SSE parsing. Server handler is framework-agnostic (`Request -> Response`) with session management, SSE writing, resumability, and message routing, plus a Hono adapter layer and convenience `serveHTTP` function.

**Tech Stack:** TypeScript (ES2025 strict), `@enkaku/transport`, `parse-sse`, `hono`, `@hono/node-server`, Vitest, SWC, pnpm workspaces

**References:**
- Design doc: `docs/plans/2026-02-04-streamable-http-design.md`
- Conventions: `docs/agents/conventions.md`
- Development: `docs/agents/development.md`
- Enkaku preferences: `docs/agents/enkaku.md`
- MCP spec: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#streamable-http
- Existing HTTP transport (to be replaced): `packages/host/src/http-transport.ts`
- Transport base class: `@enkaku/transport` (`Transport<R, W>` extends `Disposer`)

---

## Task 1: Scaffold @mokei/http-client package

**Files:**
- Create: `packages/http-client/package.json`
- Create: `packages/http-client/tsconfig.json`
- Create: `packages/http-client/src/index.ts`
- Modify: `pnpm-workspace.yaml` (add `parse-sse` to catalog)

**Step 1: Create package.json**

```json
{
  "name": "@mokei/http-client",
  "version": "0.5.0",
  "license": "MIT",
  "homepage": "https://mokei.dev",
  "description": "Mokei MCP HTTP client transport",
  "keywords": ["model", "context", "protocol", "mcp", "http", "client", "transport"],
  "repository": {
    "type": "git",
    "url": "https://github.com/TairuFramework/mokei",
    "directory": "packages/http-client"
  },
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/index.d.ts",
  "exports": {
    ".": "./lib/index.js"
  },
  "files": ["lib/*"],
  "sideEffects": false,
  "scripts": {
    "build:clean": "del lib",
    "build:js": "swc src -d ./lib --config-file ../../swc.json --strip-leading-paths",
    "build:types": "tsc --emitDeclarationOnly --skipLibCheck",
    "build:types:ci": "tsc --emitDeclarationOnly --skipLibCheck --declarationMap false",
    "build": "pnpm run build:clean && pnpm run build:js && pnpm run build:types",
    "test:types": "tsc --noEmit --skipLibCheck",
    "test:unit": "vitest run",
    "test": "pnpm run test:types && pnpm run test:unit",
    "prepublishOnly": "pnpm run build"
  },
  "dependencies": {
    "@mokei/context-client": "workspace:^",
    "@mokei/context-protocol": "workspace:^",
    "parse-sse": "catalog:"
  },
  "devDependencies": {
    "@enkaku/transport": "catalog:"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.build.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./lib"
  },
  "include": ["./src/**/*"]
}
```

**Step 3: Create empty barrel export**

```typescript
// packages/http-client/src/index.ts
/**
 * Mokei MCP HTTP client transport.
 *
 * ## Installation
 *
 * ```sh
 * npm install @mokei/http-client
 * ```
 *
 * @module http-client
 */
```

**Step 4: Add parse-sse to pnpm catalog**

In `pnpm-workspace.yaml`, add to the `catalog:` section:

```yaml
  parse-sse: ^1.0.0
```

Check the actual latest version on npm first with `npm view parse-sse version`.

**Step 5: Install dependencies**

Run: `pnpm install`
Expected: Installs successfully, lockfile updated.

**Step 6: Verify build**

Run: `pnpm --filter @mokei/http-client build`
Expected: Builds successfully (empty lib with just index.js and index.d.ts).

**Step 7: Commit**

```
feat(http-client): scaffold package
```

---

## Task 2: Implement auth module

**Files:**
- Create: `packages/http-client/src/auth.ts`
- Modify: `packages/http-client/src/index.ts`
- Create: `packages/http-client/test/auth.test.ts`

This is a direct move from `packages/host/src/http-context.ts` with renamed types per conventions (`HTTPAuthOptions` not `HttpAuthOptions`).

**Step 1: Write the failing test**

```typescript
// packages/http-client/test/auth.test.ts
import { describe, expect, test } from 'vitest'

import { buildHTTPHeaders, type HTTPAuthOptions } from '../src/auth.js'

describe('buildHTTPHeaders', () => {
  test('returns base headers when no auth provided', () => {
    const headers = buildHTTPHeaders({ 'X-Custom': 'value' })
    expect(headers).toEqual({ 'X-Custom': 'value' })
  })

  test('adds bearer token authorization header', () => {
    const auth: HTTPAuthOptions = { type: 'bearer', token: 'test-token' }
    const headers = buildHTTPHeaders(undefined, auth)
    expect(headers).toEqual({ Authorization: 'Bearer test-token' })
  })

  test('adds basic authorization header', () => {
    const auth: HTTPAuthOptions = { type: 'basic', username: 'user', password: 'pass' }
    const headers = buildHTTPHeaders(undefined, auth)
    expect(headers).toEqual({ Authorization: `Basic ${btoa('user:pass')}` })
  })

  test('adds custom header', () => {
    const auth: HTTPAuthOptions = { type: 'header', name: 'X-API-Key', value: 'secret' }
    const headers = buildHTTPHeaders(undefined, auth)
    expect(headers).toEqual({ 'X-API-Key': 'secret' })
  })

  test('merges base headers with auth header', () => {
    const auth: HTTPAuthOptions = { type: 'bearer', token: 'tk' }
    const headers = buildHTTPHeaders({ 'X-Custom': 'val' }, auth)
    expect(headers).toEqual({ 'X-Custom': 'val', Authorization: 'Bearer tk' })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @mokei/http-client test:unit`
Expected: FAIL — module `../src/auth.js` not found.

**Step 3: Write implementation**

```typescript
// packages/http-client/src/auth.ts
export type HTTPAuthOptions =
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; password: string }
  | { type: 'header'; name: string; value: string }

export function buildHTTPHeaders(
  baseHeaders?: Record<string, string>,
  auth?: HTTPAuthOptions,
): Record<string, string> {
  const headers: Record<string, string> = { ...baseHeaders }

  if (auth) {
    switch (auth.type) {
      case 'bearer':
        headers.Authorization = `Bearer ${auth.token}`
        break
      case 'basic': {
        const credentials = btoa(`${auth.username}:${auth.password}`)
        headers.Authorization = `Basic ${credentials}`
        break
      }
      case 'header':
        headers[auth.name] = auth.value
        break
    }
  }

  return headers
}
```

**Step 4: Add exports to index.ts**

```typescript
// packages/http-client/src/index.ts — add:
export { buildHTTPHeaders, type HTTPAuthOptions } from './auth.js'
```

**Step 5: Run test to verify it passes**

Run: `pnpm --filter @mokei/http-client test:unit`
Expected: PASS.

**Step 6: Commit**

```
feat(http-client): add auth module
```

---

## Task 3: Implement HTTPTransport — basic POST with JSON response

**Files:**
- Create: `packages/http-client/src/transport.ts`
- Create: `packages/http-client/test/transport.test.ts`
- Modify: `packages/http-client/src/index.ts`

Start with the simplest case: POST a JSON-RPC message, receive a JSON response. No SSE, no session management yet.

**Step 1: Write the failing test**

```typescript
// packages/http-client/test/transport.test.ts
import type { ClientMessage, ServerMessage } from '@mokei/context-protocol'
import { LATEST_PROTOCOL_VERSION } from '@mokei/context-protocol'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { HTTPTransport } from '../src/transport.js'

// Mock fetch globally
const mockFetch = vi.fn<typeof globalThis.fetch>()
vi.stubGlobal('fetch', mockFetch)

afterEach(() => {
  vi.clearAllMocks()
})

function jsonResponse(body: ServerMessage, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function acceptedResponse(): Response {
  return new Response(null, { status: 202 })
}

describe('HTTPTransport', () => {
  describe('POST with JSON response', () => {
    test('sends JSON-RPC message via POST and receives JSON response', async () => {
      const serverResponse: ServerMessage = {
        jsonrpc: '2.0',
        id: 0,
        result: { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, serverInfo: { name: 'test', version: '1.0' } },
      }
      mockFetch.mockResolvedValueOnce(jsonResponse(serverResponse))

      const transport = new HTTPTransport({ url: 'http://localhost:3000/mcp' })

      const message: ClientMessage = {
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
      }
      await transport.write(message)

      // Verify fetch was called correctly
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:3000/mcp', {
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': LATEST_PROTOCOL_VERSION,
        }),
        body: JSON.stringify(message),
        signal: expect.any(AbortSignal),
      })

      // Read the enqueued response
      const result = await transport.read()
      expect(result).toEqual({ done: false, value: serverResponse })

      await transport.dispose()
    })

    test('returns 202 for notifications without enqueuing', async () => {
      mockFetch.mockResolvedValueOnce(acceptedResponse())

      const transport = new HTTPTransport({ url: 'http://localhost:3000/mcp' })

      const notification: ClientMessage = {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }
      await transport.write(notification)

      expect(mockFetch).toHaveBeenCalledOnce()
      await transport.dispose()
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @mokei/http-client test:unit`
Expected: FAIL — `HTTPTransport` not found.

**Step 3: Write minimal implementation**

Reference `packages/host/src/http-transport.ts` for the stream creation pattern. The `Transport` base class from `@enkaku/transport` needs a `{ stream: ReadableWritablePair }` constructor arg. We create a `ReadableStream` with a controller to enqueue incoming messages, and a `WritableStream` whose `write` calls our `#sendMessage` method.

```typescript
// packages/http-client/src/transport.ts
import { Transport } from '@enkaku/transport'
import type { ClientMessage, ServerMessage } from '@mokei/context-protocol'
import { LATEST_PROTOCOL_VERSION } from '@mokei/context-protocol'

import { buildHTTPHeaders, type HTTPAuthOptions } from './auth.js'

export type HTTPTransportParams = {
  url: string
  headers?: Record<string, string>
  auth?: HTTPAuthOptions
  timeout?: number
}

export class HTTPTransport extends Transport<ServerMessage, ClientMessage> {
  #url: string
  #headers: Record<string, string>
  #timeout: number
  #sessionID: string | null = null
  #disposed = false
  #controller: ReadableStreamDefaultController<ServerMessage> | null = null

  constructor(params: HTTPTransportParams) {
    let controller!: ReadableStreamDefaultController<ServerMessage>

    const readable = new ReadableStream<ServerMessage>({
      start(c) {
        controller = c
      },
    })

    const sendMessage = (message: ClientMessage) => this.#sendMessage(message)
    const writable = new WritableStream<ClientMessage>({
      async write(message) {
        await sendMessage(message)
      },
    })

    super({ stream: { readable, writable } })
    this.#url = params.url
    this.#headers = buildHTTPHeaders(params.headers, params.auth)
    this.#timeout = params.timeout ?? 30_000
    this.#controller = controller
  }

  get sessionID(): string | null {
    return this.#sessionID
  }

  async #sendMessage(message: ClientMessage): Promise<void> {
    if (this.#disposed) {
      throw new Error('Transport is disposed')
    }

    const headers: Record<string, string> = {
      ...this.#headers,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': LATEST_PROTOCOL_VERSION,
    }

    if (this.#sessionID) {
      headers['Mcp-Session-Id'] = this.#sessionID
    }

    const controller = new AbortController()
    const timeoutID = setTimeout(() => controller.abort(), this.#timeout)

    try {
      const response = await fetch(this.#url, {
        method: 'POST',
        headers,
        body: JSON.stringify(message),
        signal: controller.signal,
      })

      const newSessionID = response.headers.get('Mcp-Session-Id')
      if (newSessionID) {
        this.#sessionID = newSessionID
      }

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`HTTP ${response.status}: ${errorText}`)
      }

      const contentType = response.headers.get('Content-Type') ?? ''

      if (response.status === 202) {
        // Accepted — no content
      } else if (contentType.includes('application/json')) {
        const data = (await response.json()) as ServerMessage
        this.#controller?.enqueue(data)
      }
    } finally {
      clearTimeout(timeoutID)
    }
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    this.#controller?.close()
    await super.dispose()
  }
}
```

**Step 4: Add export to index.ts**

```typescript
export { HTTPTransport, type HTTPTransportParams } from './transport.js'
```

**Step 5: Run test to verify it passes**

Run: `pnpm --filter @mokei/http-client test:unit`
Expected: PASS.

**Step 6: Commit**

```
feat(http-client): add HTTPTransport with POST/JSON support
```

---

## Task 4: Add session management to HTTPTransport

**Files:**
- Modify: `packages/http-client/test/transport.test.ts`
- Modify: `packages/http-client/src/transport.ts`

**Step 1: Write the failing tests**

Add to `transport.test.ts`:

```typescript
describe('session management', () => {
  test('captures Mcp-Session-Id from response and sends it on subsequent requests', async () => {
    // First request: server returns session ID
    mockFetch.mockResolvedValueOnce(jsonResponse(
      { jsonrpc: '2.0', id: 0, result: {} } as ServerMessage,
      { 'Mcp-Session-Id': 'session-123' },
    ))
    // Second request: server returns 202
    mockFetch.mockResolvedValueOnce(acceptedResponse())

    const transport = new HTTPTransport({ url: 'http://localhost:3000/mcp' })

    await transport.write({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {} } as ClientMessage)
    expect(transport.sessionID).toBe('session-123')

    await transport.write({ jsonrpc: '2.0', method: 'notifications/initialized' } as ClientMessage)

    const secondCall = mockFetch.mock.calls[1]
    expect(secondCall[1]?.headers).toHaveProperty('Mcp-Session-Id', 'session-123')

    await transport.dispose()
  })

  test('sends DELETE with session ID on dispose', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(
      { jsonrpc: '2.0', id: 0, result: {} } as ServerMessage,
      { 'Mcp-Session-Id': 'session-456' },
    ))
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }))

    const transport = new HTTPTransport({ url: 'http://localhost:3000/mcp' })
    await transport.write({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {} } as ClientMessage)
    await transport.dispose()

    expect(mockFetch).toHaveBeenCalledTimes(2)
    const deleteCall = mockFetch.mock.calls[1]
    expect(deleteCall[1]?.method).toBe('DELETE')
    expect(deleteCall[1]?.headers).toHaveProperty('Mcp-Session-Id', 'session-456')
  })

  test('throws on HTTP error responses', async () => {
    mockFetch.mockResolvedValueOnce(new Response('Bad Request', { status: 400 }))

    const transport = new HTTPTransport({ url: 'http://localhost:3000/mcp' })
    await expect(
      transport.write({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {} } as ClientMessage),
    ).rejects.toThrow('HTTP 400')

    await transport.dispose()
  })
})
```

**Step 2: Run test to verify failures**

Run: `pnpm --filter @mokei/http-client test:unit`
Expected: Some tests FAIL — DELETE on dispose not yet implemented.

**Step 3: Add DELETE on dispose to transport.ts**

Update the `dispose()` method in `HTTPTransport`:

```typescript
async dispose(): Promise<void> {
  if (this.#disposed) return
  this.#disposed = true

  if (this.#sessionID) {
    try {
      await fetch(this.#url, {
        method: 'DELETE',
        headers: { ...this.#headers, 'Mcp-Session-Id': this.#sessionID },
      })
    } catch {
      // Ignore errors during cleanup
    }
  }

  this.#controller?.close()
  await super.dispose()
}
```

**Step 4: Run tests to verify pass**

Run: `pnpm --filter @mokei/http-client test:unit`
Expected: PASS.

**Step 5: Commit**

```
feat(http-client): add session management and DELETE on dispose
```

---

## Task 5: Add SSE response handling to HTTPTransport

**Files:**
- Modify: `packages/http-client/test/transport.test.ts`
- Modify: `packages/http-client/src/transport.ts`

**Step 1: Write the failing test**

Add to `transport.test.ts`:

```typescript
function sseResponse(events: Array<{ id?: string; data: string; retry?: number }>): Response {
  const body = events
    .map((e) => {
      let text = ''
      if (e.id != null) text += `id: ${e.id}\n`
      if (e.retry != null) text += `retry: ${e.retry}\n`
      text += `data: ${e.data}\n\n`
      return text
    })
    .join('')
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

describe('SSE response handling', () => {
  test('parses SSE events from POST response and enqueues messages', async () => {
    const msg1: ServerMessage = { jsonrpc: '2.0', id: 0, result: { capabilities: {} } }
    const msg2: ServerMessage = { jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info', data: 'hello' } }

    mockFetch.mockResolvedValueOnce(
      sseResponse([
        { id: 'evt-1', data: '' },
        { id: 'evt-2', data: JSON.stringify(msg2) },
        { id: 'evt-3', data: JSON.stringify(msg1) },
      ]),
    )

    const transport = new HTTPTransport({ url: 'http://localhost:3000/mcp' })
    await transport.write({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {} } as ClientMessage)

    // Should have enqueued the two non-empty messages
    const result1 = await transport.read()
    expect(result1.value).toEqual(msg2)

    const result2 = await transport.read()
    expect(result2.value).toEqual(msg1)

    await transport.dispose()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @mokei/http-client test:unit`
Expected: FAIL — SSE content type not handled, no messages enqueued.

**Step 3: Add SSE handling to #sendMessage**

Import `parse-sse` and add SSE branch to the content-type handling. After the `application/json` branch:

```typescript
import { parseServerSentEvents } from 'parse-sse'

// Inside #sendMessage, after the JSON branch:
} else if (contentType.includes('text/event-stream')) {
  await this.#handleSSEResponse(response)
}

// New private method:
async #handleSSEResponse(response: Response): Promise<void> {
  const stream = parseServerSentEvents(response)
  for await (const event of stream) {
    if (event.data) {
      try {
        const message = JSON.parse(event.data) as ServerMessage
        this.#controller?.enqueue(message)
      } catch {
        // Ignore parse errors for empty/invalid data
      }
    }
    if (event.lastEventId) {
      this.#lastEventID = event.lastEventId
    }
    if (event.retry != null) {
      this.#retryMs = event.retry
    }
  }
}
```

Add fields to the class: `#lastEventID: string = ''` and `#retryMs: number = 3000`.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @mokei/http-client test:unit`
Expected: PASS.

**Step 5: Commit**

```
feat(http-client): handle SSE responses via parse-sse
```

---

## Task 6: Add GET stream for server-initiated messages

**Files:**
- Modify: `packages/http-client/test/transport.test.ts`
- Modify: `packages/http-client/src/transport.ts`

This adds the GET SSE stream that opens after initialization to receive server-initiated requests and notifications.

**Step 1: Write the failing test**

This is harder to test with mocked fetch because the GET stream is long-lived. Use a pattern where mockFetch returns a readable stream that we can write to.

```typescript
describe('GET stream for server-initiated messages', () => {
  test('opens GET stream after session is established and receives server messages', async () => {
    const initResult: ServerMessage = {
      jsonrpc: '2.0', id: 0,
      result: { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, serverInfo: { name: 'test', version: '1.0' } },
    }

    // POST initialize → JSON response with session ID
    mockFetch.mockResolvedValueOnce(jsonResponse(initResult, { 'Mcp-Session-Id': 'sess-1' }))

    // POST initialized notification → 202
    mockFetch.mockResolvedValueOnce(acceptedResponse())

    // GET stream → SSE with a server notification
    const serverNotification: ServerMessage = {
      jsonrpc: '2.0', method: 'notifications/message',
      params: { level: 'info', data: 'server says hello' },
    }
    mockFetch.mockResolvedValueOnce(
      sseResponse([
        { id: 'get-1', data: '' },
        { id: 'get-2', data: JSON.stringify(serverNotification) },
      ]),
    )

    const transport = new HTTPTransport({ url: 'http://localhost:3000/mcp' })

    // Write initialize
    await transport.write({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {} } as ClientMessage)

    // Write initialized notification (this triggers GET stream open)
    await transport.write({ jsonrpc: '2.0', method: 'notifications/initialized' } as ClientMessage)

    // Read init result from POST
    const result1 = await transport.read()
    expect(result1.value).toEqual(initResult)

    // Read server notification from GET stream
    const result2 = await transport.read()
    expect(result2.value).toEqual(serverNotification)

    // Verify GET was called with correct headers
    const getCall = mockFetch.mock.calls[2]
    expect(getCall[1]?.method).toBe('GET')
    expect(getCall[1]?.headers).toHaveProperty('Accept', 'text/event-stream')
    expect(getCall[1]?.headers).toHaveProperty('Mcp-Session-Id', 'sess-1')

    await transport.dispose()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @mokei/http-client test:unit`
Expected: FAIL — no GET request made.

**Step 3: Implement GET stream**

After a successful `notifications/initialized` write, open a GET stream. Detect this by inspecting the outgoing message in `#sendMessage`:

```typescript
// After POST completes successfully in #sendMessage:
if ('method' in message && message.method === 'notifications/initialized' && this.#sessionID) {
  this.#openGETStream()
}

// New method:
#getStreamController: AbortController | null = null

#openGETStream(): void {
  this.#getStreamController = new AbortController()

  const headers: Record<string, string> = {
    ...this.#headers,
    Accept: 'text/event-stream',
    'MCP-Protocol-Version': LATEST_PROTOCOL_VERSION,
  }
  if (this.#sessionID) {
    headers['Mcp-Session-Id'] = this.#sessionID
  }
  if (this.#lastEventID) {
    headers['Last-Event-ID'] = this.#lastEventID
  }

  fetch(this.#url, {
    method: 'GET',
    headers,
    signal: this.#getStreamController.signal,
  })
    .then(async (response) => {
      if (!response.ok) return
      await this.#handleSSEResponse(response)
    })
    .catch(() => {
      // Connection closed or aborted — may reconnect
    })
}
```

Update `dispose()` to abort the GET stream: `this.#getStreamController?.abort()`.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @mokei/http-client test:unit`
Expected: PASS.

**Step 5: Commit**

```
feat(http-client): open GET SSE stream for server-initiated messages
```

---

## Task 7: Add createHTTPClient convenience function

**Files:**
- Modify: `packages/http-client/src/transport.ts`
- Modify: `packages/http-client/src/index.ts`
- Create: `packages/http-client/test/client.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/http-client/test/client.test.ts
import { ContextClient } from '@mokei/context-client'
import { describe, expect, test, vi } from 'vitest'

import { createHTTPClient } from '../src/index.js'

vi.stubGlobal('fetch', vi.fn())

describe('createHTTPClient', () => {
  test('returns a ContextClient instance', () => {
    const client = createHTTPClient({ url: 'http://localhost:3000/mcp' })
    expect(client).toBeInstanceOf(ContextClient)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @mokei/http-client test:unit`
Expected: FAIL — `createHTTPClient` not exported.

**Step 3: Write implementation**

```typescript
// packages/http-client/src/transport.ts — add at the bottom:
import { ContextClient, type ContextTypes, type UnknownContextTypes } from '@mokei/context-client'
import type { ClientTransport } from '@mokei/context-client'

export function createHTTPClient<T extends ContextTypes = UnknownContextTypes>(
  params: HTTPTransportParams,
): ContextClient<T> {
  const transport = new HTTPTransport(params)
  return new ContextClient<T>({ transport: transport as ClientTransport })
}
```

Add to `index.ts`:

```typescript
export { createHTTPClient, HTTPTransport, type HTTPTransportParams } from './transport.js'
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @mokei/http-client test:unit`
Expected: PASS.

**Step 5: Commit**

```
feat(http-client): add createHTTPClient convenience function
```

---

## Task 8: Scaffold @mokei/http-server package

**Files:**
- Create: `packages/http-server/package.json`
- Create: `packages/http-server/tsconfig.json`
- Create: `packages/http-server/src/index.ts`

**Step 1: Create package.json**

```json
{
  "name": "@mokei/http-server",
  "version": "0.5.0",
  "license": "MIT",
  "homepage": "https://mokei.dev",
  "description": "Mokei MCP HTTP server handler",
  "keywords": ["model", "context", "protocol", "mcp", "http", "server", "transport"],
  "repository": {
    "type": "git",
    "url": "https://github.com/TairuFramework/mokei",
    "directory": "packages/http-server"
  },
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/index.d.ts",
  "exports": {
    ".": "./lib/index.js"
  },
  "files": ["lib/*"],
  "sideEffects": false,
  "scripts": {
    "build:clean": "del lib",
    "build:js": "swc src -d ./lib --config-file ../../swc.json --strip-leading-paths",
    "build:types": "tsc --emitDeclarationOnly --skipLibCheck",
    "build:types:ci": "tsc --emitDeclarationOnly --skipLibCheck --declarationMap false",
    "build": "pnpm run build:clean && pnpm run build:js && pnpm run build:types",
    "test:types": "tsc --noEmit --skipLibCheck",
    "test:unit": "vitest run",
    "test": "pnpm run test:types && pnpm run test:unit",
    "prepublishOnly": "pnpm run build"
  },
  "dependencies": {
    "@hono/node-server": "catalog:",
    "@mokei/context-protocol": "workspace:^",
    "@mokei/context-server": "workspace:^",
    "hono": "catalog:"
  },
  "devDependencies": {
    "@enkaku/transport": "catalog:"
  }
}
```

**Step 2: Create tsconfig.json**

Same pattern as http-client.

**Step 3: Create empty barrel export**

```typescript
// packages/http-server/src/index.ts
/**
 * Mokei MCP HTTP server handler.
 *
 * ## Installation
 *
 * ```sh
 * npm install @mokei/http-server
 * ```
 *
 * @module http-server
 */
```

**Step 4: Install and verify build**

Run: `pnpm install && pnpm --filter @mokei/http-server build`
Expected: Installs and builds successfully.

**Step 5: Commit**

```
feat(http-server): scaffold package
```

---

## Task 9: Implement SSEWriter utility

**Files:**
- Create: `packages/http-server/src/sse-writer.ts`
- Create: `packages/http-server/test/sse-writer.test.ts`
- Modify: `packages/http-server/src/index.ts`

The SSEWriter formats SSE events, assigns event IDs, and maintains a replay buffer.

**Step 1: Write the failing test**

```typescript
// packages/http-server/test/sse-writer.test.ts
import { describe, expect, test } from 'vitest'

import { SSEWriter } from '../src/sse-writer.js'

describe('SSEWriter', () => {
  test('formats and writes SSE events to a stream', async () => {
    const chunks: Array<string> = []
    const writable = new WritableStream<string>({
      write(chunk) {
        chunks.push(chunk)
      },
    })

    const writer = new SSEWriter({ writable, streamID: 'post-1', replayBufferSize: 10 })
    await writer.writeEvent({ data: '{"jsonrpc":"2.0","id":1,"result":{}}' })
    writer.close()

    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toMatch(/^id: post-1-\d+\ndata: \{"jsonrpc":"2\.0","id":1,"result":\{}\}\n\n$/)
  })

  test('sends initial priming event with empty data', async () => {
    const chunks: Array<string> = []
    const writable = new WritableStream<string>({
      write(chunk) {
        chunks.push(chunk)
      },
    })

    const writer = new SSEWriter({ writable, streamID: 'post-2', replayBufferSize: 10 })
    await writer.writePrimingEvent()
    writer.close()

    expect(chunks[0]).toMatch(/^id: post-2-\d+\ndata: \n\n$/)
  })

  test('buffers events for replay', async () => {
    const writable = new WritableStream<string>({ write() {} })
    const writer = new SSEWriter({ writable, streamID: 's1', replayBufferSize: 3 })

    await writer.writeEvent({ data: 'a' })
    await writer.writeEvent({ data: 'b' })
    await writer.writeEvent({ data: 'c' })
    await writer.writeEvent({ data: 'd' })

    // Buffer size 3: should have b, c, d (a evicted)
    const buffered = writer.getEventsAfter('s1-0')
    expect(buffered).toHaveLength(3)
    expect(buffered[0].data).toBe('b')
    writer.close()
  })

  test('writes retry field', async () => {
    const chunks: Array<string> = []
    const writable = new WritableStream<string>({
      write(chunk) {
        chunks.push(chunk)
      },
    })

    const writer = new SSEWriter({ writable, streamID: 'r1', replayBufferSize: 10 })
    await writer.writeRetry(5000)
    writer.close()

    expect(chunks[0]).toBe('retry: 5000\n\n')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @mokei/http-server test:unit`
Expected: FAIL.

**Step 3: Write implementation**

```typescript
// packages/http-server/src/sse-writer.ts

export type SSEEvent = {
  id: string
  data: string
}

export type SSEWriterParams = {
  writable: WritableStream<string>
  streamID: string
  replayBufferSize: number
}

export class SSEWriter {
  #writer: WritableStreamDefaultWriter<string>
  #streamID: string
  #counter = 0
  #buffer: Array<SSEEvent> = []
  #bufferSize: number

  constructor(params: SSEWriterParams) {
    this.#writer = params.writable.getWriter()
    this.#streamID = params.streamID
    this.#bufferSize = params.replayBufferSize
  }

  get streamID(): string {
    return this.#streamID
  }

  #nextID(): string {
    return `${this.#streamID}-${this.#counter++}`
  }

  async writePrimingEvent(): Promise<void> {
    const id = this.#nextID()
    const event: SSEEvent = { id, data: '' }
    this.#bufferEvent(event)
    await this.#writer.write(`id: ${id}\ndata: \n\n`)
  }

  async writeEvent(params: { data: string }): Promise<void> {
    const id = this.#nextID()
    const event: SSEEvent = { id, data: params.data }
    this.#bufferEvent(event)
    await this.#writer.write(`id: ${id}\ndata: ${params.data}\n\n`)
  }

  async writeRetry(ms: number): Promise<void> {
    await this.#writer.write(`retry: ${ms}\n\n`)
  }

  #bufferEvent(event: SSEEvent): void {
    this.#buffer.push(event)
    if (this.#buffer.length > this.#bufferSize) {
      this.#buffer.shift()
    }
  }

  getEventsAfter(lastEventID: string): Array<SSEEvent> {
    const index = this.#buffer.findIndex((e) => e.id === lastEventID)
    if (index === -1) return [...this.#buffer]
    return this.#buffer.slice(index + 1)
  }

  close(): void {
    this.#writer.close()
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @mokei/http-server test:unit`
Expected: PASS.

**Step 5: Commit**

```
feat(http-server): add SSEWriter utility
```

---

## Task 10: Implement session management

**Files:**
- Create: `packages/http-server/src/session.ts`
- Create: `packages/http-server/test/session.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/http-server/test/session.test.ts
import { describe, expect, test, vi, afterEach } from 'vitest'

import { SessionManager } from '../src/session.js'

describe('SessionManager', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('creates a session with a unique ID', () => {
    const manager = new SessionManager({ maxSessions: 10, sessionTimeoutMs: 300_000 })
    const session = manager.create()
    expect(session.sessionID).toBeDefined()
    expect(typeof session.sessionID).toBe('string')
    expect(session.sessionID.length).toBeGreaterThan(0)
    manager.dispose()
  })

  test('retrieves a session by ID', () => {
    const manager = new SessionManager({ maxSessions: 10, sessionTimeoutMs: 300_000 })
    const session = manager.create()
    const found = manager.get(session.sessionID)
    expect(found).toBe(session)
    manager.dispose()
  })

  test('returns undefined for unknown session ID', () => {
    const manager = new SessionManager({ maxSessions: 10, sessionTimeoutMs: 300_000 })
    expect(manager.get('nonexistent')).toBeUndefined()
    manager.dispose()
  })

  test('deletes a session', () => {
    const manager = new SessionManager({ maxSessions: 10, sessionTimeoutMs: 300_000 })
    const session = manager.create()
    manager.delete(session.sessionID)
    expect(manager.get(session.sessionID)).toBeUndefined()
    manager.dispose()
  })

  test('enforces max sessions limit', () => {
    const manager = new SessionManager({ maxSessions: 2, sessionTimeoutMs: 300_000 })
    manager.create()
    manager.create()
    expect(() => manager.create()).toThrow()
    manager.dispose()
  })

  test('updates last activity on touch', () => {
    const manager = new SessionManager({ maxSessions: 10, sessionTimeoutMs: 300_000 })
    const session = manager.create()
    const before = session.lastActivity
    vi.advanceTimersByTime(100)
    manager.touch(session.sessionID)
    // lastActivity should be updated
    expect(session.lastActivity).toBeGreaterThanOrEqual(before)
    manager.dispose()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @mokei/http-server test:unit`
Expected: FAIL.

**Step 3: Write implementation**

```typescript
// packages/http-server/src/session.ts
import type { ContextServer } from '@mokei/context-server'

import type { SSEWriter } from './sse-writer.js'

export type Session = {
  sessionID: string
  server: ContextServer | null
  postStreams: Map<string | number, SSEWriter>
  getStream: SSEWriter | null
  lastActivity: number
}

export type SessionManagerParams = {
  maxSessions: number
  sessionTimeoutMs: number
}

export class SessionManager {
  #sessions = new Map<string, Session>()
  #maxSessions: number
  #timeoutMs: number
  #cleanupInterval: ReturnType<typeof setInterval> | null = null

  constructor(params: SessionManagerParams) {
    this.#maxSessions = params.maxSessions
    this.#timeoutMs = params.timeoutMs

    this.#cleanupInterval = setInterval(() => this.#cleanup(), Math.min(this.#timeoutMs, 60_000))
    if (typeof this.#cleanupInterval === 'object' && 'unref' in this.#cleanupInterval) {
      this.#cleanupInterval.unref()
    }
  }

  create(): Session {
    if (this.#sessions.size >= this.#maxSessions) {
      throw new Error('Maximum number of sessions reached')
    }

    const session: Session = {
      sessionID: crypto.randomUUID(),
      server: null,
      postStreams: new Map(),
      getStream: null,
      lastActivity: Date.now(),
    }
    this.#sessions.set(session.sessionID, session)
    return session
  }

  get(sessionID: string): Session | undefined {
    return this.#sessions.get(sessionID)
  }

  touch(sessionID: string): void {
    const session = this.#sessions.get(sessionID)
    if (session) {
      session.lastActivity = Date.now()
    }
  }

  delete(sessionID: string): void {
    const session = this.#sessions.get(sessionID)
    if (session) {
      session.server?.dispose()
      session.postStreams.forEach((writer) => writer.close())
      session.getStream?.close()
      this.#sessions.delete(sessionID)
    }
  }

  #cleanup(): void {
    const now = Date.now()
    for (const [id, session] of this.#sessions) {
      if (now - session.lastActivity > this.#timeoutMs) {
        this.delete(id)
      }
    }
  }

  dispose(): void {
    if (this.#cleanupInterval) {
      clearInterval(this.#cleanupInterval)
    }
    for (const id of this.#sessions.keys()) {
      this.delete(id)
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @mokei/http-server test:unit`
Expected: PASS.

**Step 5: Commit**

```
feat(http-server): add session management
```

---

## Task 11: Implement createHTTPHandler — POST handling

**Files:**
- Create: `packages/http-server/src/handler.ts`
- Create: `packages/http-server/test/handler.test.ts`
- Modify: `packages/http-server/src/index.ts`

Start with POST request handling: initialization, notifications returning 202, and requests returning JSON or SSE responses. This is the most complex task.

**Step 1: Write the failing tests**

```typescript
// packages/http-server/test/handler.test.ts
import { LATEST_PROTOCOL_VERSION } from '@mokei/context-protocol'
import type { ClientMessage, ServerMessage } from '@mokei/context-protocol'
import { ContextServer, type ServerConfig } from '@mokei/context-server'
import { describe, expect, test, afterEach } from 'vitest'

import { createHTTPHandler } from '../src/handler.js'

const SERVER_CONFIG: ServerConfig = {
  name: 'test-server',
  version: '1.0.0',
  tools: {
    echo: {
      description: 'Echo input',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
      handler: async ({ arguments: args }) => ({
        content: [{ type: 'text', text: (args as { text: string }).text }],
      }),
    },
  },
}

function createTestHandler() {
  return createHTTPHandler({
    createServer: (transport) => new ContextServer({ ...SERVER_CONFIG, transport }),
    allowedOrigins: ['http://localhost'],
    replayBufferSize: 100,
  })
}

function postRequest(body: ClientMessage, sessionID?: string): Request {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': LATEST_PROTOCOL_VERSION,
    Origin: 'http://localhost',
  }
  if (sessionID) {
    headers['Mcp-Session-Id'] = sessionID
  }
  return new Request('http://localhost:3000/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

describe('createHTTPHandler', () => {
  let handler: ReturnType<typeof createTestHandler>

  afterEach(() => {
    handler?.dispose()
  })

  test('handles initialization and returns session ID', async () => {
    handler = createTestHandler()
    const initRequest: ClientMessage = {
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0' },
      },
    }

    const response = await handler.handleRequest(postRequest(initRequest))

    expect(response.status).toBe(200)
    expect(response.headers.get('Mcp-Session-Id')).toBeTruthy()

    const body = await response.json()
    expect(body).toMatchObject({
      jsonrpc: '2.0',
      id: 0,
      result: {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        serverInfo: { name: 'test-server', version: '1.0.0' },
      },
    })
  })

  test('returns 202 for notifications', async () => {
    handler = createTestHandler()

    // Initialize first
    const initReq: ClientMessage = {
      jsonrpc: '2.0', id: 0, method: 'initialize',
      params: { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
    }
    const initResponse = await handler.handleRequest(postRequest(initReq))
    const sessionID = initResponse.headers.get('Mcp-Session-Id')!

    // Send notification
    const notification: ClientMessage = { jsonrpc: '2.0', method: 'notifications/initialized' }
    const response = await handler.handleRequest(postRequest(notification, sessionID))
    expect(response.status).toBe(202)
  })

  test('rejects requests with invalid origin', async () => {
    handler = createTestHandler()
    const req = new Request('http://localhost:3000/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Origin: 'http://evil.com',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {} }),
    })

    const response = await handler.handleRequest(req)
    expect(response.status).toBe(403)
  })

  test('returns 404 for unknown session ID', async () => {
    handler = createTestHandler()
    const notification: ClientMessage = { jsonrpc: '2.0', method: 'notifications/initialized' }
    const response = await handler.handleRequest(postRequest(notification, 'unknown-session'))
    expect(response.status).toBe(404)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @mokei/http-server test:unit`
Expected: FAIL.

**Step 3: Write implementation**

This is the core handler. Implement the full `createHTTPHandler` function with:
- Origin validation
- Session lookup/creation
- POST routing (initialize, notification, request)
- Transport bridge per session (ReadableStream + WritableStream that intercepts ContextServer writes for routing)

Refer to `docs/plans/2026-02-04-streamable-http-design.md` for the message routing rules. The transport bridge creates a `ReadableStream` (fed by POST handler enqueuing client messages) and a `WritableStream` (where ContextServer writes go — these are intercepted and routed to the appropriate SSE stream or JSON response).

The handler should detect `initialize` requests and create new sessions. For requests (messages with `id` and `method`), the handler should wait for the ContextServer to produce a response (matching `id`) and return it. Start with JSON responses for simplicity; SSE streaming for POST responses comes in a follow-up task.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @mokei/http-server test:unit`
Expected: PASS.

**Step 5: Commit**

```
feat(http-server): implement createHTTPHandler with POST handling
```

---

## Task 12: Add SSE streaming for POST responses

**Files:**
- Modify: `packages/http-server/test/handler.test.ts`
- Modify: `packages/http-server/src/handler.ts`

When the server responds to a request, return a `text/event-stream` response instead of plain JSON. This enables intermediate notifications (like progress) to be streamed before the final response.

**Step 1: Write the failing test**

Add test that makes a tool call and verifies the response is SSE-formatted:

```typescript
test('returns SSE stream for tool call requests', async () => {
  handler = createTestHandler()

  // Initialize + notification
  const initReq: ClientMessage = { ... }
  const initResp = await handler.handleRequest(postRequest(initReq))
  const sessionID = initResp.headers.get('Mcp-Session-Id')!
  await handler.handleRequest(postRequest({ jsonrpc: '2.0', method: 'notifications/initialized' } as ClientMessage, sessionID))

  // Tool call
  const toolCall: ClientMessage = {
    jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'echo', arguments: { text: 'hello' } },
  }
  const response = await handler.handleRequest(postRequest(toolCall, sessionID))

  expect(response.headers.get('Content-Type')).toBe('text/event-stream')

  // Parse the SSE response body
  const text = await response.text()
  const events = text.split('\n\n').filter(Boolean)
  // Should have priming event + response event
  expect(events.length).toBeGreaterThanOrEqual(2)
})
```

**Step 2-5: Implement, test, commit**

```
feat(http-server): stream POST responses as SSE
```

---

## Task 13: Add GET stream and DELETE handling

**Files:**
- Modify: `packages/http-server/test/handler.test.ts`
- Modify: `packages/http-server/src/handler.ts`

**Step 1: Write failing tests**

```typescript
test('handles GET request to open SSE stream', async () => {
  handler = createTestHandler()
  // Initialize session first...
  // Then GET:
  const getReq = new Request('http://localhost:3000/mcp', {
    method: 'GET',
    headers: {
      Accept: 'text/event-stream',
      'Mcp-Session-Id': sessionID,
      Origin: 'http://localhost',
      'MCP-Protocol-Version': LATEST_PROTOCOL_VERSION,
    },
  })
  const response = await handler.handleRequest(getReq)
  expect(response.headers.get('Content-Type')).toBe('text/event-stream')
})

test('handles DELETE to terminate session', async () => {
  handler = createTestHandler()
  // Initialize session first...
  const delReq = new Request('http://localhost:3000/mcp', {
    method: 'DELETE',
    headers: {
      'Mcp-Session-Id': sessionID,
      Origin: 'http://localhost',
    },
  })
  const response = await handler.handleRequest(delReq)
  expect(response.status).toBe(200)

  // Subsequent requests should get 404
  const response2 = await handler.handleRequest(postRequest(
    { jsonrpc: '2.0', method: 'notifications/initialized' } as ClientMessage,
    sessionID,
  ))
  expect(response2.status).toBe(404)
})
```

**Step 2-5: Implement, test, commit**

```
feat(http-server): add GET stream and DELETE session handling
```

---

## Task 14: Add resumability (Last-Event-ID replay)

**Files:**
- Modify: `packages/http-server/test/handler.test.ts`
- Modify: `packages/http-server/src/handler.ts`

**Step 1: Write the failing test**

Test that a GET with `Last-Event-ID` replays buffered events from that point.

**Step 2-5: Implement, test, commit**

```
feat(http-server): add resumability via Last-Event-ID
```

---

## Task 15: Add Hono middleware

**Files:**
- Create: `packages/http-server/src/middleware.ts`
- Create: `packages/http-server/test/middleware.test.ts`
- Modify: `packages/http-server/src/index.ts`

**Step 1: Write the failing test**

```typescript
// packages/http-server/test/middleware.test.ts
import { Hono } from 'hono'
import { LATEST_PROTOCOL_VERSION } from '@mokei/context-protocol'
import { ContextServer } from '@mokei/context-server'
import { describe, expect, test } from 'vitest'

import { mcpHTTPMiddleware } from '../src/middleware.js'

describe('mcpHTTPMiddleware', () => {
  test('handles MCP requests through Hono', async () => {
    const app = new Hono()
    app.all('/mcp', mcpHTTPMiddleware({
      createServer: (transport) => new ContextServer({
        name: 'test', version: '1.0', transport,
      }),
      allowedOrigins: ['http://localhost'],
    }))

    const response = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Origin: 'http://localhost',
        'MCP-Protocol-Version': LATEST_PROTOCOL_VERSION,
      },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 0, method: 'initialize',
        params: { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
      }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Mcp-Session-Id')).toBeTruthy()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @mokei/http-server test:unit`
Expected: FAIL.

**Step 3: Write implementation**

```typescript
// packages/http-server/src/middleware.ts
import type { MiddlewareHandler } from 'hono'

import { createHTTPHandler, type HTTPHandlerParams } from './handler.js'

export function mcpHTTPMiddleware(params: HTTPHandlerParams): MiddlewareHandler {
  const handler = createHTTPHandler(params)

  return async (ctx) => {
    const response = await handler.handleRequest(ctx.req.raw)
    return response
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @mokei/http-server test:unit`
Expected: PASS.

**Step 5: Commit**

```
feat(http-server): add Hono middleware adapter
```

---

## Task 16: Add serveHTTP convenience function

**Files:**
- Create: `packages/http-server/src/serve.ts`
- Modify: `packages/http-server/src/index.ts`

**Step 1: Write the failing test**

```typescript
// packages/http-server/test/serve.test.ts
import { describe, expect, test, afterEach } from 'vitest'
import { ContextServer } from '@mokei/context-server'

import { serveHTTP } from '../src/serve.js'

describe('serveHTTP', () => {
  let server: ReturnType<typeof serveHTTP> | null = null

  afterEach(() => {
    server?.dispose()
    server = null
  })

  test('creates a server listening on specified port', async () => {
    server = serveHTTP({
      createServer: (transport) => new ContextServer({ name: 'test', version: '1.0', transport }),
      port: 0, // random port
      hostname: '127.0.0.1',
    })

    expect(server.handler).toBeDefined()
    expect(server.dispose).toBeDefined()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @mokei/http-server test:unit`
Expected: FAIL.

**Step 3: Write implementation**

```typescript
// packages/http-server/src/serve.ts
import { serve } from '@hono/node-server'
import { Hono } from 'hono'

import { createHTTPHandler, type HTTPHandler, type HTTPHandlerParams } from './handler.js'

export type ServeHTTPParams = HTTPHandlerParams & {
  port?: number
  hostname?: string
  path?: string
}

export type ServeHTTPResult = {
  handler: HTTPHandler
  dispose: () => void
}

export function serveHTTP(params: ServeHTTPParams): ServeHTTPResult {
  const { port = 3000, hostname = '127.0.0.1', path = '/mcp', ...handlerParams } = params
  const handler = createHTTPHandler(handlerParams)

  const app = new Hono()
  app.all(path, async (ctx) => {
    return await handler.handleRequest(ctx.req.raw)
  })

  const server = serve({ fetch: app.fetch, port, hostname })

  return {
    handler,
    dispose: () => {
      handler.dispose()
      server.close()
    },
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @mokei/http-server test:unit`
Expected: PASS.

**Step 5: Add all exports to index.ts and commit**

```typescript
// packages/http-server/src/index.ts
export { createHTTPHandler, type HTTPHandler, type HTTPHandlerParams } from './handler.js'
export { mcpHTTPMiddleware } from './middleware.js'
export { serveHTTP, type ServeHTTPParams, type ServeHTTPResult } from './serve.js'
export { SSEWriter, type SSEEvent, type SSEWriterParams } from './sse-writer.js'
```

```
feat(http-server): add serveHTTP convenience function
```

---

## Task 17: Migrate host package to use @mokei/http-client

**Files:**
- Delete: `packages/host/src/http-transport.ts`
- Delete: `packages/host/src/http-context.ts`
- Modify: `packages/host/src/host.ts`
- Modify: `packages/host/package.json`
- Modify: `packages/host/src/index.ts` (if it re-exports http types)

**Step 1: Update host package.json**

Add `@mokei/http-client` dependency, remove any now-unnecessary deps.

**Step 2: Update host.ts imports and addHTTPContext**

Replace:
```typescript
import { McpHttpTransport } from './http-transport.js'
import { type HttpContextParams, buildHttpHeaders } from './http-context.js'
```

With:
```typescript
import { createHTTPClient, type HTTPTransportParams, type HTTPAuthOptions } from '@mokei/http-client'
```

Update `addHTTPContext` to use `createHTTPClient` instead of manually creating transport + client.

**Step 3: Delete old files**

Delete `packages/host/src/http-transport.ts` and `packages/host/src/http-context.ts`.

**Step 4: Build and verify**

Run: `pnpm build`
Expected: Full build passes. No broken imports.

Run: `pnpm test`
Expected: All existing tests pass.

**Step 5: Commit**

```
refactor(host): migrate to @mokei/http-client
```

---

## Task 18: Add integration test

**Files:**
- Create: `integration-tests/suites/http-transport.test.ts`
- Modify: `integration-tests/package.json`

Wire `HTTPTransport` client to `createHTTPHandler` server over real HTTP. Full session lifecycle: initialize, call tools, dispose.

**Step 1: Update integration-tests/package.json**

Add dependencies:
```json
"@mokei/http-client": "workspace:^",
"@mokei/http-server": "workspace:^"
```

**Step 2: Write the integration test**

```typescript
// integration-tests/suites/http-transport.test.ts
import { createHTTPClient } from '@mokei/http-client'
import { serveHTTP } from '@mokei/http-server'
import { ContextServer, createTool } from '@mokei/context-server'
import { LATEST_PROTOCOL_VERSION } from '@mokei/context-protocol'
import { afterEach, describe, expect, test } from 'vitest'

describe('HTTP transport end-to-end', () => {
  let dispose: (() => void) | null = null

  afterEach(() => {
    dispose?.()
    dispose = null
  })

  test('full session lifecycle over HTTP', async () => {
    // Start server
    const server = serveHTTP({
      createServer: (transport) =>
        new ContextServer({
          name: 'integration-test',
          version: '1.0.0',
          transport,
          tools: {
            echo: {
              description: 'Echo input',
              inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
              handler: async ({ arguments: args }) => ({
                content: [{ type: 'text', text: (args as { text: string }).text }],
              }),
            },
          },
        }),
      port: 0, // random available port
      hostname: '127.0.0.1',
      allowedOrigins: ['http://localhost'],
    })
    dispose = server.dispose

    // Create client — need to determine the actual port
    // Use the address from the server...
    // (Implementation detail: serveHTTP should expose the address/port)
    const client = createHTTPClient({
      url: `http://127.0.0.1:${port}/mcp`,
    })

    // Initialize
    const initResult = await client.initialize()
    expect(initResult.serverInfo.name).toBe('integration-test')

    // List tools
    const { tools } = await client.listTools()
    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('echo')

    // Call tool
    const result = await client.callTool({ name: 'echo', arguments: { text: 'hello' } })
    expect(result.content).toEqual([{ type: 'text', text: 'hello' }])

    // Dispose client
    await client.dispose()
  })
})
```

Note: `serveHTTP` may need to expose the actual port in its return value. Update `ServeHTTPResult` to include `port` if using port 0.

**Step 3: Run integration test**

Run: `pnpm --filter mokei-integration-tests test -- --grep "HTTP transport"`
Expected: PASS.

**Step 4: Commit**

```
test: add HTTP transport integration test
```

---

## Task 19: Lint, type-check, and final verification

**Files:** None new — verification only.

**Step 1: Lint all packages**

Run: `pnpm lint`
Expected: All files pass lint and formatting.

**Step 2: Type-check**

Run: `pnpm test:types`
Expected: No type errors.

**Step 3: Full build**

Run: `pnpm build`
Expected: All packages build successfully.

**Step 4: Full test suite**

Run: `pnpm test`
Expected: All tests pass.

**Step 5: Commit any lint fixes**

```
chore: lint and format
```
