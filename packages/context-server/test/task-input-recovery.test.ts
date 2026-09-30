import type { InputRequest, InputResponse } from '@mokei/context-protocol'
import { describe, expect, test } from 'vitest'

import {
  createTaskManager,
  InputRequestWithdrawnError,
  type TaskHandle,
  TaskInputKeyReusedError,
  type TaskManager,
} from '../src/task-manager.js'
import { createMemoryTaskStore, type TaskStore } from '../src/task-store.js'
import type { GenericToolDefinition } from '../src/types.js'

const tool: GenericToolDefinition = {
  description: 'Test tool',
  inputSchema: { type: 'object' },
  handler: () => ({ content: [] }),
}
const rootsRequest = { method: 'roots/list' as const }
const rootsResponse = { roots: [{ uri: 'file:///answer' }] }
const result = { content: [{ type: 'text' as const, text: 'done' }] }

/** Starts a task whose worker asks once, then hangs so the task stays active across restart. */
async function startTask(
  store: TaskStore,
  signal?: AbortSignal,
): Promise<{ manager: TaskManager; taskID: string; input: Promise<unknown> }> {
  const manager = createTaskManager({ store })
  let input: Promise<unknown> | undefined
  const created = await manager.create({
    toolName: 'echo',
    tool,
    clientCapabilities: { roots: {} },
    work: (task) => {
      input = task.requestInput({ ask: rootsRequest }, { signal })
      // The first instance's waiter rejects on disposal.
      input.catch(() => {})
      return new Promise(() => {})
    },
  })
  await expect.poll(async () => (await store.get(created.taskId))?.status).toBe('input_required')
  return { manager, taskID: created.taskId, input: input as Promise<unknown> }
}

/**
 * Recovers the task on a second instance whose worker repeats `requests`. With a `signal`, the
 * worker hangs once the input settles either way, so every write comes from the input lifecycle.
 */
async function recoverTask(
  store: TaskStore,
  requests: Record<string, InputRequest>,
  signal?: AbortSignal,
): Promise<{ manager: TaskManager; input: Promise<Record<string, InputResponse>> }> {
  // Wrapped, so resolving does not adopt the input promise's own outcome.
  const started = Promise.withResolvers<{ input: Promise<Record<string, InputResponse>> }>()
  const manager = createTaskManager({
    store,
    recover: async (_record, resume) => {
      await resume(async (task: TaskHandle) => {
        const input = task.requestInput(requests, { signal })
        started.resolve({ input })
        if (signal !== undefined) {
          await input.catch(() => {})
          await new Promise(() => {})
        }
        await input
        return result
      })
    },
  })
  await manager.recover({ echo: tool })
  return { manager, input: (await started.promise).input }
}

