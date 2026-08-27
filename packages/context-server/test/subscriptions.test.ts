import { DirectTransports } from '@enkaku/transport'
import type {
  ClientMessage,
  ClientRequest,
  ServerMessage,
  ServerNotification,
} from '@mokei/context-protocol'
import { META_SUBSCRIPTION_ID } from '@mokei/context-protocol'
import { defer } from '@sozai/async'
import { EventEmitter } from '@sozai/event'
import { describe, expect, test, vi } from 'vitest'

import type { ServerEvents, ServerParams } from '../src/index.js'
import { ContextServer } from '../src/index.js'
import {
  createSubscriptionHub,
  SubscriptionBackpressureError,
  type SubscriptionEntry,
  type SubscriptionSink,
  SubscriptionWriter,
} from '../src/subscriptions.js'

const NEW_META = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
}

const minimalResources = {
  list: () => ({ resources: [] }),
  read: () => ({ contents: [] }),
}

/**
 * Yields one macrotask. Ack-first means the hub entry is registered *after* the ack write
 * succeeds — and on a pull-based transport the ack write resolves only once the client has read
 * the frame, so registration lands one macrotask after the client observes the ack. A real
 * producer event is not microtask-synchronized to that read; a test that emits immediately would
 * be, so it waits a tick for the subscription to become fully live first.
 */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

function createServedContext(params: Omit<ServerParams, 'name' | 'transport' | 'version'>): {
  server: ContextServer
  transports: DirectTransports<ServerMessage, ClientMessage>
} {
  const transports = new DirectTransports<ServerMessage, ClientMessage>()
  const server = new ContextServer({
    name: 'test',
    version: '0.0.0',
    transport: transports.server,
    ...params,
  })
  return { server, transports }
}

function resourceNotification(uri: string): ServerNotification {
  return {
    jsonrpc: '2.0',
    method: 'notifications/resources/updated',
    params: { uri },
  }
}

/** A sink that records concurrency: bumps a counter on entry, tracks the max seen, drops it on exit. */
function createConcurrencyTrackingSink(): {
  sink: SubscriptionSink
  written: Array<ServerNotification>
  state: { maxConcurrent: number; closed: Error | undefined | 'not-closed' }
} {
  const written: Array<ServerNotification> = []
  let inFlight = 0
  const state = { maxConcurrent: 0, closed: 'not-closed' as Error | undefined | 'not-closed' }
  const sink: SubscriptionSink = {
    async writeNotification(notification) {
      inFlight++
      state.maxConcurrent = Math.max(state.maxConcurrent, inFlight)
      // Yield a couple of microtask turns so a broken writer that fires calls concurrently has
      // room to overlap with the next one before this call resolves.
      await Promise.resolve()
      await Promise.resolve()
      written.push(notification)
      inFlight--
    },
    close(reason) {
      state.closed = reason
    },
  }
  return { sink, written, state }
}

