import { DirectTransports } from '@enkaku/transport'
import type {
  ClientMessage,
  ClientRequest,
  CreateMessageRequest,
  CreateMessageResult,
  ElicitRequest,
  ElicitResult,
  Log,
  ServerMessage,
} from '@mokei/context-protocol'
import { INTERNAL_ERROR, INVALID_PARAMS, LATEST_PROTOCOL_VERSION } from '@mokei/context-protocol'
import { describe, expect, test, vi } from 'vitest'

import {
  ContextServer,
  createPrompt,
  createTool,
  type GenericToolDefinition,
  type Schema,
  type ServerParams,
} from '../src/index.js'

type TestContext = {
  server: ContextServer
  transports: DirectTransports<ServerMessage, ClientMessage>
}

type TestContextParams = Omit<ServerParams, 'name' | 'transport' | 'version'>

function createTestContext(params: TestContextParams = {}): TestContext {
  const transports = new DirectTransports<ServerMessage, ClientMessage>()
  const server = new ContextServer({
    name: 'test',
    version: '0.0.0',
    transport: transports.server,
    ...params,
  })
  return { server, transports }
}

async function expectServerResponse(
  params: TestContextParams,
  request: Omit<ClientRequest, 'jsonrpc' | 'id'>,
  response: Record<string, unknown>,
): Promise<void> {
  const { transports } = createTestContext(params)
  transports.client.write({ jsonrpc: '2.0' as const, id: 1, ...request } as ClientRequest)
  await expect(transports.client.read()).resolves.toEqual({
    done: false,
    value: { jsonrpc: '2.0', id: 1, ...response },
  })
  await transports.dispose()
}

async function expectServerResult(
  params: TestContextParams,
  request: Omit<ClientRequest, 'jsonrpc' | 'id'>,
  result: unknown,
): Promise<void> {
  await expectServerResponse(params, request, { result })
}

async function expectServerError(
  params: TestContextParams,
  request: Omit<ClientRequest, 'jsonrpc' | 'id'>,
  error: unknown,
): Promise<void> {
  await expectServerResponse(params, request, { error })
}

const expectedClient = {
  createMessage: expect.any(Function),
  elicit: expect.any(Function),
  listRoots: expect.any(Function),
  log: expect.any(Function),
}

