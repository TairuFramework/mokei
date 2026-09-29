import { RPCError } from '@mokei/context-rpc'
import { describe, expect, test } from 'vitest'

import { createTaskManager, type TaskHandle, TaskInputKeyReusedError } from '../src/task-manager.js'
import { createMemoryTaskStore, type TaskRecord } from '../src/task-store.js'
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
    issuedInputKeys: [],
    ...patch,
  }
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('task manager', () => {
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

  test('reissued identical outstanding requests attach and other issued keys reject', async () => {
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
    await expect(handle.requestInput({ ask: rootsRequest })).rejects.toBeInstanceOf(
      TaskInputKeyReusedError,
    )
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

  test('withdraws aborted input while retaining issued keys', async () => {
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
    expect((await store.get(created.taskId))?.issuedInputKeys).toEqual(['ask'])
    await manager.update(created.taskId, { ask: rootsResponse })
    await expect(handle?.requestInput({ ask: rootsRequest })).rejects.toThrow()
    await manager.dispose()
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
    await expect(handle.checkpoint({ step: 3 })).rejects.toThrow()
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
      inputRequests: { ask: rootsRequest },
      issuedInputKeys: ['ask'],
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

  test('withdraws input with the supplied reason and lets work continue', async () => {
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
    expect(observed).toBe(reason)
    expect(await manager.get(created.taskId)).toMatchObject({ status: 'completed' })
    expect(await store.get(created.taskId)).toMatchObject({ issuedInputKeys: ['ask'] })
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

  test('ignores a stale update after input withdrawal while work continues', async () => {
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
    await manager.update(created.taskId, { ask: rootsResponse })
    expect(await store.get(created.taskId)).toMatchObject({
      status: 'working',
      issuedInputKeys: ['ask'],
    })
    expect((await store.get(created.taskId))?.inputResponses).toBeUndefined()
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
        if (
          args[1].inputResponses !== undefined &&
          Object.keys(args[1].inputResponses).length > 0
        ) {
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