describe('task input recovery', () => {
  test('answered before restart replays the stored responses', async () => {
    const store = createMemoryTaskStore()
    const first = await startTask(store)
    await first.manager.update(first.taskID, { ask: rootsResponse })
    await expect(first.input).resolves.toEqual({ ask: rootsResponse })
    await first.manager.dispose()

    const second = await recoverTask(store, { ask: rootsRequest })
    await expect(second.input).resolves.toEqual({ ask: rootsResponse })
    await expect.poll(async () => (await store.get(first.taskID))?.status).toBe('completed')
    expect((await store.get(first.taskID))?.inputs).toEqual([
      {
        id: 1,
        requests: { ask: rootsRequest },
        responses: { ask: rootsResponse },
        outcome: 'answered',
      },
    ])
    await second.manager.dispose()
  })

  test('withdrawn before restart replays InputRequestWithdrawnError', async () => {
    const store = createMemoryTaskStore()
    const controller = new AbortController()
    const first = await startTask(store, controller.signal)
    controller.abort(new Error('deadline'))
    await expect(first.input).rejects.toBeInstanceOf(InputRequestWithdrawnError)
    await first.manager.dispose()

    const second = await recoverTask(store, { ask: rootsRequest })
    const error = await second.input.catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(InputRequestWithdrawnError)
    expect(error).toMatchObject({ taskID: first.taskID, id: 1 })
    expect((await store.get(first.taskID))?.inputs).toEqual([
      { id: 1, requests: { ask: rootsRequest }, responses: {}, outcome: 'withdrawn' },
    ])
    await second.manager.dispose()
  })

  test('open at restart re-attaches and resolves on a later update', async () => {
    const store = createMemoryTaskStore()
    const first = await startTask(store)
    await first.manager.dispose()

    const second = await recoverTask(store, { ask: rootsRequest })
    expect((await second.manager.get(first.taskID)).status).toBe('input_required')
    await second.manager.update(first.taskID, { ask: rootsResponse })
    await expect(second.input).resolves.toEqual({ ask: rootsResponse })
    await expect.poll(async () => (await second.manager.get(first.taskID)).status).toBe('completed')
    // Re-attaching made no new request.
    expect((await store.get(first.taskID))?.inputs).toHaveLength(1)
    await second.manager.dispose()
  })

  test('changed request under an issued key throws TaskInputKeyReusedError', async () => {
    const store = createMemoryTaskStore()
    const first = await startTask(store)
    await first.manager.dispose()

    const changed: InputRequest = {
      method: 'elicitation/create',
      params: {
        mode: 'form',
        message: 'Pick',
        requestedSchema: { type: 'object', properties: {} },
      },
    }
    const second = await recoverTask(store, { ask: changed })
    await expect(second.input).rejects.toThrow(new TaskInputKeyReusedError('ask'))
    expect((await store.get(first.taskID))?.inputs).toEqual([
      { id: 1, requests: { ask: rootsRequest }, responses: {} },
    ])
    await second.manager.dispose()
  })

  describe('deadline passed during downtime', () => {
    const deadline = new Error('deadline')

    test('answered: resolves with the stored responses without writing', async () => {
      const store = createMemoryTaskStore()
      const first = await startTask(store)
      await first.manager.update(first.taskID, { ask: rootsResponse })
      await first.manager.dispose()
      const before = await store.get(first.taskID)

      const second = await recoverTask(store, { ask: rootsRequest }, AbortSignal.abort(deadline))
      await expect(second.input).resolves.toEqual({ ask: rootsResponse })
      expect(await store.get(first.taskID)).toEqual(before)
      await second.manager.dispose()
    })

    test('withdrawn: rejects with InputRequestWithdrawnError without writing', async () => {
      const store = createMemoryTaskStore()
      const controller = new AbortController()
      const first = await startTask(store, controller.signal)
      controller.abort(deadline)
      await expect(first.input).rejects.toBeInstanceOf(InputRequestWithdrawnError)
      await first.manager.dispose()
      const before = await store.get(first.taskID)

      const second = await recoverTask(store, { ask: rootsRequest }, AbortSignal.abort(deadline))
      await expect(second.input).rejects.toMatchObject({ taskID: first.taskID, id: 1 })
      await expect(second.input).rejects.toBeInstanceOf(InputRequestWithdrawnError)
      expect(await store.get(first.taskID)).toEqual(before)
      await second.manager.dispose()
    })

    test('open: withdraws the request and rejects with InputRequestWithdrawnError', async () => {
      const store = createMemoryTaskStore()
      const first = await startTask(store)
      await first.manager.dispose()

      // The same request re-attaches, the aborted signal withdraws it, and the waiter reports
      // the committed outcome (spec requestInput steps 1-3); the abort reason is only thrown for a
      // request that was never issued.
      const second = await recoverTask(store, { ask: rootsRequest }, AbortSignal.abort(deadline))
      await expect(second.input).rejects.toMatchObject({ taskID: first.taskID, id: 1 })
      await expect(second.input).rejects.toBeInstanceOf(InputRequestWithdrawnError)
      const stored = await store.get(first.taskID)
      expect(stored?.status).toBe('working')
      expect(stored?.inputs).toEqual([
        { id: 1, requests: { ask: rootsRequest }, responses: {}, outcome: 'withdrawn' },
      ])
      await second.manager.dispose()
    })
  })
})
