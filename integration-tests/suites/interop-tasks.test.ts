import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { resultFromTaskOutcome } from '@modelcontextprotocol/ext-tasks/client'
import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  createSDKTasksFixture,
  type SDKTasksFixture,
} from '../support/interop/sdk-tasks-fixture.ts'
import {
  createSDKClient,
  SDK_STDIO_SERVER_TASKS_PATH,
  startMokeiTasksHTTPServer,
  type TasksHTTPServer,
} from '../support/interop/servers.ts'
import {
  TASK_CANCEL_TOOL,
  TASK_COMPLETE_TOOL,
  TASK_INPUT_TOOL,
  taskResult,
} from '../support/interop/tasks-fixture.ts'

const capabilities = {
  elicitation: {},
  extensions: { 'io.modelcontextprotocol/tasks': {} },
}

type Harness = {
  client: ReturnType<typeof createSDKClient>
  fixture: SDKTasksFixture
  releaseCompletion: () => void
  dispose: () => Promise<void>
}

const rows = [
  {
    name: 'stdio',
    setup: async (): Promise<Harness> => {
      const client = createSDKClient('2026-07-28', capabilities)
      await client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [SDK_STDIO_SERVER_TASKS_PATH],
        }),
      )
      const fixture = createSDKTasksFixture(client)
      return {
        client,
        fixture,
        releaseCompletion: () => {},
        dispose: async () => {
          await fixture.dispose()
          await client.close()
        },
      }
    },
  },
  {
    name: 'Streamable HTTP',
    setup: async (): Promise<Harness> => {
      const server: TasksHTTPServer = await startMokeiTasksHTTPServer(undefined, 10)
      const client = createSDKClient('2026-07-28', capabilities)
      await client.connect(new StreamableHTTPClientTransport(new URL(server.url)))
      const fixture = createSDKTasksFixture(client)
      return {
        client,
        fixture,
        releaseCompletion: server.releaseCompletion,
        dispose: async () => {
          server.releaseCompletion()
          await fixture.dispose()
          await client.close()
          await server.dispose()
        },
      }
    },
  },
] as const

describe.each(rows)('SDK Tasks client against mokei over $name', (row) => {
  let harness: Harness | undefined

  afterEach(async () => {
    await harness?.dispose()
    harness = undefined
  })

  test('creates a task, reads status, and receives its final tool result', async () => {
    harness = await row.setup()
    expect(harness.fixture.session.capabilities.execution).toBe(true)
    const execution = await harness.fixture.session.callTool(
      TASK_COMPLETE_TOOL,
      {},
      {
        task: { preference: 'require' },
      },
    )
    expect(execution.kind).toBe('task')
    if (execution.kind !== 'task') throw new Error('Expected a task execution')
    expect(execution.handle.taskId).toBeTruthy()
    expect(harness.fixture.received).toContainEqual(
      expect.objectContaining({
        result: expect.objectContaining({
          taskId: execution.handle.taskId,
          status: 'working',
          resultType: 'task',
        }),
      }),
    )
    const snapshot = await harness.fixture.session.task(execution.handle.taskId).snapshot()
    expect(snapshot.taskId).toBe(execution.handle.taskId)
    expect(['working', 'completed']).toContain(snapshot.status)
    harness.releaseCompletion()
    const result = resultFromTaskOutcome((await execution.settle()).outcome)
    expect(result).toMatchObject(taskResult('completed'))
    expect((await harness.fixture.session.task(execution.handle.taskId).snapshot()).status).toBe(
      'completed',
    )
    expect(harness.fixture.sent).toContainEqual(expect.objectContaining({ method: 'tasks/get' }))
  })

  test('answers an elicitation input and returns the completed task result', async () => {
    harness = await row.setup()
    const execution = await harness.fixture.session.callTool(
      TASK_INPUT_TOOL,
      {},
      {
        task: { preference: 'require' },
      },
    )
    expect(execution.kind).toBe('task')
    const result = resultFromTaskOutcome((await execution.settle()).outcome)
    expect(result).toMatchObject(taskResult('hello: Ada'))
    expect(harness.fixture.received).toContainEqual(
      expect.objectContaining({
        result: expect.objectContaining({ status: 'input_required' }),
      }),
    )
    expect(harness.fixture.sent).toContainEqual(expect.objectContaining({ method: 'tasks/update' }))
  })

  test('cancels a task and receives its status on a task listen', async () => {
    harness = await row.setup()
    const execution = await harness.fixture.session.callTool(
      TASK_CANCEL_TOOL,
      {},
      {
        task: { preference: 'require' },
      },
    )
    expect(execution.kind).toBe('task')
    if (execution.kind !== 'task') throw new Error('Expected a task execution')
    const id = execution.handle.taskId
    // SDK 2.1.0 has no taskIds in its SubscriptionFilter type, but forwards extension fields.
    const subscription = await harness.client.listen({ taskIds: [id] } as Parameters<
      typeof harness.client.listen
    >[0])
    try {
      expect(harness.fixture.received).toContainEqual(
        expect.objectContaining({
          method: 'notifications/subscriptions/acknowledged',
          params: expect.objectContaining({ notifications: { taskIds: [id] } }),
        }),
      )
      await execution.cancel()
      expect(harness.fixture.sent).toContainEqual(
        expect.objectContaining({ method: 'tasks/cancel' }),
      )
      expect((await harness.fixture.session.task(id).snapshot()).status).toBe('cancelled')
      await vi.waitFor(() =>
        expect(harness?.fixture.received).toContainEqual(
          expect.objectContaining({
            method: 'notifications/tasks',
            params: expect.objectContaining({ taskId: id, status: 'cancelled' }),
          }),
        ),
      )
    } finally {
      await subscription.close()
    }
  })
})
