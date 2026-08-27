/**
 * mokei's `subscriptions/listen` CLIENT (SEP-1391 / SEP-2575, `2026-07-28`) against the official
 * SDK v2 SERVER, over stdio and Streamable HTTP.
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
 */
import type { ContextClient } from '@mokei/context-client'
import { META_SUBSCRIPTION_ID } from '@mokei/context-protocol'
import { afterEach, describe, expect, test } from 'vitest'

import {
  connectMokeiHTTPClient,
  SDK_STDIO_SERVER_SUBSCRIPTIONS_PATH,
  spawnMokeiStdioSubscriptionClient,
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
    expect(terminal.result?._meta?.[META_SUBSCRIPTION_ID]).toBe(deliveredSubscriptionId)
    expect(terminal.id).toBe(deliveredSubscriptionId)
  })
})
