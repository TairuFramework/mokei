import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  type FlowRunSnapshot,
  hasChanged,
  type InboxItem,
  isActionable,
  isFlowControlError,
  isTerminalRun,
  type RunState,
  type RunStatus,
  runStatus,
  waitForRun,
} from '../src/index.js'
import { createMemoryControl } from './memory-control.js'

function snapshot(state: RunState, extra: Partial<FlowRunSnapshot> = {}): FlowRunSnapshot {
  return {
    runID: 'run-1',
    label: 'test',
    state,
    createdAt: 1,
    updatedAt: 1,
    plan: { tools: [] },
    ...extra,
  }
}

function inputItem(id: string, runID = 'run-1'): InboxItem {
  return {
    id,
    runID,
    kind: 'input',
    inputKey: 'name',
    message: 'Your name?',
    requestedSchema: { type: 'object' },
    createdAt: 1,
  }
}

function status(state: RunState, pendingIDs: Array<string> = []): RunStatus {
  return {
    runID: 'run-1',
    state,
    pending: pendingIDs.map((id) => ({
      id,
      kind: 'input',
      message: 'm',
      requestedSchema: {},
      canPrompt: false,
    })),
  }
}

const isCompleted = (s: RunStatus) => s.state === 'completed'

afterEach(() => {
  vi.useRealTimers()
})

describe('runStatus', () => {
  test('lists pending items', async () => {
    const memory = createMemoryControl()
    memory.setRun(snapshot('input_required'))
    memory.addItem(inputItem('item-1'))
    memory.addItem(inputItem('other', 'run-2'))
    await expect(runStatus(memory.control, 'run-1')).resolves.toEqual({
      runID: 'run-1',
      state: 'input_required',
      pending: [
        {
          id: 'item-1',
          kind: 'input',
          message: 'Your name?',
          requestedSchema: { type: 'object' },
          canPrompt: false,
        },
      ],
    })
  })

  test('maps approval items and canPrompt', async () => {
    const memory = createMemoryControl({ prompt: async () => 'accept' })
    memory.setRun(snapshot('awaiting_approval'))
    memory.addItem({
      id: 'a-1',
      runID: 'run-1',
      kind: 'approval',
      plan: { tools: ['t'] },
      createdAt: 1,
    })
    const result = await runStatus(memory.control, 'run-1')
    expect(result.pending).toEqual([
      { id: 'a-1', kind: 'approval', plan: { tools: ['t'] }, canPrompt: true },
    ])
  })

  test('pending is empty for a completed run even if an item exists', async () => {
    const memory = createMemoryControl()
    const result = { content: [{ type: 'text', text: 'done' }] }
    memory.setRun(snapshot('completed', { result }))
    memory.addItem(inputItem('item-1'))
    await expect(runStatus(memory.control, 'run-1')).resolves.toEqual({
      runID: 'run-1',
      state: 'completed',
      pending: [],
      result,
    })
  })

  test('rereads when the state changes between reads', async () => {
    const memory = createMemoryControl()
    memory.setRun(snapshot('working'))
    const get = memory.control.runs.get
    let calls = 0
    memory.control.runs.get = async (runID) => {
      calls++
      // Flip the state once, between the first and second read.
      if (calls === 2) memory.setRun(snapshot('input_required'))
      return get(runID)
    }
    memory.addItem(inputItem('item-1'))
    const result = await runStatus(memory.control, 'run-1')
    expect(result.state).toBe('input_required')
    expect(result.pending.map((item) => item.id)).toEqual(['item-1'])
    expect(calls).toBe(3)
  })

  test('stops rereading after three attempts', async () => {
    const memory = createMemoryControl()
    const states: Array<RunState> = ['working', 'input_required']
    let calls = 0
    memory.control.runs.get = async () => snapshot(states[calls++ % 2] as RunState)
    await runStatus(memory.control, 'run-1')
    expect(calls).toBe(4)
  })
})

