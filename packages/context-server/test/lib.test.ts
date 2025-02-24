import { DirectTransports } from '@enkaku/transport'
import { INVALID_PARAMS } from '@mokei/context-protocol'
import type { ClientMessage, ClientRequest, ServerMessage } from '@mokei/context-protocol'

import type { SpecificationDefinition } from '../src/definitions.js'
import { type ServerParams, serve } from '../src/index.js'
import type { NoSpecification } from '../src/server.js'

type TestContext = DirectTransports<ServerMessage, ClientMessage>

type TestContextParams<Spec extends SpecificationDefinition = NoSpecification> = Omit<
  ServerParams<Spec>,
  'name' | 'transport' | 'version'
>

function createTestContext<Spec extends SpecificationDefinition = NoSpecification>(
  params: TestContextParams<Spec>,
): TestContext {
  const transports = new DirectTransports<ServerMessage, ClientMessage>()

  serve<Spec>({
    name: 'test',
    version: '0',
    transport: transports.server,
    ...params,
  } as ServerParams<Spec>)

  return transports
}

async function expectResponse<Spec extends SpecificationDefinition = NoSpecification>(
  params: TestContextParams<Spec>,
  request: Omit<ClientRequest, 'jsonrpc' | 'id'>,
  response: Record<string, unknown>,
): Promise<void> {
  const context = createTestContext<Spec>(params)
  context.client.write({ jsonrpc: '2.0' as const, id: 1, ...request } as ClientRequest)
  await expect(context.client.read()).resolves.toEqual({
    done: false,
    value: { jsonrpc: '2.0', id: 1, ...response },
  })
  await context.dispose()
}

async function expectResult<Spec extends SpecificationDefinition = NoSpecification>(
  params: TestContextParams<Spec>,
  request: Omit<ClientRequest, 'jsonrpc' | 'id'>,
  result: unknown,
): Promise<void> {
  await expectResponse<Spec>(params, request, { result })
}

async function expectError<Spec extends SpecificationDefinition = NoSpecification>(
  params: TestContextParams<Spec>,
  request: Omit<ClientRequest, 'jsonrpc' | 'id'>,
  error: unknown,
): Promise<void> {
  await expectResponse<Spec>(params, request, { error })
}

describe('ContextServer', () => {
  describe('supports prompt calls', () => {
    test('lists available prompts', async () => {
      await expectResult(
        {
          specification: {
            prompts: {
              foo: { description: 'prompt foo', arguments: { type: 'object' } },
              bar: { description: 'prompt bar' },
            },
          } as const,
          prompts: {
            foo: () => {
              return {
                messages: [
                  { role: 'assistant' as const, content: { type: 'text' as const, text: 'foo' } },
                ],
              }
            },
            bar: () => {
              return {
                messages: [
                  { role: 'assistant' as const, content: { type: 'text' as const, text: 'bar' } },
                ],
              }
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
          specification: {
            prompts: {
              hello: {
                description: 'Hello prompt',
                arguments: { type: 'object', properties: { name: { type: 'string' } } },
              },
            },
          } as const,
          prompts: {
            hello: (req) => {
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
          specification: {
            prompts: {
              hello: {
                description: 'Hello prompt',
                arguments: {
                  type: 'object',
                  properties: { name: { type: 'string' } },
                  required: ['name'],
                },
              },
            },
          } as const,
          prompts: {
            hello: () => {
              return {
                messages: [
                  {
                    role: 'assistant' as const,
                    content: { type: 'text' as const, text: 'Hello' },
                  },
                ],
              }
            },
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
          message: 'Prompt validation failed',
          data: {
            issues: [
              { message: "must have required property 'name'", path: ['', 'params', 'arguments'] },
            ],
          },
        },
      )
    })
  })

  describe('supports resource calls', () => {
    test('lists available resources', async () => {
      await expectResult(
        {
          resources: {
            list: () => {
              return {
                resources: [
                  { name: 'foo', uri: 'test://foo' },
                  { name: 'bar', uri: 'test://bar' },
                ],
              }
            },
            listTemplates: () => ({ resourceTemplates: [] }),
            read: () => ({ contents: [] }),
          },
        },
        { method: 'resources/list' },
        {
          resources: [
            { name: 'foo', uri: 'test://foo' },
            { name: 'bar', uri: 'test://bar' },
          ],
        },
      )
    })

    test('lists available resources templates', async () => {
      await expectResult(
        {
          resources: {
            list: () => ({ resources: [] }),
            listTemplates: () => {
              return {
                resourceTemplates: [
                  { name: 'foo', uriTemplate: 'test://foo/{name}' },
                  { name: 'bar', uriTemplate: 'test://bar/{name}' },
                ],
              }
            },
            read: () => ({ contents: [] }),
          },
        },
        { method: 'resources/templates/list' },
        {
          resourceTemplates: [
            { name: 'foo', uriTemplate: 'test://foo/{name}' },
            { name: 'bar', uriTemplate: 'test://bar/{name}' },
          ],
        },
      )
    })

    test('reads a resources', async () => {
      await expectResult(
        {
          resources: {
            list: () => ({ resources: [] }),
            listTemplates: () => ({ resourceTemplates: [] }),
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
          specification: {
            tools: {
              test: {
                input: {
                  type: 'object',
                  properties: { bar: { type: 'string' } },
                  additionalProperties: false,
                },
              },
              other: {
                description: 'another tool',
                input: {
                  type: 'object',
                  properties: { foo: { type: 'string' } },
                  additionalProperties: false,
                },
              },
            },
          } as const,
          tools: {
            test: (req) => {
              return { content: [{ type: 'text', text: `bar is ${req.input.bar}` }] }
            },
            other: () => {
              return { content: [{ type: 'text' as const, text: 'test' }] }
            },
          },
        },
        { method: 'tools/list' },
        {
          tools: [
            {
              name: 'test',
              description: undefined,
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
          specification: {
            tools: {
              test: {
                input: {
                  type: 'object',
                  properties: { bar: { type: 'string' } },
                  additionalProperties: false,
                },
              },
            },
          } as const,
          tools: {
            test: (req) => {
              return { content: [{ type: 'text', text: `bar is ${req.input.bar}` }] }
            },
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
          specification: {
            tools: {
              test: {
                input: {
                  type: 'object',
                  properties: { bar: { type: 'string' } },
                  additionalProperties: false,
                  required: ['bar'],
                },
              },
            },
          } as const,
          tools: {
            test: (req) => {
              return { content: [{ type: 'text', text: `bar is ${req.input.bar}` }] }
            },
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
          message: 'Tool call validation failed',
          data: {
            issues: [
              { message: "must have required property 'bar'", path: ['', 'params', 'arguments'] },
            ],
          },
        },
      )
    })
  })
})
