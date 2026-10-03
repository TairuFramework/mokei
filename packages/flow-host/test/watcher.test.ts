import type { DetailedTask, TasksGetResult } from '@mokei/context-protocol'
import { afterEach, expect, test, vi } from 'vitest'

import { createWatchers } from '../src/watcher.js'
import { createFixture, deferred } from './fixture.js'

const snapshot: TasksGetResult = {
  taskId: 'task',
  createdAt: new Date(0).toISOString(),
  lastUpdatedAt: new Date(1).toISOString(),
  ttlMs: null,
  status: 'working',
  resultType: 'complete',
}
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})
async function fixture(
  params: {
    withRun?<T>(runID: string, work: () => T): T
    apply?(runID: string, task: DetailedTask): Promise<boolean>
    interrupted?(runID: string): Promise<void>
  } = {},
) {
  const f = await createFixture()
  const client = f.session.contextHost.getContext('flow').client
  const get = vi.spyOn(client.tasks, 'get').mockResolvedValue(snapshot)
  const watchers = createWatchers({
    withRun: params.withRun ?? ((_runID, work) => work()),
    client,
    pollMs: 10,
    apply: params.apply ?? (async () => false),
    interrupted: params.interrupted ?? (async () => undefined),
  })
  cleanups.push(async () => {
    await watchers.stop()
    await f.dispose()
  })
  return { watchers, get }
}

test('readiness waits for the first snapshot to finish applying', async () => {
  const entered = deferred<void>()
  const release = deferred<void>()
  const applied: Array<string> = []
  const { watchers } = await fixture({
    apply: async (runID) => {
      entered.resolve()
      await release.promise
      applied.push(runID)
      return false
    },
  })
  const initial = watchers.watch('run', 'task')
  let ready = false
  const waiting = Promise.resolve(initial).then(() => {
    ready = true
  })
  try {
    await entered.promise
    await Promise.resolve()
    expect(ready).toBe(false)
  } finally {
    release.resolve()
    await waiting
  }
  expect(applied).toEqual(['run'])
})

test('duplicate watches share readiness and one polling loop', async () => {
  const read = deferred<TasksGetResult>()
  const { watchers, get } = await fixture()
  get.mockReturnValue(read.promise)
  const first = watchers.watch('run', 'task')
  try {
    expect(first).toBeInstanceOf(Promise)
    expect(watchers.watch('run', 'task')).toBe(first)
    read.resolve(snapshot)
    await first
    expect(get).toHaveBeenCalledTimes(1)
  } finally {
    read.resolve(snapshot)
  }
})

test('missing tasks settle readiness only after interrupted mapping', async () => {
  const entered = deferred<void>()
  const release = deferred<void>()
  let failed = false
  const { watchers, get } = await fixture({
    interrupted: async () => {
      entered.resolve()
      await release.promise
      failed = true
    },
  })
  get.mockRejectedValue({ code: -32602, message: 'Task not found' })
  const initial = watchers.watch('run', 'task')
  let ready = false
  const waiting = Promise.resolve(initial).then(() => {
    ready = true
  })
  try {
    await entered.promise
    await Promise.resolve()
    expect(ready).toBe(false)
  } finally {
    release.resolve()
    await waiting
  }
  expect(failed).toBe(true)
})

test('an initial transport error rejects readiness while polling retries', async () => {
  vi.useFakeTimers()
  const applied: Array<string> = []
  const { watchers, get } = await fixture({
    apply: async (_runID, task) => {
      applied.push(task.status)
      return task.status === 'completed'
    },
  })
  const error = new Error('Transport disconnected')
  get
    .mockRejectedValueOnce(error)
    .mockResolvedValue({ ...snapshot, status: 'completed', result: { content: [] } })
  const initial = watchers.watch('run', 'task')
  await expect(initial).rejects.toBe(error)
  expect(watchers.watch('run', 'task')).toBe(initial)
  await vi.advanceTimersByTimeAsync(100)
  expect(applied).toEqual(['completed'])
  expect(get).toHaveBeenCalledTimes(2)
  await expect(initial).rejects.toBe(error)
})

test('later transport errors retry after readiness', async () => {
  vi.useFakeTimers()
  const applied: Array<string> = []
  const { watchers, get } = await fixture({
    apply: async (_runID, task) => {
      applied.push(task.status)
      return task.status === 'completed'
    },
  })
  get
    .mockResolvedValueOnce(snapshot)
    .mockRejectedValueOnce(new Error('Temporary transport failure'))
    .mockResolvedValue({ ...snapshot, status: 'completed', result: { content: [] } })
  await watchers.watch('run', 'task')
  await vi.advanceTimersByTimeAsync(100)
  expect(applied).toEqual(['working', 'completed'])
  expect(get).toHaveBeenCalledTimes(3)
})

test('a synchronous tracing failure rejects readiness without leaking a loop', async () => {
  const error = new Error('Tracing failed')
  const { watchers } = await fixture({
    withRun: () => {
      throw error
    },
  })
  const initial = watchers.watch('run', 'task')
  await expect(initial).rejects.toBe(error)
  await watchers.stop()
})

test('an interrupted mapping failure rejects readiness without a cleanup rejection', async () => {
  const error = new Error('Mapping failed')
  const { watchers, get } = await fixture({
    interrupted: async () => {
      throw error
    },
  })
  get.mockRejectedValue({ code: -32602, message: 'Task not found' })
  const initial = watchers.watch('run', 'task')
  await expect(initial).rejects.toBe(error)
  await watchers.stop()
})

test('readiness stays pending while the first apply retries a side effect', async () => {
  vi.useFakeTimers()
  let attempts = 0
  const { watchers } = await fixture({
    apply: async () => {
      attempts += 1
      if (attempts === 1) throw new Error('Cancellation transport failed')
      return true
    },
  })
  let outcome = 'pending'
  const initial = watchers.watch('run', 'task').then(
    () => {
      outcome = 'ready'
    },
    () => {
      outcome = 'failed'
    },
  )
  await vi.advanceTimersByTimeAsync(0)
  expect(outcome).toBe('pending')
  await vi.advanceTimersByTimeAsync(100)
  await initial
  expect(outcome).toBe('ready')
  expect(attempts).toBe(2)
})

test('stop rejects pending readiness and drains the held read', async () => {
  const read = deferred<TasksGetResult>()
  const entered = deferred<void>()
  const applied: Array<string> = []
  const { watchers, get } = await fixture({
    apply: async (runID) => {
      applied.push(runID)
      return false
    },
  })
  get.mockImplementation(async () => {
    entered.resolve()
    return read.promise
  })
  const initial = watchers.watch('run', 'task')
  const outcome = Promise.resolve(initial).then(
    () => 'ready',
    () => 'interrupted',
  )
  await entered.promise
  let stopped = false
  const stop = watchers.stop()
  expect(watchers.stop()).toBe(stop)
  const stopping = stop.then(() => {
    stopped = true
  })
  try {
    expect(await outcome).toBe('interrupted')
    expect(stopped).toBe(false)
  } finally {
    read.resolve(snapshot)
    await stopping
  }
  expect(applied).toEqual([])
  const afterStop = watchers.watch('another-run', 'task')
  expect(afterStop).toBeInstanceOf(Promise)
  await expect(afterStop).rejects.toThrow()
})
