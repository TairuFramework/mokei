/**
 * `subscriptions/listen` (SEP-1391 / SEP-2575, `2026-07-28`) interop between mokei and the official
 * SDK v2, in BOTH directions, over stdio and Streamable HTTP:
 *
 * 1. mokei's `subscriptions/listen` CLIENT against the SDK v2 SERVER.
 * 2. The SDK v2 CLIENT against mokei's `subscriptions/listen` SERVER (Task 19) — including the
 *    two-clients-same-id case that exercises a stateless-HTTP durable hub's `(connectionID,
 *    subscriptionID)` keying: two concurrent SDK v2 clients both mint the same JSON-RPC request id
 *    for their listen (`listen:0`, each client's own first-call id), served by two per-POST
 *    `ContextServer`s that borrow one durable hub under two different `connectionID`s.
 *
 * The SDK v2 server implements `subscriptions/listen` server-side on both transports — ack-first,
 * capability-narrowed filtering, per-frame subscription-id stamping, and a graceful terminal result
 * — but through two different seams, and each transport here drives the one that matches how it
 * delivers:
 *
 * - **HTTP** (`createMcpHandler`): the returned handler owns a change-event bus. Its `notify`
 *   facade (`resourceUpdated(uri)` / `resourcesChanged()`) publishes onto that bus, and every open
 *   `subscriptions/listen` SSE stream that opted in gets a stamped copy. `handler.close()` writes
 *   the graceful terminal result to each open stream.
 * - **stdio** (`serveStdio`): no bus — the entry intercepts the pinned instance's outbound change
 *   notifications and reroutes them onto the open subscriptions. So the way to make a spawned stdio
 *   server emit is to have the pinned instance emit, which the fixture's `emitUpdates` tool does.
 *   The graceful terminal is written when the entry's `close()` runs, which the fixture ties to its
 *   stdin closing.
 *
 * The terminal listen result carries no client-side event (a graceful `result` settle just ends the
 * stream), so both rows assert it directly on the wire — the SDK server's own frames, tapped where
 * they cross into mokei's transport — proving the terminal's `result._meta[subscriptionId]` matches
 * the active subscription that delivered the notifications.
 *
 * The mokei-server-under-test rows (2) instead drive the SDK v2 CLIENT's own public
 * `McpSubscription` surface — `honoredFilter`, notification handlers, and `closed` (which resolves
 * `'graceful'` on a server-written terminal result) — no wire tap needed there: unlike mokei's own
 * client, the SDK client surfaces a graceful-teardown signal directly.
 */
import {
  type Client,
  type ResourceUpdatedNotificationParams,
  StreamableHTTPClientTransport,
  SUBSCRIPTION_ID_META_KEY,
} from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import type { ContextClient } from '@mokei/context-client'
import { META_SUBSCRIPTION_ID } from '@mokei/context-protocol'
import { afterEach, describe, expect, test } from 'vitest'

import {
  connectMokeiHTTPClient,
  createSDKClient,
  MOKEI_STDIO_SERVER_SUBSCRIPTIONS_PATH,
  type MokeiSubscriptionsHTTPServer,
  SDK_STDIO_SERVER_SUBSCRIPTIONS_PATH,
  spawnMokeiStdioSubscriptionClient,
  startMokeiSubscriptionsHTTPServer,
  startSDKSubscriptionsHTTPServer,
} from '../support/interop/servers.ts'
import { EMIT_TOOL_NAME, WATCHED_URI } from '../support/interop/subscriptions-fixture.ts'

/** A frame the SDK server wrote to a listen stream, decoded from whichever transport carried it. */
type WireFrame = {
  id?: string | number
  method?: string
  result?: { resultType?: string; _meta?: Record<string, unknown> }
  params?: { _meta?: Record<string, unknown> }
}

/** The graceful terminal listen results seen on the wire (a `result` carrying a subscription id). */
function terminalFrames(frames: ReadonlyArray<WireFrame>): Array<WireFrame> {
  return frames.filter((frame) => frame.result?._meta?.[META_SUBSCRIPTION_ID] != null)
}

