import { DirectTransports, type TransportType } from '@enkaku/transport'
import type {
  CallToolResult,
  ClientMessage,
  ClientRequest,
  CreateMessageRequest,
  CreateMessageResult,
  ElicitRequest,
  ElicitResult,
  InitializeRequest,
  InitializeResult,
  Log,
  Root,
  ServerMessage,
  ServerRequest,
} from '@mokei/context-protocol'
import { INVALID_REQUEST, METHOD_NOT_FOUND } from '@mokei/context-protocol'
import { describe, expect, test, vi } from 'vitest'

import { DEFAULT_INITIALIZE_PARAMS } from '../src/client.js'
import {
  CapabilityNotDeclaredError,
  type ClientParams,
  ContextClient,
  InputRequiredNotSupportedError,
  ListMaxPagesError,
  MethodNotInRevisionError,
  MRTRNotSupportedError,
  StructuredContentValidationError,
  UnsupportedProtocolVersionError,
} from '../src/index.js'

// The mocked server's negotiated version in this handshake: every client built in this file
// is configured with `protocolVersion: '2025-11-25'`, and the client now declares exactly
// that (not `LATEST_PROTOCOL_VERSION`) in its initialize request, so the response must match.
const DEFAULT_INITIALIZE_RESULT: InitializeResult = {
  capabilities: {},
  protocolVersion: '2025-11-25',
  serverInfo: { name: 'Mokei', version: '0.1.0' },
}

async function handleServerInitialize(
  transport: TransportType<ClientMessage, ServerMessage>,
  result: InitializeResult = DEFAULT_INITIALIZE_RESULT,
): Promise<ClientMessage> {
  // Server receives initialize request
  const request = await transport.read()
  if (request.done) {
    throw new Error('Server did not receive initialize request')
  }
  // Server sends back initialize response
  transport.write({ jsonrpc: '2.0', id: 0, result })
  // Server receives initialized notification
  await transport.read()
  // Return initialize request
  return request.value
}

type RunClientRequest<T> = (client: ContextClient) => Promise<T>

async function executeClientRequest<T>(
  runRequest: RunClientRequest<T>,
  expectedRequest: Omit<ClientRequest, 'jsonrpc' | 'id'>,
  result: unknown,
  expectedInitializeParams?: InitializeRequest['params'],
  initializeResult?: InitializeResult,
): Promise<T> {
  const transports = new DirectTransports<ServerMessage, ClientMessage>()
  const client = new ContextClient({ protocolVersion: '2025-11-25', transport: transports.client })

  client.initialize()
  const initRequest = await handleServerInitialize(transports.server, initializeResult)
  if (expectedInitializeParams != null) {
    expect(initRequest.params).toEqual(expectedInitializeParams)
  }

  const request = runRequest(client)
  const incomingRequest = await transports.server.read()
  expect(incomingRequest).toEqual({
    done: false,
    value: { jsonrpc: '2.0', id: 1, ...expectedRequest },
  })
  transports.server.write({ jsonrpc: '2.0', id: 1, result } as ServerMessage)

  return request
}

type Page = { result: Record<string, unknown> }

/**
 * Drives a client list call against a server that answers `pages` in order.
 * Returns the pending result plus the params of every request the server saw,
 * so a test can assert the cursor was threaded through.
 */
async function runListWalk<T>(
  runRequest: (client: ContextClient) => Promise<T>,
  pages: Array<Page>,
  clientParams: Omit<ClientParams, 'transport'> = { protocolVersion: '2025-11-25' },
): Promise<{ result: Promise<T>; requests: Array<Record<string, unknown>> }> {
  const transports = new DirectTransports<ServerMessage, ClientMessage>()
  const client = new ContextClient({ ...clientParams, transport: transports.client })

  client.initialize()
  await handleServerInitialize(transports.server, {
    ...DEFAULT_INITIALIZE_RESULT,
    capabilities: { tools: {} },
  })

  const result = runRequest(client)
  const requests: Array<Record<string, unknown>> = []

  for (const page of pages) {
    const incoming = await transports.server.read()
    if (incoming.done) {
      break
    }
    const request = incoming.value as { id: number; params: Record<string, unknown> }
    requests.push(request.params)
    transports.server.write({
      jsonrpc: '2.0',
      id: request.id,
      result: page.result,
    } as ServerMessage)
  }

  return { result, requests }
}

async function expectClientResponse(
  params: Omit<ClientParams, 'transport'>,
  request: Omit<ServerRequest, 'jsonrpc' | 'id'>,
  response: Record<string, unknown>,
  expectedInitializeParams?: Partial<InitializeRequest['params']>,
): Promise<void> {
  const transports = new DirectTransports<ServerMessage, ClientMessage>()
  const client = new ContextClient({ ...params, transport: transports.client })

  client.initialize()
  const initRequest = await handleServerInitialize(transports.server)
  if (expectedInitializeParams != null) {
    expect(initRequest.params).toEqual({
      ...DEFAULT_INITIALIZE_PARAMS,
      ...expectedInitializeParams,
    })
  }

  transports.server.write({ jsonrpc: '2.0' as const, id: 1, ...request } as ServerRequest)
  await expect(transports.server.read()).resolves.toEqual({
    done: false,
    value: { jsonrpc: '2.0', id: 1, ...response },
  })

  await transports.dispose()
}

/**
 * Sentinel a `respond` function returns to withhold a response entirely: the harness still
 * records the request in `sent`, but writes nothing back, so a bounded read waiting on it hits
 * its own timeout instead of resolving. Used to exercise the `'auto'` probe-timeout fallback
 * without blocking inside `respond` itself.
 */
const WITHHOLD = Symbol('WITHHOLD')

type Respond = (message: ClientRequest) => Record<string, unknown> | typeof WITHHOLD | undefined

/**
 * Drives a client against a scripted server: `respond` returns the result for each request
 * the server receives, `undefined` to answer with `{}`, or `WITHHOLD` to record the request
 * and never answer it. `sent` records every outbound message in order, and `transports` is
 * exposed so a test can also push server-initiated frames the scripted loop never sends.
 */