describe('ContextServer', () => {
  test('supports initialization lifecycle', async () => {
    const { server, transports } = createTestContext()

    const params = {
      capabilities: {},
      clientInfo: { name: 'mokei', version: '0.0.0' },
      protocolVersion: LATEST_PROTOCOL_VERSION,
    }

    transports.client.write({
      jsonrpc: '2.0' as const,
      id: 1,
      method: 'initialize',
      params,
    } as ClientRequest)

    await expect(server.events.once('initialize')).resolves.toBe(params)

    await expect(transports.client.read()).resolves.toEqual({
      done: false,
      value: {
        jsonrpc: '2.0',
        id: 1,
        result: {
          capabilities: { logging: {} },
          protocolVersion: LATEST_PROTOCOL_VERSION,
          serverInfo: { name: 'test', version: '0.0.0' },
        },
      },
    })

    const initialized = server.events.once('initialized')
    transports.client.write({ jsonrpc: '2.0', method: 'notifications/initialized' })
    await initialized
    expect(server.clientInitialize).toBe(params)

    await server.dispose()
  })

  test('supports sending logs', async () => {
    const { server, transports } = createTestContext()
    const serverLogs: Array<Log> = []
    server.events.on('log', (log) => {
      serverLogs.push(log)
    })

    server.log({ level: 'info', data: { test: 0 } })

    transports.client.write({
      jsonrpc: '2.0',
      id: 1,
      method: 'logging/setLevel',
      params: { level: 'notice' },
    })
    await expect(transports.client.read()).resolves.toEqual({
      done: false,
      value: { jsonrpc: '2.0', id: 1, result: {} },
    })

    server.log({ level: 'info', data: { test: 1 } })
    server.log({ level: 'notice', data: { test: 2 } })
    server.log({ level: 'warning', data: { test: 3 } })

    await expect(transports.client.read()).resolves.toEqual({
      done: false,
      value: {
        jsonrpc: '2.0',
        method: 'notifications/message',
        params: { level: 'notice', data: { test: 2 } },
      },
    })
    await expect(transports.client.read()).resolves.toEqual({
      done: false,
      value: {
        jsonrpc: '2.0',
        method: 'notifications/message',
        params: { level: 'warning', data: { test: 3 } },
      },
    })

    transports.client.write({
      jsonrpc: '2.0',
      id: 2,
      method: 'logging/setLevel',
      params: { level: 'info' },
    })
    await expect(transports.client.read()).resolves.toEqual({
      done: false,
      value: { jsonrpc: '2.0', id: 2, result: {} },
    })

    server.log({ level: 'info', data: { test: 4 } })
    server.log({ level: 'notice', data: { test: 5 } })
    await expect(transports.client.read()).resolves.toEqual({
      done: false,
      value: {
        jsonrpc: '2.0',
        method: 'notifications/message',
        params: { level: 'info', data: { test: 4 } },
      },
    })
    await expect(transports.client.read()).resolves.toEqual({
      done: false,
      value: {
        jsonrpc: '2.0',
        method: 'notifications/message',
        params: { level: 'notice', data: { test: 5 } },
      },
    })

    await server.dispose()
    expect(serverLogs).toEqual([
      { level: 'info', data: { test: 0 } },
      { level: 'info', data: { test: 1 } },
      { level: 'notice', data: { test: 2 } },
      { level: 'warning', data: { test: 3 } },
      { level: 'info', data: { test: 4 } },
      { level: 'notice', data: { test: 5 } },
    ])
  })

  test('supports outgoing roots list requests', async () => {
    const { server, transports } = createTestContext()
    const roots = [{ name: 'test', url: 'test://test' }]

    const responsePromise = server.listRoots()
    await expect(transports.client.read()).resolves.toEqual({
      done: false,
      value: { jsonrpc: '2.0', id: 0, method: 'roots/list', params: {} },
    })

    transports.client.write({ jsonrpc: '2.0', id: 0, result: { roots } })
    await expect(responsePromise).resolves.toEqual({ roots })

    await transports.dispose()
  })

  test('supports outgoing sampling messages requests', async () => {
    const { server, transports } = createTestContext()

    const params: CreateMessageRequest['params'] = {
      messages: [{ role: 'user', content: { type: 'text', text: 'hello' } }],
      maxTokens: 100,
    }
    const result: CreateMessageResult = {
      role: 'assistant',
      model: 'foo',
      content: { type: 'text', text: 'test' },
    }

    const responsePromise = server.createMessage(params)
    await expect(transports.client.read()).resolves.toEqual({
      done: false,
      value: { jsonrpc: '2.0', id: 0, method: 'sampling/createMessage', params },
    })

    transports.client.write({ jsonrpc: '2.0', id: 0, result })
    await expect(responsePromise).resolves.toEqual(result)

    await transports.dispose()
  })

  test('supports outgoing elicit requests', async () => {
    const { server, transports } = createTestContext()

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

    const responsePromise = server.elicit(params)
    await expect(transports.client.read()).resolves.toEqual({
      done: false,
      value: { jsonrpc: '2.0', id: 0, method: 'elicitation/create', params },
    })

    transports.client.write({ jsonrpc: '2.0', id: 0, result })
    await expect(responsePromise).resolves.toEqual(result)

    await transports.dispose()
  })

  test('outgoing request transport options never reach the wire', async () => {
    const { server, transports } = createTestContext()

    const params: ElicitRequest['params'] = {
      message: 'Run this test?',
      requestedSchema: { type: 'object', properties: { run: { type: 'string' } } },
    }
    const controller = new AbortController()

    // signal/timeout share one object with the request's params, so they must be stripped
    // before the params are sent: the peer sees the elicitation and nothing else.
    const responsePromise = server.elicit({ ...params, signal: controller.signal, timeout: 30_000 })
    await expect(transports.client.read()).resolves.toEqual({
      done: false,
      value: { jsonrpc: '2.0', id: 0, method: 'elicitation/create', params },
    })

    transports.client.write({
      jsonrpc: '2.0',
      id: 0,
      result: { action: 'accept', content: { run: 'once' } },
    })
    await expect(responsePromise).resolves.toEqual({
      action: 'accept',
      content: { run: 'once' },
    })

    await transports.dispose()
  })

  test('supports incoming completion requests', async () => {
    const params = {
      ref: { type: 'ref/prompt', name: 'test' },
      argument: { name: 'test', value: 'one' },
    }
    const completion = { values: ['one', 'two'] }

    const complete = vi.fn(() => ({ completion }))
    await expectServerResult(
      { complete },
      { method: 'completion/complete', params },
      { completion },
    )
    expect(complete).toHaveBeenCalledWith({
      client: expect.objectContaining(expectedClient),
      params,
      signal: expect.any(AbortSignal),
    })
  })

  describe('supports incoming prompt requests', () => {
    test('lists available prompts', async () => {
      await expectServerResult(
        {
          prompts: {
            foo: createPrompt({
              description: 'prompt foo',
              argumentsSchema: { type: 'object' },
              handler: () => {
                return {
                  messages: [
                    { role: 'assistant' as const, content: { type: 'text' as const, text: 'foo' } },
                  ],
                }
              },
            }),
            bar: {
              description: 'prompt bar',
              handler: () => {
                return {
                  messages: [
                    { role: 'assistant' as const, content: { type: 'text' as const, text: 'bar' } },
                  ],
                }
              },
            },
          },
        },
        { method: 'prompts/list' },
        {
          prompts: [
            {
              name: 'bar',
              description: 'prompt bar',
              argumentsSchema: undefined,
            },
            {
              name: 'foo',
              description: 'prompt foo',
              argumentsSchema: { type: 'object' },
            },
          ],
        },
      )
    })

    test('gets a prompt', async () => {
      await expectServerResult(
        {
          prompts: {
            hello: createPrompt({
              description: 'Hello prompt',
              argumentsSchema: {
                type: 'object',
                properties: { name: { type: 'string' } },
              } as const satisfies Schema,
              handler: (req) => {
                return {
                  messages: [
                    {
                      role: 'assistant',
                      content: {
                        type: 'text',
                        text: req.input.name ? `Hello, my name is ${req.input.name}` : 'Hello',
                      },
                    },
                  ],
                }
              },
            }),
          },
        },
        {
          method: 'prompts/get',
          params: {
            name: 'hello',
            arguments: { name: 'Bob' },
          },
        },
        {
          messages: [
            {
              role: 'assistant',
              content: { type: 'text', text: 'Hello, my name is Bob' },
            },
          ],
        },
      )
    })

    test('validates prompt arguments', async () => {
      await expectServerError(
        {
          prompts: {
            hello: createPrompt({
              description: 'Hello prompt',
              argumentsSchema: {
                type: 'object',
                properties: { name: { type: 'string' } },
                required: ['name'],
              },
              handler: () => {
                return {
                  messages: [
                    {
                      role: 'assistant' as const,
                      content: { type: 'text' as const, text: 'Hello' },
                    },
                  ],
                }
              },
            }),
          },
        },
        {
          method: 'prompts/get',
          params: {
            name: 'hello',
            arguments: {},
          },
        },
        {
          code: INVALID_PARAMS,
          message: 'Invalid prompt arguments',
          data: {
            issues: [{ message: "must have required property 'name'", path: [] }],
          },
        },
      )
    })
  })

  describe('supports incoming resource requests', () => {
    test('lists available resources by calling the provided handler', async () => {
      const resources = [
        { name: 'foo', uri: 'test://foo' },
        { name: 'bar', uri: 'test://bar' },
      ]

      await expectServerResult(
        {
          resources: {
            list: () => ({ resources }),
            read: () => ({ contents: [] }),
          },
        },
        { method: 'resources/list' },
        { resources },
      )
    })

    test('lists available resources provided directly', async () => {
      const resources = [
        { name: 'foo', uri: 'test://foo' },
        { name: 'bar', uri: 'test://bar' },
      ]

      await expectServerResult(
        {
          resources: {
            list: resources,
            read: () => ({ contents: [] }),
          },
        },
        { method: 'resources/list' },
        { resources },
      )
    })

    test('lists available resources templates by calling the provided handler', async () => {
      const resourceTemplates = [
        { name: 'foo', uriTemplate: 'test://foo/{name}' },
        { name: 'bar', uriTemplate: 'test://bar/{name}' },
      ]

      await expectServerResult(
        {
          resources: {
            listTemplates: () => ({ resourceTemplates }),
            read: () => ({ contents: [] }),
          },
        },
        { method: 'resources/templates/list' },
        { resourceTemplates },
      )
    })

    test('lists available resources templates provided directly', async () => {
      const resourceTemplates = [
        { name: 'foo', uriTemplate: 'test://foo/{name}' },
        { name: 'bar', uriTemplate: 'test://bar/{name}' },
      ]

      await expectServerResult(
        {
          resources: {
            listTemplates: resourceTemplates,
            read: () => ({ contents: [] }),
          },
        },
        { method: 'resources/templates/list' },
        { resourceTemplates },
      )
    })

    test('reads a resources', async () => {
      await expectServerResult(
        {
          resources: {
            read: ({ params }) => {
              return { contents: [{ uri: params.uri, text: 'test resource' }] }
            },
          },
        },
        { method: 'resources/read', params: { uri: 'test://foo' } },
        { contents: [{ uri: 'test://foo', text: 'test resource' }] },
      )
    })
  })

  describe('Error codes (MCP draft alignment)', () => {
    test('unknown tool returns INVALID_PARAMS (-32602)', async () => {
      const { transports } = createTestContext({
        tools: {
          known: createTool({
            description: 'x',
            inputSchema: { type: 'object' },
            handler: async () => ({ content: [] }),
          }),
        },
      })
      transports.client.write({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'missing' },
      } as ClientRequest)
      const res = await transports.client.read()
      expect(res.value).toMatchObject({ id: 1, error: { code: INVALID_PARAMS } })
      await transports.dispose()
    })
  })

  describe('Cache hints on lists', () => {
    test('tools/list includes configured ttlMs and cacheScope', async () => {
      const { transports } = createTestContext({
        cache: { ttlMs: 60000, cacheScope: 'public' },
        tools: {
          a: createTool({
            description: 'a',
            inputSchema: { type: 'object' },
            handler: async () => ({ content: [] }),
          }),
        },
      })
      transports.client.write({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      } as ClientRequest)
      const res = await transports.client.read()
      expect(res.value).toMatchObject({ result: { ttlMs: 60000, cacheScope: 'public' } })
      await transports.dispose()
    })
  })

  describe('Deterministic list ordering', () => {
    test('tools/list returns tools sorted by name', async () => {
      const noop = async () => ({ content: [] as [] })
      const { transports } = createTestContext({
        tools: {
          charlie: createTool({ description: 'c', inputSchema: { type: 'object' }, handler: noop }),
          alpha: createTool({ description: 'a', inputSchema: { type: 'object' }, handler: noop }),
          bravo: createTool({ description: 'b', inputSchema: { type: 'object' }, handler: noop }),
        },
      })
      transports.client.write({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      } as ClientRequest)
      const res = await transports.client.read()
      const names = (res.value as { result: { tools: Array<{ name: string }> } }).result.tools.map(
        (t) => t.name,
      )
      expect(names).toEqual(['alpha', 'bravo', 'charlie'])
      await transports.dispose()
    })
  })

  test('declares logging always and completions when complete handler set', async () => {
    const initParams = {
      capabilities: {},
      clientInfo: { name: 'test-client', version: '0.0.0' },
      protocolVersion: LATEST_PROTOCOL_VERSION,
    }

    // Server WITH a complete handler — logging and completions must both appear
    const { transports: t1 } = createTestContext({
      complete: async () => ({ completion: { values: [] } }),
    })
    t1.client.write({
      jsonrpc: '2.0' as const,
      id: 1,
      method: 'initialize',
      params: initParams,
    } as ClientRequest)
    const res1 = await t1.client.read()
    const caps1 = (res1.value as { result: { capabilities: Record<string, unknown> } }).result
      .capabilities
    expect(caps1.logging).toEqual({})
    expect(caps1.completions).toEqual({})
    await t1.dispose()

    // Server WITHOUT a complete handler — logging present, completions absent
    const { transports: t2 } = createTestContext({})
    t2.client.write({
      jsonrpc: '2.0' as const,
      id: 1,
      method: 'initialize',
      params: initParams,
    } as ClientRequest)
    const res2 = await t2.client.read()
    const caps2 = (res2.value as { result: { capabilities: Record<string, unknown> } }).result
      .capabilities
    expect(caps2.logging).toEqual({})
    expect(caps2.completions).toBeUndefined()
    await t2.dispose()
  })

  test('declares listChanged:true for tools/prompts/resources it serves', async () => {
    const { transports } = createTestContext({
      tools: {
        a: createTool({
          description: 'a',
          inputSchema: { type: 'object' },
          handler: async () => ({ content: [] }),
        }),
      },
      prompts: {
        p: {
          description: 'prompt p',
          handler: () => ({
            messages: [
              { role: 'assistant' as const, content: { type: 'text' as const, text: 'p' } },
            ],
          }),
        },
      },
      resources: { list: [], read: () => ({ contents: [] }) },
    })
    transports.client.write({
      jsonrpc: '2.0' as const,
      id: 1,
      method: 'initialize',
      params: {
        capabilities: {},
        clientInfo: { name: 'test-client', version: '0.0.0' },
        protocolVersion: LATEST_PROTOCOL_VERSION,
      },
    } as ClientRequest)
    const res = await transports.client.read()
    const caps = (res.value as { result: { capabilities: Record<string, unknown> } }).result
      .capabilities
    expect(caps.tools).toEqual({ listChanged: true })
    expect(caps.prompts).toEqual({ listChanged: true })
    expect(caps.resources).toMatchObject({ listChanged: true })
    await transports.dispose()
  })

  describe('Progress emitter', () => {
    test('handler can emit progress when a progressToken is provided', async () => {
      const { transports } = createTestContext({
        tools: {
          work: createTool({
            description: 'work',
            inputSchema: { type: 'object', properties: {} },
            handler: async ({ progress }) => {
              progress?.({ progress: 0.5, total: 1 })
              return { content: [{ type: 'text', text: 'done' }] }
            },
          }),
        },
      })

      transports.client.write({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'work', arguments: {}, _meta: { progressToken: 'p1' } },
      } as ClientRequest)

      // Progress notification arrives before the tools/call response
      const notif = await transports.client.read()
      expect(notif.value).toMatchObject({
        jsonrpc: '2.0',
        method: 'notifications/progress',
        params: expect.objectContaining({ progressToken: 'p1', progress: 0.5 }),
      })

      const res = await transports.client.read()
      expect(res.value).toMatchObject({
        id: 1,
        result: { content: [{ type: 'text', text: 'done' }] },
      })

      await transports.dispose()
    })
  })

  describe('inherited-prop tool/prompt lookup', () => {
    test('tools/call with an inherited prop name returns not found', async () => {
      const { transports } = createTestContext({
        tools: {
          real: createTool({
            description: 'real',
            inputSchema: { type: 'object' },
            handler: async () => ({ content: [] }),
          }),
        },
      })
      transports.client.write({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'constructor', arguments: {} },
      } as ClientRequest)
      const res = await transports.client.read()
      expect(res.value).toMatchObject({ id: 1, error: { code: INVALID_PARAMS } })
      await transports.dispose()
    })

    test('prompts/get with an inherited prop name returns not found', async () => {
      const { transports } = createTestContext({
        prompts: {
          real: {
            description: 'real prompt',
            handler: () => ({
              messages: [
                {
                  role: 'assistant' as const,
                  content: { type: 'text' as const, text: 'hello' },
                },
              ],
            }),
          },
        },
      })
      transports.client.write({
        jsonrpc: '2.0',
        id: 1,
        method: 'prompts/get',
        params: { name: 'constructor' },
      } as ClientRequest)
      const res = await transports.client.read()
      expect(res.value).toMatchObject({ id: 1, error: { code: INVALID_PARAMS } })
      await transports.dispose()
    })
  })

  describe('isError results (SEP-1303)', () => {
    test('tool handler exception becomes an isError result', async () => {
      const { transports } = createTestContext({
        tools: {
          boom: createTool({
            description: 'boom',
            inputSchema: { type: 'object', properties: {} },
            handler: async () => {
              throw new Error('kaboom')
            },
          }),
        },
      })
      transports.client.write({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'boom', arguments: {} },
      } as ClientRequest)
      const res = await transports.client.read()
      expect(res.value).toMatchObject({
        id: 1,
        result: { isError: true, content: [{ type: 'text' }] },
      })
      await transports.dispose()
    })

    test('input-validation error becomes an isError result', async () => {
      const { transports } = createTestContext({
        tools: {
          strict: createTool({
            description: 'strict',
            inputSchema: { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] },
            handler: async () => ({ content: [] }),
          }),
        },
      })
      transports.client.write({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'strict', arguments: {} },
      } as ClientRequest)
      const res = await transports.client.read()
      expect(res.value).toMatchObject({ id: 1, result: { isError: true } })
      await transports.dispose()
    })

    test('unknown tool stays a JSON-RPC error', async () => {
      const { transports } = createTestContext({ tools: {} })
      transports.client.write({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'nope', arguments: {} },
      } as ClientRequest)
      const res = await transports.client.read()
      expect(res.value).toMatchObject({ id: 1, error: { code: INVALID_PARAMS } })
      await transports.dispose()
    })

    // An outputSchema violation is the server author's own contract breach, not a
    // tool telling the model it failed, so it must cross the wire as a JSON-RPC
    // INTERNAL_ERROR rather than be swallowed into an isError result.
    const countSchema = {
      type: 'object',
      properties: { count: { type: 'number' } },
      required: ['count'],
    } as const

    test('a structuredContent violation crosses the wire as INTERNAL_ERROR', async () => {
      const { transports } = createTestContext({
        tools: {
          counter: createTool({
            description: 'counts',
            inputSchema: { type: 'object' } as const,
            outputSchema: countSchema,
            handler: () => ({ structuredContent: { count: 'three' } }) as never,
          }),
        },
      })
      transports.client.write({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'counter', arguments: {} },
      } as ClientRequest)
      const res = await transports.client.read()
      expect(res.value).toMatchObject({
        id: 1,
        error: { code: INTERNAL_ERROR, message: 'Invalid tool output' },
      })
      expect((res.value as { result?: unknown }).result).toBeUndefined()
      await transports.dispose()
    })

    test('a missing structuredContent crosses the wire as INTERNAL_ERROR', async () => {
      const { transports } = createTestContext({
        tools: {
          counter: createTool({
            description: 'counts',
            inputSchema: { type: 'object' } as const,
            outputSchema: countSchema,
            handler: () => ({ content: [] }) as never,
          }),
        },
      })
      transports.client.write({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'counter', arguments: {} },
      } as ClientRequest)
      const res = await transports.client.read()
      expect(res.value).toMatchObject({ id: 1, error: { code: INTERNAL_ERROR } })
      await transports.dispose()
    })
  })

  describe('JSON Schema 2020-12 tool input', () => {
    test('validates a tool whose inputSchema declares the 2020-12 dialect', async () => {
      await expectServerResult(
        {
          tools: {
            coords: createTool({
              description: 'coords',
              inputSchema: {
                $schema: 'https://json-schema.org/draft/2020-12/schema',
                type: 'object',
                properties: {
                  point: { type: 'array', prefixItems: [{ type: 'number' }, { type: 'number' }] },
                },
                required: ['point'],
              } as const,
              handler: (req) => {
                return {
                  content: [
                    { type: 'text' as const, text: `got ${JSON.stringify(req.input.point)}` },
                  ],
                }
              },
            }),
          },
        },
        { method: 'tools/call', params: { name: 'coords', arguments: { point: [1, 2] } } },
        { content: [{ type: 'text', text: 'got [1,2]' }] },
      )
    })
  })

  describe('supports incoming tool requests', () => {
    test('lists available tools', async () => {
      await expectServerResult(
        {
          tools: {
            test: createTool({
              description: 'test tool',
              inputSchema: {
                type: 'object',
                properties: { bar: { type: 'string' } },
                additionalProperties: false,
              },
              handler: (req) => {
                return { content: [{ type: 'text', text: `bar is ${req.input.bar}` }] }
              },
            }),
            other: createTool({
              description: 'another tool',
              inputSchema: {
                type: 'object',
                properties: { foo: { type: 'string' } },
                additionalProperties: false,
              },
              handler: () => {
                return { content: [{ type: 'text' as const, text: 'test' }] }
              },
            }),
          },
        },
        { method: 'tools/list' },
        {
          tools: [
            {
              name: 'other',
              description: 'another tool',
              inputSchema: {
                type: 'object',
                properties: { foo: { type: 'string' } },
                additionalProperties: false,
              },
            },
            {
              name: 'test',
              description: 'test tool',
              inputSchema: {
                type: 'object',
                properties: { bar: { type: 'string' } },
                additionalProperties: false,
              },
            },
          ],
        },
      )
    })

    test('executes tool call handler', async () => {
      await expectServerResult(
        {
          tools: {
            test: createTool({
              description: 'test',
              inputSchema: {
                type: 'object',
                properties: { bar: { type: 'string' } },
                additionalProperties: false,
              },
              handler: (req) => {
                return { content: [{ type: 'text', text: `bar is ${req.input.bar}` }] }
              },
            }),
          },
        },
        {
          method: 'tools/call',
          params: {
            name: 'test',
            arguments: { bar: 'foo' },
          },
        },
        { content: [{ type: 'text', text: 'bar is foo' }] },
      )
    })

    test('validates tool call inputs', async () => {
      // Input-validation errors are reported as isError results (SEP-1303), not JSON-RPC errors.
      const { transports } = createTestContext({
        tools: {
          test: createTool({
            description: 'test',
            inputSchema: {
              type: 'object',
              properties: { bar: { type: 'string' } },
              additionalProperties: false,
              required: ['bar'],
            } as const,
            handler: (req) => {
              return { content: [{ type: 'text', text: `bar is ${req.input.bar}` }] }
            },
          }),
        },
      })
      transports.client.write({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'test', arguments: {} },
      } as ClientRequest)
      const res = await transports.client.read()
      expect(res.value).toMatchObject({
        id: 1,
        result: { isError: true, content: [{ type: 'text' }] },
      })
      await transports.dispose()
    })
  })
})