/** Polls `read` until it returns a non-empty array, or throws after `timeoutMs`. */
async function poll<T>(read: () => Array<T>, timeoutMs = 5_000): Promise<Array<T>> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = read()
    if (value.length > 0) {
      return value
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for a frame`)
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

/**
 * The per-transport seams the shared body drives. `emit` triggers exactly one
 * `notifications/resources/updated` for {@link WATCHED_URI} and one
 * `notifications/resources/list_changed`; `gracefulTeardown` triggers the server-side graceful
 * close that writes the terminal listen result; `frames` returns the listen-stream frames tapped so
 * far.
 */
type SubscriptionHarness = {
  client: ContextClient
  emit: () => Promise<void>
  gracefulTeardown: () => Promise<void>
  frames: () => ReadonlyArray<WireFrame>
  dispose: () => Promise<void>
}

/**
 * Wrap `globalThis.fetch`, teeing the SSE body of every `subscriptions/listen` POST and parsing its
 * frames into `frames`. Restores the original `fetch` on `restore`.
 *
 * Patching a global is safe only because vitest runs the tests within a file serially (the same
 * reasoning `interop-sdk-server.test.ts`'s `captureFetch` relies on).
 */
function captureListenFrames(): { frames: Array<WireFrame>; restore: () => void } {
  const frames: Array<WireFrame> = []
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const isListen = typeof init?.body === 'string' && init.body.includes('"subscriptions/listen"')
    const response = await original(input, init)
    if (!isListen || response.body == null) {
      return response
    }
    const [toClient, toTap] = response.body.tee()
    void (async () => {
      const reader = toTap.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) {
            break
          }
          buffer += decoder.decode(value, { stream: true })
          let index = buffer.indexOf('\n')
          while (index !== -1) {
            const line = buffer.slice(0, index).trimEnd()
            buffer = buffer.slice(index + 1)
            if (line.startsWith('data:')) {
              const json = line.slice('data:'.length).trim()
              if (json.length > 0) {
                try {
                  frames.push(JSON.parse(json) as WireFrame)
                } catch {
                  // A non-JSON data line (there are none in this fixture's frames) is ignored.
                }
              }
            }
            index = buffer.indexOf('\n')
          }
        }
      } catch {
        // The client aborting the listen fetch (a superseded generation, or dispose) errors this
        // tee branch; there is nothing left to capture.
      }
    })()
    return new Response(toClient, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }) as typeof globalThis.fetch
  return {
    frames,
    restore: () => {
      globalThis.fetch = original
    },
  }
}

type TransportRow = {
  name: string
  setup: () => Promise<SubscriptionHarness>
}

const ROWS: ReadonlyArray<TransportRow> = [
  {
    name: 'over stdio',
    setup: async () => {
      const spawned = await spawnMokeiStdioSubscriptionClient(SDK_STDIO_SERVER_SUBSCRIPTIONS_PATH)
      return {
        client: spawned.client,
        // The pinned stdio instance emits both notifications; `serveStdio` reroutes them onto the
        // open subscription. Reaching the tool at all requires the earlier `subscribeResource` to
        // have opened the listen the notifications are delivered on.
        emit: async () => {
          await spawned.client.callTool({ name: EMIT_TOOL_NAME, arguments: {} })
        },
        // Closing the child's stdin is what the entry turns into a graceful `serveStdio` teardown.
        gracefulTeardown: async () => {
          spawned.endInput()
        },
        frames: () => spawned.received as ReadonlyArray<WireFrame>,
        dispose: spawned.dispose,
      }
    },
  },
  {
    name: 'over Streamable HTTP',
    setup: async () => {
      const httpServer = await startSDKSubscriptionsHTTPServer()
      const capture = captureListenFrames()
      const client = connectMokeiHTTPClient(httpServer.url, '2026-07-28')
      return {
        client,
        emit: async () => {
          httpServer.notify.resourceUpdated(WATCHED_URI)
          httpServer.notify.resourcesChanged()
        },
        // `handler.close()` runs the listen router's `closeAll()`, writing the graceful terminal
        // result to each open stream before ending it.
        gracefulTeardown: () => httpServer.closeHandler(),
        frames: () => capture.frames,
        dispose: async () => {
          await client.dispose()
          capture.restore()
          await httpServer.dispose()
        },
      }
    },
  },
]

describe.each(ROWS)('mokei subscriptions client against the SDK v2 server $name', (row) => {
  let harness: SubscriptionHarness | null = null

  afterEach(async () => {
    if (harness != null) {
      await harness.dispose()
      harness = null
    }
  })

  test('receives SDK v2 subscription notifications and the terminal result', async () => {
    harness = await row.setup()
    const { client } = harness

    // The server advertises resource subscriptions; without it mokei never opens a listen.
    const discovered = await client.discover()
    expect(discovered.capabilities.resources).toMatchObject({ subscribe: true, listChanged: true })

    // Subscribe: resolves once the server acknowledges, and the honored filter it echoed back is
    // exactly the requested one — the listChanged bits the server advertises plus the watched URI.
    // Asserting the whole filter (not a subset) is what proves the server HONORED the request.
    await client.subscribeResource({ uri: WATCHED_URI })
    expect(client.subscriptionFilter).toEqual({
      toolsListChanged: true,
      promptsListChanged: true,
      resourcesListChanged: true,
      resourceSubscriptions: [WATCHED_URI],
    })

    // Arm every delivery path before triggering: the client-wide `resourceUpdated` event, the
    // per-URI `onResourceUpdated` listener (which also carries the subscription id we cross-check
    // the terminal against), and the `resourcesListChanged` event.
    const resourceUpdatedEvent = client.events.once('resourceUpdated')
    const listChangedEvent = client.events.once('resourcesListChanged')
    let deliveredSubscriptionId: unknown
    const perUriDelivered = new Promise<void>((resolve) => {
      client.onResourceUpdated(WATCHED_URI, (notification) => {
        deliveredSubscriptionId = (notification as { params?: { _meta?: Record<string, unknown> } })
          .params?._meta?.[META_SUBSCRIPTION_ID]
        resolve()
      })
    })

    await harness.emit()

    expect(await resourceUpdatedEvent).toEqual({ uri: WATCHED_URI })
    await perUriDelivered
    await listChangedEvent
    // The delivered notification carried the active subscription's id in its `_meta`.
    expect(
      typeof deliveredSubscriptionId === 'string' || typeof deliveredSubscriptionId === 'number',
    ).toBe(true)

    // Graceful teardown: the SDK server writes the terminal listen result, which carries no
    // client-side event, so assert it on the wire. Exactly one subscription is open (the promoted
    // generation retired its predecessor), and its terminal `result._meta` names the same
    // subscription id the delivered notifications carried.
    await harness.gracefulTeardown()
    const terminals = await poll(() => terminalFrames(harness?.frames() ?? []))
    expect(terminals).toHaveLength(1)
    const terminal = terminals[0]
    expect(terminal?.result?._meta?.[META_SUBSCRIPTION_ID]).toBe(deliveredSubscriptionId)
    expect(terminal?.id).toBe(deliveredSubscriptionId)
  })
})

/**
 * The other direction (Task 19): the official SDK v2 CLIENT against mokei's `subscriptions/listen`
 * SERVER, over stdio (`subscriptions: true`, mokei owns the hub) and stateless Streamable HTTP
 * (`createMokeiSubscriptionConfig` served with a durable hub each per-POST server borrows).
 */
type MokeiServerHarness = {
  client: Client
  /** Triggers exactly one `notifications/resources/updated` for {@link WATCHED_URI} and one
   * `notifications/resources/list_changed`. */
  emit: () => Promise<void>
  /** Triggers the server-side graceful close that writes the terminal listen result. */
  gracefulTeardown: () => Promise<void>
  dispose: () => Promise<void>
}

type MokeiServerRow = {
  name: string
  setup: () => Promise<MokeiServerHarness>
}

const MOKEI_SERVER_ROWS: ReadonlyArray<MokeiServerRow> = [
  {
    name: 'over stdio',
    setup: async () => {
      const client = createSDKClient('2026-07-28')
      await client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [MOKEI_STDIO_SERVER_SUBSCRIPTIONS_PATH],
        }),
      )
      return {
        client,
        emit: async () => {
          await client.callTool({ name: EMIT_TOOL_NAME, arguments: {} })
        },
        // `StdioClientTransport#close()` ends the child's stdin before ever signalling it, which
        // `mokei-stdio-server-subscriptions.ts` turns into a graceful `ContextServer#dispose()` —
        // flushing the terminal listen result before the process actually exits.
        gracefulTeardown: () => client.close(),
        dispose: () => client.close(),
      }
    },
  },
  {
    name: 'over Streamable HTTP',
    setup: async () => {
      const httpServer = await startMokeiSubscriptionsHTTPServer()
      const client = createSDKClient('2026-07-28')
      await client.connect(new StreamableHTTPClientTransport(new URL(httpServer.url)))
      return {
        client,
        emit: async () => {
          httpServer.notify.resourceUpdated(WATCHED_URI)
          httpServer.notify.resourcesListChanged()
        },
        gracefulTeardown: () => httpServer.endAllGracefully(),
        dispose: async () => {
          await client.close()
          await httpServer.dispose()
        },
      }
    },
  },
]