function createTestClient(params: Omit<ClientParams, 'transport'> & { respond?: Respond }): {
  client: ContextClient
  sent: Array<ClientRequest>
  transports: DirectTransports<ServerMessage, ClientMessage>
} {
  const { respond, ...clientParams } = params
  const transports = new DirectTransports<ServerMessage, ClientMessage>()
  const client = new ContextClient({ ...clientParams, transport: transports.client })
  const sent: Array<ClientRequest> = []
  void (async () => {
    while (true) {
      const incoming = await transports.server.read()
      if (incoming.done) {
        return
      }
      const message = incoming.value as ClientRequest
      sent.push(message)
      if (message.id == null) {
        continue
      }
      if (message.method === 'initialize') {
        transports.server.write({
          jsonrpc: '2.0',
          id: message.id,
          result: DEFAULT_INITIALIZE_RESULT,
        } as ServerMessage)
        continue
      }
      const answer = respond?.(message)
      if (answer === WITHHOLD) {
        continue
      }
      if (answer === undefined) {
        transports.server.write({ jsonrpc: '2.0', id: message.id, result: {} } as ServerMessage)
      } else if ('error' in answer) {
        transports.server.write({ jsonrpc: '2.0', id: message.id, ...answer } as ServerMessage)
      } else {
        transports.server.write({ jsonrpc: '2.0', id: message.id, result: answer } as ServerMessage)
      }
    }
  })()
  return { client, sent, transports }
}

describe('ContextClient', () => {
  test('supports initialization lifecycle', async () => {
    const transports = new DirectTransports<ServerMessage, ClientMessage>()

    const client = new ContextClient({
      protocolVersion: '2025-11-25',
      transport: transports.client,
    })
    const initializedPromise = client.initialize()

    const initializedEvent = client.events.once('initialized')

    await expect(handleServerInitialize(transports.server)).resolves.toEqual({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        capabilities: {},
        clientInfo: {
          name: 'Mokei',
          version: '0.4.0',
        },
        protocolVersion: '2025-11-25',
      },
    })

    await expect(initializedEvent).resolves.toEqual(DEFAULT_INITIALIZE_RESULT)
    await expect(initializedPromise).resolves.toEqual(DEFAULT_INITIALIZE_RESULT)
  })

  test('supports logs notifications', async () => {
    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    const client = new ContextClient({
      protocolVersion: '2025-11-25',
      transport: transports.client,
    })

    const logs: Array<Log> = []
    client.events.on('log', (log) => {
      logs.push(log)
    })

    client.initialize()
    await handleServerInitialize(transports.server)

    await transports.server.write({
      jsonrpc: '2.0',
      method: 'notifications/message',
      params: { level: 'info', data: { message: 'test' } },
    })
    await transports.server.write({
      jsonrpc: '2.0',
      method: 'notifications/message',
      params: { level: 'error', data: { message: 'test' } },
    })

    // Allow the client to process both notifications before disposing
    await new Promise((resolve) => setTimeout(resolve, 10))

    await transports.dispose()
    expect(logs).toEqual([
      { level: 'info', data: { message: 'test' } },
      { level: 'error', data: { message: 'test' } },
    ])
  })

  test('supports incoming roots list requests', async () => {
    const roots: Array<Root> = [{ name: 'test', uri: 'test://test' }]
    await expectClientResponse(
      { protocolVersion: '2025-11-25', listRoots: roots },
      { method: 'roots/list' },
      { result: { roots } },
      { capabilities: { roots: {} } },
    )
  })

  test('supports incoming sampling messages requests', async () => {
    const params: CreateMessageRequest['params'] = {
      messages: [{ role: 'user', content: { type: 'text', text: 'hello' } }],
      maxTokens: 100,
    }
    const result: CreateMessageResult = {
      role: 'assistant',
      model: 'foo',
      content: { type: 'text', text: 'test' },
    }
    const createMessage = vi.fn(() => result)

    await expectClientResponse(
      { protocolVersion: '2025-11-25', createMessage },
      { method: 'sampling/createMessage', params },
      { result },
      { capabilities: { sampling: {} } },
    )
    expect(createMessage).toHaveBeenCalledWith({ params, signal: expect.any(AbortSignal) })
  })

  test('supports incoming elicit requests', async () => {
    const params: ElicitRequest['params'] = {
      message: 'Run this test?',
      requestedSchema: {
        type: 'object',
        properties: { run: { type: 'string', enum: ['once', 'always'] } },
      },
    }
    const result: ElicitResult = {
      action: 'accept',
      content: { run: 'once' },
    }
    const elicit = vi.fn(() => result)

    await expectClientResponse(
      { protocolVersion: '2025-11-25', elicit },
      { method: 'elicitation/create', params },
      { result },
      { capabilities: { elicitation: {} } },
    )
    expect(elicit).toHaveBeenCalledWith({ params, signal: expect.any(AbortSignal) })
  })

  test('supports outgoing completion requests', async () => {
    const params = {
      ref: { type: 'ref/prompt', name: 'test' },
      argument: { name: 'test', value: 'one' },
    } as const
    const completion = { values: ['one', 'two'] }

    const request = executeClientRequest(
      (client) => client.complete(params),
      { method: 'completion/complete', params },
      { completion },
      undefined,
      { ...DEFAULT_INITIALIZE_RESULT, capabilities: { completions: {} } },
    )
    await expect(request).resolves.toEqual({ completion })
  })

  describe('supports outgoing prompt requests', () => {
    test('lists available prompts', async () => {
      const prompts = [
        { name: 'first', description: 'test', arguments: { type: 'object' } },
        { name: 'second', description: 'test' },
      ]
      const request = executeClientRequest(
        (client) => client.listPrompts(),
        { method: 'prompts/list', params: {} },
        { prompts },
      )
      await expect(request).resolves.toEqual({ prompts })
    })

    test('gets a prompt', async () => {
      const result = {
        messages: [{ role: 'assistant', content: { type: 'text', text: 'Hello World!' } }],
      }
      const request = executeClientRequest(
        (client) => client.getPrompt({ name: 'hello', arguments: { name: 'World' } }),
        {
          method: 'prompts/get',
          params: {
            name: 'hello',
            arguments: { name: 'World' },
          },
        },
        result,
      )
      await expect(request).resolves.toEqual(result)
    })
  })

  describe('supports outgoing resource requests', () => {
    test('lists available resources', async () => {
      const resources = [
        { name: 'foo', uri: 'test://foo' },
        { name: 'bar', uri: 'test://bar' },
      ]
      const request = executeClientRequest(
        (client) => client.listResources(),
        { method: 'resources/list', params: {} },
        { resources },
      )
      await expect(request).resolves.toEqual({ resources })
    })

    test('lists available resource templates', async () => {
      const resourceTemplates = [
        { name: 'foo', uriTemplate: 'test://foo/{name}' },
        { name: 'bar', uriTemplate: 'test://bar/{name}' },
      ]
      const request = executeClientRequest(
        (client) => client.listResourceTemplates(),
        { method: 'resources/templates/list', params: {} },
        { resourceTemplates },
      )
      await expect(request).resolves.toEqual({ resourceTemplates })
    })

    test('reads a resource', async () => {
      const result = { contents: [{ uri: 'test://foo', text: 'test resource' }] }
      const request = executeClientRequest(
        (client) => client.readResource({ uri: 'test://foo' }),
        { method: 'resources/read', params: { uri: 'test://foo' } },
        result,
      )
      await expect(request).resolves.toEqual(result)
    })
  })

  describe('supports outgoing tool requests', () => {
    test('lists available tools', async () => {
      const tools = [
        { name: 'first', description: 'test', inputSchema: { type: 'object' } },
        { name: 'second', description: 'test', inputSchema: { type: 'object' } },
      ]
      const request = executeClientRequest(
        (client) => client.listTools(),
        { method: 'tools/list', params: {} },
        { tools },
        undefined,
        { ...DEFAULT_INITIALIZE_RESULT, capabilities: { tools: {} } },
      )
      await expect(request).resolves.toEqual({ tools })
    })

    test('calls a tool', async () => {
      const result: CallToolResult = {
        content: [{ type: 'text', text: 'hello World' }],
      }
      const request = executeClientRequest(
        (client) => client.callTool({ name: 'hello', arguments: { name: 'World' } }),
        {
          method: 'tools/call',
          params: {
            name: 'hello',
            arguments: { name: 'World' },
          },
        },
        result,
      )
      await expect(request).resolves.toEqual(result)
    })
  })
})

