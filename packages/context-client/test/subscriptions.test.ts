import type { SubscriptionFilter } from '@mokei/context-protocol'
import { describe, expect, test } from 'vitest'

import { type ListenHandlers, type OpenListen, SubscriptionDriver } from '../src/subscriptions.js'

const ACK = 'notifications/subscriptions/acknowledged'

function ackNotification(filter: SubscriptionFilter) {
  return { jsonrpc: '2.0' as const, method: ACK, params: { notifications: filter } }
}

function updatedNotification(uri: string) {
  return { jsonrpc: '2.0' as const, method: 'notifications/resources/updated', params: { uri } }
}

/** A single fake `subscriptions/listen` stream the test drives by hand. */
type FakeListen = {
  index: number
  filter: SubscriptionFilter
  handlers: ListenHandlers
  aborted: boolean
  abortReason?: Error
  /** Feed the `acknowledged` control frame. */
  ack: () => void
  /** Feed an ordinary notification frame. */
  notify: (n: unknown) => void
  /** Feed a transport-drop settle (`closed`). */
  close: (error?: Error) => void
  /** Feed a terminal settle with an explicit reason. */
  settle: (reason: 'result' | 'error' | 'cancel' | 'closed', error?: Error) => void
}

function makeHarness() {
  const opens: Array<FakeListen> = []
  const log: Array<string> = []

  const openListen: OpenListen = (filter, handlers) => {
    const index = opens.length + 1
    const rec: FakeListen = {
      index,
      filter,
      handlers,
      aborted: false,
      ack: () => {
        log.push(`ack:${index}`)
        handlers.onNotification(ackNotification(filter) as never)
      },
      notify: (n) => {
        handlers.onNotification(n as never)
      },
      close: (error) => {
        handlers.onSettle({ reason: 'closed', error })
      },
      settle: (reason, error) => {
        handlers.onSettle({ reason, error })
      },
    }
    opens.push(rec)
    log.push(`open:${index}`)
    return {
      exchange: new Promise(() => {}),
      abort: (reason?: Error) => {
        rec.aborted = true
        rec.abortReason = reason
        log.push(`abort:${index}`)
        // A real abort settles the exchange as `cancel`; the driver must ignore it
        // for an already-retired generation.
        handlers.onSettle({ reason: 'cancel', error: reason })
      },
    }
  }

  return { opens, log, openListen }
}

const immediateDelay = () => Promise.resolve()

