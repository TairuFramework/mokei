import type { ClientMessage } from '@mokei/context-protocol'
import { ContextServer, createSubscriptionHub, type ServerEvents } from '@mokei/context-server'
import { EventEmitter } from '@sozai/event'
import { describe, expect, test } from 'vitest'

import { runSubscriptionExchange, type SubscriptionExchangeParams } from '../src/subscriptions.js'

const META = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
}

/** A `subscriptions/listen` request body, stamped with the `2026-07-28` protocol `_meta`. */
function listenMessage(id: string | number, filter: Record<string, unknown>): ClientMessage {
  return {
    jsonrpc: '2.0',
    id,
    method: 'subscriptions/listen',
    params: { notifications: filter, _meta: META },
  } as unknown as ClientMessage
}

type SSEFrame = { id?: string; data: string }

/**
 * Reads raw SSE frames off a response body one at a time, as they arrive -- unlike
 * `response.text()`, which only resolves once the stream closes, and so cannot be used to
 * observe a stream that is expected to stay open.
 */
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

/** One macrotask -- lets a chained-but-async write (e.g. hub registration after the ack) settle. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * A hub bound to its own `EventEmitter`, standing in for the "durable" business-logic side of
 * subscriptions (Task 13's territory): something else, elsewhere, owns the hub and fires
 * producer events into it. `runSubscriptionExchange`'s throwaway server only ever borrows it.
 */
function createStubDurableHub() {
  const emitter = new EventEmitter<ServerEvents>()
  const hub = createSubscriptionHub({ events: emitter })
  return { hub, emitResourceUpdated: (uri: string) => emitter.emit('resourceUpdated', { uri }) }
}

function runExchange(overrides: Partial<SubscriptionExchangeParams> & { message: ClientMessage }) {
  const { hub } = createStubDurableHub()
  return runSubscriptionExchange({
    requestID: null,
    createServer: ({ transport, subscriptionHub, connectionID }) =>
      new ContextServer({
        name: 'subscription-test-server',
        version: '1.0.0',
        protocolVersions: ['2026-07-28'],
        transport,
        subscriptionHub,
        connectionID,
      }),
    subscriptionHub: hub,
    replayBufferSize: 16,
    ...overrides,
  })
}