describe('initialize hardening', () => {
  test('times out when the server never responds', async () => {
    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    const client = new ContextClient({
      protocolVersion: '2025-11-25',
      transport: transports.client,
      initializeTimeout: 50,
    })
    // Drain the client's initialize request but never reply.
    void transports.server.read()
    await expect(client.initialize()).rejects.toThrow(/within 50ms/)
    await transports.dispose()
  })

  test('throws an RPCError when the server returns an error response', async () => {
    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    const client = new ContextClient({
      protocolVersion: '2025-11-25',
      transport: transports.client,
    })
    void (async () => {
      const req = await transports.server.read()
      const id = (req.value as { id: number }).id
      await transports.server.write({
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: 'boom' },
      } as ServerMessage)
    })()
    await expect(client.initialize()).rejects.toMatchObject({ message: 'boom' })
    await transports.dispose()
  })

  test('tolerates a notification arriving before the initialize response', async () => {
    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    const client = new ContextClient({
      protocolVersion: '2025-11-25',
      transport: transports.client,
    })
    void (async () => {
      const req = await transports.server.read()
      const id = (req.value as { id: number }).id
      await transports.server.write({
        jsonrpc: '2.0',
        method: 'notifications/message',
        params: { level: 'info', data: 'hi' },
      } as ServerMessage)
      await transports.server.write({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          serverInfo: { name: 's', version: '1' },
        },
      } as ServerMessage)
    })()
    const result = await client.initialize()
    expect(result.serverInfo.name).toBe('s')
    await transports.dispose()
  })

  // Task 11 fix round 1, Fix 1: `#setupBuffer` used to have only one reader — `#readUntil()`'s
  // own loop, called at most twice per connection (probe, handshake) and never again once setup
  // finishes. A notification that arrives during that window and doesn't match either setup
  // read's predicate (as here: it has no `id` at all) used to sit in `#setupBuffer` forever,
  // never reaching `_handleMessage`/the notification stream. This asserts the opposite: once the
  // client is ready, a reader attached to `client.notifications` still receives it.
  test('delivers a notification that arrives during setup to the notification stream once ready', async () => {
    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    const client = new ContextClient({
      protocolVersion: '2025-11-25',
      transport: transports.client,
    })
    void (async () => {
      const req = await transports.server.read()
      const id = (req.value as { id: number }).id
      await transports.server.write({
        jsonrpc: '2.0',
        method: 'notifications/message',
        params: { level: 'info', data: 'buffered during setup' },
      } as ServerMessage)
      await transports.server.write({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          serverInfo: { name: 's', version: '1' },
        },
      } as ServerMessage)
    })()
    // Attach the reader before the handshake even starts, so `#hasNotificationReader` is true
    // by the time the buffered notification is drained — this test is about delivery through
    // the buffer, not about the separate reader-attach-timing behavior of `#notificationBuffer`.
    const reader = client.notifications.getReader()
    await client.initialize()
    const { done, value } = await reader.read()
    expect(done).toBe(false)
    expect(value).toEqual({
      jsonrpc: '2.0',
      method: 'notifications/message',
      params: { level: 'info', data: 'buffered during setup' },
    })
    await reader.cancel()
    await transports.dispose()
  })

  test('emits closed when the transport ends', async () => {
    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    const client = new ContextClient({
      protocolVersion: '2025-11-25',
      transport: transports.client,
    })
    void (async () => {
      const req = await transports.server.read()
      const id = (req.value as { id: number }).id
      await transports.server.write({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          serverInfo: { name: 's', version: '1' },
        },
      } as ServerMessage)
    })()
    await client.initialize()
    const closed = client.events.once('closed')
    await transports.dispose()
    await expect(closed).resolves.toEqual({ error: undefined })
  })
})

describe('capability gating', () => {
  test('listTools throws CapabilityNotDeclaredError when server declared no tools capability', async () => {
    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    const client = new ContextClient({
      protocolVersion: '2025-11-25',
      transport: transports.client,
    })

    void handleServerInitialize(transports.server) // capabilities: {} by default
    await client.initialize()

    await expect(client.listTools()).rejects.toThrow(CapabilityNotDeclaredError)

    await transports.dispose()
  })

  test('listTools succeeds when server declared tools capability', async () => {
    const initResult: InitializeResult = {
      ...DEFAULT_INITIALIZE_RESULT,
      capabilities: { tools: {} },
    }
    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    const client = new ContextClient({
      protocolVersion: '2025-11-25',
      transport: transports.client,
    })

    void handleServerInitialize(transports.server, initResult)
    await client.initialize()

    const request = client.listTools()
    const incoming = await transports.server.read()
    transports.server.write({
      jsonrpc: '2.0',
      id: (incoming.value as { id: number }).id,
      result: { tools: [] },
    } as ServerMessage)

    await expect(request).resolves.toEqual({ tools: [] })
    await transports.dispose()
  })

  test('roots/list returns METHOD_NOT_FOUND when client has no listRoots', async () => {
    await expectClientResponse(
      { protocolVersion: '2025-11-25' },
      { method: 'roots/list' },
      { error: { code: METHOD_NOT_FOUND, message: 'roots capability not supported' } },
    )
  })

  test('listTools resolves via lazy init when server declares tools capability (no explicit initialize)', async () => {
    const initResult: InitializeResult = {
      ...DEFAULT_INITIALIZE_RESULT,
      capabilities: { tools: {} },
    }
    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    const client = new ContextClient({
      protocolVersion: '2025-11-25',
      transport: transports.client,
    })

    // Drive the server side: handle init then answer tools/list — no client.initialize() call
    const serverTask = (async () => {
      await handleServerInitialize(transports.server, initResult)
      const incoming = await transports.server.read()
      transports.server.write({
        jsonrpc: '2.0',
        id: (incoming.value as { id: number }).id,
        result: { tools: [] },
      } as ServerMessage)
    })()

    await expect(client.listTools()).resolves.toEqual({ tools: [] })
    await serverTask
    await transports.dispose()
  })

  test('listTools rejects with CapabilityNotDeclaredError via lazy init when server declares no tools capability (no explicit initialize)', async () => {
    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    const client = new ContextClient({
      protocolVersion: '2025-11-25',
      transport: transports.client,
    })

    // Server declares no tools capability (default) — no client.initialize() call
    void handleServerInitialize(transports.server)

    await expect(client.listTools()).rejects.toThrow(CapabilityNotDeclaredError)

    await transports.dispose()
  })
})

