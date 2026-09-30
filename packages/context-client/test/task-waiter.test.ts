import type { DetailedTask, ServerNotification } from '@mokei/context-protocol'
import { RPCError } from '@mokei/context-rpc'
import { describe, expect, test, vi } from 'vitest'

import {
  InputRequiredNotSupportedError,
  TaskCancelledError,
  TaskExpiredError,
  TaskInputUnavailableError,
  TaskInputWithdrawnError,
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

  describe('withdrawal and expiry', () => {
    const input = {
      ...base,
      status: 'input_required' as const,
      inputRequests: { ask: { method: 'roots/list' as const, params: {} } },
    }
    const at = (seconds: number) => `2026-09-29T12:00:0${seconds}.000Z`

    function subscribe() {
      const state: { notify?: (status: DetailedTask) => void } = {}
      const openListen = (
        _filter: unknown,
        handlers: {
          onNotification: (notification: ServerNotification) => void
        },
      ) => {
        state.notify = (status) =>
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
        return { exchange: new Promise<never>(() => {}), abort: vi.fn() }
      }
      return { state, openListen }
    }

    const notFound = () => new RPCError({ code: -32602, message: 'Task not found' })

    test('withdrawal aborts the handler with TaskInputWithdrawnError', async () => {
      const { state, openListen } = subscribe()
      let reason: unknown
      const fulfil = vi.fn(
        (_key: string, _request: unknown, signal: AbortSignal) =>
          new Promise<never>((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              reason = signal.reason
              reject(signal.reason)
            })
          }),
      )
      const request = vi.fn().mockResolvedValue(input)
      const waiter = new TaskWaiter({
        request,
        openListen,
        fulfil,
        validate: vi.fn(),
      })
      const pending = waiter.wait({ taskID: base.taskId })
      await vi.waitFor(() => expect(fulfil).toHaveBeenCalledTimes(1))
      state.notify?.({ ...working, lastUpdatedAt: at(1) })
      await vi.waitFor(() => expect(reason).toBeInstanceOf(TaskInputWithdrawnError))
      expect(reason).toMatchObject({ key: 'ask', taskID: base.taskId })
      let settled = false
      pending.then(
        () => (settled = true),
        () => (settled = true),
      )
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(settled).toBe(false)
      state.notify?.({ ...completed, lastUpdatedAt: at(2) })
      expect(await pending).toEqual(completed.result)
      expect(request).not.toHaveBeenCalledWith('tasks/update', expect.anything())
    })

    test('a late answer keeps the wait alive', async () => {
      let gets = 0
      const request = vi.fn(async (method: string) => {
        if (method === 'tasks/update') {
          throw new RPCError({ code: -32602, message: 'stale input', data: { key: 'ask' } })
        }
        gets += 1
        return gets === 1
          ? input
          : gets === 2
            ? { ...working, lastUpdatedAt: at(1) }
            : { ...completed, lastUpdatedAt: at(2) }
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
      expect(await waiter.wait({ taskID: base.taskId })).toEqual(completed.result)
    })

    test('reversed snapshot delivery leaves a withdrawn dialog closed', async () => {
      const { state, openListen } = subscribe()
      const signals: Array<AbortSignal> = []
      const fulfil = vi.fn((_key: string, _request: unknown, signal: AbortSignal) => {
        signals.push(signal)
        return new Promise<never>(() => {})
      })
      const onStatus = vi.fn()
      const older = { ...input, lastUpdatedAt: at(1) }
      const waiter = new TaskWaiter({
        request: vi.fn().mockResolvedValue(input),
        openListen,
        fulfil,
        validate: vi.fn(),
      })
      const pending = waiter.wait({ taskID: base.taskId, onStatus })
      await vi.waitFor(() => expect(fulfil).toHaveBeenCalledTimes(1))
      state.notify?.({ ...working, lastUpdatedAt: at(2) })
      state.notify?.(older)
      state.notify?.({ ...completed, lastUpdatedAt: at(3) })
      expect(await pending).toEqual(completed.result)
      expect(fulfil.mock.calls.length).toBeLessThanOrEqual(1)
      expect(signals[0]?.aborted).toBe(true)
      expect(onStatus).not.toHaveBeenCalledWith(older)
    })

    test('expiry while subscribed fails with TaskExpiredError', async () => {
      vi.useFakeTimers()
      try {
        vi.setSystemTime(Date.parse(base.createdAt))
        const deadline = Date.parse(base.createdAt) + base.ttlMs
        const { openListen } = subscribe()
        const rejection = notFound()
        const request = vi.fn(async () => {
          if (Date.now() >= deadline) throw rejection
          return working
        })
        const waiter = new TaskWaiter({
          request,
          openListen,
          fulfil: vi.fn(),
          validate: vi.fn(),
          now: () => Date.now(),
        })
        const pending = waiter.wait({ taskID: base.taskId })
        const assertion = expect(pending).rejects.toMatchObject({
          name: 'TaskExpiredError',
          taskID: base.taskId,
          cause: rejection,
        })
        await vi.advanceTimersByTimeAsync(base.ttlMs)
        await assertion
        await expect(pending).rejects.toBeInstanceOf(TaskExpiredError)
      } finally {
        vi.useRealTimers()
      }
    })

    test('expiry while polling fails with TaskExpiredError', async () => {
      vi.useFakeTimers()
      try {
        vi.setSystemTime(Date.parse(base.createdAt))
        const deadline = Date.parse(base.createdAt) + 600
        const request = vi.fn(async () => {
          if (Date.now() >= deadline) throw notFound()
          return { ...working, ttlMs: 600 }
        })
        const waiter = new TaskWaiter({
          request,
          openListen: () => {
            throw new Error('unavailable')
          },
          fulfil: vi.fn(),
          validate: vi.fn(),
          now: () => Date.now(),
        })
        const pending = waiter.wait({ taskID: base.taskId })
        const assertion = expect(pending).rejects.toBeInstanceOf(TaskExpiredError)
        await vi.advanceTimersByTimeAsync(1000)
        await assertion
      } finally {
        vi.useRealTimers()
      }
    })

    test('not found before the deadline keeps the original error', async () => {
      const rejection = notFound()
      const request = vi.fn().mockResolvedValueOnce(working).mockRejectedValueOnce(rejection)
      const waiter = new TaskWaiter({
        request,
        openListen: () => {
          throw new Error('unavailable')
        },
        fulfil: vi.fn(),
        validate: vi.fn(),
        delay: async () => {},
        now: () => Date.parse(base.createdAt),
      })
      await expect(waiter.wait({ taskID: base.taskId })).rejects.toBe(rejection)
    })

    test('releasing the wait aborts the handler', async () => {
      const controller = new AbortController()
      let dispatchSignal: AbortSignal | undefined
      let finish: ((response: { roots: Array<never> }) => void) | undefined
      const fulfil = vi.fn((_key: string, _request: unknown, signal: AbortSignal) => {
        dispatchSignal = signal
        return new Promise<{ roots: Array<never> }>((resolve) => {
          finish = resolve
        })
      })
      const request = vi.fn().mockResolvedValue(input)
      const waiter = new TaskWaiter({
        request,
        openListen: () => {
          throw new Error('unavailable')
        },
        fulfil,
        validate: vi.fn(),
        delay: (_ms, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason))
          }),
      })
      const pending = waiter.wait({ taskID: base.taskId, signal: controller.signal })
      await vi.waitFor(() => expect(fulfil).toHaveBeenCalledTimes(1))
      const reason = new Error('stopped')
      controller.abort(reason)
      await expect(pending).rejects.toBe(reason)
      expect(dispatchSignal?.aborted).toBe(true)
      finish?.({ roots: [] })
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(request).not.toHaveBeenCalledWith('tasks/update', expect.anything())
    })
  })
})
