import { DirectTransports } from '@enkaku/transport'
import type { ClientMessage, ClientRequest, ServerMessage } from '@mokei/context-protocol'
import {
  META_CLIENT_CAPABILITIES,
  META_PROTOCOL_VERSION,
  TASKS_EXTENSION,
} from '@mokei/context-protocol'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { createTool } from '../src/definitions.js'
import { ContextServer } from '../src/server.js'
import { createTaskManager, type TaskManager } from '../src/task-manager.js'
import { createMemoryTaskStore, type TaskOwner } from '../src/task-store.js'
import type { GenericToolDefinition } from '../src/types.js'

const declared = {
  [META_PROTOCOL_VERSION]: '2026-07-28',
  [META_CLIENT_CAPABILITIES]: {
    extensions: { [TASKS_EXTENSION]: {} },
    roots: {},
  },
}
const undeclared = {
  [META_PROTOCOL_VERSION]: '2026-07-28',
  [META_CLIENT_CAPABILITIES]: {},
}
const tool: GenericToolDefinition = {
  description: 'Task test tool',
  inputSchema: { type: 'object' },
  handler: () => ({ content: [] }),
}
const result = { content: [{ type: 'text' as const, text: 'done' }] }
const rootsRequest = { method: 'roots/list' as const }
const rootsResponse = { roots: [] }

type Response = {
  error?: { code: number; message: string; data?: unknown }
  result?: Record<string, unknown>
}

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
})

function setup(tasks?: TaskManager, auth?: TaskOwner, taskTool: GenericToolDefinition = tool) {
  const transports = new DirectTransports<ServerMessage, ClientMessage>()
  const server = new ContextServer({
    name: 'task-methods-test',
    version: '1.0.0',
    protocolVersions: ['2026-07-28'],
    tasks,
    auth,
    tools: { echo: taskTool },
    transport: transports.server,
  })
  cleanup.push(() => transports.dispose())
  if (tasks != null) cleanup.push(() => tasks.dispose())
  cleanup.push(() => server.dispose())
  let nextID = 0
  return async (method: string, params: Record<string, unknown>): Promise<Response> => {
    transports.client.write({ jsonrpc: '2.0', id: ++nextID, method, params } as ClientRequest)
    const frame = await transports.client.read()
    expect(frame.done).toBe(false)
    return frame.value as Response
  }
}

async function createTask(
  manager: TaskManager,
  work: Parameters<TaskManager['create']>[0]['work'],
) {
  return manager.create({
    toolName: 'echo',
    tool,
    clientCapabilities: { roots: {} },
    work,
  })
}

