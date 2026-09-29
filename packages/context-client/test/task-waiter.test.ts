import type { DetailedTask, ServerNotification } from '@mokei/context-protocol'
import { RPCError } from '@mokei/context-rpc'
import { describe, expect, test, vi } from 'vitest'

import {
  InputRequiredNotSupportedError,
  TaskCancelledError,
  TaskInputUnavailableError,
} from '../src/errors.js'
import { TaskWaiter } from '../src/task-waiter.js'

const base = {
  taskId: 'task-1',
  createdAt: '2026-09-29T12:00:00.000Z',
  lastUpdatedAt: '2026-09-29T12:00:00.000Z',
  ttlMs: 1000,
  pollIntervalMs: 1,
} as const

const working = { ...base, status: 'working' as const }
const completed = {
  ...base,
  status: 'completed' as const,
  result: { content: [{ type: 'text' as const, text: 'done' }] },
}

describe('TaskWaiter', () => {
  test.each([
    ['task resumed', { ...working, lastUpdatedAt: '2026-09-29T12:00:01.000Z' }],
    [
      'another key remains',
      {
        ...base,
        status: 'input_required' as const,
        lastUpdatedAt: '2026-09-29T12:00:01.000Z',
        inputRequests: { other: { method: 'roots/list' as const, params: {} } },
      },
    ],
  ] as const)('continues after a late answer when %s', async (_caseName, withdrawn) => {
    const input = {
      ...base,
      status: 'input_required' as const,
      inputRequests: { ask: { method: 'roots/list' as const, params: {} } },
    }
    const finished = { ...completed, lastUpdatedAt: '2026-09-29T12:00:02.000Z' }
    let gets = 0
    const request = vi.fn(async (method: string) => {
      if (method === 'tasks/update')
        throw new RPCError({ code: -32602, message: 'stale input', data: { key: 'ask' } })
      gets += 1
      return gets === 1 ? input : gets === 2 ? withdrawn : finished
    })
    const waiter = new TaskWaiter({
      request,
      openListen: () => {
        throw new Error('unavailable')
      },
      fulfil: async (key) => (key === 'ask' ? { roots: [] } : new Promise(() => {})),
      validate: vi.fn(),
      delay: async () => {},
    })
    expect(await waiter.wait({ taskID: base.taskId })).toEqual(completed.result)
    expect(request).toHaveBeenCalledWith('tasks/update', {
      taskId: base.taskId,
      inputResponses: { ask: { roots: [] } },
    })
  })

  test('surfaces a rejected answer when the key remains outstanding', async () => {
    const input = {
      ...base,
      status: 'input_required' as const,
      inputRequests: { ask: { method: 'roots/list' as const, params: {} } },
    }
    const rejection = new RPCError({ code: -32602, message: 'stale input', data: { key: 'ask' } })
    const request = vi.fn(async (method: string) => {
      if (method === 'tasks/update') throw rejection
      return input
    })
    const waiter = new TaskWaiter({
      request,
      openListen: () => {
        throw new Error('unavailable')
      },
      fulfil: async () => ({ roots: [] }),
      validate: vi.fn(),
      delay: async () => {},
    })
    await expect(waiter.wait({ taskID: base.taskId })).rejects.toBe(rejection)
    expect(
      request.mock.calls.filter(([method]) => method === 'tasks/get').length,
    ).toBeGreaterThanOrEqual(2)
  })
  test('polls to completion when listen is unavailable', async () => {
    const request = vi.fn().mockResolvedValueOnce(working).mockResolvedValueOnce(completed)
    const waiter = new TaskWaiter({
      request,
      openListen: () => {
        throw new Error('unavailable')
      },
      fulfil: vi.fn(),
      validate: vi.fn(),
      delay: async () => {},
    })
    expect(await waiter.wait({ taskID: base.taskId })).toEqual(completed.result)
    expect(request).toHaveBeenCalledTimes(2)
  })

  test('converts failed and cancelled outcomes', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        ...base,
        status: 'failed',
        error: { code: -32001, message: 'broken', data: { x: 1 } },
      })
      .mockResolvedValueOnce({ ...base, status: 'cancelled' })
    const waiter = new TaskWaiter({
      request,
      openListen: () => {
        throw new Error('unavailable')
      },
      fulfil: vi.fn(),
      validate: vi.fn(),
      delay: async () => {},
    })
    await expect(waiter.wait({ taskID: base.taskId })).rejects.toMatchObject({
      code: -32001,
      data: { x: 1 },
    } satisfies Partial<RPCError>)
    await expect(waiter.wait({ taskID: base.taskId })).rejects.toBeInstanceOf(TaskCancelledError)
  })

  test('reports an unavailable input handler', async () => {
    const request = vi.fn().mockResolvedValue({
      ...base,
      status: 'input_required',
      inputRequests: { ask: { method: 'roots/list', params: {} } },
    })
    const waiter = new TaskWaiter({
      request,
      openListen: () => {
        throw new Error('unavailable')
      },
      fulfil: async () => {
        throw new InputRequiredNotSupportedError({ reason: 'no handler' })
      },
      validate: vi.fn(),
      delay: async () => {},
    })
    await expect(waiter.wait({ taskID: base.taskId })).rejects.toBeInstanceOf(
      TaskInputUnavailableError,
    )
  })

  test('ignores snapshots for another task', async () => {
    let notify: ((snapshot: DetailedTask) => void) | undefined
    const request = vi.fn().mockResolvedValue(working)
    const waiter = new TaskWaiter({
      request,
      openListen: (_filter, handlers) => {
        notify = (snapshot) =>
          handlers.onNotification({
            jsonrpc: '2.0',
            method: 'notifications/tasks',
            params: snapshot,
          })
        queueMicrotask(() =>
          handlers.onNotification({
            jsonrpc: '2.0',
            method: 'notifications/subscriptions/acknowledged',
            params: { notifications: { taskIds: [base.taskId] } },
          } as unknown as ServerNotification),
        )
        return { exchange: new Promise(() => {}), abort: vi.fn() }
      },
      fulfil: vi.fn(),
      validate: vi.fn(),
    })
    const pending = waiter.wait({ taskID: base.taskId })
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    notify?.({ ...completed, taskId: 'foreign' })
    notify?.(completed)
    expect(await pending).toEqual(completed.result)
  })

  test('polls at the 250 ms floor when acknowledgement omits the task', async () => {
    const request = vi.fn().mockResolvedValueOnce(working).mockResolvedValueOnce(completed)
    const delay = vi.fn(async () => {})
    const waiter = new TaskWaiter({
      request,
      openListen: (_filter, handlers) => {
        queueMicrotask(() =>
          handlers.onNotification({
            jsonrpc: '2.0',
            method: 'notifications/subscriptions/acknowledged',
            params: { notifications: { taskIds: [] } },
          } as unknown as ServerNotification),
        )
        return { exchange: new Promise(() => {}), abort: vi.fn() }
      },
      fulfil: vi.fn(),
      validate: vi.fn(),
      delay,
    })
    expect(await waiter.wait({ taskID: base.taskId })).toEqual(completed.result)
    expect(delay).toHaveBeenCalledWith(250, expect.any(AbortSignal))
  })

  test('falls back to polling after an accepted listen drops', async () => {
    const request = vi.fn().mockResolvedValueOnce(working).mockResolvedValueOnce(completed)
    const delay = vi.fn(async () => {})
    const waiter = new TaskWaiter({
      request,
      openListen: (_filter, handlers) => {
        queueMicrotask(() =>
          handlers.onNotification({
            jsonrpc: '2.0',
            method: 'notifications/subscriptions/acknowledged',
            params: { notifications: { taskIds: [base.taskId] } },
          } as unknown as ServerNotification),
        )
        queueMicrotask(() => handlers.onSettle({ reason: 'closed' }))
        return { exchange: new Promise(() => {}), abort: vi.fn() }
      },
      fulfil: vi.fn(),
      validate: vi.fn(),
      delay,
    })
    expect(await waiter.wait({ taskID: base.taskId })).toEqual(completed.result)
    expect(delay).toHaveBeenCalledTimes(1)
  })

  test('aborts a silent listen after three seconds and polls', async () => {
    vi.useFakeTimers()
    try {
      const abort = vi.fn()
      const request = vi.fn().mockResolvedValueOnce(working).mockResolvedValueOnce(completed)
      const delay = vi.fn(async () => {})
      const waiter = new TaskWaiter({
        request,
        openListen: () => ({ exchange: new Promise(() => {}), abort }),
        fulfil: vi.fn(),
        validate: vi.fn(),
        delay,
      })
      const pending = waiter.wait({ taskID: base.taskId })

      await vi.advanceTimersByTimeAsync(2999)
      expect(request).not.toHaveBeenCalled()
      expect(abort).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(await pending).toEqual(completed.result)
      expect(abort).toHaveBeenCalledTimes(1)
      expect(delay).toHaveBeenCalledWith(250, expect.any(AbortSignal))
    } finally {
      vi.useRealTimers()
    }
  })

  test('shares one listen across concurrent waits', async () => {
    let notify: ((snapshot: DetailedTask) => void) | undefined
    const abort = vi.fn()
    const openListen = vi.fn((_filter, handlers) => {
      notify = (snapshot) =>
        handlers.onNotification({
          jsonrpc: '2.0',
          method: 'notifications/tasks',
          params: snapshot,
        })
      queueMicrotask(() =>
        handlers.onNotification({
          jsonrpc: '2.0',
          method: 'notifications/subscriptions/acknowledged',
          params: { notifications: { taskIds: [base.taskId] } },
        } as unknown as ServerNotification),
      )
      return { exchange: new Promise(() => {}), abort }
    })
    const request = vi.fn().mockResolvedValue(working)
    const waiter = new TaskWaiter({ request, openListen, fulfil: vi.fn(), validate: vi.fn() })
    const controller = new AbortController()
    const reason = new Error('released')
    const first = waiter.wait({ taskID: base.taskId, signal: controller.signal })
    const second = waiter.wait({ taskID: base.taskId })
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    controller.abort(reason)
    await expect(first).rejects.toBe(reason)
    expect(abort).not.toHaveBeenCalled()
    notify?.(completed)
    expect(await second).toEqual(completed.result)
    expect(openListen).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledTimes(2)
    expect(abort).toHaveBeenCalledTimes(1)
  })

  test('deduplicates an in-flight key across notifications, polls, and concurrent waits', async () => {
    const input = {
      ...base,
      status: 'input_required' as const,
      inputRequests: { ask: { method: 'roots/list' as const, params: {} } },
    }
    let notify: ((snapshot: DetailedTask) => void) | undefined
    let settle: (() => void) | undefined
    let finishInput: ((response: { roots: Array<never> }) => void) | undefined
    let completedNow = false
    let gets = 0
    const request = vi.fn(async (method: string) => {
      if (method === 'tasks/update') {
        completedNow = true
        return { resultType: 'complete' }
      }
      gets += 1
      return completedNow ? completed : input
    })
    const fulfil = vi.fn(
      () =>
        new Promise<{ roots: Array<never> }>((resolve) => {
          finishInput = resolve
        }),
    )
    const delays: Array<() => void> = []
    const delay = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          delays.push(resolve)
        }),
    )
    const waiter = new TaskWaiter({
      request,
      openListen: (_filter, handlers) => {
        notify = (snapshot) =>
          handlers.onNotification({
            jsonrpc: '2.0',
            method: 'notifications/tasks',
            params: snapshot,
          })
        settle = () => handlers.onSettle({ reason: 'closed' })
        queueMicrotask(() =>
          handlers.onNotification({
            jsonrpc: '2.0',
            method: 'notifications/subscriptions/acknowledged',
            params: { notifications: { taskIds: [base.taskId] } },
          } as unknown as ServerNotification),
        )
        return { exchange: new Promise(() => {}), abort: vi.fn() }
      },
      fulfil,
      validate: vi.fn(),
      delay,
    })
    const first = waiter.wait({ taskID: base.taskId })
    const second = waiter.wait({ taskID: base.taskId })
    await vi.waitFor(() => expect(gets).toBe(2))
    await vi.waitFor(() => expect(fulfil).toHaveBeenCalledTimes(1))
    notify?.(input)
    settle?.()
    await vi.waitFor(() => expect(delays).toHaveLength(2))
    for (const release of delays.splice(0)) release()
    await vi.waitFor(() => expect(gets).toBe(4))
    expect(fulfil).toHaveBeenCalledTimes(1)
    expect(request.mock.calls.filter(([method]) => method === 'tasks/update')).toHaveLength(0)

    finishInput?.({ roots: [] })
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith('tasks/update', {
        taskId: base.taskId,
        inputResponses: { ask: { roots: [] } },
      }),
    )
    await vi.waitFor(() => expect(delays).toHaveLength(2))
    for (const release of delays.splice(0)) release()
    expect(await Promise.all([first, second])).toEqual([completed.result, completed.result])
    expect(fulfil).toHaveBeenCalledTimes(1)
    expect(request.mock.calls.filter(([method]) => method === 'tasks/update')).toHaveLength(1)
  })

  test('validates completed output only when a tool name is known', async () => {
    const validate = vi.fn((result) => result)
    const waiter = new TaskWaiter({
      request: vi.fn().mockResolvedValue(completed),
      openListen: () => {
        throw new Error('unavailable')
      },
      fulfil: vi.fn(),
      validate,
    })
    await waiter.wait({ taskID: base.taskId })
    expect(validate).not.toHaveBeenCalled()
    await waiter.wait({ taskID: base.taskId, toolName: 'hello' })
    expect(validate).toHaveBeenCalledWith(completed.result, 'hello')
  })

  test('reports accepted notification snapshots to onStatus', async () => {
    let notify: ((status: DetailedTask) => void) | undefined
    const onStatus = vi.fn()
    const waiter = new TaskWaiter({
      request: vi.fn().mockResolvedValue(working),
      openListen: (_filter, handlers) => {
        notify = (status) =>
          handlers.onNotification({
            jsonrpc: '2.0',
            method: 'notifications/tasks',
            params: status,
          })
        queueMicrotask(() =>
          handlers.onNotification({
            jsonrpc: '2.0',
            method: 'notifications/subscriptions/acknowledged',
            params: { notifications: { taskIds: [base.taskId] } },
          } as unknown as ServerNotification),
        )
        return { exchange: new Promise(() => {}), abort: vi.fn() }
      },
      fulfil: vi.fn(),
      validate: vi.fn(),
    })
    const pending = waiter.wait({ taskID: base.taskId, onStatus })
    await vi.waitFor(() => expect(onStatus).toHaveBeenCalledWith(working))
    notify?.(completed)
    expect(await pending).toEqual(completed.result)
    expect(onStatus).toHaveBeenCalledWith(completed)
  })

  test('cancels the server task on automatic wait abort', async () => {
    const controller = new AbortController()
    const reason = new Error('stopped')
    const request = vi.fn(async (method: string) => {
      if (method === 'tasks/get') {
        controller.abort(reason)
        return working
      }
      return { resultType: 'complete' }
    })
    const waiter = new TaskWaiter({
      request,
      openListen: () => {
        throw new Error('unavailable')
      },
      fulfil: vi.fn(),
      validate: vi.fn(),
    })
    await expect(
      waiter.wait({
        taskID: base.taskId,
        signal: controller.signal,
        cancelOnAbort: true,
      }),
    ).rejects.toBe(reason)
    expect(request).toHaveBeenCalledWith('tasks/cancel', { taskId: base.taskId })
  })

  test('does not send a fulfilled key withdrawn by the latest snapshot', async () => {
    let notify: ((status: DetailedTask) => void) | undefined
    let finishInput: ((response: { roots: Array<never> }) => void) | undefined
    const fulfil = vi.fn(
      () =>
        new Promise<{ roots: Array<never> }>((resolve) => {
          finishInput = resolve
        }),
    )
    const request = vi.fn().mockResolvedValue({
      ...base,
      status: 'input_required',
      inputRequests: { ask: { method: 'roots/list', params: {} } },
    })
    const waiter = new TaskWaiter({
      request,
      openListen: (_filter, handlers) => {
        notify = (status) =>
          handlers.onNotification({
            jsonrpc: '2.0',
            method: 'notifications/tasks',
            params: status,
          })
        queueMicrotask(() =>
          handlers.onNotification({
            jsonrpc: '2.0',
            method: 'notifications/subscriptions/acknowledged',
            params: { notifications: { taskIds: [base.taskId] } },
          } as unknown as ServerNotification),
        )
        return { exchange: new Promise(() => {}), abort: vi.fn() }
      },
      fulfil,
      validate: vi.fn(),
    })
    const pending = waiter.wait({ taskID: base.taskId })
    await vi.waitFor(() => expect(fulfil).toHaveBeenCalledTimes(1))
    notify?.({ ...base, status: 'working', lastUpdatedAt: '2026-09-29T12:00:01.000Z' })
    finishInput?.({ roots: [] })
    notify?.({ ...completed, lastUpdatedAt: '2026-09-29T12:00:02.000Z' })
    expect(await pending).toEqual(completed.result)
    expect(request).not.toHaveBeenCalledWith('tasks/update', expect.anything())
  })
})
