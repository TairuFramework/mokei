import type { ServerNotification } from '@mokei/context-protocol'
import { defer } from '@sozai/async'
import { describe, expect, test, vi } from 'vitest'

import {
  SubscriptionBackpressureError,
  type SubscriptionSink,
  SubscriptionWriter,
} from '../src/subscriptions.js'

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
