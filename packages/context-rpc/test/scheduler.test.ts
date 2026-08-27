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

  test('refuses a duplicate id while its original is running, without touching the original', async () => {
    const scheduler = new RequestScheduler()
    const first = controllable()
    const duplicate = controllable()

    void scheduler.schedule(1, first.run)
    const refused = await scheduler.schedule(1, duplicate.run)

    expect(duplicate.calls).toHaveLength(0)
    expect(refused).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32600 },
    })
    expect(scheduler.runningCount).toBe(1)
    expect(first.calls).toHaveLength(1)
  })

  test('refuses a duplicate id while its original is still queued', async () => {
    const scheduler = new RequestScheduler({ maxConcurrentRequests: 1 })
    const first = controllable()
    const second = controllable()
    const duplicate = controllable()

    void scheduler.schedule(1, first.run)
    void scheduler.schedule(2, second.run)
    const refused = await scheduler.schedule(2, duplicate.run)

    expect(duplicate.calls).toHaveLength(0)
    expect(refused).toMatchObject({
      jsonrpc: '2.0',
      id: 2,
      error: { code: -32600 },
    })
    expect(scheduler.queuedCount).toBe(1)
  })

  test('accepts a reused id again once the original request has settled', async () => {
    const scheduler = new RequestScheduler()
    const first = controllable()
    void scheduler.schedule(1, first.run)
    first.gate.resolve()
    await vi.waitFor(() => expect(scheduler.runningCount).toBe(0))

    const second = controllable()
    void scheduler.schedule(1, second.run)

    expect(second.calls).toHaveLength(1)
  })

  test('a reused id refused while running never reaches #running, so abortAll only aborts the original', () => {
    const scheduler = new RequestScheduler()
    const first = controllable()
    const duplicate = controllable()

    void scheduler.schedule(1, first.run)
    void scheduler.schedule(1, duplicate.run)

    scheduler.abortAll(new Error('closed'))

    expect(first.calls).toHaveLength(1)
    expect(first.calls[0].aborted).toBe(true)
    expect(duplicate.calls).toHaveLength(0)
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

  test('detaching a running request frees its slot for a queued request', async () => {
    const scheduler = new RequestScheduler({ maxConcurrentRequests: 1 })
    const first = controllable()
    const second = controllable()

    void scheduler.schedule(1, first.run)
    void scheduler.schedule(2, second.run)
    expect(scheduler.queuedCount).toBe(1)
    expect(second.calls).toHaveLength(0)

    scheduler.detach(1)

    await vi.waitFor(() => expect(second.calls).toHaveLength(1))
    // The detached request no longer occupies a running slot; the queued one took it.
    expect(scheduler.runningCount).toBe(1)
    expect(scheduler.detachedCount).toBe(1)
    expect(scheduler.queuedCount).toBe(0)

    first.gate.resolve()
    second.gate.resolve()
  })

  test('cancelling a detached request aborts its signal', () => {
    const scheduler = new RequestScheduler()
    const first = controllable()
    void scheduler.schedule(1, first.run)
    scheduler.detach(1)

    scheduler.cancel(1)

    expect(first.calls[0].aborted).toBe(true)
    first.gate.resolve()
  })

  test('completeDetached removes the detached record', () => {
    const scheduler = new RequestScheduler()
    const first = controllable()
    void scheduler.schedule(1, first.run)
    scheduler.detach(1)
    expect(scheduler.detachedCount).toBe(1)

    scheduler.completeDetached(1)

    expect(scheduler.detachedCount).toBe(0)
    first.gate.resolve()
  })

  test('refuses a duplicate id while its original is detached', async () => {
    const scheduler = new RequestScheduler()
    const first = controllable()
    const duplicate = controllable()

    void scheduler.schedule(1, first.run)
    scheduler.detach(1)
    const refused = await scheduler.schedule(1, duplicate.run)

    expect(duplicate.calls).toHaveLength(0)
    expect(refused).toMatchObject({ jsonrpc: '2.0', id: 1, error: { code: -32600 } })
    first.gate.resolve()
  })

  test('abortAll aborts detached signals', () => {
    const scheduler = new RequestScheduler()
    const first = controllable()
    void scheduler.schedule(1, first.run)
    scheduler.detach(1)

    scheduler.abortAll(new Error('closed'))

    expect(first.calls[0].aborted).toBe(true)
    first.gate.resolve()
  })

  test('an immediately-run handler that rejects settles to null', async () => {
    const scheduler = new RequestScheduler()
    const result = await scheduler.schedule(1, async () => {
      throw new Error('handler failed')
    })

    expect(result).toBeNull()
  })

  test('a queued handler that rejects settles to null and drains the next request', async () => {
    const scheduler = new RequestScheduler({ maxConcurrentRequests: 1 })
    const third = controllable()

    // Start first request
    const first = scheduler.schedule(1, async () => {
      throw new Error('handler failed')
    })

    // Queue second (also rejecting)
    const second = scheduler.schedule(2, async () => {
      throw new Error('handler failed')
    })

    // Queue third (succeeds)
    const queued = scheduler.schedule(3, third.run)

    // Wait for first to settle as null
    const firstResult = await first
    expect(firstResult).toBeNull()

    // Wait for second to settle as null
    const secondResult = await second
    expect(secondResult).toBeNull()

    // Verify third was started (drained and running)
    await vi.waitFor(() => expect(third.calls).toHaveLength(1))
    expect(scheduler.runningCount).toBe(1)

    // Clean up
    third.gate.resolve()
    await queued
  })
})