describe('strict-mode suppression on tool/prompt schemas', () => {
  test('a valid 2020-12 prefixItems schema logs no strict-mode warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      createTool({
        description: 'tuple tool',
        inputSchema: {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          type: 'object',
          properties: {
            pair: {
              type: 'array',
              prefixItems: [{ type: 'string' }, { type: 'number' }],
            },
          },
        } as const,
        handler: () => ({ content: [] }),
      })
      expect(warn).not.toHaveBeenCalled()
      expect(error).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
      error.mockRestore()
    }
  })

  test('a genuinely broken schema still throws (strict:false suppresses warnings, not compile errors)', () => {
    expect(() =>
      createTool({
        description: 'broken tool',
        inputSchema: { type: 'not-a-real-type' } as unknown as Schema,
        handler: () => ({ content: [] }),
      }),
    ).toThrow()
  })
})

describe('factory parameters object', () => {
  const valueSchema = {
    type: 'object',
    properties: { value: { type: 'number' } },
    required: ['value'],
    additionalProperties: false,
  } as const

  test('createTool accepts a parameters object', async () => {
    const definition = createTool({
      description: 'adds one',
      inputSchema: valueSchema,
      handler: ({ input: { value } }) => ({
        content: [{ type: 'text', text: String(value + 1) }],
      }),
    })

    expect(definition.description).toBe('adds one')
    expect(definition.inputSchema).toMatchObject({ type: 'object' })

    const result = await definition.handler({
      input: { value: 1 },
      client: {} as never,
      signal: new AbortController().signal,
    })
    expect(result).toEqual({ content: [{ type: 'text', text: '2' }] })
  })

  test('createTool still rejects invalid input', async () => {
    const definition = createTool({
      description: 'adds one',
      inputSchema: valueSchema,
      handler: () => ({ content: [] }),
    })

    await expect(
      definition.handler({
        input: { value: 'not a number' },
        client: {} as never,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: INVALID_PARAMS })
  })

  test('createPrompt accepts a parameters object', async () => {
    const definition = createPrompt({
      description: 'greets',
      argumentsSchema: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
        additionalProperties: false,
      } as const,
      handler: ({ input: { name } }) => ({
        messages: [{ role: 'assistant', content: { type: 'text', text: `Hello ${name}` } }],
      }),
    })

    const result = await definition.handler({
      input: { name: 'World' },
      client: {} as never,
      signal: new AbortController().signal,
    })
    expect(result).toEqual({
      messages: [{ role: 'assistant', content: { type: 'text', text: 'Hello World' } }],
    })
  })

  test('createPrompt without an argumentsSchema skips validation', async () => {
    const definition = createPrompt({
      description: 'no args',
      handler: () => ({ messages: [] }),
    })

    expect(definition.argumentsSchema).toBeUndefined()
    const result = await definition.handler({
      input: { anything: true },
      client: {} as never,
      signal: new AbortController().signal,
    })
    expect(result).toEqual({ messages: [] })
  })
})