describe('SubscriptionWriter', () => {
  test('writes enqueued notifications in order and never concurrently', async () => {
    const { sink, written, state } = createConcurrencyTrackingSink()
    const onFailure = vi.fn()
    const writer = new SubscriptionWriter({ sink, onFailure })

    const notifications = [
      resourceNotification('file:///a'),
      resourceNotification('file:///b'),
      resourceNotification('file:///c'),
    ]

    await Promise.all(notifications.map((n) => writer.enqueue(n)))

    expect(written).toEqual(notifications)
    expect(state.maxConcurrent).toBe(1)
    expect(onFailure).not.toHaveBeenCalled()
  })

  test('enqueue resolves only after writeNotification resolves', async () => {
    const gate = defer<void>()
    const order: Array<string> = []
    const sink: SubscriptionSink = {
      async writeNotification() {
        order.push('write-start')
        await gate.promise
        order.push('write-end')
      },
      close: vi.fn(),
    }
    const writer = new SubscriptionWriter({ sink, onFailure: vi.fn() })

    const enqueued = writer.enqueue(resourceNotification('file:///a')).then(() => {
      order.push('enqueue-resolved')
    })

    // Give the drain loop a chance to call writeNotification and start awaiting the gate.
    await Promise.resolve()
    await Promise.resolve()
    expect(order).toEqual(['write-start'])

    gate.resolve()
    await enqueued

    expect(order).toEqual(['write-start', 'write-end', 'enqueue-resolved'])
  })

  test('a second enqueue only reaches the sink after the first one settles', async () => {
    const started: Array<string> = []
    const gates = [defer<void>(), defer<void>()]
    let call = 0
    const sink: SubscriptionSink = {
      async writeNotification(notification) {
        const uri = (notification.params as { uri: string }).uri
        started.push(uri)
        const gate = gates[call]
        call++
        await gate.promise
      },
      close: vi.fn(),
    }
    const writer = new SubscriptionWriter({ sink, onFailure: vi.fn() })

    const first = writer.enqueue(resourceNotification('file:///a'))
    const second = writer.enqueue(resourceNotification('file:///b'))

    await Promise.resolve()
    await Promise.resolve()
    // Only the first frame should have reached the sink -- the second is still queued behind it.
    expect(started).toEqual(['file:///a'])

    gates[0].resolve()
    await first
    await Promise.resolve()
    await Promise.resolve()
    expect(started).toEqual(['file:///a', 'file:///b'])

    gates[1].resolve()
    await second
  })

  test('exceeding maxPendingFrames calls onFailure with SubscriptionBackpressureError and closes the sink', async () => {
    const gate = defer<void>()
    let closedWith: Error | undefined | 'not-closed' = 'not-closed'
    const sink: SubscriptionSink = {
      async writeNotification() {
        // Never resolves within the test -- keeps the first frame permanently in flight so
        // pending frames accumulate.
        await gate.promise
      },
      close(reason) {
        closedWith = reason
      },
    }
    const onFailure = vi.fn()
    const writer = new SubscriptionWriter({ sink, maxPendingFrames: 2, onFailure })

    // Frame 1: dispatched immediately to the sink (in flight, gated forever).
    const first = writer.enqueue(resourceNotification('file:///a'))
    first.catch(() => {})
    // Frame 2: queued behind it. pending === 2.
    const second = writer.enqueue(resourceNotification('file:///b'))
    second.catch(() => {})

    // Frame 3: pending (2) already meets maxPendingFrames (2) -> overflow.
    await expect(writer.enqueue(resourceNotification('file:///c'))).rejects.toBeInstanceOf(
      SubscriptionBackpressureError,
    )

    expect(onFailure).toHaveBeenCalledTimes(1)
    expect(onFailure.mock.calls[0][0]).toBeInstanceOf(SubscriptionBackpressureError)
    expect(closedWith).toBeInstanceOf(SubscriptionBackpressureError)

    // The already-queued (not yet dispatched) second frame is rejected too.
    await expect(second).rejects.toBeInstanceOf(SubscriptionBackpressureError)

    // Further enqueues are refused outright without re-invoking onFailure or close.
    await expect(writer.enqueue(resourceNotification('file:///d'))).rejects.toBeInstanceOf(
      SubscriptionBackpressureError,
    )
    expect(onFailure).toHaveBeenCalledTimes(1)

    // The in-flight frame cannot be un-sent -- it resolves normally once its write finally
    // settles, even though the writer has already failed.
    gate.resolve()
    await expect(first).resolves.toBeUndefined()
  })

  test('a real writeNotification rejection fails the whole writer', async () => {
    const writeError = new Error('sink write failed')
    let writeCalls = 0
    let closedWith: Error | undefined | 'not-closed' = 'not-closed'
    const sink: SubscriptionSink = {
      async writeNotification() {
        writeCalls++
        throw writeError
      },
      close(reason) {
        closedWith = reason
      },
    }
    const onFailure = vi.fn()
    const writer = new SubscriptionWriter({ sink, onFailure })

    await expect(writer.enqueue(resourceNotification('file:///a'))).rejects.toBe(writeError)

    expect(onFailure).toHaveBeenCalledTimes(1)
    expect(onFailure.mock.calls[0][0]).toBe(writeError)
    expect(closedWith).toBe(writeError)

    // A subsequent enqueue is refused -- and no further writeNotification is attempted on the
    // now-dead sink.
    await expect(writer.enqueue(resourceNotification('file:///b'))).rejects.toBe(writeError)
    expect(writeCalls).toBe(1)
    expect(onFailure).toHaveBeenCalledTimes(1)
  })

  test('flush resolves once the queue is fully drained', async () => {
    const sink: SubscriptionSink = {
      async writeNotification() {
        await Promise.resolve()
      },
      close: vi.fn(),
    }
    const writer = new SubscriptionWriter({ sink, onFailure: vi.fn() })

    let flushed = false
    const enqueued = Promise.all([
      writer.enqueue(resourceNotification('file:///a')),
      writer.enqueue(resourceNotification('file:///b')),
    ])
    const flush = writer.flush().then(() => {
      flushed = true
    })

    expect(flushed).toBe(false)
    await enqueued
    await flush
    expect(flushed).toBe(true)
  })

  test('abort stops the writer without calling onFailure or closing the sink', async () => {
    const gate = defer<void>()
    const close = vi.fn()
    const sink: SubscriptionSink = {
      async writeNotification() {
        await gate.promise
      },
      close,
    }
    const onFailure = vi.fn()
    const writer = new SubscriptionWriter({ sink, onFailure })

    const first = writer.enqueue(resourceNotification('file:///a'))
    first.catch(() => {})
    const second = writer.enqueue(resourceNotification('file:///b'))

    const reason = new Error('aborted by caller')
    writer.abort(reason)

    await expect(second).rejects.toBe(reason)
    await expect(writer.enqueue(resourceNotification('file:///c'))).rejects.toBe(reason)
    expect(onFailure).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()

    // The in-flight frame cannot be un-sent -- it resolves normally once its write finally
    // settles, even though the writer has already been aborted.
    gate.resolve()
    await expect(first).resolves.toBeUndefined()
  })
})