describe('list pagination', () => {
  const toolA = { name: 'a', inputSchema: { type: 'object' } }
  const toolB = { name: 'b', inputSchema: { type: 'object' } }
  const toolC = { name: 'c', inputSchema: { type: 'object' } }

  test('walks every page and returns one aggregate without nextCursor', async () => {
    const { result, requests } = await runListWalk(
      (client) => client.listTools(),
      [
        { result: { tools: [toolA], nextCursor: 'c1' } },
        { result: { tools: [toolB], nextCursor: 'c2' } },
        { result: { tools: [toolC] } },
      ],
    )

    await expect(result).resolves.toEqual({ tools: [toolA, toolB, toolC] })
    expect(requests).toEqual([{}, { cursor: 'c1' }, { cursor: 'c2' }])
  })

  test('an explicit cursor issues one request and preserves nextCursor', async () => {
    const { result, requests } = await runListWalk(
      (client) => client.listTools({ cursor: 'c1' }),
      [{ result: { tools: [toolB], nextCursor: 'c2' } }],
    )

    await expect(result).resolves.toEqual({ tools: [toolB], nextCursor: 'c2' })
    expect(requests).toEqual([{ cursor: 'c1' }])
  })

  test('throws ListMaxPagesError with partial results when the cap is exceeded', async () => {
    const { result } = await runListWalk(
      (client) => client.listTools({ maxPages: 2 }),
      [
        { result: { tools: [toolA], nextCursor: 'c1' } },
        { result: { tools: [toolB], nextCursor: 'c2' } },
      ],
    )

    await expect(result).rejects.toThrow(ListMaxPagesError)
    await result.catch((error: unknown) => {
      const listError = error as ListMaxPagesError
      expect(listError.method).toBe('tools/list')
      expect(listError.pages).toBe(2)
      expect(listError.cursor).toBe('c2')
      expect(listError.results).toEqual([toolA, toolB])
    })
  })

  test('a server echoing an unchanging cursor terminates at the cap', async () => {
    const page = { result: { tools: [toolA], nextCursor: 'same' } }
    const { result } = await runListWalk(
      (client) => client.listTools({ maxPages: 3 }),
      [page, page, page],
    )
    await expect(result).rejects.toThrow(ListMaxPagesError)
  })

  test('listMaxPages on ClientParams supplies the default cap', async () => {
    const page = { result: { tools: [toolA], nextCursor: 'same' } }
    const { result } = await runListWalk((client) => client.listTools(), [page], {
      protocolVersion: '2025-11-25',
      listMaxPages: 1,
    })
    await expect(result).rejects.toThrow(ListMaxPagesError)
  })

  test('an aborted signal rejects the walk in progress', async () => {
    const controller = new AbortController()
    const { result } = await runListWalk(
      (client) => client.listTools({ signal: controller.signal }),
      [{ result: { tools: [], nextCursor: 'c1' } }],
    )
    controller.abort()
    await expect(result).rejects.toThrow()
  })

  test('pagination and transport options never reach the wire', async () => {
    // maxPages/signal/timeout share one object with the request's params, so they must be
    // stripped before the params are sent: the peer sees the cursor and nothing else.
    const controller = new AbortController()
    const { result, requests } = await runListWalk(
      (client) =>
        client.listTools({ cursor: 'c1', maxPages: 5, signal: controller.signal, timeout: 30_000 }),
      [{ result: { tools: [toolA] } }],
    )

    await expect(result).resolves.toEqual({ tools: [toolA] })
    expect(requests).toEqual([{ cursor: 'c1' }])
  })

  test('listPrompts walks pages', async () => {
    const { result } = await runListWalk(
      (client) => client.listPrompts(),
      [
        { result: { prompts: [{ name: 'a' }], nextCursor: 'c1' } },
        { result: { prompts: [{ name: 'b' }] } },
      ],
    )
    await expect(result).resolves.toEqual({ prompts: [{ name: 'a' }, { name: 'b' }] })
  })

  test('listResources walks pages', async () => {
    const { result } = await runListWalk(
      (client) => client.listResources(),
      [
        { result: { resources: [{ name: 'a', uri: 'test://a' }], nextCursor: 'c1' } },
        { result: { resources: [{ name: 'b', uri: 'test://b' }] } },
      ],
    )
    await expect(result).resolves.toEqual({
      resources: [
        { name: 'a', uri: 'test://a' },
        { name: 'b', uri: 'test://b' },
      ],
    })
  })

  test('listResourceTemplates walks pages', async () => {
    const { result } = await runListWalk(
      (client) => client.listResourceTemplates(),
      [
        {
          result: {
            resourceTemplates: [{ name: 'a', uriTemplate: 'test://a/{x}' }],
            nextCursor: 'c1',
          },
        },
        { result: { resourceTemplates: [{ name: 'b', uriTemplate: 'test://b/{x}' }] } },
      ],
    )
    await expect(result).resolves.toEqual({
      resourceTemplates: [
        { name: 'a', uriTemplate: 'test://a/{x}' },
        { name: 'b', uriTemplate: 'test://b/{x}' },
      ],
    })
  })
})