describe('isTerminalRun', () => {
  test('only terminal states are terminal', () => {
    for (const state of ['completed', 'failed', 'cancelled', 'denied'] as const) {
      expect(isTerminalRun(status(state))).toBe(true)
    }
    for (const state of ['working', 'input_required', 'awaiting_approval'] as const) {
      expect(isTerminalRun(status(state))).toBe(false)
    }
  })
})

describe('isActionable', () => {
  test('terminal states are actionable', () => {
    for (const state of ['completed', 'failed', 'cancelled', 'denied'] as const) {
      expect(isActionable(status(state))).toBe(true)
    }
  })

  test('input_required with an item is actionable', () => {
    expect(isActionable(status('input_required', ['a']))).toBe(true)
  })

  test('input_required without items is not actionable', () => {
    expect(isActionable(status('input_required'))).toBe(false)
  })

  test('working is not actionable', () => {
    expect(isActionable(status('working'))).toBe(false)
  })
})

describe('hasChanged', () => {
  test('same state and item ids is unchanged', () => {
    expect(
      hasChanged(status('input_required', ['a', 'b']))(status('input_required', ['b', 'a'])),
    ).toBe(false)
  })

  test('a new item id is a change', () => {
    expect(hasChanged(status('input_required', ['a']))(status('input_required', ['b']))).toBe(true)
  })

  test('a new state is a change', () => {
    expect(hasChanged(status('working'))(status('completed'))).toBe(true)
  })

  test('a new result or error is a change', () => {
    const previous = status('completed')
    expect(hasChanged(previous)({ ...previous, result: { content: [] } })).toBe(true)
    expect(hasChanged(previous)({ ...previous, error: { type: 'E', message: 'x' } })).toBe(true)
  })
})

