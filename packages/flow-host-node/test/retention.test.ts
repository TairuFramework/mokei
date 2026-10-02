import { createMemoryTaskStore } from '@mokei/context-server'
import { createMemoryRunStore, createMemoryTraceStore, pruneRuns } from '@mokei/flow-host'
import { getReporter } from '@sozai/log'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { startRetention } from '../src/retention.js'

const { report } = vi.hoisted(() => ({ report: vi.fn() }))
vi.mock('@mokei/flow-host', { spy: true })
vi.mock(import('@sozai/log'), async (importOriginal) => {
  const original = await importOriginal()
  return { ...original, getReporter: vi.fn(() => report) }
})

const counts = { runs: 0, skipped: 0, spans: 0, logs: 0 }
const stores = {
  runStore: createMemoryRunStore(),
  taskStore: createMemoryTaskStore(),
  traceStore: createMemoryTraceStore(),
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(3000000000)
  vi.mocked(pruneRuns).mockResolvedValue(counts)
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  report.mockReset()
})

describe('retention scheduler', () => {
  test('starts immediately with the configured cutoff', async () => {
    const handle = startRetention({ ...stores, days: 30, intervalMs: 100 })
    expect(pruneRuns).toHaveBeenCalledWith({ ...stores, before: 408000000 })
    await vi.advanceTimersByTimeAsync(100)
    expect(pruneRuns).toHaveBeenLastCalledWith({ ...stores, before: 408000100 })
    await handle.stop()
  })

  test('uses an unref timer with a daily default', async () => {
    const interval = vi.spyOn(globalThis, 'setInterval')
    const handle = startRetention({ ...stores, days: 30 })
    expect(interval).toHaveBeenCalledWith(expect.any(Function), 86400000)
    const timer = interval.mock.results[0]?.value as ReturnType<typeof setInterval>
    expect(timer.hasRef()).toBe(false)
    await vi.advanceTimersByTimeAsync(86399999)
    expect(pruneRuns).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    expect(pruneRuns).toHaveBeenCalledTimes(2)
    await handle.stop()
  })

  test('skips overlapping ticks and resumes after failures', async () => {
    const pass = Promise.withResolvers<typeof counts>()
    vi.mocked(pruneRuns).mockReturnValueOnce(pass.promise)
    const handle = startRetention({ ...stores, days: 30, intervalMs: 100 })
    await vi.advanceTimersByTimeAsync(300)
    expect(pruneRuns).toHaveBeenCalledOnce()
    const error = new Error('storage unavailable')
    pass.reject(error)
    await vi.advanceTimersByTimeAsync(0)
    expect(getReporter).toHaveBeenCalledWith(['mokei', 'flow-host', 'capture'], '@mokei/flow-host')
    expect(report).toHaveBeenCalledExactlyOnceWith(expect.any(String), error)
    await vi.advanceTimersByTimeAsync(100)
    expect(pruneRuns).toHaveBeenCalledTimes(2)
    await handle.stop()
  })

  test('stop waits for running work and prevents future ticks', async () => {
    const pass = Promise.withResolvers<typeof counts>()
    vi.mocked(pruneRuns).mockReturnValueOnce(pass.promise)
    const handle = startRetention({ ...stores, days: 30, intervalMs: 100 })
    const first = handle.stop()
    const second = handle.stop()
    expect(second).toBe(first)
    const settled = vi.fn()
    void first.then(settled)
    void second.then(settled)
    await vi.advanceTimersByTimeAsync(300)
    expect(settled).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    pass.resolve(counts)
    await Promise.all([first, second])
    expect(settled).toHaveBeenCalledTimes(2)
    expect(handle.stop()).toBe(first)
    await vi.advanceTimersByTimeAsync(300)
    expect(pruneRuns).toHaveBeenCalledOnce()
  })
})