describe('structuredContent validation', () => {
  const countSchema = {
    type: 'object',
    properties: { count: { type: 'number' } },
    required: ['count'],
  } as const

  async function listThenCall(
    toolResult: Record<string, unknown>,
    outputSchema: Record<string, unknown> | null | undefined = countSchema,
  ): Promise<{ call: Promise<CallToolResult> }> {
    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    const client = new ContextClient({
      protocolVersion: '2025-11-25',
      transport: transports.client,
    })

    client.initialize()
    await handleServerInitialize(transports.server, {
      ...DEFAULT_INITIALIZE_RESULT,
      capabilities: { tools: {} },
    })

    const listed = client.listTools()
    const listRequest = await transports.server.read()
    transports.server.write({
      jsonrpc: '2.0',
      id: (listRequest.value as { id: number }).id,
      result: {
        tools: [
          {
            name: 'counter',
            inputSchema: { type: 'object' },
            ...(outputSchema == null ? {} : { outputSchema }),
          },
        ],
      },
    } as ServerMessage)
    await listed

    const call = client.callTool({ name: 'counter', arguments: {} })
    const callRequest = await transports.server.read()
    transports.server.write({
      jsonrpc: '2.0',
      id: (callRequest.value as { id: number }).id,
      result: toolResult,
    } as ServerMessage)
    return { call }
  }

  test('passes a conforming structuredContent through', async () => {
    const { call } = await listThenCall({
      content: [{ type: 'text', text: '{"count":3}' }],
      structuredContent: { count: 3 },
    })
    await expect(call).resolves.toEqual({
      content: [{ type: 'text', text: '{"count":3}' }],
      structuredContent: { count: 3 },
    })
  })

  test('rejects a structuredContent that violates the advertised schema', async () => {
    const { call } = await listThenCall({ content: [], structuredContent: { count: 'three' } })
    await expect(call).rejects.toThrow(StructuredContentValidationError)
    await call.catch((error: unknown) => {
      const validationError = error as StructuredContentValidationError
      expect(validationError.toolName).toBe('counter')
      expect(validationError.issues.length).toBeGreaterThan(0)
    })
  })

  test('does not validate when the tool advertised no outputSchema', async () => {
    const { call } = await listThenCall(
      { content: [], structuredContent: { count: 'three' } },
      null,
    )
    await expect(call).resolves.toEqual({ content: [], structuredContent: { count: 'three' } })
  })

  test('does not validate when listTools was never called', async () => {
    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    const client = new ContextClient({
      protocolVersion: '2025-11-25',
      transport: transports.client,
    })
    client.initialize()
    await handleServerInitialize(transports.server, {
      ...DEFAULT_INITIALIZE_RESULT,
      capabilities: { tools: {} },
    })

    const call = client.callTool({ name: 'counter', arguments: {} })
    const request = await transports.server.read()
    transports.server.write({
      jsonrpc: '2.0',
      id: (request.value as { id: number }).id,
      result: { content: [], structuredContent: { count: 'three' } },
    } as ServerMessage)

    await expect(call).resolves.toEqual({ content: [], structuredContent: { count: 'three' } })
    await transports.dispose()
  })

  test('tools/list_changed clears the cache so a re-listed tool uses its new schema', async () => {
    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    const client = new ContextClient({
      protocolVersion: '2025-11-25',
      transport: transports.client,
    })
    client.initialize()
    await handleServerInitialize(transports.server, {
      ...DEFAULT_INITIALIZE_RESULT,
      capabilities: { tools: {} },
    })

    const listed = client.listTools()
    const listRequest = await transports.server.read()
    transports.server.write({
      jsonrpc: '2.0',
      id: (listRequest.value as { id: number }).id,
      result: {
        tools: [{ name: 'counter', inputSchema: { type: 'object' }, outputSchema: countSchema }],
      },
    } as ServerMessage)
    await listed

    transports.server.write({
      jsonrpc: '2.0',
      method: 'notifications/tools/list_changed',
    } as ServerMessage)
    // Give the notification a turn to be handled before calling.
    await new Promise((resolve) => setTimeout(resolve, 0))

    const call = client.callTool({ name: 'counter', arguments: {} })
    const callRequest = await transports.server.read()
    transports.server.write({
      jsonrpc: '2.0',
      id: (callRequest.value as { id: number }).id,
      result: { content: [], structuredContent: { count: 'three' } },
    } as ServerMessage)

    // Cache cleared: the bad structuredContent passes because no schema is known.
    await expect(call).resolves.toEqual({ content: [], structuredContent: { count: 'three' } })
    await transports.dispose()
  })

  test('callTool transport options never reach the wire', async () => {
    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    const client = new ContextClient({
      protocolVersion: '2025-11-25',
      transport: transports.client,
    })
    client.initialize()
    await handleServerInitialize(transports.server, {
      ...DEFAULT_INITIALIZE_RESULT,
      capabilities: { tools: {} },
    })

    const controller = new AbortController()
    const call = client.callTool({
      name: 'counter',
      arguments: { n: 1 },
      signal: controller.signal,
      timeout: 30_000,
    })
    const request = await transports.server.read()
    const { id, params } = request.value as { id: number; params: unknown }

    // An AbortSignal left in the params would be serialized as a request param.
    expect(params).toEqual({ name: 'counter', arguments: { n: 1 } })

    transports.server.write({ jsonrpc: '2.0', id, result: { content: [] } } as ServerMessage)
    await expect(call).resolves.toEqual({ content: [] })
    await transports.dispose()
  })
})

describe('protocolVersion negotiation', () => {
  test('rejects an unsupported server protocolVersion and disposes', async () => {
    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    const client = new ContextClient({
      protocolVersion: '2025-11-25',
      transport: transports.client,
    })
    void (async () => {
      const req = await transports.server.read()
      const id = (req.value as { id: number }).id
      await transports.server.write({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          serverInfo: { name: 's', version: '1' },
        },
      } as ServerMessage)
    })()
    await expect(client.initialize()).rejects.toBeInstanceOf(UnsupportedProtocolVersionError)
  })

  test('accepts 2025-11-25', async () => {
    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    const client = new ContextClient({
      protocolVersion: '2025-11-25',
      transport: transports.client,
    })
    void (async () => {
      await handleServerInitialize(transports.server, {
        protocolVersion: '2025-11-25',
        capabilities: {},
        serverInfo: { name: 's', version: '1' },
      })
    })()
    const result = await client.initialize()
    expect(result.protocolVersion).toBe('2025-11-25')
    await transports.dispose()
  })
})

/**
 * A `2026-07-28` client whose read loop is running, with the transports it runs on. That
 * revision has no handshake, so the only way to settle `#ready` — and therefore start the read
 * loop a server-initiated frame needs — is to make a request first.
 */
async function createReady20260728Transports(): Promise<
  DirectTransports<ServerMessage, ClientMessage>
> {
  const transports = new DirectTransports<ServerMessage, ClientMessage>()
  const client = new ContextClient({
    protocolVersion: '2026-07-28',
    transport: transports.client,
  })
  const listing = client.listPrompts()
  const incoming = await transports.server.read()
  transports.server.write({
    jsonrpc: '2.0',
    id: (incoming.value as ClientRequest).id,
    result: { resultType: 'complete', prompts: [] },
  } as ServerMessage)
  await listing
  return transports
}

