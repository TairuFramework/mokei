import { DirectTransports } from '@enkaku/transport'
import { ContextClient, TaskCancelledError } from '@mokei/context-client'
import type { ClientMessage, ServerMessage } from '@mokei/context-protocol'
import type { JSONValue, TaskHandle } from '@mokei/context-server'
import { ContextServer, createTaskManager } from '@mokei/context-server'
import { createFlowGraph, type FlowDefinition } from '@sozai/flow-graph'
import { expect, test } from 'vitest'

import { type ResumeDataV1, startRun } from '../src/driver.js'
import { createDecisionFlowServer } from '../src/server.js'
import type { ToolCaller } from '../src/tool-caller.js'
import { toolKind } from '../src/tool-node.js'

const tool = { id: 'sibling:work', inputSchema: { type: 'object' as const } }
const result = { content: [{ type: 'text' as const, text: 'done' }] }

function definition(kind: 'end' | 'tool' = 'end'): FlowDefinition {
  return {
    id: 'driver-test',
    name: 'Driver test',
    version: 1,
    start: kind === 'end' ? 'done' : 'work',
    nodes: {
      ...(kind === 'tool'
        ? { work: { kind: 'tool' as const, tool: tool.id, args: {}, next: 'done' } }
        : {}),
      done: { kind: 'end', outcome: 'finished', output: { answer: { value: 42 } } },
    },
  }
}

function harness(
  options: {
    definition?: FlowDefinition
    caller?: Partial<ToolCaller>
    checkpoint?: (data: ResumeDataV1) => Promise<void>
    depth?: number
  } = {},
) {
  const flow = options.definition ?? definition()
  const abort = new AbortController()
  const checkpoints: Array<ResumeDataV1> = []
  const statuses: Array<string> = []
  const cancelled: Array<{ id: string; taskId: string }> = []
  const caller: ToolCaller = {
    listTools: () => [tool],
    callTool: async () => ({ result }),
    waitTask: async () => result,
    cancelTask: async (params) => {
      cancelled.push(params)
    },
    ...options.caller,
  }
  const graph = createFlowGraph({
    kinds: [
      toolKind({
        caller,
        catalogue: [tool],
        depth: options.depth ?? 0,
        approved: new Set([tool.id]),
      }),
    ],
  })
  const run = graph.start({ definition: flow, signal: abort.signal, runID: 'run-1' })
  const resumeData: ResumeDataV1 = {
    v: 1,
    flow: { definition: flow },
    approved: [tool.id],
    depth: options.depth ?? 0,
    runState: run.getState(),
    siblings: [],
  }
  const handle: TaskHandle = {
    taskID: 'task-1',
    signal: abort.signal,
    requestMeta: {},
    setStatus: async (message) => {
      statuses.push(message)
    },
    checkpoint: async (data: JSONValue) => {
      const snapshot = structuredClone(data) as unknown as ResumeDataV1
      checkpoints.push(snapshot)
      await options.checkpoint?.(snapshot)
    },
    requestInput: async () => {
      throw new Error('unexpected input')
    },
    awaitInput: async () => {
      throw new Error('unexpected input')
    },
    cancel: async () => {
      abort.abort()
      return true
    },
  }
  const drive = () => startRun({ handle, graph, run, definition: flow, resumeData, caller })
  return {
    flow,
    drive,
    abort,
    checkpoints,
    statuses,
    cancelled,
    resumeData,
    handle,
    caller,
    graph,
    run,
  }
}

test('inline end checkpoints committed state and returns its output', async () => {
  const h = harness()
  const completed = await h.drive()
  expect(completed.structuredContent).toEqual({ outcome: 'finished', output: { answer: 42 } })
  expect(h.checkpoints.at(-1)?.runState.status).toBe('ended')
  expect(h.statuses).toContain('Running node done')
})