describe('runSubscriptionExchange', () => {
  test('the SSE response opens with the priming event then the ack, and stays open', async () => {
    const { hub, emitResourceUpdated } = createStubDurableHub()
    const filter = { resourceSubscriptions: ['file:///a'] }

    const response = await runSubscriptionExchange({
      message: listenMessage(1, filter),
      requestID: 1,
      createServer: ({ transport, subscriptionHub, connectionID }) =>
        new ContextServer({
          name: 'subscription-test-server',
          version: '1.0.0',
          protocolVersions: ['2026-07-28'],
          transport,
          subscriptionHub,
          connectionID,
        }),
      subscriptionHub: hub,
      replayBufferSize: 16,
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('text/event-stream')

    const frames = createSSEFrameReader(response)

    // First event: the priming frame -- empty data, exists only to open the stream.
    const priming = await frames.next()
    expect(priming?.data).toBe('')

    // Second event: the acknowledgement -- a notification, not the request's own response.
    const ackFrame = await frames.next()
    expect(ackFrame).toBeDefined()
    const ack = JSON.parse((ackFrame as SSEFrame).data) as Record<string, unknown>
    expect(ack.method).toBe('notifications/subscriptions/acknowledged')
    expect((ack as { id?: unknown }).id).toBeUndefined()

    // The stub durable server emits one notification once the subscription is live.
    await settle()
    await emitResourceUpdated('file:///a')

    const updateFrame = await frames.next()
    expect(updateFrame).toBeDefined()
    const update = JSON.parse((updateFrame as SSEFrame).data) as Record<string, unknown>
    expect(update.method).toBe('notifications/resources/updated')

    // Nothing closes the stream: no response timeout fired, and neither the ack nor this
    // notification was treated as the request's own response. A further read stays pending.
    const result = await raceTimeout(frames.next(), 100)
    expect(result).toBe('timeout')

    await hub.dispose()
  })

  // The held terminal is the subscription's own response (`isOwnResponse`) and its definitive end,
  // so writing it closes the exchange — keeping a standalone `endAllGracefully()` from leaking the
  // borrower until handler shutdown.
  test('closes the stream once the held terminal is written', async () => {
    const { hub } = createStubDurableHub()

    const response = await runSubscriptionExchange({
      message: listenMessage(1, {}),
      requestID: 1,
      createServer: ({ transport, subscriptionHub, connectionID }) =>
        new ContextServer({
          name: 'subscription-test-server',
          version: '1.0.0',
          protocolVersions: ['2026-07-28'],
          transport,
          subscriptionHub,
          connectionID,
        }),
      subscriptionHub: hub,
      replayBufferSize: 16,
    })

    const frames = createSSEFrameReader(response)
    await frames.next() // priming
    await frames.next() // ack

    // Graceful completion, driven from the durable side: resolves the held terminal, which the RPC
    // layer writes as this request's own response.
    await settle()
    await hub.endAllGracefully()

    const terminalFrame = await frames.next()
    expect(terminalFrame).toBeDefined()
    const terminal = JSON.parse((terminalFrame as SSEFrame).data) as {
      id?: unknown
      result?: unknown
    }
    expect(terminal.id).toBe(1)
    expect(terminal.result).toBeDefined()

    // Writing the terminal ends the exchange: the stream closes rather than staying open.
    const next = await raceTimeout(frames.next(), 500)
    expect(next).toBeUndefined()

    await hub.dispose()
  })

  test('mints a fresh connectionID per exchange via runtime.getRandomID()', async () => {
    const connectionIDs: Array<string> = []
    const runtime = { getRandomID: () => `fixed-${connectionIDs.length}` }

    const response = await runExchange({
      message: listenMessage(1, {}),
      requestID: 1,
      runtime,
      createServer: ({ transport, subscriptionHub, connectionID }) => {
        connectionIDs.push(connectionID)
        return new ContextServer({
          name: 'subscription-test-server',
          version: '1.0.0',
          protocolVersions: ['2026-07-28'],
          transport,
          subscriptionHub,
          connectionID,
        })
      },
    })

    expect(response.status).toBe(200)
    expect(connectionIDs).toEqual(['fixed-0'])
  })

  test('an already-aborted signal short-circuits before a server is built', async () => {
    let serversCreated = 0
    const abort = new AbortController()
    abort.abort()

    const response = await runExchange({
      message: listenMessage(1, {}),
      requestID: 1,
      signal: abort.signal,
      createServer: ({ transport, subscriptionHub, connectionID }) => {
        serversCreated++
        return new ContextServer({
          name: 'subscription-test-server',
          version: '1.0.0',
          protocolVersions: ['2026-07-28'],
          transport,
          subscriptionHub,
          connectionID,
        })
      },
    })

    expect(response.status).toBe(499)
    expect(serversCreated).toBe(0)
  })

  test('a client abort tears the exchange down', async () => {
    const abort = new AbortController()
    let disposed: Promise<void> | undefined

    const responsePromise = runExchange({
      message: listenMessage(1, {}),
      requestID: 1,
      signal: abort.signal,
      createServer: ({ transport, subscriptionHub, connectionID }) => {
        const server = new ContextServer({
          name: 'subscription-test-server',
          version: '1.0.0',
          protocolVersions: ['2026-07-28'],
          transport,
          subscriptionHub,
          connectionID,
        })
        disposed = server.disposed
        return server
      },
    })

    const response = await responsePromise
    // The SSE stream had already opened (ack written) before the abort below, so the response
    // promise settled with the stream, not with the post-teardown 503 -- same as
    // `runStatelessExchange`. Aborting still has to reach the throwaway server's disposal.
    expect(response.status).toBe(200)
    const frames = createSSEFrameReader(response)
    await frames.next() // priming
    await frames.next() // ack

    abort.abort()
    await disposed
  })
})