describe('protocol version selection', () => {
  // `listPrompts` is deliberate: it is not capability-gated, so these tests exercise
  // decoration and handshake behavior without depending on Task 10's discover-backed gating.
  test('2026-07-28 sends no initialize and decorates every request', async () => {
    const { client, sent } = createTestClient({
      protocolVersion: '2026-07-28',
      respond: () => ({ resultType: 'complete', prompts: [] }),
    })
    await client.listPrompts()
    expect(sent.map((message) => message.method)).toEqual(['prompts/list'])
    const params = sent[0].params as { _meta: Record<string, unknown> }
    expect(params._meta['io.modelcontextprotocol/protocolVersion']).toBe('2026-07-28')
    expect(params._meta['io.modelcontextprotocol/clientCapabilities']).toEqual({})
  })

  test('2025-11-25 still runs the handshake and sends no protocol _meta', async () => {
    const { client, sent } = createTestClient({
      protocolVersion: '2025-11-25',
      respond: () => ({ prompts: [] }),
    })
    await client.listPrompts()
    expect(sent.map((message) => message.method)).toEqual([
      'initialize',
      'notifications/initialized',
      'prompts/list',
    ])
    const params = sent[2].params as { _meta?: Record<string, unknown> } | undefined
    expect(params?._meta?.['io.modelcontextprotocol/protocolVersion']).toBeUndefined()
  })

  test('refuses sampling handlers on 2026-07-28 at construction', () => {
    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    expect(
      () =>
        new ContextClient({
          transport: transports.client,
          protocolVersion: '2026-07-28',
          createMessage: () => ({
            content: { type: 'text', text: '' },
            model: 'test',
            role: 'assistant',
          }),
        }),
    ).toThrow(MRTRNotSupportedError)
  })

  test('rejects an input_required result until MRTR lands', async () => {
    const { client } = createTestClient({
      protocolVersion: '2026-07-28',
      respond: () => ({ resultType: 'input_required', inputRequests: [] }),
    })
    await expect(client.callTool({ name: 'echo', arguments: {} })).rejects.toThrow(
      InputRequiredNotSupportedError,
    )
  })

  test('protocolVersion getter returns the configured revision', () => {
    const { client } = createTestClient({ protocolVersion: '2026-07-28' })
    expect(client.protocolVersion).toBe('2026-07-28')
  })

  test('protocolVersion getter throws before an auto probe resolves', () => {
    const { client } = createTestClient({ protocolVersion: 'auto' })
    expect(() => client.protocolVersion).toThrow()
  })

  test('initialize() throws when the configured revision has no handshake', async () => {
    const { client } = createTestClient({ protocolVersion: '2026-07-28' })
    await expect(client.initialize()).rejects.toThrow(/does not require a handshake/)
  })

  // `ping` is in `2025-11-25`'s `serverMethods` and the spec makes answering it a MUST, so the
  // client must reply `{}`. `2026-07-28` removes the method, so the same frame must not be
  // answered there — the counterpart of `@mokei/context-server`'s own ping pair.
  test('answers ping on 2025-11-25', async () => {
    await expectClientResponse(
      { protocolVersion: '2025-11-25' },
      { method: 'ping' },
      { result: {} },
    )
  })

  test('does not answer ping on 2026-07-28, which removed the method', async () => {
    const transports = await createReady20260728Transports()

    transports.server.write({ jsonrpc: '2.0', id: 99, method: 'ping' } as ServerMessage)
    const response = await transports.server.read()
    expect(response.value).toMatchObject({ jsonrpc: '2.0', id: 99 })
    expect((response.value as Record<string, unknown>).error).toBeDefined()
    expect((response.value as Record<string, unknown>).result).toBeUndefined()

    await transports.dispose()
  })

  // The wire parser, not the handler switch, is where a peer sending something its own revision
  // cannot produce must be refused: `2026-07-28` has an empty `serverMethods`, so
  // `sampling/createMessage` is not a request that revision admits at all.
  test('2026-07-28 rejects a server request its revision cannot produce', async () => {
    const transports = await createReady20260728Transports()

    transports.server.write({
      jsonrpc: '2.0',
      id: 99,
      method: 'sampling/createMessage',
      params: { maxTokens: 1, messages: [] },
    } as ServerMessage)
    await expect(transports.server.read()).resolves.toMatchObject({
      done: false,
      value: { jsonrpc: '2.0', id: 99, error: { code: INVALID_REQUEST } },
    })

    await transports.dispose()
  })

  test('2025-11-25 still accepts a server request its revision does produce', async () => {
    await expectClientResponse(
      {
        protocolVersion: '2025-11-25',
        listRoots: [{ name: 'root', uri: 'file:///root' }],
      },
      { method: 'roots/list' },
      { result: { roots: [{ name: 'root', uri: 'file:///root' }] } },
    )
  })
})

