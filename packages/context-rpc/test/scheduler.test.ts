import type { Response } from '@mokei/context-protocol'
import { defer } from '@sozai/async'
import { describe, expect, test, vi } from 'vitest'

import { RequestScheduler } from '../src/scheduler.js'

/** A handler whose completion the test controls, recording the signal it was given. */
function controllable() {
  const gate = defer<void>()
  const calls: Array<AbortSignal> = []
  const run = async (signal: AbortSignal): Promise<Response | null> => {
    calls.push(signal)
    await gate.promise
    return { jsonrpc: '2.0', id: 0, result: {} } as Response
  }
  return { calls, gate, run }
}

describe('RequestScheduler', () => {
  test('runs immediately while under the concurrency cap', () => {
    const scheduler = new RequestScheduler({ maxConcurrentRequests: 2 })
    const first = controllable()
    void scheduler.schedule(1, first.run)

    expect(scheduler.runningCount).toBe(1)
    expect(scheduler.queuedCount).toBe(0)
    expect(first.calls).toHaveLength(1)
  })

  test('queues past the cap and starts the queued request when a slot frees', async () => {
    const scheduler = new RequestScheduler({ maxConcurrentRequests: 1 })
    const first = controllable()
    const second = controllable()

    void scheduler.schedule(1, first.run)
    void scheduler.schedule(2, second.run)

    expect(scheduler.queuedCount).toBe(1)
    expect(second.calls).toHaveLength(0)

    first.gate.resolve()
    await vi.waitFor(() => expect(second.calls).toHaveLength(1))
    expect(scheduler.queuedCount).toBe(0)
  })

  test('refuses a request past the queue bound without running it', async () => {
    const scheduler = new RequestScheduler({ maxConcurrentRequests: 1, maxQueuedRequests: 1 })
    const first = controllable()
    const second = controllable()
    const third = controllable()

    void scheduler.schedule(1, first.run)
    void scheduler.schedule(2, second.run)
    const refused = await scheduler.schedule(3, third.run)

    expect(third.calls).toHaveLength(0)
    expect(refused).toMatchObject({
      jsonrpc: '2.0',
      id: 3,
      error: { code: -32603, message: 'Server busy' },
    })
  })

  test('cancelling a queued request never runs it and answers nothing', async () => {
    const scheduler = new RequestScheduler({ maxConcurrentRequests: 1 })
    const first = controllable()
    const second = controllable()

    void scheduler.schedule(1, first.run)
    const queued = scheduler.schedule(2, second.run)
    scheduler.cancel(2)

    await expect(queued).resolves.toBeNull()
    expect(second.calls).toHaveLength(0)
    expect(scheduler.queuedCount).toBe(0)
  })

  test('cancelling a running request aborts its signal', () => {
    const scheduler = new RequestScheduler()
    const first = controllable()
    void scheduler.schedule(1, first.run)

    scheduler.cancel(1)

    expect(first.calls[0].aborted).toBe(true)
  })

  test('abortAll aborts running signals and drops queued requests', async () => {
    const scheduler = new RequestScheduler({ maxConcurrentRequests: 1 })
    const first = controllable()
    const second = controllable()
    void scheduler.schedule(1, first.run)
    const queued = scheduler.schedule(2, second.run)

    scheduler.abortAll(new Error('closed'))

    expect(first.calls[0].aborted).toBe(true)
    await expect(queued).resolves.toBeNull()
    expect(second.calls).toHaveLength(0)
  })
})
