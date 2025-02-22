import { DirectTransports } from '@enkaku/transport'
import type { ClientMessage, ServerMessage } from '@mokei/context-protocol'

import { serve } from '../src/index.js'

describe('ContextServer', () => {
  describe('supports prompt calls', () => {
    test('lists available prompts', async () => {
      const transports = new DirectTransports<ServerMessage, ClientMessage>()

      serve({
        name: 'test',
        version: '0',
        specification: {
          prompts: {
            foo: { description: 'prompt foo', arguments: { type: 'object' } },
            bar: { description: 'prompt bar' },
          },
        } as const,
        transport: transports.server,
        prompts: {
          foo: () => {
            return { messages: [{ role: 'assistant', content: { type: 'text', text: 'foo' } }] }
          },
          bar: () => {
            return { messages: [{ role: 'assistant', content: { type: 'text', text: 'bar' } }] }
          },
        },
      })

      transports.client.write({
        jsonrpc: '2.0',
        id: 1,
        method: 'prompts/list',
      })

      await expect(transports.client.read()).resolves.toEqual({
        done: false,
        value: {
          jsonrpc: '2.0',
          id: 1,
          result: {
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
        },
      })

      await transports.dispose()
    })

    test('gets a prompt', async () => {
      const transports = new DirectTransports<ServerMessage, ClientMessage>()

      serve({
        name: 'test',
        version: '0',
        specification: {
          prompts: {
            hello: {
              description: 'Hello prompt',
              arguments: { type: 'object', properties: { name: { type: 'string' } } },
            },
          },
        } as const,
        transport: transports.server,
        prompts: {
          hello: (req) => {
            return {
              messages: [
                {
                  role: 'assistant',
                  content: {
                    type: 'text',
                    text: req.arguments.name ? `Hello, my name is ${req.arguments.name}` : 'Hello',
                  },
                },
              ],
            }
          },
        },
      })

      transports.client.write({
        jsonrpc: '2.0',
        id: 1,
        method: 'prompts/get',
        params: {
          name: 'hello',
          arguments: { name: 'Bob' },
        },
      })

      await expect(transports.client.read()).resolves.toEqual({
        done: false,
        value: {
          jsonrpc: '2.0',
          id: 1,
          result: {
            messages: [
              {
                role: 'assistant',
                content: { type: 'text', text: 'Hello, my name is Bob' },
              },
            ],
          },
        },
      })

      await transports.dispose()
    })
  })

  describe('supports resource calls', () => {
    test('lists available resources', async () => {
      const transports = new DirectTransports<ServerMessage, ClientMessage>()

      serve({
        name: 'test',
        version: '0',
        transport: transports.server,
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
      })

      transports.client.write({
        jsonrpc: '2.0',
        id: 1,
        method: 'resources/list',
      })

      await expect(transports.client.read()).resolves.toEqual({
        done: false,
        value: {
          jsonrpc: '2.0',
          id: 1,
          result: {
            resources: [
              { name: 'foo', uri: 'test://foo' },
              { name: 'bar', uri: 'test://bar' },
            ],
          },
        },
      })

      await transports.dispose()
    })

    test('lists available resources templates', async () => {
      const transports = new DirectTransports<ServerMessage, ClientMessage>()

      serve({
        name: 'test',
        version: '0',
        transport: transports.server,
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
      })

      transports.client.write({
        jsonrpc: '2.0',
        id: 1,
        method: 'resources/templates/list',
      })

      await expect(transports.client.read()).resolves.toEqual({
        done: false,
        value: {
          jsonrpc: '2.0',
          id: 1,
          result: {
            resourceTemplates: [
              { name: 'foo', uriTemplate: 'test://foo/{name}' },
              { name: 'bar', uriTemplate: 'test://bar/{name}' },
            ],
          },
        },
      })

      await transports.dispose()
    })

    test('reads a resources', async () => {
      const transports = new DirectTransports<ServerMessage, ClientMessage>()

      serve({
        name: 'test',
        version: '0',
        transport: transports.server,
        resources: {
          list: () => ({ resources: [] }),
          listTemplates: () => ({ resourceTemplates: [] }),
          read: ({ params }) => {
            return { contents: [{ uri: params.uri, text: 'test resource' }] }
          },
        },
      })

      transports.client.write({
        jsonrpc: '2.0',
        id: 1,
        method: 'resources/read',
        params: { uri: 'test://foo' },
      })

      await expect(transports.client.read()).resolves.toEqual({
        done: false,
        value: {
          jsonrpc: '2.0',
          id: 1,
          result: { contents: [{ uri: 'test://foo', text: 'test resource' }] },
        },
      })

      await transports.dispose()
    })
  })

  describe('supports tool calls', () => {
    test('lists available tools', async () => {
      const transports = new DirectTransports<ServerMessage, ClientMessage>()

      serve({
        name: 'test',
        version: '0',
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
        transport: transports.server,
        tools: {
          test: (req) => {
            return { content: [{ type: 'text', text: `bar is ${req.input.bar}` }] }
          },
          other: () => {
            return { content: [{ type: 'text', text: 'test' }] }
          },
        },
      })

      transports.client.write({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      })

      await expect(transports.client.read()).resolves.toEqual({
        done: false,
        value: {
          jsonrpc: '2.0',
          id: 1,
          result: {
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
        },
      })

      await transports.dispose()
    })

    test('executes tool call handler', async () => {
      const transports = new DirectTransports<ServerMessage, ClientMessage>()

      serve({
        name: 'test',
        version: '0',
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
        transport: transports.server,
        tools: {
          test: (req) => {
            return { content: [{ type: 'text', text: `bar is ${req.input.bar}` }] }
          },
        },
      })

      transports.client.write({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'test',
          arguments: { bar: 'foo' },
        },
      })

      await expect(transports.client.read()).resolves.toEqual({
        done: false,
        value: {
          jsonrpc: '2.0',
          id: 1,
          result: {
            content: [{ type: 'text', text: 'bar is foo' }],
          },
        },
      })

      await transports.dispose()
    })
  })
})