describe.each(MOKEI_SERVER_ROWS)('SDK v2 client against the mokei server $name', (row) => {
  let harness: MokeiServerHarness | null = null

  afterEach(async () => {
    if (harness != null) {
      await harness.dispose()
      harness = null
    }
  })

  test('opens a listen, receives notifications, and observes the graceful terminal', async () => {
    harness = await row.setup()
    const { client } = harness

    // The server advertises resource subscriptions; without it the SDK client would refuse to
    // open a listen at all (`listen()` itself does not gate on the capability, but a real
    // consumer would check this the same way the mokei-client rows do on the other side).
    expect(client.getServerCapabilities()?.resources).toMatchObject({
      subscribe: true,
      listChanged: true,
    })

    const resourceUpdated = new Promise<ResourceUpdatedNotificationParams>((resolve) => {
      client.setNotificationHandler('notifications/resources/updated', (notification) => {
        resolve(notification.params)
      })
    })
    const listChanged = new Promise<void>((resolve) => {
      client.setNotificationHandler('notifications/resources/list_changed', () => {
        resolve()
      })
    })

    const subscription = await client.listen({
      resourceSubscriptions: [WATCHED_URI],
      resourcesListChanged: true,
    })
    // The whole filter, not a subset: mokei echoes `params.notifications` back verbatim (no
    // capability-based narrowing), so an exact match is what proves the request was honored.
    expect(subscription.honoredFilter).toEqual({
      resourceSubscriptions: [WATCHED_URI],
      resourcesListChanged: true,
    })

    await harness.emit()

    expect(await resourceUpdated).toMatchObject({ uri: WATCHED_URI })
    await listChanged

    // Graceful teardown: mokei writes the terminal listen result (a JSON-RPC RESULT response for
    // the listen request's own id), which the SDK client's transport-level demux recognizes and
    // settles `closed` to `'graceful'` — no wire tap needed, unlike the mokei-client rows above.
    await harness.gracefulTeardown()
    expect(await subscription.closed).toBe('graceful')
  })
})

