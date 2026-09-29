import { DirectTransports } from '@enkaku/transport'
import type { ClientMessage, ClientRequest, ServerMessage } from '@mokei/context-protocol'
import { META_SUBSCRIPTION_ID, TASKS_EXTENSION } from '@mokei/context-protocol'
import { defer } from '@sozai/async'
import { EventEmitter } from '@sozai/event'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { ContextServer, type ServerEvents } from '../src/server.js'
import { createSubscriptionHub } from '../src/subscriptions.js'
import { createTaskManager } from '../src/task-manager.js'
import type { TaskOwner } from '../src/task-store.js'

const alice: TaskOwner = { issuer: 'issuer', subject: 'alice', scopes: ['read'] }
const bob: TaskOwner = { issuer: 'issuer', subject: 'bob', scopes: ['read'] }
const tool = {
  description: 'test',
  inputSchema: { type: 'object' as const },
  handler: () => ({ content: [] }),
}
const meta = (declared: boolean) => ({
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': declared
    ? { extensions: { [TASKS_EXTENSION]: {} } }
    : {},
})
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.useRealTimers()
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
})

async function taskFor(owner: TaskOwner, tasks: ReturnType<typeof createTaskManager>) {
  const gate = defer<void>()
  const settled = defer<void>()
  const created = await tasks.create({
    toolName: 'test',
    tool,
    owner,
    clientCapabilities: {},
    work: async (handle) => {
      await gate.promise
      await handle.setStatus('ready')
      settled.resolve()
      return { content: [{ type: 'text' as const, text: 'done' }] }
    },
  })
  return { taskID: created.taskId, release: () => gate.resolve(), settled: settled.promise }
}

function setup(auth: TaskOwner & { expiresAt?: number }) {
  const tasks = createTaskManager()
  const hub = createSubscriptionHub({ events: new EventEmitter<ServerEvents>(), tasks })
  const transports = new DirectTransports<ServerMessage, ClientMessage>()
  const server = new ContextServer({
    name: 'test',
    version: '1.0.0',
    protocolVersions: ['2026-07-28'],
    transport: transports.server,
    tasks,
    subscriptionHub: hub,
    auth,
  })
  cleanup.push(
    () => tasks.dispose(),
    () => hub.dispose(),
    () => server.dispose(),
    () => transports.dispose(),
  )
  return { tasks, transports }
}

function listen(
  transports: DirectTransports<ServerMessage, ClientMessage>,
  taskIds: Array<string>,
  declared = true,
) {
  transports.client.write({
    jsonrpc: '2.0',
    id: 7,
    method: 'subscriptions/listen',
    params: { notifications: { taskIds }, _meta: meta(declared) },
  } as ClientRequest)
}

describe('task subscriptions', () => {
  test('rejects an undeclared task listen before acknowledgement', async () => {
    const { transports } = setup(alice)
    listen(transports, ['task'], false)
    const frame = await transports.client.read()
    expect(frame.value).toMatchObject({ error: { code: -32021 } })
  })

  test('acknowledges only accessible IDs and sends detailed status only for them', async () => {
    const { tasks, transports } = setup(alice)
    const accepted = await taskFor(alice, tasks)
    const rejected = await taskFor(bob, tasks)
    listen(transports, [accepted.taskID, rejected.taskID, 'missing'])
    const ack = await transports.client.read()
    expect(ack.value).toMatchObject({
      method: 'notifications/subscriptions/acknowledged',
      params: {
        notifications: { taskIds: [accepted.taskID] },
        _meta: { [META_SUBSCRIPTION_ID]: 7 },
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    rejected.release()
    await rejected.settled
    accepted.release()
    const frame = await transports.client.read()
    expect(frame.value).toMatchObject({
      method: 'notifications/tasks',
      params: {
        taskId: accepted.taskID,
        status: 'working',
        statusMessage: 'ready',
        createdAt: expect.any(String),
        lastUpdatedAt: expect.any(String),
        ttlMs: expect.any(Number),
      },
    })
  })

  test('expires an authenticated listen before a later task event', async () => {
    vi.useFakeTimers()
    const now = Date.now()
    const { tasks, transports } = setup({ ...alice, expiresAt: Math.ceil(now / 1000) + 2 })
    const task = await taskFor(alice, tasks)
    listen(transports, [task.taskID])
    const ack = await transports.client.read()
    expect(ack.value).toMatchObject({ method: 'notifications/subscriptions/acknowledged' })
    await vi.advanceTimersByTimeAsync(3_000)
    task.release()
    await task.settled
    const next = await transports.client.read()
    expect(next.value).not.toMatchObject({ method: 'notifications/tasks' })
  })
})
