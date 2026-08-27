import { METHOD_NOT_FOUND } from '@mokei/context-protocol'
import {
  ContextServer,
  createSubscriptionHub,
  type ServerConfig,
  type ServerEvents,
  type SubscriptionHub,
} from '@mokei/context-server'
import { EventEmitter } from '@sozai/event'
import { describe, expect, test } from 'vitest'

import { createHTTPHandler, type HTTPHandlerParams } from '../src/handler.js'

/**
 * A `2026-07-28`-capable server config with resources declared, so that `resources.subscribe`
 * can be advertised whenever a hub is also present (both halves of a served subscription).
 */
const SERVER_CONFIG: ServerConfig = {
  name: 'listen-test-server',
  version: '1.0.0',
  protocolVersions: ['2026-07-28', '2025-11-25'],
  resources: {
    read: async () => ({ contents: [] }),
  },
  tools: {
    echo: {
      description: 'Echo input',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
      handler: async ({ input }) => ({
        content: [{ type: 'text', text: (input as { text: string }).text }],
      }),
    },
  },
}

/**
 * A hub bound to its own `EventEmitter`, standing in for the durable business-logic side of
 * subscriptions that a deployment supplies. The handler only ever borrows it.
 */
function createStubDurableHub(): {
  hub: SubscriptionHub
  emitResourceUpdated: (uri: string) => Promise<void>
} {
  const emitter = new EventEmitter<ServerEvents>()
  const hub = createSubscriptionHub({ events: emitter })
  return { hub, emitResourceUpdated: (uri: string) => emitter.emit('resourceUpdated', { uri }) }
}

function createHandler(overrides?: Partial<HTTPHandlerParams>) {
  return createHTTPHandler({
    createServer: ({ transport, subscriptionHub, connectionID }) =>
      new ContextServer({ ...SERVER_CONFIG, transport, subscriptionHub, connectionID }),
    ...overrides,
  })
}

const META = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': { name: 'test-client', version: '1.0.0' },
}

/** A `subscriptions/listen` POST, stamped with the `2026-07-28` protocol `_meta`. */
function listenRequest(id: string | number, filter: Record<string, unknown> = {}): Request {
  return new Request('http://localhost/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2026-07-28',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'subscriptions/listen',
      params: { notifications: filter, _meta: META },
    }),
  })
}

/** A stateless `server/discover` POST on `2026-07-28`. */
function discoverRequest(id: string | number = 1): Request {
  return new Request('http://localhost/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2026-07-28',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'server/discover',
      params: { _meta: META },
    }),
  })
}

type SSEFrame = { id?: string; data: string }

/** Reads raw SSE frames one at a time, so a stream expected to stay open can be observed. */
function createSSEFrameReader(response: Response): { next: () => Promise<SSEFrame | undefined> } {
  const body = response.body
  if (body == null) {
    throw new Error('Response has no readable body')
  }
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  async function next(): Promise<SSEFrame | undefined> {
    for (;;) {
      const separatorIndex = buffer.indexOf('\n\n')
      if (separatorIndex !== -1) {
        const block = buffer.slice(0, separatorIndex)
        buffer = buffer.slice(separatorIndex + 2)
        let id: string | undefined
        let data = ''
        for (const line of block.split('\n')) {
          if (line.startsWith('id: ')) {
            id = line.slice(4)
          } else if (line.startsWith('data: ')) {
            data = line.slice(6)
          }
        }
        return { id, data }
      }
      const { value, done } = await reader.read()
      if (done) {
        return undefined
      }
      buffer += decoder.decode(value, { stream: true })
    }
  }

  return { next }
}

/** Resolves with `'timeout'` rather than a frame when nothing arrives within `ms`. */
function raceTimeout(
  promise: Promise<SSEFrame | undefined>,
  ms: number,
): Promise<SSEFrame | undefined | 'timeout'> {
  return Promise.race([
    promise,
    new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), ms)),
  ])
}

/** Collect the `data:` payloads of an SSE response body, ignoring priming events. */
async function readSSEData(response: Response): Promise<Array<Record<string, unknown>>> {
  const text = await response.text()
  const out: Array<Record<string, unknown>> = []
  for (const block of text.split('\n\n')) {
    for (const line of block.split('\n')) {
      if (line.startsWith('data: ')) {
        const payload = line.slice(6)
        if (payload.trim() !== '') {
          out.push(JSON.parse(payload) as Record<string, unknown>)
        }
      }
    }
  }
  return out
}

