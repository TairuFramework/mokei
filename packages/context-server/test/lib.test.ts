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
          capabilities: {},
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
              name: 'foo',
              description: 'prompt foo',
              argumentsSchema: { type: 'object' },
            },
            {
              name: 'bar',
              description: 'prompt bar',
              argumentsSchema: undefined,
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
              name: 'test',
              description: 'test tool',
              inputSchema: {
                type: 'object',
                properties: { bar: { type: 'string' } },
                additionalProperties: false,
              },
            },
            {
              name: 'other',
              description: 'another tool',
              inputSchema: {
                type: 'object',
                properties: { foo: { type: 'string' } },
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
      await expectServerError(
        {
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
        },
        {
          method: 'tools/call',
          params: {
            name: 'test',
            arguments: {},
          },
        },
        {
          code: INVALID_PARAMS,
          message: 'Invalid tool input',
          data: {
            issues: [{ message: "must have required property 'bar'", path: [] }],
          },
        },
      )
    })
  })
})