describe('discover()', () => {
  test('caches its result for ttlMs', async () => {
    const { client, sent } = createTestClient({
      protocolVersion: '2026-07-28',
      respond: () => ({
        resultType: 'complete',
        supportedVersions: ['2026-07-28'],
        capabilities: { tools: {} },
        ttlMs: 60_000,
        cacheScope: 'public',
      }),
    })
    const first = await client.discover()
    const second = await client.discover()
    expect(second).toEqual(first)
    expect(sent.filter((message) => message.method === 'server/discover')).toHaveLength(1)
  })

  test('is rejected on 2025-11-25', async () => {
    const { client } = createTestClient({ protocolVersion: '2025-11-25' })
    await expect(client.discover()).rejects.toThrow(/use initialize\(\)/)
  })

  test('listTools rejects with CapabilityNotDeclaredError when the discovered capabilities omit tools', async () => {
    const { client } = createTestClient({
      protocolVersion: '2026-07-28',
      respond: (message) =>
        message.method === 'server/discover'
          ? {
              resultType: 'complete',
              supportedVersions: ['2026-07-28'],
              capabilities: {},
              ttlMs: 0,
              cacheScope: 'private',
            }
          : { resultType: 'complete', tools: [] },
    })
    await expect(client.listTools()).rejects.toThrow(CapabilityNotDeclaredError)
  })

  // Closes the gap Task 9's review flagged: on 2026-07-28, `#serverCapabilities` never
  // populates (there is no handshake), so before this task `listTools()` could not
  // succeed on this revision at all. This proves the positive case, not just the rejection.
  test('listTools succeeds on 2026-07-28 when the discovered capabilities declare tools', async () => {
    const { client } = createTestClient({
      protocolVersion: '2026-07-28',
      respond: (message) =>
        message.method === 'server/discover'
          ? {
              resultType: 'complete',
              supportedVersions: ['2026-07-28'],
              capabilities: { tools: {} },
              ttlMs: 0,
              cacheScope: 'private',
            }
          : { resultType: 'complete', tools: [] },
    })
    await expect(client.listTools()).resolves.toEqual({ resultType: 'complete', tools: [] })
  })

  // `2026-07-28` still advertises `logging: {}` in its capabilities even though
  // `logging/setLevel` is gone from `clientMethods` — gating this on the discovered
  // capabilities would pass and send a method the server would answer with
  // METHOD_NOT_FOUND. It must refuse client-side instead, without ever calling discover().
  test('setLoggingLevel refuses client-side on 2026-07-28 without consulting discovered capabilities', async () => {
    const { client, sent } = createTestClient({
      protocolVersion: '2026-07-28',
      respond: (message) =>
        message.method === 'server/discover'
          ? {
              resultType: 'complete',
              supportedVersions: ['2026-07-28'],
              capabilities: { logging: {} },
              ttlMs: 60_000,
              cacheScope: 'public',
            }
          : undefined,
    })
    await expect(client.setLoggingLevel({ level: 'info' })).rejects.toThrow(
      MethodNotInRevisionError,
    )
    expect(sent.some((message) => message.method === 'server/discover')).toBe(false)
  })

  // Regression test for the bug that blocked Task 10's review: an unconfigured server
  // returns `ttlMs: 0`, which used to make the capability *gate* re-issue `server/discover`
  // before every gated call, forever. The gate must snapshot the discovered capabilities for
  // the connection's lifetime instead, independent of `discover()`'s own `ttlMs` cache.
  test('the capability gate sends server/discover exactly once across two gated calls, even when ttlMs is 0', async () => {
    const { client, sent } = createTestClient({
      protocolVersion: '2026-07-28',
      respond: (message) =>
        message.method === 'server/discover'
          ? {
              resultType: 'complete',
              supportedVersions: ['2026-07-28'],
              capabilities: { tools: {} },
              ttlMs: 0,
              cacheScope: 'private',
            }
          : { resultType: 'complete', tools: [] },
    })
    await client.listTools()
    await client.listTools()
    expect(sent.filter((message) => message.method === 'server/discover')).toHaveLength(1)
  })

  // The gating snapshot is justified by "a live connection's declared capabilities cannot change
  // except via a `*_list_changed` notification" — so that notification has to clear it, or
  // `discover()` and the gate disagree permanently and `listTools()` never recovers.
  test('a tools/list_changed notification reopens the capability gate', async () => {
    let declaresTools = false
    const { client, transports } = createTestClient({
      protocolVersion: '2026-07-28',
      respond: (message) =>
        message.method === 'server/discover'
          ? {
              resultType: 'complete',
              supportedVersions: ['2026-07-28'],
              capabilities: declaresTools ? { tools: {} } : {},
              ttlMs: 0,
              cacheScope: 'private',
            }
          : { resultType: 'complete', tools: [] },
    })
    await expect(client.listTools()).rejects.toThrow(CapabilityNotDeclaredError)

    declaresTools = true
    // Reading the notification back is what makes this deterministic: `_handleNotification`
    // clears the caches before the frame reaches the stream.
    const reader = client.notifications.getReader()
    transports.server.write({
      jsonrpc: '2.0',
      method: 'notifications/tools/list_changed',
    } as ServerMessage)
    await reader.read()
    reader.releaseLock()

    await expect(client.listTools()).resolves.toEqual({ resultType: 'complete', tools: [] })
  })

  test('re-requests when its own ttlMs has expired', async () => {
    const { client, sent } = createTestClient({
      protocolVersion: '2026-07-28',
      respond: () => ({
        resultType: 'complete',
        supportedVersions: ['2026-07-28'],
        capabilities: { tools: {} },
        ttlMs: 0,
        cacheScope: 'private',
      }),
    })
    await client.discover()
    await client.discover()
    expect(sent.filter((message) => message.method === 'server/discover')).toHaveLength(2)
  })

  test('a rejected discover clears #discovering so a retry re-requests', async () => {
    let calls = 0
    const { client, sent } = createTestClient({
      protocolVersion: '2026-07-28',
      respond: (message) => {
        if (message.method !== 'server/discover') {
          return undefined
        }
        calls += 1
        return calls === 1
          ? { error: { code: -32000, message: 'discover failed' } }
          : {
              resultType: 'complete',
              supportedVersions: ['2026-07-28'],
              capabilities: { tools: {} },
              ttlMs: 60_000,
              cacheScope: 'public',
            }
      },
    })
    await expect(client.discover()).rejects.toThrow(/discover failed/)
    await expect(client.discover()).resolves.toMatchObject({ capabilities: { tools: {} } })
    expect(sent.filter((message) => message.method === 'server/discover')).toHaveLength(2)
  })

  test('concurrent callers collapse onto one in-flight request', async () => {
    const { client, sent } = createTestClient({
      protocolVersion: '2026-07-28',
      respond: () => ({
        resultType: 'complete',
        supportedVersions: ['2026-07-28'],
        capabilities: { tools: {} },
        ttlMs: 60_000,
        cacheScope: 'public',
      }),
    })
    const [first, second] = await Promise.all([client.discover(), client.discover()])
    expect(second).toEqual(first)
    expect(sent.filter((message) => message.method === 'server/discover')).toHaveLength(1)
  })

  test('complete succeeds on 2026-07-28 when the discovered capabilities declare completions', async () => {
    const { client } = createTestClient({
      protocolVersion: '2026-07-28',
      respond: (message) =>
        message.method === 'server/discover'
          ? {
              resultType: 'complete',
              supportedVersions: ['2026-07-28'],
              capabilities: { completions: {} },
              ttlMs: 0,
              cacheScope: 'private',
            }
          : {
              resultType: 'complete',
              completion: { values: [], total: 0, hasMore: false },
            },
    })
    await expect(
      client.complete({
        ref: { type: 'ref/prompt', name: 'test' },
        argument: { name: 'arg', value: '' },
      }),
    ).resolves.toEqual({
      resultType: 'complete',
      completion: { values: [], total: 0, hasMore: false },
    })
  })

  test('complete rejects with CapabilityNotDeclaredError when the discovered capabilities omit completions', async () => {
    const { client } = createTestClient({
      protocolVersion: '2026-07-28',
      respond: (message) =>
        message.method === 'server/discover'
          ? {
              resultType: 'complete',
              supportedVersions: ['2026-07-28'],
              capabilities: {},
              ttlMs: 0,
              cacheScope: 'private',
            }
          : {
              resultType: 'complete',
              completion: { values: [], total: 0, hasMore: false },
            },
    })
    await expect(
      client.complete({
        ref: { type: 'ref/prompt', name: 'test' },
        argument: { name: 'arg', value: '' },
      }),
    ).rejects.toThrow(CapabilityNotDeclaredError)
  })
})