function toolsListChangedNotification(): ServerNotification {
  return { jsonrpc: '2.0', method: 'notifications/tools/list_changed' }
}

function createEntry(
  overrides: Partial<SubscriptionEntry> &
    Pick<SubscriptionEntry, 'connectionID' | 'subscriptionID'>,
): {
  entry: SubscriptionEntry
  deliver: ReturnType<typeof vi.fn>
  complete: ReturnType<typeof vi.fn>
} {
  const deliver = vi.fn(async () => {})
  const complete = vi.fn(async () => {})
  const entry: SubscriptionEntry = {
    filter: {},
    deliver,
    complete,
    ...overrides,
  }
  return { entry, deliver, complete }
}

describe('SubscriptionHub', () => {
  test('resourceUpdated delivers only to entries subscribed to that uri', async () => {
    const events = new EventEmitter<ServerEvents>()
    const hub = createSubscriptionHub({ events })

    const subscribed = createEntry({
      connectionID: 'A',
      subscriptionID: 0,
      filter: { resourceSubscriptions: ['file:///a'] },
    })
    const other = createEntry({
      connectionID: 'B',
      subscriptionID: 0,
      filter: { resourceSubscriptions: ['file:///other'] },
    })
    hub.register(subscribed.entry)
    hub.register(other.entry)

    await events.emit('resourceUpdated', { uri: 'file:///a' })

    expect(subscribed.deliver).toHaveBeenCalledTimes(1)
    expect(subscribed.deliver).toHaveBeenCalledWith({
      jsonrpc: '2.0',
      method: 'notifications/resources/updated',
      params: { uri: 'file:///a' },
    })
    expect(other.deliver).not.toHaveBeenCalled()

    await hub.dispose()
  })

  test('toolsListChanged delivers only to entries with filter.toolsListChanged === true', async () => {
    const events = new EventEmitter<ServerEvents>()
    const hub = createSubscriptionHub({ events })

    const subscribed = createEntry({
      connectionID: 'A',
      subscriptionID: 0,
      filter: { toolsListChanged: true },
    })
    const notSubscribed = createEntry({
      connectionID: 'B',
      subscriptionID: 0,
      filter: { toolsListChanged: false },
    })
    hub.register(subscribed.entry)
    hub.register(notSubscribed.entry)

    await events.emit('toolsListChanged')

    expect(subscribed.deliver).toHaveBeenCalledTimes(1)
    expect(subscribed.deliver).toHaveBeenCalledWith(toolsListChangedNotification())
    expect(notSubscribed.deliver).not.toHaveBeenCalled()

    await hub.dispose()
  })

  test('entries with the same subscriptionID but different connectionID are distinct and both receive matching events', async () => {
    const events = new EventEmitter<ServerEvents>()
    const hub = createSubscriptionHub({ events })

    const a = createEntry({
      connectionID: 'A',
      subscriptionID: 0,
      filter: { toolsListChanged: true },
    })
    const b = createEntry({
      connectionID: 'B',
      subscriptionID: 0,
      filter: { toolsListChanged: true },
    })
    hub.register(a.entry)
    hub.register(b.entry)

    await events.emit('toolsListChanged')

    expect(a.deliver).toHaveBeenCalledTimes(1)
    expect(b.deliver).toHaveBeenCalledTimes(1)

    await hub.dispose()
  })

  test('endAllGracefully calls and awaits every entry complete()', async () => {
    const events = new EventEmitter<ServerEvents>()
    const hub = createSubscriptionHub({ events })

    const gate = defer<void>()
    let completedFirst = false
    const slow = createEntry({ connectionID: 'A', subscriptionID: 0 })
    slow.complete.mockImplementation(async () => {
      await gate.promise
      completedFirst = true
    })
    const fast = createEntry({ connectionID: 'B', subscriptionID: 1 })
    hub.register(slow.entry)
    hub.register(fast.entry)

    const done = hub.endAllGracefully().then(() => {
      expect(completedFirst).toBe(true)
    })

    expect(slow.complete).toHaveBeenCalledTimes(1)
    expect(fast.complete).toHaveBeenCalledTimes(1)

    gate.resolve()
    await done

    // Entries were removed -- a subsequent event no longer reaches them.
    await events.emit('toolsListChanged')
    expect(slow.deliver).not.toHaveBeenCalled()
    expect(fast.deliver).not.toHaveBeenCalled()

    await hub.dispose()
  })

  test('handle.close and handle.complete are mutually exclusive, first-settlement-wins', async () => {
    const events = new EventEmitter<ServerEvents>()
    const hub = createSubscriptionHub({ events })

    // close() first -- complete() becomes a no-op and never calls entry.complete().
    const closedFirst = createEntry({ connectionID: 'A', subscriptionID: 0 })
    const handle1 = hub.register(closedFirst.entry)
    const reason = new Error('cancelled')
    handle1.close(reason)
    await handle1.complete()
    expect(closedFirst.complete).not.toHaveBeenCalled()

    // complete() first -- close() becomes a no-op.
    const completedFirst = createEntry({ connectionID: 'B', subscriptionID: 0 })
    const handle2 = hub.register(completedFirst.entry)
    const completion = handle2.complete()
    handle2.close(new Error('too late'))
    await completion
    expect(completedFirst.complete).toHaveBeenCalledTimes(1)

    // Both entries were removed on first settlement -- no double delivery, no leaks.
    await events.emit('toolsListChanged')
    expect(closedFirst.deliver).not.toHaveBeenCalled()
    expect(completedFirst.deliver).not.toHaveBeenCalled()

    await hub.dispose()
  })
})

