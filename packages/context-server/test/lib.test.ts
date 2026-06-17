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
import { INVALID_PARAMS, LATEST_PROTOCOL_VERSION } from '@mokei/context-protocol'
import { describe, expect, test, vi } from 'vitest'

import {
  ContextServer,
  createPrompt,
  createTool,
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

    server.log('info', { test: 0 })

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

    server.log('info', { test: 1 })
    server.log('notice', { test: 2 })
    server.log('warning', { test: 3 })

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

    server.log('info', { test: 4 })
    server.log('notice', { test: 5 })
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
            foo: createPrompt('prompt foo', { type: 'object' }, () => {
              return {
                messages: [
                  { role: 'assistant' as const, content: { type: 'text' as const, text: 'foo' } },
                ],
              }
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
            hello: createPrompt(
              'Hello prompt',
              {
                type: 'object',
                properties: { name: { type: 'string' } },
              } as const satisfies Schema,
              (req) => {
                return {
                  messages: [
                    {
                      role: 'assistant',
                      content: {
                        type: 'text',
                        text: req.arguments.name
                          ? `Hello, my name is ${req.arguments.name}`
                          : 'Hello',
                      },
                    },
                  ],
                }
              },
            ),
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
            hello: createPrompt(
              'Hello prompt',
              {
                type: 'object',
                properties: { name: { type: 'string' } },
                required: ['name'],
              },
              () => {
                return {
                  messages: [
                    {
                      role: 'assistant' as const,
                      content: { type: 'text' as const, text: 'Hello' },
                    },
                  ],
                }
              },
            ),
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
        tools: { known: createTool('x', { type: 'object' }, async () => ({ content: [] })) },
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
        tools: { a: createTool('a', { type: 'object' }, async () => ({ content: [] })) },
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
          charlie: createTool('c', { type: 'object' }, noop),
          alpha: createTool('a', { type: 'object' }, noop),
          bravo: createTool('b', { type: 'object' }, noop),
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
      tools: { a: createTool('a', { type: 'object' }, async () => ({ content: [] })) },
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

  describe('isError results (SEP-1303)', () => {
    test('tool handler exception becomes an isError result', async () => {
      const { transports } = createTestContext({
        tools: {
          boom: createTool('boom', { type: 'object', properties: {} }, async () => {
            throw new Error('kaboom')
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
          strict: createTool(
            'strict',
            { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] },
            async () => ({ content: [] }),
          ),
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
  })

  describe('JSON Schema 2020-12 tool input', () => {
    test('validates a tool whose inputSchema declares the 2020-12 dialect', async () => {
      await expectServerResult(
        {
          tools: {
            coords: createTool(
              'coords',
              {
                $schema: 'https://json-schema.org/draft/2020-12/schema',
                type: 'object',
                properties: {
                  point: { type: 'array', prefixItems: [{ type: 'number' }, { type: 'number' }] },
                },
                required: ['point'],
              } as const,
              (req) => {
                return {
                  content: [
                    { type: 'text' as const, text: `got ${JSON.stringify(req.arguments.point)}` },
                  ],
                }
              },
            ),
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
            test: createTool(
              'test tool',
              {
                type: 'object',
                properties: { bar: { type: 'string' } },
                additionalProperties: false,
              },
              (req) => {
                return { content: [{ type: 'text', text: `bar is ${req.arguments.bar}` }] }
              },
            ),
            other: createTool(
              'another tool',
              {
                type: 'object',
                properties: { foo: { type: 'string' } },
                additionalProperties: false,
              },
              () => {
                return { content: [{ type: 'text' as const, text: 'test' }] }
              },
            ),
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
            test: createTool(
              'test',
              {
                type: 'object',
                properties: { bar: { type: 'string' } },
                additionalProperties: false,
              },
              (req) => {
                return { content: [{ type: 'text', text: `bar is ${req.arguments.bar}` }] }
              },
            ),
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
          test: createTool(
            'test',
            {
              type: 'object',
              properties: { bar: { type: 'string' } },
              additionalProperties: false,
              required: ['bar'],
            } as const,
            (req) => {
              return { content: [{ type: 'text', text: `bar is ${req.arguments.bar}` }] }
            },
          ),
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
