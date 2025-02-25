import { DirectTransports } from '@enkaku/transport'
import { jest } from '@jest/globals'
import { INVALID_PARAMS } from '@mokei/context-protocol'
import type { ClientMessage, ClientRequest, ServerMessage } from '@mokei/context-protocol'

import { type Schema, type ServerParams, createPrompt, createTool, serve } from '../src/index.js'

type TestContext = DirectTransports<ServerMessage, ClientMessage>

type TestContextParams = Omit<ServerParams, 'name' | 'transport' | 'version'>

function createTestContext(params: TestContextParams): TestContext {
  const transports = new DirectTransports<ServerMessage, ClientMessage>()

  serve({
    name: 'test',
    version: '0',
    transport: transports.server,
    ...params,
  })

  return transports
}

async function expectResponse(
  params: TestContextParams,
  request: Omit<ClientRequest, 'jsonrpc' | 'id'>,
  response: Record<string, unknown>,
): Promise<void> {
  const context = createTestContext(params)
  context.client.write({ jsonrpc: '2.0' as const, id: 1, ...request } as ClientRequest)
  await expect(context.client.read()).resolves.toEqual({
    done: false,
    value: { jsonrpc: '2.0', id: 1, ...response },
  })
  await context.dispose()
}

async function expectResult(
  params: TestContextParams,
  request: Omit<ClientRequest, 'jsonrpc' | 'id'>,
  result: unknown,
): Promise<void> {
  await expectResponse(params, request, { result })
}

async function expectError(
  params: TestContextParams,
  request: Omit<ClientRequest, 'jsonrpc' | 'id'>,
  error: unknown,
): Promise<void> {
  await expectResponse(params, request, { error })
}

describe('ContextServer', () => {
  test('supports completion calls', async () => {
    const params = {
      ref: { type: 'ref/prompt', name: 'test' },
      argument: { name: 'test', value: 'one' },
    }
    const completion = { values: ['one', 'two'] }

    const complete = jest.fn(() => ({ completion }))
    await expectResult({ complete }, { method: 'completion/complete', params }, { completion })
    expect(complete).toHaveBeenCalledWith({ params, signal: expect.any(AbortSignal) })
  })

  describe('supports prompt calls', () => {
    test('lists available prompts', async () => {
      await expectResult(
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
      await expectResult(
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
      await expectError(
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
            issues: [{ message: "must have required property 'name'", path: [''] }],
          },
        },
      )
    })
  })

  describe('supports resource calls', () => {
    test('lists available resources by calling the provided handler', async () => {
      const resources = [
        { name: 'foo', uri: 'test://foo' },
        { name: 'bar', uri: 'test://bar' },
      ]

      await expectResult(
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

      await expectResult(
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

      await expectResult(
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

      await expectResult(
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
      await expectResult(
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

  describe('supports tool calls', () => {
    test('lists available tools', async () => {
      await expectResult(
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
                return { content: [{ type: 'text', text: `bar is ${req.input.bar}` }] }
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
      await expectResult(
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
                return { content: [{ type: 'text', text: `bar is ${req.input.bar}` }] }
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
      await expectError(
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
                return { content: [{ type: 'text', text: `bar is ${req.input.bar}` }] }
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
            issues: [{ message: "must have required property 'bar'", path: [''] }],
          },
        },
      )
    })
  })
})
