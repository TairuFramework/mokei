import { MethodNotInRevisionError } from '@mokei/context-client'
import { createMemoryTaskStore, createTaskManager, createTool } from '@mokei/context-server'
import { afterEach, describe, expect, test } from 'vitest'

import { ContextHost } from '../src/index.js'

function config() {
  return {
    name: 'tasks-server',
    version: '1.0.0',
    protocolVersions: ['2026-07-28' as const],
    tasks: createTaskManager({ store: createMemoryTaskStore(), pollIntervalMs: 10 }),
    tools: {
      work: createTool({
        description: 'Task-capable tool',
        inputSchema: { type: 'object' },
        handler: ({ task }) => {
          const done = { content: [{ type: 'text' as const, text: 'done' }] }
          return task == null ? done : task.run(async () => done)
        },
      }),
    },
  }
}

describe('host Tasks opt-in', () => {
  let host: ContextHost | undefined
  afterEach(async () => {
    await host?.dispose()
    host = undefined
  })

  test('default host gets a plain result and refuses task methods', async () => {
    host = new ContextHost()
    const client = host.addDirectContext({
      key: 'srv',
      protocolVersion: '2026-07-28',
      config: config(),
    })
    const result = await client.callTool({ name: 'work', arguments: {}, task: 'handle' })
    expect(result.resultType).not.toBe('task')
    expect(result).toMatchObject({ content: [{ type: 'text', text: 'done' }] })
    await expect(client.tasks.get('t1')).rejects.toBeInstanceOf(MethodNotInRevisionError)
  })

  test('tasks: true host gets the task path', async () => {
    host = new ContextHost({ tasks: true })
    const client = host.addDirectContext({
      key: 'srv',
      protocolVersion: '2026-07-28',
      config: config(),
    })
    const created = await client.callTool({ name: 'work', arguments: {}, task: 'handle' })
    expect(created.resultType).toBe('task')
    const taskID = (created as { taskId: string }).taskId
    const task = await client.tasks.get(taskID)
    expect(task.taskId).toBe(taskID)
  })
})