describe('subscriptions/listen routing', () => {
  test('routes to runSubscriptionExchange when a hub is configured (held-open ack stream)', async () => {
    const { hub } = createStubDurableHub()
    const handler = createHandler({ subscriptionHub: hub })

    const response = await handler.handleRequest(listenRequest(1, { resourceSubscriptions: [] }))
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('text/event-stream')

    const frames = createSSEFrameReader(response)
    const priming = await frames.next()
    expect(priming?.data).toBe('')

    const ackFrame = await frames.next()
    const ack = JSON.parse((ackFrame as SSEFrame).data) as Record<string, unknown>
    expect(ack.method).toBe('notifications/subscriptions/acknowledged')

    // A listen exchange never closes on its own initiative: unlike runStatelessExchange, neither
    // the ack nor a held terminal is treated as this request's cue to end the stream.
    const result = await raceTimeout(frames.next(), 100)
    expect(result).toBe('timeout')

    await handler.dispose()
    await hub.dispose()
  })

  test('returns METHOD_NOT_FOUND when no hub is configured', async () => {
    const handler = createHandler()

    const response = await handler.handleRequest(listenRequest(1))
    const data = await readSSEData(response)
    const errorFrame = data.find((m) => m.error != null)
    expect(errorFrame).toBeDefined()
    const error = errorFrame?.error as { code?: number } | undefined
    expect(error?.code).toBe(METHOD_NOT_FOUND)

    await handler.dispose()
  })
})

describe('handler.dispose() awaits in-flight listen disposal', () => {
  test('resolves only after the per-POST listen server has flushed and disposed (bounded)', async () => {
    const { hub } = createStubDurableHub()
    let capturedServer: ContextServer | undefined
    let serverDisposed = false

    const handler = createHTTPHandler({
      subscriptionHub: hub,
      createServer: ({ transport, subscriptionHub, connectionID }) => {
        const server = new ContextServer({
          ...SERVER_CONFIG,
          transport,
          subscriptionHub,
          connectionID,
        })
        capturedServer = server
        void server.disposed.then(() => {
          serverDisposed = true
        })
        return server
      },
    })

    const response = await handler.handleRequest(listenRequest(1))
    const frames = createSSEFrameReader(response)
    await frames.next() // priming
    await frames.next() // ack
    expect(capturedServer).toBeDefined()

    // Registration into the hub is chained after the ack write (ack-first), so let that
    // microtask/macrotask settle before completing — otherwise the entry is not yet retained.
    await new Promise((resolve) => setTimeout(resolve, 0))

    // The durable side gracefully completes the subscription, resolving the held terminal and
    // writing it through the per-POST server's SSE stream.
    await hub.endAllGracefully()
    const terminalFrame = await frames.next()
    const terminal = JSON.parse((terminalFrame as SSEFrame).data) as {
      id?: unknown
      result?: unknown
    }
    expect(terminal.id).toBe(1)
    expect(terminal.result).toBeDefined()

    // dispose is async and awaits the per-POST server's disposal.
    const disposePromise = handler.dispose()
    expect(typeof (disposePromise as Promise<void>).then).toBe('function')
    await disposePromise

    // By the time dispose() resolves, the in-flight listen's server has been disposed.
    expect(serverDisposed).toBe(true)

    await hub.dispose()
  })
})

describe('stateless server/discover capability reporting', () => {
  test('reports resources.subscribe when a hub is configured', async () => {
    const { hub } = createStubDurableHub()
    const handler = createHandler({ subscriptionHub: hub })

    const response = await handler.handleRequest(discoverRequest())
    const data = await readSSEData(response)
    const result = data.find((m) => m.result != null)?.result as
      | { capabilities?: { resources?: { subscribe?: boolean } } }
      | undefined
    expect(result?.capabilities?.resources?.subscribe).toBe(true)

    await handler.dispose()
    await hub.dispose()
  })

  test('omits resources.subscribe when no hub is configured', async () => {
    const handler = createHandler()

    const response = await handler.handleRequest(discoverRequest())
    const data = await readSSEData(response)
    const result = data.find((m) => m.result != null)?.result as
      | { capabilities?: { resources?: { subscribe?: boolean } } }
      | undefined
    expect(result?.capabilities?.resources).toBeDefined()
    expect(result?.capabilities?.resources?.subscribe).toBeUndefined()

    await handler.dispose()
  })
})
