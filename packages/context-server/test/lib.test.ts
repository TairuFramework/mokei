import { DirectTransports } from '@enkaku/transport'
import type { ClientMessage, ServerMessage } from '@mokei/context-protocol'

import { ContextServer } from '../src/index.js'

describe('ContextServer', () => {
  test('handles tool calls', async () => {
    const transports = new DirectTransports<ServerMessage, ClientMessage>()

    new ContextServer({
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
        test: (ctx) => {
          return { content: [{ type: 'text', text: `bar is ${ctx.input.bar}` }] }
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