describe("'auto' probe", () => {
  test("'auto' resolves to 2026-07-28 when discover answers", async () => {
    const { client } = createTestClient({
      protocolVersion: 'auto',
      respond: () => ({
        resultType: 'complete',
        supportedVersions: ['2026-07-28'],
        capabilities: { tools: {} },
        ttlMs: 0,
        cacheScope: 'private',
      }),
    })
    await client.listPrompts()
    expect(client.protocolVersion).toBe('2026-07-28')
  })

  test("'auto' falls back to 2025-11-25 when discover is not a known method", async () => {
    const { client, sent } = createTestClient({
      protocolVersion: 'auto',
      respond: (message) =>
        message.method === 'server/discover'
          ? { error: { code: -32601, message: 'Method not found' } }
          : undefined,
    })
    await client.listPrompts()
    expect(client.protocolVersion).toBe('2025-11-25')
    expect(sent.map((message) => message.method)).toEqual([
      'server/discover',
      'initialize',
      'notifications/initialized',
      'prompts/list',
    ])
  })

  // Correction 1: the brief's own probe design mirrors #initialize()'s bounded-read shape with
  // an independent `_read()`, and that loses this race. The transport's reader is shared and
  // reads are served FIFO (@enkaku/transport's Transport#read() calls reader.read() on one
  // ReadableStreamDefaultReader obtained once via _getReader()): a probe that times out leaves
  // its own `_read()` pending — a losing `Promise.race` branch doesn't cancel it — and a fresh,
  // independent `_read()` issued by #initialize() afterward would queue FIFO behind it. The
  // initialize response would then resolve the *abandoned* probe read instead of #initialize()'s
  // own read, which would wait forever for a message that already arrived and silently went
  // to the wrong waiter, eventually dying with its own RequestTimeoutError.
  //
  // This test proves the fix rather than papering over the symptom: it asserts the handshake
  // actually *succeeds* (a real listPrompts() round trip resolves, and `sent` shows the full,
  // correctly-ordered frame sequence), not merely that `protocolVersion` reads '2025-11-25'
  // after the client failed some other way.
  test("'auto' falls back when the probe times out, and the handshake that follows succeeds", async () => {
    const { client, sent } = createTestClient({
      protocolVersion: 'auto',
      setupTimeout: 50,
      respond: (message) => (message.method === 'server/discover' ? WITHHOLD : undefined),
    })
    await expect(client.listPrompts()).resolves.toEqual({ prompts: [] })
    expect(client.protocolVersion).toBe('2025-11-25')
    expect(sent.map((message) => message.method)).toEqual([
      'server/discover',
      'initialize',
      'notifications/initialized',
      'prompts/list',
    ])
  })

  test("'auto' retries with a mutually supported version on -32022", async () => {
    const { client } = createTestClient({
      protocolVersion: 'auto',
      respond: (message) =>
        message.method === 'server/discover'
          ? {
              error: {
                code: -32022,
                message: 'Unsupported protocol version',
                data: { supported: ['2025-11-25'], requested: '2026-07-28' },
              },
            }
          : undefined,
    })
    await client.listPrompts()
    expect(client.protocolVersion).toBe('2025-11-25')
  })

  // Correction 3, gap 1: `getPrompt`, `readResource` and `callTool` call `request()` directly
  // with no `#ready` await of their own (unlike `setLoggingLevel`/`complete`/`listTools`/
  // `#listPaged`). Before this task, calling any of them *first* under `protocolVersion: 'auto'`
  // threw "not resolved yet" synchronously instead of running the probe. Each of the next three
  // tests calls one of them as the very first thing done with a fresh client, so it actually
  // exercises the gap rather than riding on a probe some earlier call already triggered.
  test("'auto' resolves via getPrompt when it is the first call made", async () => {
    const { client } = createTestClient({
      protocolVersion: 'auto',
      respond: (message) =>
        message.method === 'server/discover'
          ? {
              resultType: 'complete',
              supportedVersions: ['2026-07-28'],
              capabilities: {},
              ttlMs: 0,
              cacheScope: 'private',
            }
          : { resultType: 'complete', description: 'd', messages: [] },
    })
    await expect(client.getPrompt({ name: 'test', arguments: {} })).resolves.toEqual({
      resultType: 'complete',
      description: 'd',
      messages: [],
    })
    expect(client.protocolVersion).toBe('2026-07-28')
  })

  test("'auto' resolves via readResource when it is the first call made", async () => {
    const { client } = createTestClient({
      protocolVersion: 'auto',
      respond: (message) =>
        message.method === 'server/discover'
          ? {
              resultType: 'complete',
              supportedVersions: ['2026-07-28'],
              capabilities: {},
              ttlMs: 0,
              cacheScope: 'private',
            }
          : { resultType: 'complete', contents: [] },
    })
    await expect(client.readResource({ uri: 'file:///test' })).resolves.toEqual({
      resultType: 'complete',
      contents: [],
    })
    expect(client.protocolVersion).toBe('2026-07-28')
  })

  test("'auto' resolves via callTool when it is the first call made", async () => {
    const { client } = createTestClient({
      protocolVersion: 'auto',
      respond: (message) =>
        message.method === 'server/discover'
          ? {
              resultType: 'complete',
              supportedVersions: ['2026-07-28'],
              capabilities: {},
              ttlMs: 0,
              cacheScope: 'private',
            }
          : { resultType: 'complete', content: [] },
    })
    await expect(client.callTool({ name: 'echo', arguments: {} })).resolves.toEqual({
      resultType: 'complete',
      content: [],
    })
    expect(client.protocolVersion).toBe('2026-07-28')
  })

  // Correction 3, gap 2: the constructor only refuses a createMessage/elicit/listRoots handler
  // when the revision is known synchronously (a fixed protocolVersion). Under 'auto' it was
  // accepted at construction and never re-checked, so a handler configured against a server
  // that turns out to speak 2026-07-28 — whose serverMethods is always empty — went live
  // anyway, and #capabilities kept advertising it in every request's _meta.
  test("'auto' refuses a createMessage handler once the probe resolves to 2026-07-28", async () => {
    const { client } = createTestClient({
      protocolVersion: 'auto',
      createMessage: () => ({
        content: { type: 'text', text: '' },
        model: 'test',
        role: 'assistant',
      }),
      respond: () => ({
        resultType: 'complete',
        supportedVersions: ['2026-07-28'],
        capabilities: {},
        ttlMs: 0,
        cacheScope: 'private',
      }),
    })
    await expect(client.listPrompts()).rejects.toThrow(MRTRNotSupportedError)
  })

  test("'auto' still allows a createMessage handler when the probe falls back to 2025-11-25", async () => {
    const { client } = createTestClient({
      protocolVersion: 'auto',
      createMessage: () => ({
        content: { type: 'text', text: '' },
        model: 'test',
        role: 'assistant',
      }),
      respond: (message) =>
        message.method === 'server/discover'
          ? { error: { code: -32601, message: 'Method not found' } }
          : undefined,
    })
    await expect(client.listPrompts()).resolves.toEqual({ prompts: [] })
    expect(client.protocolVersion).toBe('2025-11-25')
  })
})