test.each(['run_flow', 'flow_driver_test'])(
  '%s completes through the server with the resolved definition',
  async (name) => {
    const pair = new DirectTransports<ServerMessage, ClientMessage>()
    const tasks = createTaskManager()
    const flow = definition()
    const serverDefinition = createDecisionFlowServer({
      caller: {
        listTools: () => [],
        callTool: async () => {
          throw new Error('unexpected tool')
        },
        waitTask: async () => {
          throw new Error('unexpected wait')
        },
        cancelTask: async () => {},
      },
      predictor: {
        predict: async () => {
          throw new Error('unexpected predict')
        },
      },
      tasks,
      flows: [flow],
      approval: () => ({ tools: [] }),
    })
    const server = new ContextServer({ ...serverDefinition.config, transport: pair.server })
    const client = new ContextClient({ protocolVersion: '2026-07-28', transport: pair.client })
    try {
      const started = await client.callTool({
        name,
        arguments: name === 'run_flow' ? { definition: flow } : {},
        task: 'handle',
      })
      expect(started.resultType).toBe('task')
      if (started.resultType !== 'task' || typeof started.taskId !== 'string') return
      expect(await client.tasks.wait(started.taskId)).toMatchObject({
        structuredContent: { outcome: 'finished', output: { answer: 42 } },
      })
    } finally {
      await client.dispose()
      await server.dispose()
      await tasks.dispose()
      await pair.dispose()
    }
  },
)

test('a registered definition resumes a sibling task before ending', async () => {
  const h = harness({
    definition: definition('tool'),
    caller: {
      callTool: async () => ({ task: { taskId: 'sibling-1' } }),
      waitTask: async () => result,
    },
  })
  h.resumeData.flow = { id: h.flow.id, digest: 'registered' }
  const completed = await h.drive()
  expect(completed.structuredContent).toEqual({ outcome: 'finished', output: { answer: 42 } })
  expect(
    h.checkpoints.some((entry) => entry.siblings.some((sibling) => sibling.taskId === 'sibling-1')),
  ).toBe(true)
  expect(h.checkpoints.at(-1)?.siblings).toEqual([])
})

test('a flow error completes as an isError result', async () => {
  const flow = definition('tool')
  const h = harness({
    definition: flow,
    caller: {
      callTool: async () => {
        throw new Error('transport failed')
      },
    },
  })
  const completed = await h.drive()
  expect(completed.isError).toBe(true)
  expect(completed.structuredContent?.error).toMatchObject({ node: 'work' })
  expect(h.checkpoints.at(-1)?.runState.status).toBe('error')
})

test.each(['node_error', 'total_timeout'] as const)(
  '%s cancels every recorded sibling',
  async (reason) => {
    const h = harness()
    h.resumeData.runState = {
      ...h.resumeData.runState,
      status: 'error',
      error: {
        code: 'node_failed',
        name: 'FlowNodeFailure',
        reason: reason === 'total_timeout' ? 'total_timeout' : 'non_retryable',
      },
    }
    h.resumeData.siblings.push(
      { tool: tool.id, taskId: 'sibling-1' },
      { tool: tool.id, taskId: 'sibling-2' },
    )
    const completed = await h.drive()
    expect(completed.isError).toBe(true)
    expect(h.cancelled).toEqual([
      { id: tool.id, taskId: 'sibling-1' },
      { id: tool.id, taskId: 'sibling-2' },
    ])
  },
)

test('client cancellation cancels every outstanding sibling task', async () => {
  let waiting!: () => void
  const entered = new Promise<void>((resolve) => {
    waiting = resolve
  })
  const h = harness({
    definition: definition('tool'),
    caller: {
      callTool: async () => ({ task: { taskId: 'sibling-1' } }),
      waitTask: async ({ signal }) => {
        waiting()
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
        )
        return result
      },
    },
  })
  h.resumeData.siblings.push({ tool: tool.id, taskId: 'sibling-2' })
  const work = h.drive()
  await entered
  h.abort.abort(new Error('client cancelled'))
  await work.catch(() => {})
  expect(h.cancelled).toEqual([
    { id: tool.id, taskId: 'sibling-2' },
    { id: tool.id, taskId: 'sibling-1' },
  ])
})