describe('ContextServer subscriptions/listen', () => {
  test('acks first, then streams matching producer notifications carrying the subscriptionId', async () => {
    const { server, transports } = createServedContext({
      protocolVersions: ['2026-07-28'],
      resources: minimalResources,
      subscriptions: true,
    })

    const filter = { resourceSubscriptions: ['file:///a'], toolsListChanged: true }
    transports.client.write({
      jsonrpc: '2.0',
      id: 7,
      method: 'subscriptions/listen',
      params: { notifications: filter, _meta: NEW_META },
    } as ClientRequest)

    // The first frame on the stream must be the acknowledgement -- not an immediate JSON-RPC
    // response (a response would carry `id` and `result`, a notification carries neither).
    const ack = await transports.client.read()
    expect(ack.value).toMatchObject({
      jsonrpc: '2.0',
      method: 'notifications/subscriptions/acknowledged',
      params: {
        notifications: filter,
        _meta: { [META_SUBSCRIPTION_ID]: 7 },
      },
    })
    expect((ack.value as { id?: unknown }).id).toBeUndefined()
    await settle()

    // A producer event for a subscribed URI arrives on the stream, decorated with the id.
    await server.events.emit('resourceUpdated', { uri: 'file:///a' })
    const updated = await transports.client.read()
    expect(updated.value).toMatchObject({
      jsonrpc: '2.0',
      method: 'notifications/resources/updated',
      params: {
        uri: 'file:///a',
        _meta: { [META_SUBSCRIPTION_ID]: 7 },
      },
    })

    // Read the graceful terminal concurrently with dispose so the pull-based transport's write
    // is not left waiting on an absent reader.
    const disposing = server.dispose()
    await transports.client.read()
    await disposing
    await transports.dispose()
  })

  test('does not deliver events the filter did not opt into', async () => {
    const { server, transports } = createServedContext({
      protocolVersions: ['2026-07-28'],
      resources: minimalResources,
      subscriptions: true,
    })

    transports.client.write({
      jsonrpc: '2.0',
      id: 1,
      method: 'subscriptions/listen',
      params: { notifications: { resourceSubscriptions: ['file:///a'] }, _meta: NEW_META },
    } as ClientRequest)
    await transports.client.read() // ack
    await settle()

    // A URI outside the filter is dropped; the next frame the client sees is the one for the
    // subscribed URI, never the unsubscribed one.
    await server.events.emit('resourceUpdated', { uri: 'file:///other' })
    await server.events.emit('resourceUpdated', { uri: 'file:///a' })
    const next = await transports.client.read()
    expect(next.value).toMatchObject({
      method: 'notifications/resources/updated',
      params: { uri: 'file:///a' },
    })

    const disposing = server.dispose()
    await transports.client.read()
    await disposing
    await transports.dispose()
  })

  test('graceful dispose writes the terminal result before closing', async () => {
    const { server, transports } = createServedContext({
      protocolVersions: ['2026-07-28'],
      resources: minimalResources,
      subscriptions: true,
    })

    transports.client.write({
      jsonrpc: '2.0',
      id: 42,
      method: 'subscriptions/listen',
      params: { notifications: { resourcesListChanged: true }, _meta: NEW_META },
    } as ClientRequest)
    await transports.client.read() // ack
    await settle()

    // Dispose gracefully; read the terminal concurrently so the pull-based transport's terminal
    // write is not left blocked on an absent reader (which would stall dispose to its deadline).
    const disposing = server.dispose()

    // The terminal response carries only `result._meta[subscriptionId]` (== the listen id) --
    // no `resultType`.
    const terminal = await transports.client.read()
    expect(terminal.value).toEqual({
      jsonrpc: '2.0',
      id: 42,
      result: { _meta: { [META_SUBSCRIPTION_ID]: 42 } },
    })
    expect(
      (terminal.value as { result: Record<string, unknown> }).result.resultType,
    ).toBeUndefined()

    // The stream is closed after the terminal write.
    await expect(transports.client.read()).resolves.toEqual({ done: true, value: undefined })
    await disposing
    await transports.dispose()
  })

  test('client cancelling the listen tears the subscription down: no terminal, no further delivery', async () => {
    const { server, transports } = createServedContext({
      protocolVersions: ['2026-07-28'],
      resources: minimalResources,
      subscriptions: true,
    })

    transports.client.write({
      jsonrpc: '2.0',
      id: 5,
      method: 'subscriptions/listen',
      params: { notifications: { resourceSubscriptions: ['file:///a'] }, _meta: NEW_META },
    } as ClientRequest)
    const ack = await transports.client.read()
    expect((ack.value as { method: string }).method).toBe(
      'notifications/subscriptions/acknowledged',
    )
    await settle()

    // The client cancels the listen request -- the same `notifications/cancelled` path the RPC
    // scheduler already handles. This aborts the held request's signal, which routes to
    // `handle.close` and unregisters the subscription.
    transports.client.write({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId: 5 },
    })
    await settle()

    // A matching producer event must NOT reach the now-torn-down subscription.
    await server.events.emit('resourceUpdated', { uri: 'file:///a' })
    await settle()

    // Graceful dispose must write NO terminal for a cancelled listen (MCP: a cancelled request is
    // not responded to). The first -- and only -- frame the client sees is the stream close: no
    // `resources/updated` frame from the emit above, and no `subscriptions/listen` terminal.
    const disposing = server.dispose()
    await expect(transports.client.read()).resolves.toEqual({ done: true, value: undefined })
    await disposing
    await transports.dispose()
  })

  test('a per-subscription sink write failure tears the subscription down', async () => {
    const onError = vi.fn()
    const { server, transports } = createServedContext({
      protocolVersions: ['2026-07-28'],
      resources: minimalResources,
      subscriptions: true,
      onError,
    })

    // Make the delivery write (only) fail, so the writer's `onFailure` fires on the first
    // producer frame while the ack -- a different method -- still writes cleanly.
    const writeError = new Error('sink boom')
    const originalWrite = transports.server.write.bind(transports.server)
    transports.server.write = async (message) => {
      if ((message as { method?: string }).method === 'notifications/resources/updated') {
        throw writeError
      }
      return originalWrite(message)
    }

    transports.client.write({
      jsonrpc: '2.0',
      id: 9,
      method: 'subscriptions/listen',
      params: { notifications: { resourceSubscriptions: ['file:///a'] }, _meta: NEW_META },
    } as ClientRequest)
    const ack = await transports.client.read()
    expect((ack.value as { method: string }).method).toBe(
      'notifications/subscriptions/acknowledged',
    )
    await settle()

    // First matching event: its delivery write rejects -> writer.onFailure -> teardown, which
    // rejects the held terminal. That rejection surfaces through the RPC layer's `onError`.
    await server.events.emit('resourceUpdated', { uri: 'file:///a' })
    await settle()
    await settle()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0]).toBe(writeError)

    // The subscription is gone: a second matching event reaches no sink, so no further failure.
    await server.events.emit('resourceUpdated', { uri: 'file:///a' })
    await settle()
    await settle()
    expect(onError).toHaveBeenCalledTimes(1)

    // And graceful dispose writes no terminal for the torn-down subscription.
    const disposing = server.dispose()
    await expect(transports.client.read()).resolves.toEqual({ done: true, value: undefined })
    await disposing
    await transports.dispose()
  })

  test('constructing with both `subscriptions` and `subscriptionHub` throws', () => {
    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    const hub = createSubscriptionHub({ events: new EventEmitter<ServerEvents>() })
    expect(
      () =>
        new ContextServer({
          name: 'test',
          version: '0.0.0',
          transport: transports.server,
          protocolVersions: ['2026-07-28'],
          subscriptions: true,
          subscriptionHub: hub,
        }),
    ).toThrow()
  })

  describe('resources.subscribe capability gating', () => {
    async function discoverCapabilities(
      params: Omit<ServerParams, 'name' | 'transport' | 'version'>,
    ): Promise<Record<string, unknown>> {
      const { server, transports } = createServedContext(params)
      transports.client.write({
        jsonrpc: '2.0',
        id: 1,
        method: 'server/discover',
        params: { _meta: NEW_META },
      } as ClientRequest)
      const res = await transports.client.read()
      const capabilities = (res.value as { result: { capabilities: Record<string, unknown> } })
        .result.capabilities
      await server.dispose()
      await transports.dispose()
      return capabilities
    }

    test('advertises resources.subscribe when resources are configured and a hub is present', async () => {
      const capabilities = await discoverCapabilities({
        protocolVersions: ['2026-07-28'],
        resources: minimalResources,
        subscriptions: true,
      })
      expect(capabilities.resources).toEqual({ listChanged: true, subscribe: true })
    })

    test('does not advertise subscribe when resources are configured but no hub is present', async () => {
      const capabilities = await discoverCapabilities({
        protocolVersions: ['2026-07-28'],
        resources: minimalResources,
      })
      expect(capabilities.resources).toEqual({ listChanged: true })
    })

    test('does not advertise a resources capability when a hub is present but no resources configured', async () => {
      const capabilities = await discoverCapabilities({
        protocolVersions: ['2026-07-28'],
        subscriptions: true,
      })
      expect(capabilities.resources).toBeUndefined()
    })
  })
})
