import { createTaskManager, createTool } from '@mokei/context-server'
import { ContextHost } from '@mokei/host'
import { afterEach, expect, test } from 'vitest'

import { callMeta, readFlowDepth } from '../src/call-meta.js'
import {
  hostToolCaller,
  markDecisionFlowContext,
  ToolUnavailableError,
  unmarkDecisionFlowContext,
} from '../src/tool-caller.js'

const hosts: Array<ContextHost> = []
const managers: Array<ReturnType<typeof createTaskManager>> = []
const signal = new AbortController().signal
const inputSchema = { type: 'object' as const, properties: {} }
const outputSchema = { type: 'object' as const, properties: { ok: { type: 'boolean' as const } } }

function host() {
  const result = new ContextHost()
  hosts.push(result)
  return result
}

async function addEcho(target: ContextHost, key: string) {
  target.addDirectContext({
    key,
    protocolVersion: '2026-07-28',
    config: {
      name: key,
      version: '1.0.0',
      protocolVersions: ['2026-07-28'],
      tools: {
        echo: createTool({
          description: 'Echo call metadata',
          inputSchema,
          outputSchema,
          handler: ({ meta }) => ({
            content: [],
            structuredContent: { ok: meta['dev.mokei/flow-depth'] === 1 },
          }),
        }),
      },
    },
  })
  await target.setup({ key })
}

function params(id: string) {
  return { id, arguments: {}, meta: callMeta({ depth: 1, key: 'run:node', attempt: 2 }), signal }
}

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((item) => item.dispose()))
  await Promise.all(managers.splice(0).map((item) => item.dispose()))
})

test('lists enabled callable tools minus decision-flow contexts and allow never', async () => {
  const target = host()
  await Promise.all([
    addEcho(target, 'first'),
    addEcho(target, 'flow-a'),
    addEcho(target, 'flow-b'),
    addEcho(target, 'skipped'),
  ])
  target.addLocalTool({ name: 'local-echo', inputSchema, execute: () => ({ content: [] }) })
  markDecisionFlowContext(target, 'flow-a')
  markDecisionFlowContext(target, 'flow-b')
  const caller = hostToolCaller(target, { exclude: ['skipped'] })

  expect(caller.listTools()).toEqual([
    { id: 'first:echo', inputSchema, outputSchema },
    { id: 'local:local-echo', inputSchema },
  ])

  const firstTool = target.contexts.first?.tools[0]
  if (firstTool == null) throw new Error('Expected discovered tool')
  firstTool.allow = 'never'
  expect(caller.listTools().map((tool) => tool.id)).toEqual(['local:local-echo'])
  unmarkDecisionFlowContext(target, 'flow-a')
  expect(caller.listTools().map((tool) => tool.id)).toEqual(['flow-a:echo', 'local:local-echo'])
})

test('refuses a disabled tool at dispatch with tool_unavailable', async () => {
  const target = host()
  await addEcho(target, 'first')
  const caller = hostToolCaller(target)
  expect(caller.listTools().map((tool) => tool.id)).toEqual(['first:echo'])
  target.disableContextTools({ key: 'first', toolNames: ['echo'] })

  await expect(caller.callTool(params('first:echo'))).rejects.toMatchObject({
    code: 'tool_unavailable',
  })
  await expect(caller.callTool(params('first:echo'))).rejects.toBeInstanceOf(ToolUnavailableError)
})

test('removed context is tool_unavailable at dispatch', async () => {
  const target = host()
  await addEcho(target, 'first')
  const caller = hostToolCaller(target)
  await target.remove('first')

  await expect(caller.callTool(params('first:echo'))).rejects.toMatchObject({
    code: 'tool_unavailable',
  })
})

test('returns a task handle from a task sibling and waits for it', async () => {
  const target = host()
  const manager = createTaskManager()
  managers.push(manager)
  const gate = Promise.withResolvers<void>()
  target.addDirectContext({
    key: 'tasks',
    protocolVersion: '2026-07-28',
    config: {
      name: 'tasks',
      version: '1.0.0',
      protocolVersions: ['2026-07-28'],
      tasks: manager,
      tools: {
        work: createTool({
          description: 'Complete after release',
          inputSchema,
          handler: ({ task }) => {
            if (task == null) throw new Error('Expected task context')
            return task.run(async () => {
              await gate.promise
              return { content: [{ type: 'text' as const, text: 'complete' }] }
            })
          },
        }),
      },
    },
  })
  await target.setup({ key: 'tasks' })
  const caller = hostToolCaller(target)

  const outcome = await caller.callTool(params('tasks:work'))
  expect(outcome).toHaveProperty('task.taskId')
  if (!('task' in outcome)) throw new Error('Expected task handle')
  const waiting = caller.waitTask({ id: 'tasks:work', taskId: outcome.task.taskId, signal })
  gate.resolve()
  expect(await waiting).toMatchObject({ content: [{ type: 'text', text: 'complete' }] })
})

test('cancelTask sends tasks/cancel', async () => {
  const target = host()
  const manager = createTaskManager()
  managers.push(manager)
  target.addDirectContext({
    key: 'tasks',
    protocolVersion: '2026-07-28',
    config: {
      name: 'tasks',
      version: '1.0.0',
      protocolVersions: ['2026-07-28'],
      tasks: manager,
      tools: {
        work: createTool({
          description: 'Wait for cancellation',
          inputSchema,
          handler: ({ task }) => {
            if (task == null) throw new Error('Expected task context')
            return task.run(async (handle) => {
              await new Promise<void>((resolve) => {
                handle.signal.addEventListener('abort', () => resolve(), { once: true })
              })
              return { content: [] }
            })
          },
        }),
      },
    },
  })
  await target.setup({ key: 'tasks' })
  const caller = hostToolCaller(target)
  const outcome = await caller.callTool(params('tasks:work'))
  if (!('task' in outcome)) throw new Error('Expected task handle')

  await caller.cancelTask({ id: 'tasks:work', taskId: outcome.task.taskId })
  const tasks = target.contexts.tasks
  if (tasks == null) throw new Error('Expected tasks context')
  expect(await tasks.client.tasks.get(outcome.task.taskId)).toMatchObject({
    status: 'cancelled',
  })
})

test('local tool receives call meta', async () => {
  const target = host()
  target.addLocalTool({
    name: 'depth',
    inputSchema,
    execute: ({ meta }) => ({
      content: [{ type: 'text', text: String(meta['dev.mokei/flow-depth']) }],
    }),
  })

  expect(await hostToolCaller(target).callTool(params('local:depth'))).toEqual({
    result: { content: [{ type: 'text', text: '1' }] },
  })
})

test('remote tool receives call meta', async () => {
  const target = host()
  await addEcho(target, 'first')

  expect(await hostToolCaller(target).callTool(params('first:echo'))).toMatchObject({
    result: { content: [], structuredContent: { ok: true } },
  })
})

test('readFlowDepth accepts absence and non-negative integers only', () => {
  expect(readFlowDepth({})).toBe(0)
  expect(readFlowDepth({ 'dev.mokei/flow-depth': 2 })).toBe(2)
  for (const value of [-1, 1.5, 'x']) {
    expect(readFlowDepth({ 'dev.mokei/flow-depth': value })).toBeUndefined()
  }
})