describe('tool outputSchema', () => {
  const countSchema = {
    type: 'object',
    properties: { count: { type: 'number' } },
    required: ['count'],
  } as const

  function callHandler(definition: GenericToolDefinition, args: Record<string, unknown> = {}) {
    return definition.handler({
      input: args,
      client: {} as never,
      signal: new AbortController().signal,
    })
  }

  test('outputSchema is advertised in tools/list', async () => {
    const { transports } = createTestContext({
      tools: {
        counter: createTool({
          description: 'counts',
          inputSchema: { type: 'object' } as const,
          outputSchema: countSchema,
          handler: () => ({ structuredContent: { count: 1 } }),
        }),
      },
    })
    transports.client.write({ jsonrpc: '2.0', id: 1, method: 'tools/list' } as ClientRequest)
    const response = await transports.client.read()
    expect(response.value).toMatchObject({
      id: 1,
      result: { tools: [{ name: 'counter', outputSchema: countSchema }] },
    })
    await transports.dispose()
  })

  test('a conforming structuredContent passes through', async () => {
    const definition = createTool({
      description: 'counts',
      inputSchema: { type: 'object' } as const,
      outputSchema: countSchema,
      handler: () => ({
        content: [{ type: 'text', text: 'three' }],
        structuredContent: { count: 3 },
      }),
    })
    await expect(callHandler(definition)).resolves.toEqual({
      content: [{ type: 'text', text: 'three' }],
      structuredContent: { count: 3 },
    })
  })

  test('a violating structuredContent raises INTERNAL_ERROR with issues', async () => {
    const definition = createTool({
      description: 'counts',
      inputSchema: { type: 'object' } as const,
      outputSchema: countSchema,
      handler: () => ({ structuredContent: { count: 'three' } }) as never,
    })
    await expect(callHandler(definition)).rejects.toMatchObject({
      code: INTERNAL_ERROR,
      message: 'Invalid tool output',
    })
  })

  test('a missing structuredContent against a declared schema raises INTERNAL_ERROR', async () => {
    const definition = createTool({
      description: 'counts',
      inputSchema: { type: 'object' } as const,
      outputSchema: countSchema,
      handler: () => ({ content: [] }) as never,
    })
    await expect(callHandler(definition)).rejects.toMatchObject({ code: INTERNAL_ERROR })
  })

  test('content is auto-filled from structuredContent when omitted', async () => {
    const definition = createTool({
      description: 'counts',
      inputSchema: { type: 'object' } as const,
      outputSchema: countSchema,
      handler: () => ({ structuredContent: { count: 3 } }),
    })
    await expect(callHandler(definition)).resolves.toEqual({
      content: [{ type: 'text', text: '{"count":3}' }],
      structuredContent: { count: 3 },
    })
  })

  test('a handler-supplied content is preserved', async () => {
    const definition = createTool({
      description: 'counts',
      inputSchema: { type: 'object' } as const,
      outputSchema: countSchema,
      handler: () => ({
        content: [{ type: 'text', text: 'three things' }],
        structuredContent: { count: 3 },
      }),
    })
    await expect(callHandler(definition)).resolves.toEqual({
      content: [{ type: 'text', text: 'three things' }],
      structuredContent: { count: 3 },
    })
  })

  test('a tool without an outputSchema is unaffected', async () => {
    const definition = createTool({
      description: 'plain',
      inputSchema: { type: 'object' } as const,
      handler: () => ({ content: [{ type: 'text', text: 'ok' }] }),
    })
    expect(definition.outputSchema).toBeUndefined()
    await expect(callHandler(definition)).resolves.toEqual({
      content: [{ type: 'text', text: 'ok' }],
    })
  })
})