/** Flush pending micro/macro tasks so queued mutations and reconnects run. */
async function flush(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

describe('SubscriptionDriver', () => {
  test('subscribeResource settles only after ack, and retires the previous stream after promotion', async () => {
    const { opens, log, openListen } = makeHarness()
    const driver = new SubscriptionDriver({ openListen, delay: immediateDelay })

    const p1 = driver.subscribeResource({ uri: 'file:///a' })
    await flush()
    // A candidate listen opened carrying the URI.
    expect(opens.length).toBe(1)
    expect(opens[0].filter.resourceSubscriptions).toEqual(['file:///a'])

    // The mutation does not settle before the ack.
    let settled1 = false
    void p1.then(() => {
      settled1 = true
    })
    await flush()
    expect(settled1).toBe(false)

    opens[0].ack()
    await p1
    expect(settled1).toBe(true)

    // Second subscribe opens a fresh candidate carrying both URIs.
    const p2 = driver.subscribeResource({ uri: 'file:///b' })
    await flush()
    expect(opens.length).toBe(2)
    expect(opens[1].filter.resourceSubscriptions).toEqual(['file:///a', 'file:///b'])
    // Open-before-retire: the previous stream is NOT aborted before the new one acks.
    expect(opens[0].aborted).toBe(false)

    opens[1].ack()
    await p2
    // Now, and only now, the previous stream is retired.
    expect(opens[0].aborted).toBe(true)
    expect(log).toEqual(['open:1', 'ack:1', 'open:2', 'ack:2', 'abort:1'])
  })

  test('drops a frame from a superseded generation', async () => {
    const { opens, openListen } = makeHarness()
    const driver = new SubscriptionDriver({ openListen, delay: immediateDelay })
    const received: Array<unknown> = []
    driver.onNotification((n) => received.push(n))

    const p1 = driver.subscribeResource({ uri: 'file:///a' })
    await flush()
    opens[0].ack()
    await p1

    const p2 = driver.subscribeResource({ uri: 'file:///b' })
    await flush()
    opens[1].ack()
    await p2

    // gen1 is retired; a late frame on it must be dropped.
    opens[0].notify(updatedNotification('file:///a'))
    expect(received).toEqual([])

    // A frame on the active generation is delivered.
    opens[1].notify(updatedNotification('file:///b'))
    expect(received.length).toBe(1)
  })

  test('a candidate whose first frame is not `acknowledged` is a protocol error via the error sink', async () => {
    const { opens, openListen } = makeHarness()
    const errors: Array<Error> = []
    const driver = new SubscriptionDriver({
      openListen,
      delay: immediateDelay,
      onError: (e) => errors.push(e),
    })

    const p = driver.subscribeResource({ uri: 'file:///a' })
    await flush()
    // First frame is an ordinary notification, not the acknowledgement.
    opens[0].notify(updatedNotification('file:///a'))

    await expect(p).rejects.toThrow()
    expect(errors.length).toBe(1)
    // The bad candidate is torn down.
    expect(opens[0].aborted).toBe(true)
  })

  test('concurrent subscribeResource calls serialize, each on its own generation', async () => {
    const { opens, openListen } = makeHarness()
    const driver = new SubscriptionDriver({ openListen, delay: immediateDelay })

    const p1 = driver.subscribeResource({ uri: 'file:///a' })
    const p2 = driver.subscribeResource({ uri: 'file:///b' })
    await flush()

    // Serialized: only the first candidate has opened.
    expect(opens.length).toBe(1)
    expect(opens[0].filter.resourceSubscriptions).toEqual(['file:///a'])

    opens[0].ack()
    await p1
    await flush()

    // The second mutation runs on its own generation, carrying the accumulated filter.
    expect(opens.length).toBe(2)
    expect(opens[1].filter.resourceSubscriptions).toEqual(['file:///a', 'file:///b'])

    opens[1].ack()
    await p2
    expect(opens[0].aborted).toBe(true)
  })

  test('a mid-flight stream close reconnects on the same queue, retaining the desired filter', async () => {
    const { opens, openListen } = makeHarness()
    const driver = new SubscriptionDriver({ openListen, delay: immediateDelay })

    const p1 = driver.subscribeResource({ uri: 'file:///a' })
    await flush()
    opens[0].ack()
    await p1

    // The active stream drops.
    opens[0].close()
    await flush()

    // A reconnect candidate opened on the same queue, retaining the desired filter.
    expect(opens.length).toBe(2)
    expect(opens[1].filter.resourceSubscriptions).toEqual(['file:///a'])

    opens[1].ack()
    await flush()

    // The reconnected stream is now the active one: a frame on it is delivered.
    const received: Array<unknown> = []
    driver.onNotification((n) => received.push(n))
    opens[1].notify(updatedNotification('file:///a'))
    expect(received.length).toBe(1)
  })

  test('a reconnect does not overtake an unacknowledged candidate', async () => {
    const { opens, openListen } = makeHarness()
    const driver = new SubscriptionDriver({ openListen, delay: immediateDelay })

    const p1 = driver.subscribeResource({ uri: 'file:///a' })
    await flush()
    opens[0].ack()
    await p1

    // A user mutation is in flight (candidate gen2 not yet acked)...
    const pB = driver.subscribeResource({ uri: 'file:///b' })
    await flush()
    expect(opens.length).toBe(2)

    // ...meanwhile the active stream drops, scheduling a reconnect on the same queue.
    opens[0].close()
    await flush()
    // The reconnect must NOT open a new stream ahead of the pending candidate.
    expect(opens.length).toBe(2)

    // The candidate acks and is promoted.
    opens[1].ack()
    await pB
    await flush()

    // The queued reconnect runs, sees a healthy active stream, and opens nothing new.
    expect(opens.length).toBe(2)
    expect(opens[1].filter.resourceSubscriptions).toEqual(['file:///a', 'file:///b'])
  })

  test('reconnect backoff grows from 1s and caps at 30s', async () => {
    const { opens, openListen } = makeHarness()
    const requested: Array<number> = []
    const retries: Array<{ attempt: number; retryInMs: number }> = []
    let release: () => void = () => {}
    const delay = (ms: number) => {
      requested.push(ms)
      return new Promise<void>((resolve) => {
        release = () => resolve()
      })
    }
    const driver = new SubscriptionDriver({
      openListen,
      delay,
      onRetry: ({ attempt, retryInMs }) => retries.push({ attempt, retryInMs }),
    })

    const p1 = driver.subscribeResource({ uri: 'file:///a' })
    await flush()
    opens[0].ack()
    await p1

    const expected = [1000, 2000, 4000, 8000, 16000, 30000, 30000]
    // Trigger the first reconnect by dropping the active stream.
    opens[0].close()

    for (let i = 0; i < expected.length; i++) {
      await flush()
      expect(requested[i]).toBe(expected[i])
      // Fire the backoff timer so the reconnect candidate opens...
      release()
      await flush()
      // ...then drop it before it acks, forcing the next (larger) backoff.
      opens[opens.length - 1].close()
    }

    expect(retries.map((r) => r.retryInMs)).toEqual(expected)
    expect(retries.map((r) => r.attempt)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  test('dispose() rejects and tears down an in-flight, unacknowledged candidate', async () => {
    const { opens, openListen } = makeHarness()
    const driver = new SubscriptionDriver({ openListen, delay: immediateDelay })

    // A candidate opens but the (fake) server never acks it.
    const p = driver.subscribeResource({ uri: 'file:///a' })
    await flush()
    expect(opens.length).toBe(1)

    // Disposal must not hang on the never-arriving ack: it rejects the mutation and aborts the
    // in-flight exchange.
    driver.dispose()
    await expect(p).rejects.toThrow()
    expect(opens[0].aborted).toBe(true)
  })

  test('ackTimeoutMs fails an unacknowledged candidate so the queue cannot wedge', async () => {
    const { opens, openListen } = makeHarness()
    const driver = new SubscriptionDriver({ openListen, delay: immediateDelay, ackTimeoutMs: 10 })

    const p = driver.subscribeResource({ uri: 'file:///a' })
    await flush()
    expect(opens.length).toBe(1)

    // No ack ever arrives; the bound fires and rejects, aborting the candidate.
    await expect(p).rejects.toThrow(/timed out/)
    expect(opens[0].aborted).toBe(true)

    // The queue is not wedged: a subsequent mutation runs on a fresh candidate.
    const p2 = driver.subscribeResource({ uri: 'file:///b' })
    await flush()
    expect(opens.length).toBe(2)
    opens[1].ack()
    await p2
  })

  test('a reconnect candidate whose ack times out backs off and retries', async () => {
    const { opens, openListen } = makeHarness()
    const retries: Array<number> = []
    let release: () => void = () => {}
    const delay = () =>
      new Promise<void>((resolve) => {
        release = resolve
      })
    const driver = new SubscriptionDriver({
      openListen,
      delay,
      ackTimeoutMs: 30,
      onRetry: ({ attempt }) => retries.push(attempt),
    })

    // Establish an active, acknowledged stream (acked well within the 30ms bound).
    const p1 = driver.subscribeResource({ uri: 'file:///a' })
    await flush()
    opens[0].ack()
    await p1

    // The active stream drops → a reconnect is scheduled (attempt 1) and parks on the backoff.
    opens[0].close()
    await flush()
    expect(retries).toEqual([1])

    // Fire the backoff: the reconnect candidate opens...
    release()
    await flush()
    expect(opens.length).toBe(2)

    // ...but its ack never arrives, so the ack-timeout fires. A silent server here MUST NOT kill
    // the stream: the timeout is retryable, so a second reconnect (attempt 2) is scheduled.
    await new Promise((resolve) => setTimeout(resolve, 60))
    await flush()
    expect(retries).toEqual([1, 2])

    // Firing the next backoff opens yet another candidate — the stream is still trying, not dead.
    release()
    await flush()
    expect(opens.length).toBe(3)
  })

  test('dispose() unblocks a mutation queued behind a hung candidate', async () => {
    const { opens, openListen } = makeHarness()
    const driver = new SubscriptionDriver({ openListen, delay: immediateDelay })

    const p1 = driver.subscribeResource({ uri: 'file:///a' })
    const p2 = driver.subscribeResource({ uri: 'file:///b' })
    await flush()
    // Only the first candidate has opened (serialized); it is never acked.
    expect(opens.length).toBe(1)

    driver.dispose()
    await expect(p1).rejects.toThrow()
    await expect(p2).rejects.toThrow()
  })
})
