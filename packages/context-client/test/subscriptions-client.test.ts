import { DirectTransports } from '@enkaku/transport'
import type {
  ClientMessage,
  RequestID,
  ServerCapabilities,
  ServerMessage,
} from '@mokei/context-protocol'
import { META_SUBSCRIPTION_ID } from '@mokei/context-protocol'
import { describe, expect, test } from 'vitest'

import { ContextClient } from '../src/client.js'
import { SubscriptionProtocolError } from '../src/index.js'

const ACK_METHOD = 'notifications/subscriptions/acknowledged'

/** Caps a subscribe-capable `2026-07-28` server advertises. */
const SUBSCRIBE_CAPS: ServerCapabilities = {
  resources: { subscribe: true, listChanged: true },
  tools: { listChanged: true },
  prompts: { listChanged: true },
}

function discoverResult(capabilities: ServerCapabilities) {
  return {
    capabilities,
    resultType: 'complete' as const,
    supportedVersions: ['2026-07-28'],
    serverInfo: { name: 'Test', version: '0.0.0' },
  }
}

type Deferred = { promise: Promise<void>; resolve: () => void }
function deferred(): Deferred {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/** Flush pending micro/macro tasks so the client read loop drains written frames. */
async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

type ServerState = {
  listenId: RequestID | undefined
  listenFilter: unknown
  discoverCount: number
}

type ServerOptions = {
  capabilities?: ServerCapabilities
  /** Ack only the first `subscriptions/listen` (the auto-open); ignore later candidates. */
  ackOnlyFirst?: boolean
}

/**
 * Drives a fake `2026-07-28` server over the paired transport: answers `server/discover`,
 * acknowledges `subscriptions/listen` (recording its id), and answers `tools/list`/`resources/list`.
 * Dispatches by method so the test never depends on request-id ordering.
 */
function startServer(
  server: DirectTransports<ServerMessage, ClientMessage>['server'],
  options: ServerOptions = {},
) {
  const state: ServerState = { listenId: undefined, listenFilter: undefined, discoverCount: 0 }
  const firstAck = deferred()
  let acks = 0

  void (async () => {
    while (true) {
      const next = await server.read()
      if (next.done) {
        break
      }
      const message = next.value as { id?: RequestID; method?: string; params?: unknown }
      switch (message.method) {
        case 'server/discover': {
          state.discoverCount += 1
          server.write({
            jsonrpc: '2.0',
            id: message.id as RequestID,
            result: discoverResult(options.capabilities ?? SUBSCRIBE_CAPS),
          } as never)
          break
        }
        case 'subscriptions/listen': {
          const filter = (message.params as { notifications?: unknown }).notifications
          acks += 1
          if (options.ackOnlyFirst && acks > 1) {
            break
          }
          state.listenId = message.id
          state.listenFilter = filter
          server.write({
            jsonrpc: '2.0',
            method: ACK_METHOD,
            params: { notifications: filter, _meta: { [META_SUBSCRIPTION_ID]: message.id } },
          } as never)
          if (acks === 1) {
            firstAck.resolve()
          }
          break
        }
        case 'tools/list': {
          server.write({
            jsonrpc: '2.0',
            id: message.id as RequestID,
            result: { resultType: 'complete', tools: [] },
          } as never)
          break
        }
        case 'resources/list': {
          server.write({
            jsonrpc: '2.0',
            id: message.id as RequestID,
            result: { resultType: 'complete', resources: [] },
          } as never)
          break
        }
        default:
          // Ignore notifications (e.g. notifications/cancelled).
          break
      }
    }
  })()

  return {
    state,
    firstAcked: firstAck.promise,
    emit: (frame: unknown) => server.write(frame as never),
  }
}

describe('ContextClient subscriptions wiring', () => {
  test('auto-opens a listen after setup against a subscribe-capable server', async () => {
    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    const client = new ContextClient({
      protocolVersion: '2026-07-28',
      transport: transports.client,
    })
    const sub = startServer(transports.server)

    await client.listTools()
    await sub.firstAcked

    // The auto-open opted into exactly the listChanged types the server advertised (with the
    // driver's always-present, initially empty resource-subscription set).
    expect(sub.state.listenFilter).toEqual({
      toolsListChanged: true,
      promptsListChanged: true,
      resourcesListChanged: true,
      resourceSubscriptions: [],
    })
    expect(client.subscriptionFilter).toEqual(sub.state.listenFilter)

    await client.dispose()
  })

  test('does NOT auto-open when the server does not advertise resources.subscribe', async () => {
    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    const client = new ContextClient({
      protocolVersion: '2026-07-28',
      transport: transports.client,
    })
    const sub = startServer(transports.server, {
      capabilities: { tools: { listChanged: true } },
    })

    await client.listTools()
    await flush()
    expect(sub.state.listenId).toBeUndefined()

    await client.dispose()
  })

  test('a server resources/list_changed refreshes discovery (_resetDiscovery)', async () => {
    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    const client = new ContextClient({
      protocolVersion: '2026-07-28',
      transport: transports.client,
    })
    const sub = startServer(transports.server)

    // Setup seeds the capability snapshot with one discover; a gated call reuses it.
    await client.listTools()
    await sub.firstAcked
    expect(sub.state.discoverCount).toBe(1)
    await client.listTools()
    expect(sub.state.discoverCount).toBe(1)

    // A list_changed frame on the listen stream clears the discover-derived caches...
    sub.emit({
      jsonrpc: '2.0',
      method: 'notifications/resources/list_changed',
      params: { _meta: { [META_SUBSCRIPTION_ID]: sub.state.listenId } },
    })
    await flush()

    // ...so the next gated call re-fetches capabilities.
    await client.listTools()
    expect(sub.state.discoverCount).toBe(2)

    await client.dispose()
  })

  test('list_changed frames on the listen stream emit dataless client events (SEP-1391)', async () => {
    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    const client = new ContextClient({
      protocolVersion: '2026-07-28',
      transport: transports.client,
    })
    const sub = startServer(transports.server)

    const events: Array<string> = []
    client.events.on('toolsListChanged', () => {
      events.push('tools')
    })
    client.events.on('promptsListChanged', () => {
      events.push('prompts')
    })
    client.events.on('resourcesListChanged', () => {
      events.push('resources')
    })

    await client.listTools()
    await sub.firstAcked

    for (const which of ['tools', 'prompts', 'resources'] as const) {
      sub.emit({
        jsonrpc: '2.0',
        method: `notifications/${which}/list_changed`,
        params: { _meta: { [META_SUBSCRIPTION_ID]: sub.state.listenId } },
      })
    }
    await flush()

    // Each list_changed frame surfaced an observable client event, in addition to the existing
    // internal `_resetDiscovery()` routing.
    expect(events).toEqual(['tools', 'prompts', 'resources'])

    await client.dispose()
  })

  test('a resources/updated frame emits a resourceUpdated client event carrying the uri', async () => {
    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    const client = new ContextClient({
      protocolVersion: '2026-07-28',
      transport: transports.client,
    })
    const sub = startServer(transports.server)

    const updated: Array<{ uri: string }> = []
    client.events.on('resourceUpdated', (data) => {
      updated.push(data)
    })

    await client.listTools()
    await sub.firstAcked
    await client.subscribeResource({ uri: 'file:///z' })

    sub.emit({
      jsonrpc: '2.0',
      method: 'notifications/resources/updated',
      params: { uri: 'file:///z', _meta: { [META_SUBSCRIPTION_ID]: sub.state.listenId } },
    })
    await flush()

    expect(updated).toEqual([{ uri: 'file:///z' }])

    await client.dispose()
  })

  test('a resources/updated for a subscribed URI reaches a subscribeResource consumer', async () => {
    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    const client = new ContextClient({
      protocolVersion: '2026-07-28',
      transport: transports.client,
    })
    const sub = startServer(transports.server)

    await client.listTools()
    await sub.firstAcked

    const updates: Array<unknown> = []
    const off = client.onResourceUpdated('file:///x', (n) => updates.push(n))

    // Subscribing opens a fresh candidate; the server acks it and it becomes active.
    await client.subscribeResource({ uri: 'file:///x' })
    expect(sub.state.listenFilter).toMatchObject({ resourceSubscriptions: ['file:///x'] })

    // Attach a notifications reader before the update is emitted.
    const reader = client.notifications.getReader()

    sub.emit({
      jsonrpc: '2.0',
      method: 'notifications/resources/updated',
      params: { uri: 'file:///x', _meta: { [META_SUBSCRIPTION_ID]: sub.state.listenId } },
    })

    // Reaches the per-URI listener...
    const read = await reader.read()
    expect((read.value as { params: { uri: string } }).params.uri).toBe('file:///x')
    // ...and the per-URI subscriber.
    expect(updates.length).toBe(1)

    off()
    reader.releaseLock()
    await client.dispose()
  })

  test('a terminal result whose subscriptionId mismatches the envelope id is a protocol error', async () => {
    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    const errors: Array<Error> = []
    const client = new ContextClient({
      protocolVersion: '2026-07-28',
      transport: transports.client,
      onError: (error) => errors.push(error),
    })
    const sub = startServer(transports.server)

    await client.listTools()
    await sub.firstAcked

    // Terminal listen result correlated (on the wire) to the listen id, but carrying a wrong
    // subscriptionId in its `_meta`.
    sub.emit({
      jsonrpc: '2.0',
      id: sub.state.listenId,
      result: { _meta: { [META_SUBSCRIPTION_ID]: 999999 } },
    })
    await flush()

    expect(errors.some((error) => error instanceof SubscriptionProtocolError)).toBe(true)

    await client.dispose()
  })

  test('dispose() does not hang when a subscribe candidate is never acknowledged', async () => {
    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    const client = new ContextClient({
      protocolVersion: '2026-07-28',
      transport: transports.client,
    })
    startServer(transports.server, { ackOnlyFirst: true })

    await client.listTools()

    // The server acks the auto-open but never the subscribe candidate.
    const pending = client.subscribeResource({ uri: 'file:///y' })
    await flush()

    // Disposal tears down the in-flight candidate and rejects the pending mutation — no hang.
    await client.dispose()
    await expect(pending).rejects.toThrow()
  })
})