test('a checkpoint failure cancels siblings and fails with the specified RPC error', async () => {
  const h = harness({
    definition: definition('tool'),
    caller: { callTool: async () => ({ task: { taskId: 'sibling-1' } }) },
    checkpoint: async (data) => {
      if (data.siblings.length) throw new Error('store failure')
    },
  })
  await expect(h.drive()).rejects.toMatchObject({ code: -32603, message: 'Flow checkpoint failed' })
  expect(h.cancelled).toEqual([{ id: tool.id, taskId: 'sibling-1' }])
})

test('a checkpoint rejected after client cancellation stops quietly', async () => {
  const h = harness({
    checkpoint: async () => {
      h.abort.abort()
      throw new Error('terminal')
    },
  })
  await expect(h.drive()).resolves.not.toMatchObject({ isError: true })
})

test('a failed sibling wait resumes the tool as a failed task', async () => {
  const h = harness({
    definition: definition('tool'),
    caller: {
      callTool: async () => ({ task: { taskId: 'sibling-1' } }),
      waitTask: async () => {
        throw new TaskCancelledError({ taskID: 'sibling-1' })
      },
    },
  })
  const completed = await h.drive()
  expect(completed.structuredContent?.error).toMatchObject({
    lastFailure: { type: 'tool_task_cancelled' },
  })
})

test('different run depths reach sibling calls independently', async () => {
  const depths: Array<unknown> = []
  const make = (depth: number) =>
    harness({
      depth,
      definition: definition('tool'),
      caller: {
        callTool: async ({ meta }) => {
          depths.push(meta['io.mokei/flow-depth'])
          return { result }
        },
      },
    })
  await Promise.all([make(0).drive(), make(2).drive()])
  expect(depths.sort()).toEqual([1, 3])
})

test('recovery repeats an acted call with the same operation key after its handle missed checkpoint', async () => {
  const keys: Array<unknown> = []
  let calls = 0
  const h = harness({
    definition: definition('tool'),
    caller: {
      callTool: async ({ meta }) => {
        keys.push(meta['io.mokei/idempotency-key'])
        calls++
        return calls === 1 ? { task: { taskId: 'orphan' } } : { result }
      },
    },
    checkpoint: async (data) => {
      if (data.siblings.length) throw new Error('crash before checkpoint')
    },
  })
  await expect(h.drive()).rejects.toMatchObject({ message: 'Flow checkpoint failed' })
  const durable = h.checkpoints.filter((entry) => entry.runState.status === 'running').at(-1)
  expect(durable?.runState.inFlight).toBeDefined()
  const resumeData = structuredClone(durable) as ResumeDataV1
  resumeData.siblings = []
  const recovered = h.graph.recover({
    definition: h.flow,
    runState: resumeData.runState,
    signal: h.handle.signal,
  })
  const completed = await startRun({
    handle: h.handle,
    graph: h.graph,
    run: recovered,
    definition: h.flow,
    resumeData,
    caller: h.caller,
  })
  expect(completed.structuredContent).toMatchObject({ outcome: 'finished' })
  expect(keys).toHaveLength(2)
  expect(keys[0]).toBe(keys[1])
  expect(h.cancelled).toContainEqual({ id: tool.id, taskId: 'orphan' })
})

test('retry suspension waits for resumeAt then completes', async () => {
  const flow = definition('tool')
  flow.nodes.work = {
    ...flow.nodes.work,
    retry: { maxAttempts: 2, backoff: { initialMs: 80 }, suspendAfterMs: 0 },
  } as FlowDefinition['nodes'][string]
  let calls = 0
  const h = harness({
    definition: flow,
    caller: {
      callTool: async () => {
        calls++
        if (calls === 1) throw new Error('transient')
        return { result }
      },
    },
  })
  const completed = await h.drive()
  expect(completed.structuredContent).toMatchObject({ outcome: 'finished' })
  expect(h.checkpoints.some((entry) => entry.runState.pending?.reason === 'retry')).toBe(true)
  expect(calls).toBe(2)
})
