import { AsyncLocalStorage } from 'node:async_hooks'
import type {
  ClientCapabilities,
  DetailedTask,
  InputRequest,
  InputResponse,
} from '@mokei/context-protocol'
import { RPCError } from '@mokei/context-rpc'
import type { Context } from '@opentelemetry/api'
import { context, ROOT_CONTEXT } from '@opentelemetry/api'
import { getActiveTraceContext } from '@sozai/otel'
import { describe, expect, test, vi } from 'vitest'

import { TaskManagerDisposedError } from '../src/index.js'
import {
  createTaskManager,
  InputRequestWithdrawnError,
  type TaskHandle,
  TaskInputKeyReusedError,
} from '../src/task-manager.js'
import { createMemoryTaskStore, type TaskRecord, type TaskStore } from '../src/task-store.js'
import type { GenericToolDefinition } from '../src/types.js'

const tool: GenericToolDefinition = {
  description: 'Test tool',
  inputSchema: { type: 'object' },
  handler: () => ({ content: [] }),
}
const rootsRequest = { method: 'roots/list' as const }
const rootsResponse = { roots: [] }
const result = { content: [{ type: 'text' as const, text: 'done' }] }

function record(patch: Partial<TaskRecord> = {}): TaskRecord {
  return {
    taskID: crypto.randomUUID(),
    revision: 0,
    status: 'working',
    createdAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    ttlMs: 3_600_000,
    toolName: 'echo',
    clientCapabilities: { roots: {} },
    inputs: [],
    ...patch,
  }
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('task manager', () => {
  test('dispose aborts running work with TaskManagerDisposedError', async () => {
    const manager = createTaskManager()
    let signal: AbortSignal | undefined
    await manager.create({
      toolName: 'echo',
      tool,
      clientCapabilities: {},
      work: (handle) => {
        signal = handle.signal
        return new Promise(() => {})
      },
    })
    await manager.dispose()
    expect(signal?.aborted).toBe(true)
    expect(signal?.reason).toBeInstanceOf(TaskManagerDisposedError)
    expect(signal?.reason).toMatchObject({
      name: 'TaskManagerDisposedError',
      message: 'Task manager disposed',
    })
  })

  test('create does not start work when disposed during the store write', async () => {
    const base = createMemoryTaskStore()
    const writing = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const store: TaskStore = {
      ...base,
      create: async (record) => {
        writing.resolve()
        await release.promise
        await base.create(record)
      },
    }
    const manager = createTaskManager({ store })
    let started = false
    const creating = manager.create({
      toolName: 'echo',
      tool,
      clientCapabilities: {},
      work: () => {
        started = true
        return result
      },
    })
    await writing.promise
    await manager.dispose()
    release.resolve()
    const created = await creating
    expect(started).toBe(false)
    expect((await store.get(created.taskId))?.status).toBe('working')
    const recovered: Array<string> = []
    const second = createTaskManager({
      store,
      recover: async (record, resume) => {
        recovered.push(record.taskID)
        await resume(() => result)
      },
    })
    try {
      await second.recover({ echo: tool })
      expect(recovered).toEqual([created.taskId])
      await expect.poll(async () => (await second.get(created.taskId)).status).toBe('completed')
    } finally {
      await second.dispose()
    }
  })

  test('recovered work runs under its stored request trace context', async () => {
    const storage = new AsyncLocalStorage<Context>()
    context.setGlobalContextManager({
      active: () => storage.getStore() ?? ROOT_CONTEXT,
      with: <A extends Array<unknown>, F extends (...args: A) => ReturnType<F>>(
        ctx: Context,
        fn: F,
        thisArg?: ThisParameterType<F>,
        ...args: A
      ): ReturnType<F> => storage.run(ctx, () => fn.call(thisArg, ...args)),
      bind: <T>(_ctx: Context, target: T): T => target,
      enable() {
        return this
      },
      disable() {
        return this
      },
    })
    const store = createMemoryTaskStore()
    const first = createTaskManager({ store })
    let second: ReturnType<typeof createTaskManager> | undefined
    let traceID: string | undefined
    try {
      const created = await first.create({
        toolName: 'echo',
        tool,
        clientCapabilities: {},
        requestMeta: { traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01' },
        work: () => new Promise(() => {}),
      })
      await first.dispose()
      const recovered = createTaskManager({
        store,
        recover: async (_record, resume) => {
          await resume(async () => {
            await Promise.resolve()
            traceID = getActiveTraceContext()?.traceID
            return result
          })
        },
      })
      second = recovered
      await recovered.recover({ echo: tool })
      await expect.poll(async () => (await recovered.get(created.taskId)).status).toBe('completed')
      expect(traceID).toBe('0af7651916cd43dd8448eb211c80319c')
    } finally {
      await first.dispose()
      await second?.dispose()
      context.disable()
    }
  })

  test('a failed answer write rejects the update and a retry completes the input', async () => {
    const base = createMemoryTaskStore()
    const failure = new Error('Store unavailable')
    let failures = 0
    const store = {
      ...base,
      update: async (...args: Parameters<typeof base.update>) => {
        if (args[1].status === 'working' && failures++ === 0) throw failure
        return base.update(...args)
      },
    }
    const manager = createTaskManager({ store })
    const errors: Array<unknown> = []
    manager.events.on('taskError', (event) => {
      errors.push(event)
    })
    const created = await manager.create({
      toolName: 'echo',
      tool,
      clientCapabilities: { roots: {} },
      work: async (task) => {
        await task.requestInput({ ask: rootsRequest })
        return result
      },
    })
    try {
      await tick()
      await expect(manager.update(created.taskId, { ask: rootsResponse })).rejects.toBe(failure)
      expect((await manager.get(created.taskId)).status).toBe('input_required')
      await manager.update(created.taskId, { ask: rootsResponse })
      await expect.poll(async () => (await manager.get(created.taskId)).status).toBe('completed')
      expect(failures).toBe(2)
      expect(errors).toEqual([])
    } finally {
      await manager.dispose()
    }
  })

  test('retries a transient detached settlement failure', async () => {
    const base = createMemoryTaskStore()
    let failures = 0
    const store = {
      ...base,
      update: async (...args: Parameters<typeof base.update>) => {
        if (args[1].status === 'completed' && failures++ < 2) throw new Error('Store unavailable')
        return base.update(...args)
      },
    }
    const manager = createTaskManager({ store })
    const errors: Array<unknown> = []
    manager.events.on('taskError', (event) => {
      errors.push(event)
    })
    const created = await manager.create({
      toolName: 'echo',
      tool,
      clientCapabilities: {},
      work: () => result,
    })
    await tick()
    expect((await manager.get(created.taskId)).status).toBe('completed')
    expect(failures).toBe(3)
    expect(errors).toEqual([])
    await manager.dispose()
  })

  test('reports a persistent detached settlement failure with its task ID', async () => {
    const base = createMemoryTaskStore()
    const failure = new Error('Store unavailable')
    let attempts = 0
    const store = {
      ...base,
      update: async (...args: Parameters<typeof base.update>) => {
        if (args[1].status === 'completed') {
          attempts++
          throw failure
        }
        return base.update(...args)
      },
    }
    const manager = createTaskManager({ store })
    const errors: Array<{ taskID?: string; error: unknown }> = []
    manager.events.on('taskError', (event) => {
      errors.push(event)
    })
    const created = await manager.create({
      toolName: 'echo',
      tool,
      clientCapabilities: {},
      work: () => result,
    })
    await tick()
    expect(attempts).toBe(4)
    expect(errors).toEqual([{ taskID: created.taskId, error: failure }])
    expect((await manager.get(created.taskId)).status).toBe('working')
    await manager.dispose()
  })

  test('handle cancellation aborts pending input and reports whether it won', async () => {
    const manager = createTaskManager()
    const errors: Array<unknown> = []
    manager.events.on('taskError', (event) => {
      errors.push(event)
    })
    let handle: TaskHandle | undefined
    let inputRejection: unknown
    const gate = Promise.withResolvers<void>()
    const created = await manager.create({
      toolName: 'echo',
      tool,
      clientCapabilities: { roots: {} },
      work: async (task) => {
        handle = task
        try {
          await task.requestInput({ ask: rootsRequest })
        } catch (error) {
          inputRejection = error
          await gate.promise
        }
        return result
      },
    })
    await tick()
    if (handle === undefined) throw new Error('Worker did not start')
    expect(await handle.cancel('Declined')).toBe(true)
    expect(handle.signal.aborted).toBe(true)
    expect((handle.signal.reason as Error).message).toBe('Declined')
    await tick()
    expect((inputRejection as Error).message).toBe('Declined')
    expect(await handle.cancel()).toBe(false)
    expect((await manager.get(created.taskId)).status).toBe('cancelled')
    gate.resolve()
    await tick()
    expect(await manager.get(created.taskId)).toMatchObject({ status: 'cancelled' })
    expect(errors).toEqual([])
    await manager.dispose()
  })

  test.each([
    ['without a signal', undefined],
    ['with a signal', new AbortController().signal],
  ])(
    'requestInput %s leaves only the returned promise to handle when the task ends',
    async (_name, signal) => {
      const unhandled: Array<unknown> = []
      const onUnhandled = (reason: unknown) => unhandled.push(reason)
      process.on('unhandledRejection', onUnhandled)
      try {
        const manager = createTaskManager()
        let handle: TaskHandle | undefined
        const created = await manager.create({
          toolName: 'echo',
          tool,
          clientCapabilities: { roots: {} },
          work: (task) => {
            handle = task
            return new Promise(() => {})
          },
        })
        if (handle === undefined) throw new Error('Worker did not start')
        const pending = handle.requestInput({ ask: rootsRequest }, { signal })
        const outcome = pending.then(
          () => undefined,
          (error: unknown) => error,
        )
        await tick()
        await manager.cancel(created.taskId)
        expect(await outcome).toBeInstanceOf(Error)
        await tick()
        await tick()
        expect(unhandled).toEqual([])
        await manager.dispose()
      } finally {
        process.off('unhandledRejection', onUnhandled)
      }
    },
  )

  test('handle cancellation loses to client cancellation', async () => {
    const manager = createTaskManager()
    let handle: TaskHandle | undefined
    const created = await manager.create({
      toolName: 'echo',
      tool,
      clientCapabilities: {},
      work: (task) => {
        handle = task
        return new Promise(() => {})
      },
    })
    if (handle === undefined) throw new Error('Worker did not start')
    await manager.cancel(created.taskId)
    expect(await handle.cancel()).toBe(false)
    expect(handle.signal.aborted).toBe(true)
    expect((await manager.get(created.taskId)).status).toBe('cancelled')
    await manager.dispose()
  })

  test('handle cancellation loses to expiry', async () => {
    const store = createMemoryTaskStore()
    let now = Date.parse('2026-09-29T12:00:00Z')
    const manager = createTaskManager({ store, ttlMs: 1, now: () => now })
    let handle: TaskHandle | undefined
    const created = await manager.create({
      toolName: 'echo',
      tool,
      clientCapabilities: {},
      work: (task) => {
        handle = task
        return new Promise(() => {})
      },
    })
    if (handle === undefined) throw new Error('Worker did not start')
    now += 2
    expect(await manager.canAccess(created.taskId)).toBe(false)
    expect(await handle.cancel()).toBe(false)
    expect(handle.signal.aborted).toBe(true)
    expect(await store.get(created.taskId)).toBeUndefined()
    await manager.dispose()
  })

  test('handle cancellation loses after settlement', async () => {
    const manager = createTaskManager()
    let handle: TaskHandle | undefined
    const created = await manager.create({
      toolName: 'echo',
      tool,
      clientCapabilities: {},
      work: (task) => {
        handle = task
        return result
      },
    })
    await tick()
    if (handle === undefined) throw new Error('Worker did not start')
    expect(await handle.cancel()).toBe(false)
    expect((await manager.get(created.taskId)).status).toBe('completed')
    await manager.dispose()
  })

  test('reissued identical requests attach or replay and other issued keys reject', async () => {
    const manager = createTaskManager()
    let handle: TaskHandle | undefined
    const created = await manager.create({
      toolName: 'echo',
      tool,
      clientCapabilities: { roots: {} },
      work: (task) => {
        handle = task
        return new Promise(() => {})
      },
    })
    if (handle === undefined) throw new Error('Worker did not start')
    const first = handle.requestInput({ ask: rootsRequest })
    await tick()
    const attached = handle.requestInput({ ask: { method: 'roots/list' } })
    await expect(
      handle.requestInput({ ask: rootsRequest, other: rootsRequest }),
    ).rejects.toBeInstanceOf(TaskInputKeyReusedError)
    await manager.update(created.taskId, { ask: rootsResponse })
    await expect(first).resolves.toEqual({ ask: rootsResponse })
    await expect(attached).resolves.toEqual({ ask: rootsResponse })
    await expect(handle.requestInput({ ask: rootsRequest })).resolves.toEqual({
      ask: rootsResponse,
    })
    await expect(
      handle.requestInput({ ask: { method: 'roots/list', params: { page: 2 } } }),
    ).rejects.toBeInstanceOf(TaskInputKeyReusedError)
    await manager.dispose()
  })

  test('reissued input attaches before a final response changes the task to working', async () => {
    const base = createMemoryTaskStore()
    let armed = false
    let reads = 0
    let deliverFinalResponse: (() => Promise<void>) | undefined
    let first: Promise<Record<string, InputResponse>> | undefined
    const store = {
      ...base,
      get: async (taskID: string) => {
        if (armed && ++reads === 2) {
          armed = false
          await deliverFinalResponse?.()
          await first
        }
        return base.get(taskID)
      },
    }
    const manager = createTaskManager({ store })
    let handle: TaskHandle | undefined
    const created = await manager.create({
      toolName: 'echo',
      tool,
      clientCapabilities: { roots: {} },
      work: (task) => {
        handle = task
        return new Promise(() => {})
      },
    })
    if (handle === undefined) throw new Error('Worker did not start')
    first = handle.requestInput({ ask: rootsRequest })
    await tick()
    deliverFinalResponse = () => manager.update(created.taskId, { ask: rootsResponse })
    armed = true
    const attached = handle.requestInput({ ask: { method: 'roots/list' } })
    const attachedOutcome = attached.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    )
    await tick()
    if (armed) {
      armed = false
      await deliverFinalResponse()
    }
    expect(await first).toEqual({ ask: rootsResponse })
    expect(await attachedOutcome).toEqual({ value: { ask: rootsResponse } })
    await manager.dispose()
  })

  test('reissued input compares nested JSON without depending on property order', async () => {
    const manager = createTaskManager()
    let handle: TaskHandle | undefined
    const created = await manager.create({
      toolName: 'echo',
      tool,
      clientCapabilities: { roots: {} },
      work: (task) => {
        handle = task
        return new Promise(() => {})
      },
    })
    if (handle === undefined) throw new Error('Worker did not start')
    const first = handle.requestInput({
      ask: { method: 'roots/list', params: { a: [1, { b: true }], c: null } },
    })
    await tick()
    const attached = handle.requestInput({
      ask: { params: { c: null, a: [1, { b: true }] }, method: 'roots/list' },
    })
    await manager.update(created.taskId, { ask: rootsResponse })
    await expect(first).resolves.toEqual({ ask: rootsResponse })
    await expect(attached).resolves.toEqual({ ask: rootsResponse })
    await manager.dispose()
  })

  test('changing a request under an outstanding key rejects with the key reuse error', async () => {
    const manager = createTaskManager()
    let handle: TaskHandle | undefined
    const created = await manager.create({
      toolName: 'echo',
      tool,
      clientCapabilities: { roots: {} },
      work: (task) => {
        handle = task
        return new Promise(() => {})
      },
    })
    if (handle === undefined) throw new Error('Worker did not start')
    const first = handle.requestInput({ ask: { method: 'roots/list', params: { page: 1 } } })
    await tick()
    await expect(
      handle.requestInput({ ask: { method: 'roots/list', params: { page: 2 } } }),
    ).rejects.toBeInstanceOf(TaskInputKeyReusedError)
    await manager.update(created.taskId, { ask: rootsResponse })
    await expect(first).resolves.toEqual({ ask: rootsResponse })
    await manager.dispose()
  })

  test('preserves request metadata for live and recovered workers', async () => {
    const store = createMemoryTaskStore()
    let live: TaskHandle | undefined
    const first = createTaskManager({ store })
    const created = await first.create({
      toolName: 'echo',
      tool,
      clientCapabilities: {},
      requestMeta: { trace: 'abc', depth: 2 },
      work: (task) => {
        live = task
        return new Promise(() => {})
      },
    })
    expect(live?.requestMeta).toEqual({ trace: 'abc', depth: 2 })
    expect((await store.get(created.taskId))?.requestMeta).toEqual({ trace: 'abc', depth: 2 })
    await first.dispose()
    let recovered: TaskHandle | undefined
    const second = createTaskManager({
      store,
      recover: async (_record, resume) => {
        await resume((task) => {
          recovered = task
          return new Promise(() => {})
        })
      },
    })
    await second.recover({ echo: tool })
    expect(recovered?.requestMeta).toEqual({ trace: 'abc', depth: 2 })
    await second.dispose()
  })

  test('uses empty request metadata when none was supplied', async () => {
    const manager = createTaskManager()
    let observed: unknown
    await manager.create({
      toolName: 'echo',
      tool,
      clientCapabilities: {},
      work: (task) => {
        observed = task.requestMeta
        return new Promise(() => {})
      },
    })
    expect(observed).toEqual({})
    await manager.dispose()
  })
  test('persists a UUID before returning and settles with status events', async () => {
    const store = createMemoryTaskStore()
    const manager = createTaskManager({ store, now: () => Date.parse('2026-09-29T12:00:00Z') })
    const statuses: Array<string> = []
    manager.events.on('taskStatus', (task) => {
      statuses.push(task.status)
    })
    let release: ((value: typeof result) => void) | undefined
    const work = new Promise<typeof result>((resolve) => {
      release = resolve
    })
    const created = await manager.create({
      toolName: 'echo',
      tool,
      clientCapabilities: {},
      work: () => work,
    })
    expect(created.taskId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(await store.get(created.taskId)).toMatchObject({
      status: 'working',
      createdAt: '2026-09-29T12:00:00.000Z',
    })
    release?.(result)
    await tick()
    expect(await manager.get(created.taskId)).toMatchObject({
      status: 'completed',
      result: { ...result, resultType: 'complete' },
    })
    expect(statuses).toEqual(['working', 'completed'])
    await manager.dispose()
  })

  test('cancellation aborts work and ignores its later outcome', async () => {
    const manager = createTaskManager()
    let handle: TaskHandle | undefined
    const created = await manager.create({
      toolName: 'echo',
      tool,
      clientCapabilities: {},
      work: (task) => {
        handle = task
        return new Promise(() => {})
      },
    })
    await manager.cancel(created.taskId)
    expect(handle?.signal.aborted).toBe(true)
    expect((await manager.get(created.taskId)).status).toBe('cancelled')
    await manager.dispose()
  })

  test('expiry uses creation time on access', async () => {
    let now = Date.parse('2026-09-29T12:00:00Z')
    const store = createMemoryTaskStore()
    const manager = createTaskManager({ store, now: () => now, ttlMs: 1000 })
    const created = await manager.create({
      toolName: 'echo',
      tool,
      clientCapabilities: {},
      work: () => new Promise(() => {}),
    })
    now += 1001
    await expect(manager.get(created.taskId)).rejects.toMatchObject({
      code: -32602,
      message: 'Task not found',
    })
    expect(await store.get(created.taskId)).toBeUndefined()
    await manager.dispose()
  })

  test('withdraws aborted input while retaining its request', async () => {
    const store = createMemoryTaskStore()
    const manager = createTaskManager({ store })
    const controller = new AbortController()
    let handle: TaskHandle | undefined
    const created = await manager.create({
      toolName: 'echo',
      tool,
      clientCapabilities: { roots: {} },
      work: async (task) => {
        handle = task
        await task.requestInput({ ask: rootsRequest }, { signal: controller.signal })
        return result
      },
    })
    await tick()
    expect((await manager.get(created.taskId)).status).toBe('input_required')
    controller.abort(new Error('deadline'))
    await tick()
    expect((await manager.get(created.taskId)).status).toBe('completed')
    expect((await store.get(created.taskId))?.inputs).toEqual([
      { id: 1, requests: { ask: rootsRequest }, responses: {}, outcome: 'withdrawn' },
    ])
    await expect(manager.update(created.taskId, { ask: rootsResponse })).rejects.toMatchObject({
      code: -32602,
      message: 'Task is not awaiting input for ask',
      data: { key: 'ask' },
    })
    await expect(handle?.requestInput({ ask: rootsRequest })).rejects.toThrow(
      'Task is no longer active',
    )
    await manager.dispose()
  })

  test('dispose ends the withdraw retry loop during persistent store failures', async () => {
    vi.useFakeTimers()
    try {
      const base = createMemoryTaskStore()
      const failure = new Error('Store unavailable')
      const store = {
        ...base,
        update: async (...args: Parameters<typeof base.update>) => {
          if (args[1].inputs?.at(-1)?.outcome === 'withdrawn') throw failure
          return base.update(...args)
        },
      }
      const manager = createTaskManager({ store })
      const errors: Array<{ taskID?: string; error: unknown }> = []
      manager.events.on('taskError', (event) => {
        errors.push(event)
      })
      const controller = new AbortController()
      await manager.create({
        toolName: 'echo',
        tool,
        clientCapabilities: { roots: {} },
        work: async (task) => {
          await task.requestInput({ ask: rootsRequest }, { signal: controller.signal })
          return result
        },
      })
      await vi.advanceTimersByTimeAsync(0)
      controller.abort(new Error('deadline'))
      // Attempts at 0, 10, 30 and 70 ms, then a 80 ms backoff sleep is pending.
      await vi.advanceTimersByTimeAsync(75)
      expect(errors).toHaveLength(4)
      await manager.dispose()
      expect(vi.getTimerCount()).toBe(0)
      await vi.advanceTimersByTimeAsync(5_000)
      expect(errors).toHaveLength(4)
    } finally {
      vi.useRealTimers()
    }
  })

  test('merges concurrent status and checkpoint writes', async () => {
    const store = createMemoryTaskStore()
    const manager = createTaskManager({ store })
    let handle: TaskHandle | undefined
    const created = await manager.create({
      toolName: 'echo',
      tool,
      clientCapabilities: {},
      work: (task) => {
        handle = task
        return new Promise(() => {})
      },
    })
    if (handle === undefined) throw new Error('Worker did not start')
    await Promise.all([handle.setStatus('halfway'), handle.checkpoint({ step: 2 })])
    expect(await store.get(created.taskId)).toMatchObject({
      statusMessage: 'halfway',
      resumeData: { step: 2 },
    })
    await manager.cancel(created.taskId)
    await expect(handle.checkpoint({ step: 3 })).rejects.toThrow('Task cancelled')
    await manager.dispose()
  })

  test('merges partial responses and resumes input after every key arrives', async () => {
    const manager = createTaskManager()
    const created = await manager.create({
      toolName: 'echo',
      tool,
      clientCapabilities: { roots: {} },
      work: async (task) => {
        const responses = await task.requestInput({ a: rootsRequest, b: rootsRequest })
        return { content: [{ type: 'text', text: String(Object.keys(responses).length) }] }
      },
    })
    await tick()
    await Promise.all([
      manager.update(created.taskId, { a: rootsResponse }),
      manager.update(created.taskId, { b: rootsResponse }),
    ])
    await tick()
    expect(await manager.get(created.taskId)).toMatchObject({
      status: 'completed',
      result: { content: [{ text: '2' }] },
    })
    await manager.dispose()
  })

  test('keeps persisted workers hidden until explicit recovery', async () => {
    const store = createMemoryTaskStore()
    const saved = record({ resumeData: { step: 2 } })
    await store.create(saved)
    const manager = createTaskManager({
      store,
      recover: async (item, resume) => {
        expect(item.resumeData).toEqual({ step: 2 })
        await resume(async () => result)
      },
    })
    await expect(manager.get(saved.taskID)).rejects.toMatchObject({ message: 'Task not found' })
    await manager.recover({ echo: tool })
    await tick()
    expect((await manager.get(saved.taskID)).status).toBe('completed')
    await manager.dispose()
  })

  test('resumes outstanding input and settles a recovered worker', async () => {
    const store = createMemoryTaskStore()
    const saved = record({
      status: 'input_required',
      inputs: [{ id: 1, requests: { ask: rootsRequest }, responses: {} }],
    })
    await store.create(saved)
    const manager = createTaskManager({
      store,
      recover: (_item, resume) =>
        resume(async (task) => {
          await task.awaitInput()
          return result
        }),
    })
    await manager.recover({ echo: tool })
    await manager.update(saved.taskID, { ask: rootsResponse })
    await tick()
    expect((await manager.get(saved.taskID)).status).toBe('completed')
    await manager.dispose()
  })

  test('recovered worker reissues its persisted outstanding request', async () => {
    const store = createMemoryTaskStore()
    const saved = record({
      status: 'input_required',
      inputs: [{ id: 1, requests: { ask: rootsRequest }, responses: {} }],
    })
    await store.create(saved)
    const observed = Promise.withResolvers<Record<string, InputResponse>>()
    const manager = createTaskManager({
      store,
      recover: (_item, resume) =>
        resume(async (task) => {
          const responses = await task.requestInput({ ask: { method: 'roots/list' } })
          observed.resolve(responses)
          return result
        }),
    })
    await manager.recover({ echo: tool })
    await manager.update(saved.taskID, { ask: rootsResponse })
    expect(await observed.promise).toEqual({ ask: rootsResponse })
    await tick()
    expect((await manager.get(saved.taskID)).status).toBe('completed')
    await manager.dispose()
  })

  test('fails abandoned records with the exact interruption error', async () => {
    const store = createMemoryTaskStore()
    const saved = record()
    await store.create(saved)
    const manager = createTaskManager({ store })
    expect(await manager.get(saved.taskID)).toMatchObject({
      status: 'failed',
      error: { code: -32603, message: 'Task interrupted by server restart' },
    })
    await manager.dispose()
  })

  test('preserves RPC errors thrown by recovered work', async () => {
    const store = createMemoryTaskStore()
    const saved = record()
    await store.create(saved)
    const manager = createTaskManager({
      store,
      recover: (_item, resume) =>
        resume(() => {
          throw new RPCError({ code: -32021, message: 'missing capability' })
        }),
    })
    await manager.recover({ echo: tool })
    await tick()
    expect(await manager.get(saved.taskID)).toMatchObject({
      status: 'failed',
      error: { code: -32021, message: 'missing capability' },
    })
    await manager.dispose()
  })

  test('keeps a task hidden while recovery callback is pending', async () => {
    const store = createMemoryTaskStore()
    const saved = record()
    await store.create(saved)
    let finish: (() => void) | undefined
    const callbackGate = new Promise<void>((resolve) => {
      finish = resolve
    })
    const manager = createTaskManager({
      store,
      recover: async (_item, resume) => {
        await resume(() => new Promise(() => {}))
        await callbackGate
      },
    })
    const recovering = manager.recover({ echo: tool })
    await tick()
    expect(await manager.canAccess(saved.taskID)).toBe(false)
    finish?.()
    await recovering
    expect(await manager.canAccess(saved.taskID)).toBe(true)
    await manager.dispose()
  })

  test('does not start recovered work after disposal during the callback', async () => {
    const store = createMemoryTaskStore()
    const saved = record()
    await store.create(saved)
    const gate = Promise.withResolvers<void>()
    let started = 0
    const manager = createTaskManager({
      store,
      recover: async (_item, resume) => {
        await gate.promise
        await resume(() => {
          started++
          return new Promise(() => {})
        })
      },
    })
    const recovering = manager.recover({ echo: tool })
    await tick()
    await manager.dispose()
    gate.resolve()
    await recovering
    expect(started).toBe(0)
    expect((await store.get(saved.taskID))?.status).toBe('working')
  })

  test('does not start recovered work after expiry during the callback', async () => {
    const store = createMemoryTaskStore()
    const saved = record({ ttlMs: 1 })
    await store.create(saved)
    let now = Date.parse(saved.createdAt)
    const gate = Promise.withResolvers<void>()
    let started = 0
    const manager = createTaskManager({
      store,
      now: () => now,
      recover: async (_item, resume) => {
        await gate.promise
        await resume(() => {
          started++
          return new Promise(() => {})
        })
      },
    })
    const recovering = manager.recover({ echo: tool })
    await tick()
    now += 2
    gate.resolve()
    await recovering
    expect(started).toBe(0)
    expect(await store.get(saved.taskID)).toBeUndefined()
    await manager.dispose()
  })

  test('serialises overlapping recovery of the same task', async () => {
    const store = createMemoryTaskStore()
    const saved = record()
    await store.create(saved)
    const gate = Promise.withResolvers<void>()
    let callbacks = 0
    let started = 0
    const manager = createTaskManager({
      store,
      recover: async (_item, resume) => {
        callbacks++
        await gate.promise
        await resume(() => {
          started++
          return new Promise(() => {})
        })
      },
    })
    const first = manager.recover({ echo: tool })
    await tick()
    const second = manager.recover({ echo: tool })
    await tick()
    gate.resolve()
    await Promise.all([first, second])
    expect(callbacks).toBe(1)
    expect(started).toBe(1)
    await manager.dispose()
  })

  test('fails records when a tool is missing or recovery returns without resuming', async () => {
    const store = createMemoryTaskStore()
    const missing = record({ toolName: 'missing' })
    const abandoned = record()
    await store.create(missing)
    await store.create(abandoned)
    const manager = createTaskManager({ store, recover: () => {} })
    await manager.recover({ [abandoned.toolName]: tool })
    expect(await manager.get(missing.taskID)).toMatchObject({
      status: 'failed',
      error: INTERRUPTED_ERROR,
    })
    expect(await manager.get(abandoned.taskID)).toMatchObject({
      status: 'failed',
      error: INTERRUPTED_ERROR,
    })
    await manager.dispose()
  })

  test('fails a record if recovery callback throws after attaching work', async () => {
    const store = createMemoryTaskStore()
    const saved = record()
    await store.create(saved)
    const manager = createTaskManager({
      store,
      recover: async (_item, resume) => {
        await resume(() => new Promise(() => {}))
        throw new Error('cannot recover')
      },
    })
    await manager.recover({ echo: tool })
    expect(await manager.get(saved.taskID)).toMatchObject({
      status: 'failed',
      error: INTERRUPTED_ERROR,
    })
    await manager.dispose()
  })

  test('rejects missing input capability with its protocol error', async () => {
    const manager = createTaskManager()
    const created = await manager.create({
      toolName: 'echo',
      tool,
      clientCapabilities: {},
      work: async (task) => {
        await task.requestInput({ ask: rootsRequest })
        return result
      },
    })
    await tick()
    expect(await manager.get(created.taskId)).toMatchObject({
      status: 'failed',
      error: {
        code: -32021,
        message:
          'Cannot request input "ask" (roots/list): the request\'s client capabilities do not declare roots',
        data: { requiredCapabilities: { roots: {} } },
      },
    })
    await manager.dispose()
  })

  test('keeps records for recovery when disposed and aborts pending input', async () => {
    const store = createMemoryTaskStore()
    const manager = createTaskManager({ store })
    let rejected: unknown
    const created = await manager.create({
      toolName: 'echo',
      tool,
      clientCapabilities: { roots: {} },
      work: async (task) => {
        try {
          await task.requestInput({ ask: rootsRequest })
        } catch (error) {
          rejected = error
        }
        return result
      },
    })
    await tick()
    await manager.dispose()
    await tick()
    expect(rejected).toBeInstanceOf(Error)
    expect(await store.get(created.taskId)).toMatchObject({ status: 'input_required' })
  })

  test('withdraws input with the withdrawn error and lets work continue', async () => {
    const store = createMemoryTaskStore()
    const manager = createTaskManager({ store })
    const controller = new AbortController()
    const reason = new Error('input deadline')
    let observed: unknown
    const created = await manager.create({
      toolName: 'echo',
      tool,
      clientCapabilities: { roots: {} },
      work: async (task) => {
        try {
          await task.requestInput({ ask: rootsRequest }, { signal: controller.signal })
        } catch (error) {
          observed = error
        }
        return result
      },
    })
    await tick()
    controller.abort(reason)
    await tick()
    expect(observed).toBeInstanceOf(InputRequestWithdrawnError)
    expect(await manager.get(created.taskId)).toMatchObject({ status: 'completed' })
    expect((await store.get(created.taskId))?.inputs).toEqual([
      { id: 1, requests: { ask: rootsRequest }, responses: {}, outcome: 'withdrawn' },
    ])
    await manager.dispose()
  })

  test('a withdrawn input replays its withdrawal and rejects a changed reissue', async () => {
    const manager = createTaskManager()
    const controller = new AbortController()
    const attempts = Promise.withResolvers<Array<unknown>>()
    const created = await manager.create({
      toolName: 'echo',
      tool,
      clientCapabilities: { roots: {} },
      work: async (task) => {
        const errors: Array<unknown> = []
        for (const requests of [
          { ask: rootsRequest },
          { ask: rootsRequest },
          { ask: { method: 'roots/list' as const, params: { page: 2 } } },
        ]) {
          try {
            await task.requestInput(requests, { signal: controller.signal })
          } catch (error) {
            errors.push(error)
          }
        }
        attempts.resolve(errors)
        return result
      },
    })
    await tick()
    controller.abort(new Error('input deadline'))
    const [withdrawn, replayed, changed] = await attempts.promise
    expect(withdrawn).toBeInstanceOf(InputRequestWithdrawnError)
    expect(replayed).toBeInstanceOf(InputRequestWithdrawnError)
    expect(changed).toBeInstanceOf(TaskInputKeyReusedError)
    await tick()
    expect((await manager.get(created.taskId)).status).toBe('completed')
    await manager.dispose()
  })

  test('rejects a mismatched response without consuming its input key', async () => {
    const manager = createTaskManager()
    const created = await manager.create({
      toolName: 'echo',
      tool,
      clientCapabilities: { roots: {} },
      work: async (task) => {
        await task.requestInput({ ask: rootsRequest })
        return result
      },
    })
    await tick()
    await expect(
      manager.update(created.taskId, { ask: { action: 'decline' } }),
    ).rejects.toMatchObject({ code: -32602 })
    expect(await manager.get(created.taskId)).toMatchObject({
      status: 'input_required',
      inputRequests: { ask: rootsRequest },
    })
    await manager.cancel(created.taskId)
    await manager.dispose()
  })

  test('enforces issuer, subject and scope binding', async () => {
    const owner = { issuer: 'issuer', subject: 'alice', scopes: ['read', 'write'] }
    const manager = createTaskManager()
    const created = await manager.create({
      toolName: 'echo',
      tool,
      clientCapabilities: {},
      owner,
      work: () => new Promise(() => {}),
    })
    expect(await manager.canAccess(created.taskId, { ...owner, scopes: ['read'] })).toBe(false)
    expect(await manager.canAccess(created.taskId, { ...owner, subject: 'bob' })).toBe(false)
    expect(
      await manager.canAccess(created.taskId, { ...owner, scopes: ['read', 'write', 'other'] }),
    ).toBe(true)
    await expect(manager.get(created.taskId)).rejects.toMatchObject({ message: 'Task not found' })
    await manager.dispose()
  })

  test('passes the latest checkpoint to the recovery callback', async () => {
    const store = createMemoryTaskStore()
    const first = createTaskManager({ store })
    let handle: TaskHandle | undefined
    const created = await first.create({
      toolName: 'echo',
      tool,
      clientCapabilities: {},
      resumeData: { step: 1 },
      work: (task) => {
        handle = task
        return new Promise(() => {})
      },
    })
    if (handle === undefined) throw new Error('Worker did not start')
    await handle.checkpoint({ step: 2 })
    await first.dispose()
    let observed: unknown
    const second = createTaskManager({
      store,
      recover: async (saved, resume) => {
        observed = saved.resumeData
        await resume(async () => result)
      },
    })
    await second.recover({ echo: tool })
    await tick()
    expect(observed).toEqual({ step: 2 })
    expect((await second.get(created.taskId)).status).toBe('completed')
    await second.dispose()
  })

  test('rejects a stale update after input withdrawal while work continues', async () => {
    const store = createMemoryTaskStore()
    const manager = createTaskManager({ store })
    const controller = new AbortController()
    const gate = Promise.withResolvers<void>()
    const created = await manager.create({
      toolName: 'echo',
      tool,
      clientCapabilities: { roots: {} },
      work: async (task) => {
        try {
          await task.requestInput({ ask: rootsRequest }, { signal: controller.signal })
        } catch {
          await gate.promise
        }
        return result
      },
    })
    await tick()
    controller.abort(new Error('deadline'))
    await tick()
    expect((await manager.get(created.taskId)).status).toBe('working')
    await expect(manager.update(created.taskId, { ask: rootsResponse })).rejects.toMatchObject({
      code: -32602,
      message: 'Task is not awaiting input for ask',
    })
    expect((await store.get(created.taskId))?.status).toBe('working')
    expect((await store.get(created.taskId))?.inputs).toEqual([
      { id: 1, requests: { ask: rootsRequest }, responses: {}, outcome: 'withdrawn' },
    ])
    gate.resolve()
    await tick()
    await manager.dispose()
  })

  test('expires a task through the background sweep', async () => {
    const store = createMemoryTaskStore()
    let now = Date.parse('2026-09-29T12:00:00Z')
    const manager = createTaskManager({ store, ttlMs: 1, now: () => now })
    const created = await manager.create({
      toolName: 'echo',
      tool,
      clientCapabilities: {},
      work: () => new Promise(() => {}),
    })
    now += 2
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(await store.get(created.taskId)).toBeUndefined()
    await manager.dispose()
  })

  test('expiry aborts a worker and rejects its pending input', async () => {
    const store = createMemoryTaskStore()
    let now = Date.parse('2026-09-29T12:00:00Z')
    const manager = createTaskManager({ store, ttlMs: 1, now: () => now })
    let signal: AbortSignal | undefined
    let rejection: unknown
    const created = await manager.create({
      toolName: 'echo',
      tool,
      clientCapabilities: { roots: {} },
      work: async (task) => {
        signal = task.signal
        try {
          await task.requestInput({ ask: rootsRequest })
        } catch (error) {
          rejection = error
        }
        return result
      },
    })
    await tick()
    expect((await store.get(created.taskId))?.status).toBe('input_required')
    now += 2
    await expect(manager.get(created.taskId)).rejects.toMatchObject({ message: 'Task not found' })
    await tick()
    expect(signal?.aborted).toBe(true)
    expect(rejection).toBeInstanceOf(Error)
    expect((rejection as Error).message).toBe('Task expired')
    await manager.dispose()
  })

  test.each(['setStatus', 'checkpoint'] as const)(
    'treats deletion during %s as a missing task',
    async (method) => {
      const base = createMemoryTaskStore()
      const store = {
        ...base,
        update: async (...args: Parameters<typeof base.update>) => {
          await base.delete(args[0])
          return base.update(...args)
        },
      }
      const manager = createTaskManager({ store })
      let handle: TaskHandle | undefined
      await manager.create({
        toolName: 'echo',
        tool,
        clientCapabilities: {},
        work: (task) => {
          handle = task
          return new Promise(() => {})
        },
      })
      if (handle === undefined) throw new Error('Worker did not start')
      const write =
        method === 'setStatus' ? handle.setStatus('progress') : handle.checkpoint({ step: 2 })
      await expect(write).rejects.toMatchObject({ message: 'Task not found' })
      await manager.dispose()
    },
  )

  test('treats deletion during an input update as a missing task', async () => {
    const base = createMemoryTaskStore()
    const store = {
      ...base,
      update: async (...args: Parameters<typeof base.update>) => {
        if (Object.keys(args[1].inputs?.at(-1)?.responses ?? {}).length > 0) {
          await base.delete(args[0])
        }
        return base.update(...args)
      },
    }
    const manager = createTaskManager({ store })
    const created = await manager.create({
      toolName: 'echo',
      tool,
      clientCapabilities: { roots: {} },
      work: async (task) => {
        await task.requestInput({ ask: rootsRequest })
        return result
      },
    })
    await tick()
    await expect(manager.update(created.taskId, { ask: rootsResponse })).rejects.toMatchObject({
      message: 'Task not found',
    })
    await manager.dispose()
  })

  test('handles deletion during detached worker settlement', async () => {
    const base = createMemoryTaskStore()
    const store = {
      ...base,
      update: async (...args: Parameters<typeof base.update>) => {
        if (args[1].status === 'completed') await base.delete(args[0])
        return base.update(...args)
      },
    }
    const manager = createTaskManager({ store })
    const created = await manager.create({
      toolName: 'echo',
      tool,
      clientCapabilities: {},
      work: async () => result,
    })
    await tick()
    expect(await store.get(created.taskId)).toBeUndefined()
    await manager.dispose()
  })

  test('handles a failed background expiry sweep', async () => {
    const base = createMemoryTaskStore()
    let scans = 0
    const store = {
      ...base,
      list: async (...args: Parameters<typeof base.list>) => {
        scans++
        if (scans > 1) throw new Error('Store unavailable')
        return base.list(...args)
      },
    }
    const manager = createTaskManager({ store, ttlMs: 1 })
    const errors: Array<{ taskID?: string; error: unknown }> = []
    manager.events.on('taskError', (event) => {
      errors.push(event)
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(scans).toBeGreaterThan(1)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]?.error).toMatchObject({ message: 'Store unavailable' })
    await manager.dispose()
  })

  test('reports an expiry sweep failure for its record and retries on the next sweep', async () => {
    const base = createMemoryTaskStore()
    let now = Date.now()
    let failures = 0
    const store = {
      ...base,
      delete: async (taskID: string) => {
        if (failures++ === 0) throw new Error('Delete unavailable')
        await base.delete(taskID)
      },
    }
    const manager = createTaskManager({ store, ttlMs: 1, now: () => now })
    const errors: Array<{ taskID?: string; error: unknown }> = []
    manager.events.on('taskError', (event) => {
      errors.push(event)
    })
    const created = await manager.create({
      toolName: 'echo',
      tool,
      clientCapabilities: {},
      work: () => new Promise(() => {}),
    })
    now += 2
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(errors).toMatchObject([
      { taskID: created.taskId, error: { message: 'Delete unavailable' } },
    ])
    expect(await store.get(created.taskId)).toBeUndefined()
    await manager.dispose()
  })

  test('rejects pending input when cancelled', async () => {
    const manager = createTaskManager()
    let rejected: unknown
    const created = await manager.create({
      toolName: 'echo',
      tool,
      clientCapabilities: { roots: {} },
      work: async (task) => {
        try {
          await task.requestInput({ ask: rootsRequest })
        } catch (error) {
          rejected = error
        }
        return result
      },
    })
    await tick()
    await manager.cancel(created.taskId)
    await tick()
    expect(rejected).toBeInstanceOf(Error)
    expect((await manager.get(created.taskId)).status).toBe('cancelled')
    await manager.dispose()
  })

  test('completion wins over a delayed status write without losing the terminal state', async () => {
    const store = createMemoryTaskStore()
    const manager = createTaskManager({ store })
    let handle: TaskHandle | undefined
    const gate = Promise.withResolvers<typeof result>()
    const created = await manager.create({
      toolName: 'echo',
      tool,
      clientCapabilities: {},
      work: (task) => {
        handle = task
        return gate.promise
      },
    })
    if (handle === undefined) throw new Error('Worker did not start')
    const status = handle.setStatus('finishing').catch(() => {})
    gate.resolve(result)
    await status
    await tick()
    expect((await manager.get(created.taskId)).status).toBe('completed')
    await manager.dispose()
  })
})

const INTERRUPTED_ERROR = { code: -32603, message: 'Task interrupted by server restart' }

async function started(
  params: {
    store?: TaskStore
    now?: () => number
    ttlMs?: number
    clientCapabilities?: ClientCapabilities
  } = {},
) {
  const { clientCapabilities = { roots: {} }, ...options } = params
  const store = options.store ?? createMemoryTaskStore()
  const manager = createTaskManager({ ...options, store })
  const events: Array<DetailedTask> = []
  const errors: Array<{ taskID?: string; error: unknown }> = []
  manager.events.on('taskStatus', (event) => {
    events.push(event)
  })
  manager.events.on('taskError', (event) => {
    errors.push(event)
  })
  let handle: TaskHandle | undefined
  const created = await manager.create({
    toolName: 'echo',
    tool,
    clientCapabilities,
    work: (task) => {
      handle = task
      return new Promise(() => {})
    },
  })
  if (handle === undefined) throw new Error('Worker did not start')
  events.length = 0
  return { store, manager, handle, taskID: created.taskId, events, errors }
}

function settleOf<T>(promise: Promise<T>): Promise<{ value: T } | { error: unknown }> {
  return promise.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  )
}

describe('input transitions', () => {
  test('ask appends an open request and changes the status', async () => {
    const { store, manager, handle, taskID, events } = await started()
    void settleOf(handle.requestInput({ ask: rootsRequest }))
    await vi.waitFor(() => expect(events).toHaveLength(1))
    const saved = await store.get(taskID)
    expect(saved).toMatchObject({ status: 'input_required', revision: 1 })
    expect(saved?.inputs).toEqual([{ id: 1, requests: { ask: rootsRequest }, responses: {} }])
    expect(events[0]).toMatchObject({
      status: 'input_required',
      inputRequests: { ask: rootsRequest },
    })
    await manager.dispose()
  })

  test('ask fails while a request is open', async () => {
    const { store, manager, handle, taskID, events } = await started()
    void settleOf(handle.requestInput({ ask: rootsRequest }))
    await vi.waitFor(() => expect(events).toHaveLength(1))
    await expect(handle.requestInput({ other: rootsRequest })).rejects.toThrow(
      'Input is already outstanding',
    )
    expect((await store.get(taskID))?.revision).toBe(1)
    expect(events).toHaveLength(1)
    await manager.dispose()
  })

  test('ask fails when the key is issued with different contents', async () => {
    const { store, manager, handle, taskID, events } = await started()
    void settleOf(handle.requestInput({ ask: { method: 'roots/list', params: { page: 1 } } }))
    await vi.waitFor(() => expect(events).toHaveLength(1))
    await expect(
      handle.requestInput({ ask: { method: 'roots/list', params: { page: 2 } } }),
    ).rejects.toBeInstanceOf(TaskInputKeyReusedError)
    expect((await store.get(taskID))?.revision).toBe(1)
    expect(events).toHaveLength(1)
    await manager.dispose()
  })

  test('ask fails with an aborted signal without writing', async () => {
    const { store, manager, handle, taskID, events } = await started()
    const reason = new Error('deadline')
    await expect(
      handle.requestInput({ ask: rootsRequest }, { signal: AbortSignal.abort(reason) }),
    ).rejects.toBe(reason)
    expect(await store.get(taskID)).toMatchObject({ revision: 0, inputs: [] })
    expect(events).toHaveLength(0)
    await manager.dispose()
  })

  test('a partial answer keeps the request open with the unanswered keys', async () => {
    const { store, manager, handle, taskID, events } = await started()
    void settleOf(handle.requestInput({ a: rootsRequest, b: rootsRequest }))
    await vi.waitFor(() => expect(events).toHaveLength(1))
    await manager.update(taskID, { a: rootsResponse })
    const saved = await store.get(taskID)
    expect(saved?.status).toBe('input_required')
    expect(saved?.inputs).toEqual([
      { id: 1, requests: { a: rootsRequest, b: rootsRequest }, responses: { a: rootsResponse } },
    ])
    expect(events).toHaveLength(2)
    expect((await manager.get(taskID)) as { inputRequests?: unknown }).toMatchObject({
      status: 'input_required',
      inputRequests: { b: rootsRequest },
    })
    expect(Object.keys((events[1] as { inputRequests: object }).inputRequests)).toEqual(['b'])
    await manager.dispose()
  })

  test('the final answer settles the request and resumes work', async () => {
    const { store, manager, handle, taskID, events } = await started()
    const pending = handle.requestInput({ a: rootsRequest, b: rootsRequest })
    await vi.waitFor(() => expect(events).toHaveLength(1))
    await manager.update(taskID, { a: rootsResponse })
    await manager.update(taskID, { b: rootsResponse })
    await expect(pending).resolves.toEqual({ a: rootsResponse, b: rootsResponse })
    const saved = await store.get(taskID)
    expect(saved?.status).toBe('working')
    expect(saved?.inputs).toEqual([
      {
        id: 1,
        requests: { a: rootsRequest, b: rootsRequest },
        responses: { a: rootsResponse, b: rootsResponse },
        outcome: 'answered',
      },
    ])
    expect(events).toHaveLength(3)
    expect(events[2]).not.toHaveProperty('inputRequests')
    await manager.dispose()
  })

  test.each([
    ['an unknown key', { stale: rootsResponse }, 'stale'],
    ['an answered key', { a: rootsResponse }, 'a'],
    ['a multi-key update with one stale key', { b: rootsResponse, a: rootsResponse }, 'a'],
  ] as const)('answer fails for %s', async (_name, responses, key) => {
    const { store, manager, handle, taskID, events } = await started()
    void settleOf(handle.requestInput({ a: rootsRequest, b: rootsRequest }))
    await vi.waitFor(() => expect(events).toHaveLength(1))
    await manager.update(taskID, { a: rootsResponse })
    const before = await store.get(taskID)
    await expect(manager.update(taskID, responses)).rejects.toMatchObject({
      code: -32602,
      message: `Task is not awaiting input for ${key}`,
      data: { key },
    })
    expect(await store.get(taskID)).toEqual(before)
    expect(events).toHaveLength(2)
    await manager.dispose()
  })

  test('answer fails for a withdrawn request', async () => {
    const { store, manager, handle, taskID, events } = await started()
    const controller = new AbortController()
    const pending = settleOf(
      handle.requestInput({ ask: rootsRequest }, { signal: controller.signal }),
    )
    await vi.waitFor(() => expect(events).toHaveLength(1))
    controller.abort(new Error('deadline'))
    await pending
    const before = await store.get(taskID)
    await expect(manager.update(taskID, { ask: rootsResponse })).rejects.toMatchObject({
      code: -32602,
      message: 'Task is not awaiting input for ask',
      data: { key: 'ask' },
    })
    expect(await store.get(taskID)).toEqual(before)
    expect(events).toHaveLength(2)
    await manager.dispose()
  })

  test('answer fails for a terminal task', async () => {
    const { store, manager, handle, taskID, events } = await started()
    const pending = settleOf(handle.requestInput({ ask: rootsRequest }))
    await vi.waitFor(() => expect(events).toHaveLength(1))
    await manager.cancel(taskID)
    await pending
    const before = await store.get(taskID)
    await expect(manager.update(taskID, { ask: rootsResponse })).rejects.toMatchObject({
      code: -32602,
      message: 'Task is not awaiting input for ask',
      data: { key: 'ask' },
    })
    expect(await store.get(taskID)).toEqual(before)
    expect(events).toHaveLength(2)
    await manager.dispose()
  })

  test('empty responses write nothing', async () => {
    const { store, manager, handle, taskID, events } = await started()
    void settleOf(handle.requestInput({ ask: rootsRequest }))
    await vi.waitFor(() => expect(events).toHaveLength(1))
    await manager.update(taskID, {})
    expect((await store.get(taskID))?.revision).toBe(1)
    expect(events).toHaveLength(1)
    await manager.dispose()
  })

  test('withdraw settles the request and rejects its waiter', async () => {
    const { store, manager, handle, taskID, events } = await started()
    const controller = new AbortController()
    const pending = handle.requestInput({ ask: rootsRequest }, { signal: controller.signal })
    await vi.waitFor(() => expect(events).toHaveLength(1))
    controller.abort(new Error('deadline'))
    const error = await pending.catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(InputRequestWithdrawnError)
    expect(error).toMatchObject({
      taskID,
      id: 1,
      message: `Input request 1 for task ${taskID} was withdrawn`,
    })
    const saved = await store.get(taskID)
    expect(saved?.status).toBe('working')
    expect(saved?.inputs).toEqual([
      { id: 1, requests: { ask: rootsRequest }, responses: {}, outcome: 'withdrawn' },
    ])
    expect(events).toHaveLength(2)
    await manager.dispose()
  })

  test('withdraw is a no-op after the request is answered', async () => {
    const { store, manager, handle, taskID, events } = await started()
    const controller = new AbortController()
    const pending = handle.requestInput({ ask: rootsRequest }, { signal: controller.signal })
    await vi.waitFor(() => expect(events).toHaveLength(1))
    await manager.update(taskID, { ask: rootsResponse })
    await expect(pending).resolves.toEqual({ ask: rootsResponse })
    controller.abort(new Error('deadline'))
    await tick()
    expect((await store.get(taskID))?.revision).toBe(2)
    expect(events).toHaveLength(2)
    await manager.dispose()
  })

  test('cancelling with a request open leaves inputs unchanged and rejects the waiter', async () => {
    const { store, manager, handle, taskID, events } = await started()
    const pending = handle.requestInput({ ask: rootsRequest })
    await vi.waitFor(() => expect(events).toHaveLength(1))
    await manager.cancel(taskID)
    await expect(pending).rejects.toThrow('Task cancelled')
    const saved = await store.get(taskID)
    expect(saved?.status).toBe('cancelled')
    expect(saved?.inputs).toEqual([{ id: 1, requests: { ask: rootsRequest }, responses: {} }])
    expect(events).toHaveLength(2)
    await manager.dispose()
  })
})

describe('input waiting and lifecycle', () => {
  test('answer committed before a waiter registers still resolves it', async () => {
    const { manager, handle, taskID, events } = await started()
    void settleOf(handle.requestInput({ ask: rootsRequest }))
    await vi.waitFor(() => expect(events).toHaveLength(1))
    await manager.update(taskID, { ask: rootsResponse })
    await expect(handle.requestInput({ ask: { method: 'roots/list' } })).resolves.toEqual({
      ask: rootsResponse,
    })
    await manager.dispose()
  })

  test('a re-ask with an undefined property matches the stored request', async () => {
    const { store, manager, handle, taskID, events } = await started({
      clientCapabilities: { elicitation: {} },
    })
    const ask = (): InputRequest => ({
      method: 'elicitation/create',
      params: {
        mode: 'form',
        message: 'Pick',
        requestedSchema: {
          type: 'object',
          properties: { value: { type: 'string', description: undefined } },
        },
      },
    })
    const first = handle.requestInput({ ask: ask() })
    await vi.waitFor(() => expect(events).toHaveLength(1))
    const again = handle.requestInput({ ask: ask() })
    const answer = { action: 'accept' as const, content: { value: 'Ada' } }
    await manager.update(taskID, { ask: answer })
    await expect(first).resolves.toEqual({ ask: answer })
    await expect(again).resolves.toEqual({ ask: answer })
    await expect(handle.requestInput({ ask: ask() })).resolves.toEqual({ ask: answer })
    expect((await store.get(taskID))?.inputs).toHaveLength(1)
    await manager.dispose()
  })

  test('a failed outcome read retries and settles with the committed outcome', async () => {
    const base = createMemoryTaskStore()
    const failure = new Error('Store unavailable')
    let failing = 0
    const store: TaskStore = {
      ...base,
      get: async (taskID) => {
        if (failing > 0) {
          failing--
          throw failure
        }
        return base.get(taskID)
      },
    }
    const { manager, handle, taskID, events, errors } = await started({ store })
    void settleOf(handle.requestInput({ ask: rootsRequest }))
    await vi.waitFor(() => expect(events).toHaveLength(1))
    await manager.update(taskID, { ask: rootsResponse })
    // The identical re-ask reads once to find the answered entry, then the outcome read fails
    // twice before the retry sees the committed answer.
    const originalGet = store.get
    let reads = 0
    store.get = async (id) => {
      reads++
      if (reads === 2) failing = 2
      return originalGet(id)
    }
    await expect(handle.requestInput({ ask: rootsRequest })).resolves.toEqual({
      ask: rootsResponse,
    })
    expect(errors).toEqual([
      { taskID, error: failure },
      { taskID, error: failure },
    ])
    await manager.dispose()
  })

  test('dispose ends the outcome read retry during persistent store failures', async () => {
    vi.useFakeTimers()
    try {
      const base = createMemoryTaskStore()
      const failure = new Error('Store unavailable')
      let failing = false
      const store: TaskStore = {
        ...base,
        get: async (taskID) => {
          if (failing) throw failure
          return base.get(taskID)
        },
        update: async (...args: Parameters<typeof base.update>) => {
          const updated = await base.update(...args)
          // Every read after the ask commits fails, so only the retry loop can observe it.
          if (updated.status === 'input_required') failing = true
          return updated
        },
      }
      const { manager, handle, errors } = await started({ store })
      const pending = settleOf(handle.requestInput({ ask: rootsRequest }))
      // Attempts at 0, 10, 30 and 70 ms, then a 80 ms backoff sleep is pending.
      await vi.advanceTimersByTimeAsync(75)
      expect(errors).toHaveLength(4)
      await manager.dispose()
      expect(await pending).toEqual({ error: new TaskManagerDisposedError() })
      expect(vi.getTimerCount()).toBe(0)
      await vi.advanceTimersByTimeAsync(5_000)
      expect(errors).toHaveLength(4)
    } finally {
      vi.useRealTimers()
    }
  })

  test('requestInput replays a withdrawn request', async () => {
    const { manager, handle, taskID, events } = await started()
    const controller = new AbortController()
    const first = settleOf(
      handle.requestInput({ ask: rootsRequest }, { signal: controller.signal }),
    )
    await vi.waitFor(() => expect(events).toHaveLength(1))
    controller.abort(new Error('deadline'))
    await first
    const error = await handle
      .requestInput({ ask: rootsRequest })
      .catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(InputRequestWithdrawnError)
    expect(error).toMatchObject({ taskID, id: 1 })
    await manager.dispose()
  })

  test('lastUpdatedAt strictly increases under a frozen clock', async () => {
    const fixed = Date.parse('2026-09-29T12:00:00Z')
    const { manager, handle, events } = await started({ now: () => fixed })
    await handle.setStatus('one')
    await handle.setStatus('two')
    await handle.setStatus('three')
    const stamps = events.map((event) => Date.parse(event.lastUpdatedAt))
    expect(stamps).toEqual([fixed + 1, fixed + 2, fixed + 3])
    await manager.dispose()
  })

  test('expiry rejects an open waiter with Task expired', async () => {
    let now = Date.parse('2026-09-29T12:00:00Z')
    const { manager, handle, taskID, events } = await started({ now: () => now, ttlMs: 1000 })
    const pending = handle.requestInput({ ask: rootsRequest })
    await vi.waitFor(() => expect(events).toHaveLength(1))
    now += 1001
    await expect(manager.get(taskID)).rejects.toMatchObject({ message: 'Task not found' })
    await expect(pending).rejects.toThrow('Task expired')
    await manager.dispose()
  })

  test('dispose rejects pending waiters', async () => {
    const { store, manager, handle, taskID, events } = await started()
    const first = handle.requestInput({ ask: rootsRequest })
    await vi.waitFor(() => expect(events).toHaveLength(1))
    const second = handle.requestInput({ ask: rootsRequest })
    await manager.dispose()
    await expect(first).rejects.toThrow('Task manager disposed')
    await expect(second).rejects.toThrow('Task manager disposed')
    expect((await store.get(taskID))?.status).toBe('input_required')
  })

  test('withdraw retries a failing store write', async () => {
    const base = createMemoryTaskStore()
    const failure = new Error('Store unavailable')
    let failures = 0
    const store: TaskStore = {
      ...base,
      update: async (...args: Parameters<typeof base.update>) => {
        if (args[1].inputs?.at(-1)?.outcome === 'withdrawn' && failures < 2) {
          failures++
          throw failure
        }
        return base.update(...args)
      },
    }
    const { manager, handle, taskID, events, errors } = await started({ store })
    const controller = new AbortController()
    const pending = handle.requestInput({ ask: rootsRequest }, { signal: controller.signal })
    await vi.waitFor(() => expect(events).toHaveLength(1))
    controller.abort(new Error('deadline'))
    await expect(pending).rejects.toBeInstanceOf(InputRequestWithdrawnError)
    expect(errors).toEqual([
      { taskID, error: failure },
      { taskID, error: failure },
    ])
    expect((await store.get(taskID))?.inputs.at(-1)?.outcome).toBe('withdrawn')
    await manager.dispose()
  })

  test('awaitInput with no open request throws No input is outstanding', async () => {
    const { manager, handle } = await started()
    await expect(handle.awaitInput()).rejects.toThrow('No input is outstanding')
    await manager.dispose()
  })
})