describe('waitForRun', () => {
  test('returns at once when already matching', async () => {
    const memory = createMemoryControl()
    memory.setRun(snapshot('completed'))
    const result = await waitForRun(memory.control, 'run-1', {
      until: isCompleted,
      timeoutMs: 60_000,
    })
    expect(result).toEqual({
      status: expect.objectContaining({ state: 'completed' }),
      timedOut: false,
    })
    expect(memory.openSubscriptions()).toBe(0)
  })

  test('returns when a later event matches', async () => {
    const memory = createMemoryControl()
    memory.setRun(snapshot('working'))
    const waiting = waitForRun(memory.control, 'run-1', { until: isCompleted, timeoutMs: 60_000 })
    await vi.waitFor(() => expect(memory.openSubscriptions()).toBe(1))
    memory.setRun(snapshot('working', { runID: 'run-2' }))
    memory.setRun(snapshot('completed'))
    await expect(waiting).resolves.toMatchObject({
      status: { state: 'completed' },
      timedOut: false,
    })
    expect(memory.openSubscriptions()).toBe(0)
  })

  test('sees an event landing between subscribe and read', async () => {
    const memory = createMemoryControl()
    memory.setRun(snapshot('working'))
    const order: Array<string> = []
    const subscribe = memory.control.subscribe
    memory.control.subscribe = async (signal) => {
      const subscription = await subscribe(signal)
      order.push('subscribe')
      // The run completes after the subscription is live but before the first read lands.
      memory.setRun(snapshot('completed'))
      return subscription
    }
    const get = memory.control.runs.get
    let gets = 0
    memory.control.runs.get = async (runID) => {
      order.push('get')
      gets++
      // The initial runStatus (get, list, get) observes an older snapshot, so only the queued
      // event can trigger the read that sees the completion.
      if (gets <= 2) return snapshot('working')
      return get(runID)
    }
    const result = await waitForRun(memory.control, 'run-1', {
      until: isCompleted,
      timeoutMs: 1_000,
    })
    expect(result).toMatchObject({ status: { state: 'completed' }, timedOut: false })
    expect(order[0]).toBe('subscribe')
    expect(gets).toBe(3)
  })

  test('wakes on inbox:added for the run', async () => {
    const memory = createMemoryControl()
    memory.setRun(snapshot('input_required'))
    const waiting = waitForRun(memory.control, 'run-1', { until: isActionable, timeoutMs: 1_000 })
    await vi.waitFor(() => expect(memory.openSubscriptions()).toBe(1))
    memory.addItem(inputItem('item-1'))
    await expect(waiting).resolves.toMatchObject({
      status: { state: 'input_required', pending: [{ id: 'item-1' }] },
      timedOut: false,
    })
  })

  test('wakes on inbox:settled for the run', async () => {
    const memory = createMemoryControl()
    memory.setRun(snapshot('input_required'))
    memory.addItem(inputItem('item-1'))
    const initial = await runStatus(memory.control, 'run-1')
    const waiting = waitForRun(memory.control, 'run-1', {
      until: hasChanged(initial),
      timeoutMs: 1_000,
    })
    await vi.waitFor(() => expect(memory.openSubscriptions()).toBe(1))
    memory.addItem(inputItem('other', 'run-2'))
    memory.settle('other')
    memory.settle('item-1')
    await expect(waiting).resolves.toMatchObject({
      status: { state: 'input_required', pending: [] },
      timedOut: false,
    })
  })

  test('times out with the latest status and closes the subscription', async () => {
    vi.useFakeTimers()
    const memory = createMemoryControl()
    memory.setRun(snapshot('working'))
    const waiting = waitForRun(memory.control, 'run-1', { until: isCompleted, timeoutMs: 5_000 })
    await vi.advanceTimersByTimeAsync(10)
    memory.setRun(snapshot('input_required'))
    await vi.advanceTimersByTimeAsync(5_000)
    await expect(waiting).resolves.toMatchObject({
      status: { state: 'input_required' },
      timedOut: true,
    })
    expect(memory.openSubscriptions()).toBe(0)
  })

  test('rejects with the abort reason', async () => {
    const memory = createMemoryControl()
    memory.setRun(snapshot('working'))
    const controller = new AbortController()
    const waiting = waitForRun(memory.control, 'run-1', {
      until: isCompleted,
      timeoutMs: 60_000,
      signal: controller.signal,
    })
    await vi.waitFor(() => expect(memory.openSubscriptions()).toBe(1))
    const reason = new Error('stop')
    controller.abort(reason)
    await expect(waiting).rejects.toBe(reason)
    expect(memory.openSubscriptions()).toBe(0)
  })

  test('rejects at once when the signal is already aborted', async () => {
    const memory = createMemoryControl()
    memory.setRun(snapshot('completed'))
    const reason = new Error('early')
    await expect(
      waitForRun(memory.control, 'run-1', {
        until: isCompleted,
        timeoutMs: 60_000,
        signal: AbortSignal.abort(reason),
      }),
    ).rejects.toBe(reason)
  })

  test('resubscribes after DISCONNECTED', async () => {
    vi.useFakeTimers()
    const memory = createMemoryControl()
    memory.setRun(snapshot('working'))
    const subscribe = vi.spyOn(memory.control, 'subscribe')
    const waiting = waitForRun(memory.control, 'run-1', { until: isCompleted, timeoutMs: 60_000 })
    await vi.advanceTimersByTimeAsync(0)
    expect(memory.openSubscriptions()).toBe(1)
    memory.disconnect()
    // The run completes while disconnected: no event reaches the waiter.
    memory.setRun(snapshot('completed'))
    await vi.advanceTimersByTimeAsync(249)
    expect(subscribe).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await expect(waiting).resolves.toMatchObject({
      status: { state: 'completed' },
      timedOut: false,
    })
    expect(subscribe).toHaveBeenCalledTimes(2)
    expect(memory.openSubscriptions()).toBe(0)
  })

  test('retries FLOW_UNAVAILABLE while starting with doubling backoff', async () => {
    vi.useFakeTimers()
    const memory = createMemoryControl()
    memory.setRun(snapshot('completed'))
    memory.setUnavailable('starting')
    const subscribe = vi.spyOn(memory.control, 'subscribe')
    const waiting = waitForRun(memory.control, 'run-1', { until: isCompleted, timeoutMs: 60_000 })
    await vi.advanceTimersByTimeAsync(0)
    expect(subscribe).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(250)
    expect(subscribe).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(499)
    expect(subscribe).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(subscribe).toHaveBeenCalledTimes(3)
    memory.setUnavailable(undefined)
    await vi.advanceTimersByTimeAsync(1_000)
    await expect(waiting).resolves.toMatchObject({
      status: { state: 'completed' },
      timedOut: false,
    })
    expect(memory.openSubscriptions()).toBe(0)
  })

  test('caps the backoff at 2 s', async () => {
    vi.useFakeTimers()
    const memory = createMemoryControl()
    memory.setRun(snapshot('completed'))
    memory.setUnavailable('starting')
    const subscribe = vi.spyOn(memory.control, 'subscribe')
    const waiting = waitForRun(memory.control, 'run-1', { until: isCompleted, timeoutMs: 60_000 })
    // 250 + 500 + 1000 + 2000 + 2000
    await vi.advanceTimersByTimeAsync(5_750)
    expect(subscribe).toHaveBeenCalledTimes(6)
    await vi.advanceTimersByTimeAsync(1_999)
    expect(subscribe).toHaveBeenCalledTimes(6)
    await vi.advanceTimersByTimeAsync(1)
    expect(subscribe).toHaveBeenCalledTimes(7)
    memory.setUnavailable(undefined)
    await vi.advanceTimersByTimeAsync(2_000)
    await expect(waiting).resolves.toMatchObject({ timedOut: false })
  })

  test('rejects with the last error when it times out before any read succeeds', async () => {
    vi.useFakeTimers()
    const memory = createMemoryControl()
    memory.setRun(snapshot('working'))
    memory.setUnavailable('starting')
    const waiting = waitForRun(memory.control, 'run-1', { until: isCompleted, timeoutMs: 1_000 })
    const assertion = expect(waiting).rejects.toSatisfy((error) =>
      isFlowControlError(error, 'FLOW_UNAVAILABLE'),
    )
    await vi.advanceTimersByTimeAsync(1_000)
    await assertion
    expect(memory.openSubscriptions()).toBe(0)
  })

  test('rejects when the service failed', async () => {
    const memory = createMemoryControl()
    memory.setRun(snapshot('working'))
    memory.setUnavailable('failed')
    await expect(
      waitForRun(memory.control, 'run-1', { until: isCompleted, timeoutMs: 60_000 }),
    ).rejects.toSatisfy((error) => isFlowControlError(error, 'FLOW_UNAVAILABLE'))
    expect(memory.openSubscriptions()).toBe(0)
  })

  test('rejects when the run does not exist', async () => {
    const memory = createMemoryControl()
    await expect(
      waitForRun(memory.control, 'missing', { until: isCompleted, timeoutMs: 60_000 }),
    ).rejects.toSatisfy((error) => isFlowControlError(error, 'RUN_NOT_FOUND'))
    expect(memory.openSubscriptions()).toBe(0)
  })

  test('returns the status with timedOut when the timeout is shorter than the first read', async () => {
    const memory = createMemoryControl()
    memory.setRun(snapshot('working'))
    const get = memory.control.runs.get
    memory.control.runs.get = async (runID) => {
      await new Promise((resolve) => setTimeout(resolve, 30))
      return get(runID)
    }
    await expect(
      waitForRun(memory.control, 'run-1', { until: isCompleted, timeoutMs: 5 }),
    ).resolves.toMatchObject({ status: { runID: 'run-1', state: 'working' }, timedOut: true })
    expect(memory.openSubscriptions()).toBe(0)
  })

  test('surfaces RUN_NOT_FOUND when the timeout is shorter than the first read', async () => {
    const memory = createMemoryControl()
    const get = memory.control.runs.get
    memory.control.runs.get = async (runID) => {
      await new Promise((resolve) => setTimeout(resolve, 30))
      return get(runID)
    }
    await expect(
      waitForRun(memory.control, 'missing', { until: isCompleted, timeoutMs: 5 }),
    ).rejects.toSatisfy((error) => isFlowControlError(error, 'RUN_NOT_FOUND'))
  })
})
