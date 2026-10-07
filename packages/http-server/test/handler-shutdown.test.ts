import { DirectTransports } from '@enkaku/transport'
import type { ClientMessage, ServerMessage } from '@mokei/context-protocol'
import {
  ContextServer,
  createSubscriptionHub,
  type ServerConfig,
  type ServerEvents,
} from '@mokei/context-server'
import { EventEmitter } from '@sozai/event'
import { describe, expect, test } from 'vitest'

import { createHTTPHandler, type HTTPHandlerParams } from '../src/handler.js'

const SERVER_CONFIG: ServerConfig = {
  name: 'shutdown-test-server',
  version: '1.0.0',
  protocolVersions: ['2026-07-28', '2025-11-25'],
  resources: { read: async () => ({ contents: [] }) },
}

const LISTEN_MESSAGE = {
  jsonrpc: '2.0',
  id: 2,
  method: 'subscriptions/listen',
  params: {
    notifications: {},
    _meta: {
      'io.modelcontextprotocol/protocolVersion': '2026-07-28',
      'io.modelcontextprotocol/clientCapabilities': {},
      'io.modelcontextprotocol/clientInfo': { name: 'test-client', version: '1.0.0' },
    },
  },
} as const

function postRequest(message: Record<string, unknown>): Request {
  return new Request('http://localhost/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(message),
  })
}

function initializeRequest(): Request {
  return postRequest({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    },
  })
}

function createHandler(overrides?: Partial<HTTPHandlerParams>) {
  return createHTTPHandler({
    createServer: ({ transport, subscriptionHub, connectionID }) =>
      new ContextServer({ ...SERVER_CONFIG, transport, subscriptionHub, connectionID }),
    ...overrides,
  })
}

async function* readMessages(response: Response): AsyncGenerator<Record<string, unknown>> {
  if (response.body == null) throw new Error('Response has no readable body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return
      buffer += decoder.decode(value, { stream: true })
      let separator = buffer.indexOf('\n\n')
      while (separator !== -1) {
        const block = buffer.slice(0, separator)
        buffer = buffer.slice(separator + 2)
        for (const line of block.split('\n')) {
          if (line.startsWith('data: ') && line.slice(6).trim() !== '') {
            yield JSON.parse(line.slice(6)) as Record<string, unknown>
          }
        }
        separator = buffer.indexOf('\n\n')
      }
    }
  } finally {
    reader.releaseLock()
  }
}

describe('HTTPHandler.shutdown()', () => {
  test('shutdown ends hub subscriptions with terminal frames', async () => {
    const hub = createSubscriptionHub({ events: new EventEmitter<ServerEvents>() })
    const handler = createHandler({ subscriptionHub: hub })
    try {
      const response = await handler.handleRequest(postRequest(LISTEN_MESSAGE))
      expect(response.status).toBe(200)
      const messages = readMessages(response)
      expect((await messages.next()).value).toMatchObject({
        method: 'notifications/subscriptions/acknowledged',
      })
      // Registration follows the ack write, so let it settle before draining the hub.
      await new Promise((resolve) => setTimeout(resolve, 0))
      await handler.shutdown()
      expect((await messages.next()).value).toEqual({
        jsonrpc: '2.0',
        id: 2,
        result: { _meta: { 'io.modelcontextprotocol/subscriptionId': 2 } },
      })
      expect((await messages.next()).done).toBe(true)
    } finally {
      await handler.dispose()
      await hub.dispose()
    }
  })

  test('shutdown ends session-owned subscriptions', async () => {
    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    const handler = createHandler({
      createServer: ({ transport }) => {
        // The handshake uses HTTP; the session server's newer listen uses its own wire.
        void (async () => {
          const message = await transport.read()
          if (message.done) throw new Error('Missing initialise request')
          await transports.client.write(message.value)
          const response = await transports.client.read()
          if (response.done) throw new Error('Missing initialise response')
          await transport.write(response.value)
        })()
        return new ContextServer({
          ...SERVER_CONFIG,
          transport: transports.server,
          subscriptions: true,
        })
      },
    })
    try {
      const initialized = await handler.handleRequest(initializeRequest())
      expect(initialized.status).toBe(200)
      expect(initialized.headers.get('Mcp-Session-Id')).toBeTruthy()
      await transports.client.write(LISTEN_MESSAGE)
      expect((await transports.client.read()).value).toMatchObject({
        method: 'notifications/subscriptions/acknowledged',
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
      const terminal = transports.client.read()
      await handler.shutdown()
      expect((await terminal).value).toEqual({
        jsonrpc: '2.0',
        id: 2,
        result: { _meta: { 'io.modelcontextprotocol/subscriptionId': 2 } },
      })
    } finally {
      await handler.dispose()
      await transports.dispose()
    }
  })

  test.each([
    ['rejects new sessions after shutdown begins', initializeRequest],
    ['rejects new listen requests after shutdown begins', () => postRequest(LISTEN_MESSAGE)],
  ])('%s', async (_name, request) => {
    const hub = createSubscriptionHub({ events: new EventEmitter<ServerEvents>() })
    const gate = Promise.withResolvers<void>()
    const started = Promise.withResolvers<void>()
    const handler = createHandler({
      subscriptionHub: {
        ...hub,
        endAllGracefully: async () => {
          started.resolve()
          await gate.promise
          await hub.endAllGracefully()
        },
      },
    })
    try {
      const shutdown = handler.shutdown()
      await started.promise
      const incoming = request()
      const id = (JSON.parse(await incoming.clone().text()) as { id: number }).id
      const response = await handler.handleRequest(incoming)
      expect(response.status).toBe(503)
      expect(response.headers.get('Content-Type')).toBe('application/json')
      expect(await response.json()).toMatchObject({
        jsonrpc: '2.0',
        id,
        error: { code: expect.any(Number), message: expect.any(String) },
      })
      gate.resolve()
      await shutdown
      expect((await handler.handleRequest(request())).status).toBe(503)
    } finally {
      gate.resolve()
      await handler.dispose()
      await hub.dispose()
    }
  })

  test('dispose after shutdown is safe', async () => {
    const handler = createHandler()
    await handler.shutdown()
    await expect(handler.dispose()).resolves.toBeUndefined()
  })

  test('concurrent shutdown calls await the same drain', async () => {
    const hub = createSubscriptionHub({ events: new EventEmitter<ServerEvents>() })
    const gate = Promise.withResolvers<void>()
    let drains = 0
    const handler = createHandler({
      subscriptionHub: {
        ...hub,
        endAllGracefully: async () => {
          drains++
          await gate.promise
          await hub.endAllGracefully()
        },
      },
    })
    try {
      const first = handler.shutdown()
      const second = handler.shutdown()
      let settled = false
      void second.then(() => {
        settled = true
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(settled).toBe(false)
      gate.resolve()
      await Promise.all([first, second, handler.shutdown()])
      expect(drains).toBe(1)
    } finally {
      gate.resolve()
      await handler.dispose()
      await hub.dispose()
    }
  })
})