describe('task methods', () => {
  test('stores the verified request identity when creating a task', async () => {
    const store = createMemoryTaskStore()
    const manager = createTaskManager({ store })
    const auth = { issuer: 'https://issuer.example', subject: 'alice', scopes: ['read'] }
    let received: TaskOwner | undefined
    const request = setup(
      manager,
      auth,
      createTool({
        description: 'Task test tool',
        inputSchema: { type: 'object' },
        handler: ({ task, auth: verified }) => {
          received = verified
          if (task == null) throw new Error('Expected task context')
          return task.run(() => result)
        },
      }),
    )
    const response = await request('tools/call', {
      name: 'echo',
      arguments: {},
      _meta: declared,
    })
    expect(response.result?.resultType).toBe('task')
    const record = await store.get(response.result?.taskId as string)
    expect(record?.owner).toEqual(auth)
    expect(received).toEqual(auth)
  })

  test('stores only owner fields from full verifier auth', async () => {
    const store = createMemoryTaskStore()
    const manager = createTaskManager({ store })
    const auth = {
      issuer: 'https://issuer.example',
      subject: 'alice',
      scopes: ['read'],
      expiresAt: 1_800_000_000,
      raw: { claim: 1n },
    }
    const request = setup(
      manager,
      auth,
      createTool({
        description: 'Task test tool',
        inputSchema: { type: 'object' },
        handler: ({ task }) => {
          if (task == null) throw new Error('Expected task context')
          return task.run(() => result)
        },
      }),
    )
    const response = await request('tools/call', {
      name: 'echo',
      arguments: {},
      _meta: declared,
    })
    expect(response.error).toBeUndefined()
    expect(response.result?.resultType).toBe('task')
    const record = await store.get(response.result?.taskId as string)
    expect(record?.owner).toEqual({
      issuer: auth.issuer,
      subject: auth.subject,
      scopes: auth.scopes,
    })
  })

  test.each(['tasks/get', 'tasks/update', 'tasks/cancel'])(
    '%s hides tasks from a different identity or reduced scopes',
    async (method) => {
      const manager = createTaskManager()
      const owner = {
        issuer: 'https://issuer.example',
        subject: 'alice',
        scopes: ['read', 'write'],
      }
      const created = await manager.create({
        toolName: 'echo',
        tool,
        clientCapabilities: {},
        owner,
        work: () => result,
      })
      for (const auth of [
        { ...owner, subject: 'bob' },
        { ...owner, issuer: 'https://other.example' },
        { ...owner, scopes: ['read'] },
        undefined,
      ]) {
        const request = setup(manager, auth)
        const response = await request(method, {
          taskId: created.taskId,
          ...(method === 'tasks/update' && { inputResponses: {} }),
          _meta: declared,
        })
        expect(response.error).toMatchObject({ code: -32602, message: 'Task not found' })
      }
      const request = setup(manager, { ...owner, scopes: [...owner.scopes, 'extra'] })
      const response = await request(method, {
        taskId: created.taskId,
        ...(method === 'tasks/update' && { inputResponses: {} }),
        _meta: declared,
      })
      expect(response.error).toBeUndefined()
    },
  )

  test('an authenticated caller cannot access an ownerless task', async () => {
    const manager = createTaskManager()
    const created = await createTask(manager, () => result)
    const owner = { issuer: 'https://issuer.example', subject: 'alice', scopes: ['read'] }
    const response = await setup(manager, owner)('tasks/get', {
      taskId: created.taskId,
      _meta: declared,
    })
    expect(response.error).toMatchObject({ code: -32602, message: 'Task not found' })
  })
  test.each(['tasks/get', 'tasks/update', 'tasks/cancel'])(
    '%s is unavailable without a manager',
    async (method) => {
      const request = setup()
      const response = await request(method, {
        taskId: crypto.randomUUID(),
        ...(method === 'tasks/update' && { inputResponses: {} }),
        _meta: declared,
      })
      expect(response.error?.code).toBe(-32601)
    },
  )

  test.each(['tasks/get', 'tasks/update', 'tasks/cancel'])(
    '%s checks the declared extension before task lookup',
    async (method) => {
      const request = setup(createTaskManager())
      const response = await request(method, {
        taskId: crypto.randomUUID(),
        ...(method === 'tasks/update' && { inputResponses: {} }),
        _meta: undeclared,
      })
      expect(response.error).toMatchObject({
        code: -32021,
        data: { requiredCapabilities: { extensions: { [TASKS_EXTENSION]: {} } } },
      })
    },
  )

  test.each(['tasks/get', 'tasks/update', 'tasks/cancel'])(
    '%s hides missing task IDs',
    async (method) => {
      const request = setup(createTaskManager())
      const response = await request(method, {
        taskId: crypto.randomUUID(),
        ...(method === 'tasks/update' && { inputResponses: {} }),
        _meta: declared,
      })
      expect(response.error).toMatchObject({ code: -32602, message: 'Task not found' })
    },
  )

  test('tasks/get returns the detailed status and completed result', async () => {
    const gate = Promise.withResolvers<void>()
    const manager = createTaskManager()
    const request = setup(manager)
    const created = await createTask(manager, async () => {
      await gate.promise
      return result
    })
    expect(
      (await request('tasks/get', { taskId: created.taskId, _meta: declared })).result,
    ).toMatchObject({
      resultType: 'complete',
      taskId: created.taskId,
      status: 'working',
      createdAt: created.createdAt,
      ttlMs: created.ttlMs,
    })
    gate.resolve()
    await vi.waitFor(async () => {
      expect((await manager.get(created.taskId)).status).toBe('completed')
    })
    expect(
      (await request('tasks/get', { taskId: created.taskId, _meta: declared })).result,
    ).toMatchObject({
      resultType: 'complete',
      status: 'completed',
      result: { ...result, resultType: 'complete' },
    })
  })

  test('tasks/update preserves inputResponses and acknowledges a completed input', async () => {
    const manager = createTaskManager()
    const request = setup(manager)
    const created = await createTask(manager, async (handle) => {
      await handle.requestInput({ ask: rootsRequest })
      return result
    })
    await vi.waitFor(async () => {
      expect((await manager.get(created.taskId)).status).toBe('input_required')
    })
    expect(
      (await request('tasks/get', { taskId: created.taskId, _meta: declared })).result,
    ).toMatchObject({
      status: 'input_required',
      inputRequests: { ask: rootsRequest },
    })
    const updated = await request('tasks/update', {
      taskId: created.taskId,
      inputResponses: { ask: rootsResponse },
      _meta: declared,
    })
    expect(updated.error).toBeUndefined()
    expect(updated.result).toMatchObject({ resultType: 'complete' })
    await vi.waitFor(async () => {
      expect((await manager.get(created.taskId)).status).toBe('completed')
    })
  })

  test('tasks/update rejects a response of the wrong kind', async () => {
    const manager = createTaskManager()
    const request = setup(manager)
    const created = await createTask(manager, async (handle) => {
      await handle.requestInput({ ask: rootsRequest })
      return result
    })
    await vi.waitFor(async () => {
      expect((await manager.get(created.taskId)).status).toBe('input_required')
    })
    const response = await request('tasks/update', {
      taskId: created.taskId,
      inputResponses: { ask: { action: 'decline' } },
      _meta: declared,
    })
    expect(response.error?.code).toBe(-32602)
    expect((await manager.get(created.taskId)).status).toBe('input_required')
    await request('tasks/cancel', { taskId: created.taskId, _meta: declared })
  })

  test('tasks/update merges racing partial responses and rejects stale keys', async () => {
    const store = createMemoryTaskStore()
    const manager = createTaskManager({ store })
    const request = setup(manager)
    const created = await createTask(manager, async (handle) => {
      await handle.requestInput({ a: rootsRequest, b: rootsRequest })
      return result
    })
    await vi.waitFor(async () => {
      expect((await manager.get(created.taskId)).status).toBe('input_required')
    })
    await Promise.all([
      request('tasks/update', {
        taskId: created.taskId,
        inputResponses: { a: rootsResponse },
        _meta: declared,
      }),
      request('tasks/update', {
        taskId: created.taskId,
        inputResponses: { b: rootsResponse },
        _meta: declared,
      }),
    ])
    await vi.waitFor(async () => {
      expect((await manager.get(created.taskId)).status).toBe('completed')
    })
    expect((await store.get(created.taskId))?.inputs).toEqual([
      {
        id: 1,
        requests: { a: rootsRequest, b: rootsRequest },
        responses: { a: rootsResponse, b: rootsResponse },
        outcome: 'answered',
      },
    ])
    const stale = await request('tasks/update', {
      taskId: created.taskId,
      inputResponses: { a: rootsResponse },
      _meta: declared,
    })
    expect(stale.error).toMatchObject({
      code: -32602,
      message: 'Task is not awaiting input for a',
    })
  })

  test('tasks/update keeps partial input outstanding and rejects an answered key', async () => {
    const manager = createTaskManager()
    const request = setup(manager)
    const created = await createTask(manager, async (handle) => {
      await handle.requestInput({ a: rootsRequest, b: rootsRequest })
      return result
    })
    await vi.waitFor(async () => {
      expect((await manager.get(created.taskId)).status).toBe('input_required')
    })
    await request('tasks/update', {
      taskId: created.taskId,
      inputResponses: { a: rootsResponse },
      _meta: declared,
    })
    expect((await manager.get(created.taskId)).status).toBe('input_required')
    const second = await request('tasks/update', {
      taskId: created.taskId,
      inputResponses: { a: { action: 'decline' }, b: rootsResponse },
      _meta: declared,
    })
    expect(second.error).toMatchObject({
      code: -32602,
      message: 'Task is not awaiting input for a',
    })
    expect((await manager.get(created.taskId)).status).toBe('input_required')
    await request('tasks/update', {
      taskId: created.taskId,
      inputResponses: { b: rootsResponse },
      _meta: declared,
    })
    await vi.waitFor(async () => {
      expect((await manager.get(created.taskId)).status).toBe('completed')
    })
  })

  test('tasks/update rejects keys absent from outstanding input', async () => {
    const manager = createTaskManager()
    const request = setup(manager)
    const created = await createTask(manager, async (handle) => {
      await handle.requestInput({ ask: rootsRequest })
      return result
    })
    await vi.waitFor(async () => {
      expect((await manager.get(created.taskId)).status).toBe('input_required')
    })
    const response = await request('tasks/update', {
      taskId: created.taskId,
      inputResponses: { stale: rootsResponse },
      _meta: declared,
    })
    expect(response.error).toMatchObject({
      code: -32602,
      message: 'Task is not awaiting input for stale',
    })
    expect((await manager.get(created.taskId)).status).toBe('input_required')
    await request('tasks/cancel', { taskId: created.taskId, _meta: declared })
  })

  test('tasks/cancel acknowledges a cancellation and leaves completed tasks unchanged', async () => {
    const gate = Promise.withResolvers<void>()
    const manager = createTaskManager()
    const request = setup(manager)
    let workerSignal: AbortSignal | undefined
    const created = await createTask(manager, async (handle) => {
      workerSignal = handle.signal
      await gate.promise
      return result
    })
    const cancelled = await request('tasks/cancel', { taskId: created.taskId, _meta: declared })
    expect(cancelled.result).toMatchObject({ resultType: 'complete' })
    expect(workerSignal?.aborted).toBe(true)
    gate.resolve()
    await vi.waitFor(async () => {
      expect((await manager.get(created.taskId)).status).toBe('cancelled')
    })
    const again = await request('tasks/cancel', { taskId: created.taskId, _meta: declared })
    expect(again.result).toMatchObject({ resultType: 'complete' })

    const completed = await createTask(manager, () => result)
    await vi.waitFor(async () => {
      expect((await manager.get(completed.taskId)).status).toBe('completed')
    })
    expect(
      (await request('tasks/cancel', { taskId: completed.taskId, _meta: declared })).result,
    ).toMatchObject({ resultType: 'complete' })
    expect((await manager.get(completed.taskId)).status).toBe('completed')
  })

  test('tasks/update rejects requestState at the request schema', async () => {
    const manager = createTaskManager()
    const request = setup(manager)
    const response = await request('tasks/update', {
      taskId: crypto.randomUUID(),
      inputResponses: {},
      requestState: 'not allowed',
      _meta: declared,
    })
    expect(response.error?.code).toBe(-32600)
  })
})