/**
 * THE key case: two concurrent SDK v2 clients, both minting the same JSON-RPC request id for their
 * `subscriptions/listen` (`Client#listen`'s own `` `listen:${this._nextListenId++}` `` counter —
 * each fresh `Client` instance's FIRST listen call is `listen:0`), against ONE mokei
 * stateless-HTTP server with a durable hub. Every `subscriptions/listen` POST on `2026-07-28` is
 * served by its own transport-isolated per-POST `ContextServer` that borrows the durable hub and
 * mints its own `connectionID` (`runSubscriptionExchange`) — so this is exactly two subscriptions
 * sharing one `subscriptionID` value under two different `connectionID`s, the case the hub's
 * `Map<connectionID, Map<subscriptionID, …>>` keying (`createSubscriptionHub`) exists for.
 */
describe('two SDK v2 clients sharing a JSON-RPC request id (stateless HTTP, durable hub)', () => {
  test('each subscriber receives exactly its own delivery — no cross-delivery, no duplication', async () => {
    let httpServer: MokeiSubscriptionsHTTPServer | null = null
    let clientA: Client | null = null
    let clientB: Client | null = null

    try {
      httpServer = await startMokeiSubscriptionsHTTPServer()
      clientA = createSDKClient('2026-07-28')
      clientB = createSDKClient('2026-07-28')
      await clientA.connect(new StreamableHTTPClientTransport(new URL(httpServer.url)))
      await clientB.connect(new StreamableHTTPClientTransport(new URL(httpServer.url)))

      const receivedA: Array<ResourceUpdatedNotificationParams> = []
      const receivedB: Array<ResourceUpdatedNotificationParams> = []
      const firstA = new Promise<void>((resolve) => {
        clientA?.setNotificationHandler('notifications/resources/updated', (notification) => {
          receivedA.push(notification.params)
          resolve()
        })
      })
      const firstB = new Promise<void>((resolve) => {
        clientB?.setNotificationHandler('notifications/resources/updated', (notification) => {
          receivedB.push(notification.params)
          resolve()
        })
      })

      // Overlapping filters: both watch the same URI, so one emission matches both.
      const filter = { resourceSubscriptions: [WATCHED_URI] }
      const subscriptionA = await clientA.listen(filter)
      const subscriptionB = await clientB.listen(filter)

      // Emit ONE `resourceUpdated` matching both filters.
      httpServer.notify.resourceUpdated(WATCHED_URI)

      await firstA
      await firstB

      // Exactly one copy each: no duplication (a second copy on its own stream) and no
      // cross-delivery (the other client's copy) from this single emission.
      expect(receivedA).toHaveLength(1)
      expect(receivedB).toHaveLength(1)
      expect(receivedA[0]).toMatchObject({ uri: WATCHED_URI })
      expect(receivedB[0]).toMatchObject({ uri: WATCHED_URI })

      // Both notifications carry the SAME subscription id — proof the two subscriptions really do
      // share one `subscriptionID` (not that the test accidentally picked distinct ones) and still
      // route correctly to their own stream, distinguished only by the per-POST `connectionID`.
      expect(receivedA[0]?._meta?.[SUBSCRIPTION_ID_META_KEY]).toBe('listen:0')
      expect(receivedB[0]?._meta?.[SUBSCRIPTION_ID_META_KEY]).toBe('listen:0')

      await subscriptionA.close()
      await subscriptionB.close()
    } finally {
      await clientA?.close()
      await clientB?.close()
      await httpServer?.dispose()
    }
  })
})
