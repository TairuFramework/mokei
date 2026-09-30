import { DirectTransports } from '@enkaku/transport'
import { ContextClient, TaskCancelledError } from '@mokei/context-client'
import type { ClientMessage, ServerMessage } from '@mokei/context-protocol'
import type { JSONValue, TaskHandle } from '@mokei/context-server'
import { ContextServer, createMemoryTaskStore, createTaskManager } from '@mokei/context-server'
import { createFlowGraph, type FlowDefinition } from '@sozai/flow-graph'
import { expect, test, vi } from 'vitest'

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

test('a stalled sibling cancellation does not block run completion', async () => {
  vi.useFakeTimers()
  try {
    const h = harness({ caller: { cancelTask: async () => new Promise<void>(() => {}) } })
    h.resumeData.runState = { ...h.resumeData.runState, status: 'error' }
    h.resumeData.siblings.push({ tool: tool.id, taskId: 'stalled' })
    const completion = h.drive()
    await vi.advanceTimersByTimeAsync(5_000)
    const sentinel = Symbol('still waiting')
    expect(await Promise.race([completion, Promise.resolve(sentinel)])).toMatchObject({
      isError: true,
    })
  } finally {
    vi.useRealTimers()
  }
})

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

test('a failed status write fails the run with a flow status RPC error', async () => {
  const h = harness()
  h.handle.setStatus = async () => {
    throw new Error('store failure')
  }
  await expect(h.drive()).rejects.toMatchObject({
    code: -32603,
    message: 'Flow status update failed',
  })
})

test('a terminal status write stops the run quietly', async () => {
  const h = harness()
  h.handle.setStatus = async () => {
    throw new Error('Task is no longer active')
  }
  await expect(h.drive()).resolves.toEqual({ content: [] })
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

test('a lost sibling wait cancels its task before failing the node', async () => {
  const h = harness({
    definition: definition('tool'),
    caller: {
      callTool: async () => ({ task: { taskId: 'sibling-1' } }),
      waitTask: async () => {
        throw new Error('transport lost')
      },
    },
  })
  const completed = await h.drive()
  expect(completed.structuredContent?.error).toMatchObject({
    lastFailure: { type: 'tool_task_failed' },
  })
  expect(h.cancelled).toEqual([{ id: tool.id, taskId: 'sibling-1' }])
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
  const calls: Array<{ key: unknown; attempt: unknown }> = []
  const h = harness({
    definition: definition('tool'),
    caller: {
      callTool: async ({ meta }) => {
        calls.push({
          key: meta['io.mokei/idempotency-key'],
          attempt: meta['io.mokei/attempt'],
        })
        return calls.length === 1 ? { task: { taskId: 'orphan' } } : { result }
      },
    },
  })
  const base = createMemoryTaskStore()
  let first: ReturnType<typeof createTaskManager>
  let crash = true
  const store = {
    ...base,
    update: async (...args: Parameters<typeof base.update>) => {
      const data = args[1].resumeData as unknown as ResumeDataV1 | undefined
      if (crash && data?.siblings.length) {
        crash = false
        await first.dispose()
        throw new Error('crash before sibling checkpoint')
      }
      return base.update(...args)
    },
  }
  const taskTool = {
    description: 'Flow task',
    inputSchema: { type: 'object' as const },
    handler: () => result,
  }
  const stopped = Promise.withResolvers<void>()
  first = createTaskManager({ store })
  const created = await first.create({
    toolName: 'flow',
    tool: taskTool,
    clientCapabilities: {},
    resumeData: h.resumeData as unknown as JSONValue,
    work: async (handle) => {
      try {
        return await startRun({
          handle,
          graph: h.graph,
          run: h.run,
          definition: h.flow,
          resumeData: h.resumeData,
          caller: h.caller,
        })
      } finally {
        stopped.resolve()
      }
    },
  })
  await stopped.promise
  const persisted = await base.get(created.taskId)
  expect(crash).toBe(false)
  expect(persisted).toMatchObject({ status: 'working', resumeData: { siblings: [] } })
  const checkpoint = persisted?.resumeData as unknown as ResumeDataV1
  expect(checkpoint.runState.inFlight).toBeDefined()

  const second = createTaskManager({
    store,
    recover: (record, resume) =>
      resume((handle) => {
        const data = record.resumeData as unknown as ResumeDataV1
        const recovered = h.graph.recover({
          definition: h.flow,
          runState: data.runState,
          signal: handle.signal,
        })
        return startRun({
          handle,
          graph: h.graph,
          run: recovered,
          definition: h.flow,
          resumeData: data,
          caller: h.caller,
        })
      }),
  })
  try {
    await second.recover({ flow: taskTool })
    await expect.poll(async () => (await second.get(created.taskId)).status).toBe('completed')
    expect(await second.get(created.taskId)).toMatchObject({
      result: { structuredContent: { outcome: 'finished' } },
    })
    expect(calls).toHaveLength(2)
    expect(calls[0]?.key).toMatch(/^run-1:.+/)
    expect(calls[1]?.key).toBe(calls[0]?.key)
    expect(calls.map(({ attempt }) => attempt)).toEqual([1, 1])
    expect(h.cancelled).toContainEqual({ id: tool.id, taskId: 'orphan' })
  } finally {
    await second.dispose()
  }
})

test('retry suspension waits for resumeAt then completes', async () => {
  vi.useFakeTimers()
  try {
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
    const completion = h.drive()
    await vi.advanceTimersByTimeAsync(80)
    const completed = await completion
    expect(completed.structuredContent).toMatchObject({ outcome: 'finished' })
    expect(h.checkpoints.some((entry) => entry.runState.pending?.reason === 'retry')).toBe(true)
    expect(calls).toBe(2)
  } finally {
    vi.useRealTimers()
  }
})

test('a timed-out tool call retries with the same operation key and next attempt', async () => {
  vi.useFakeTimers()
  try {
    const flow = definition('tool')
    flow.nodes.work = {
      ...flow.nodes.work,
      retry: { maxAttempts: 2, attemptTimeoutMs: 20, backoff: { initialMs: 0 } },
    } as FlowDefinition['nodes'][string]
    const calls: Array<{ key: unknown; attempt: unknown }> = []
    const h = harness({
      definition: flow,
      caller: {
        callTool: async ({ meta, signal }) => {
          calls.push({
            key: meta['io.mokei/idempotency-key'],
            attempt: meta['io.mokei/attempt'],
          })
          if (calls.length === 1) {
            await new Promise<void>((_resolve, reject) => {
              signal.addEventListener('abort', () => reject(signal.reason), { once: true })
            })
          }
          return { result }
        },
      },
    })
    const completion = h.drive()
    await vi.advanceTimersByTimeAsync(20)
    expect((await completion).structuredContent).toMatchObject({ outcome: 'finished' })
    expect(calls).toHaveLength(2)
    expect(calls[0]?.key).toMatch(/^run-1:.+/)
    expect(calls[1]?.key).toBe(calls[0]?.key)
    expect(calls.map(({ attempt }) => attempt)).toEqual([1, 2])
  } finally {
    vi.useRealTimers()
  }
})

test('a sibling wait that exceeds its attempt deadline cancels the sibling and retries', async () => {
  vi.useFakeTimers()
  try {
    const flow = definition('tool')
    flow.nodes.work = {
      ...flow.nodes.work,
      retry: { maxAttempts: 2, attemptTimeoutMs: 10, backoff: { initialMs: 0 } },
    } as FlowDefinition['nodes'][string]
    let calls = 0
    const h = harness({
      definition: flow,
      caller: {
        callTool: async () => (++calls === 1 ? { task: { taskId: 'slow' } } : { result }),
        waitTask: async () => new Promise(() => {}),
      },
    })
    const completion = h.drive()
    await vi.advanceTimersByTimeAsync(10)
    expect((await completion).structuredContent).toMatchObject({ outcome: 'finished' })
    expect(calls).toBe(2)
    expect(h.cancelled).toEqual([{ id: tool.id, taskId: 'slow' }])
  } finally {
    vi.useRealTimers()
  }
})

test('an early sibling attempt timer waits for the deadline before retrying', async () => {
  vi.useFakeTimers()
  let now: ReturnType<typeof vi.spyOn> | undefined
  try {
    const flow = definition('tool')
    flow.nodes.work = {
      ...flow.nodes.work,
      retry: { maxAttempts: 2, attemptTimeoutMs: 10, backoff: { initialMs: 0 } },
    } as FlowDefinition['nodes'][string]
    const entered = Promise.withResolvers<void>()
    let calls = 0
    const h = harness({
      definition: flow,
      caller: {
        callTool: async () => (++calls === 1 ? { task: { taskId: 'slow' } } : { result }),
        waitTask: async () => {
          entered.resolve()
          return new Promise(() => {})
        },
      },
    })
    const completion = h.drive()
    await entered.promise
    now = vi
      .spyOn(Date, 'now')
      .mockImplementation(() => (vi.getMockedSystemTime()?.getTime() ?? 0) - 2)
    await vi.advanceTimersByTimeAsync(10)
    expect(h.cancelled).toEqual([])
    expect(calls).toBe(1)
    await vi.advanceTimersByTimeAsync(2)
    expect((await completion).structuredContent).toMatchObject({ outcome: 'finished' })
    expect(calls).toBe(2)
    expect(h.cancelled).toEqual([{ id: tool.id, taskId: 'slow' }])
  } finally {
    now?.mockRestore()
    vi.useRealTimers()
  }
})

test('a total deadline during a sibling wait ends the node with total_timeout', async () => {
  vi.useFakeTimers()
  try {
    const flow = definition('tool')
    flow.nodes.work = {
      ...flow.nodes.work,
      retry: {
        maxAttempts: 2,
        attemptTimeoutMs: 100,
        totalTimeoutMs: 10,
        backoff: { initialMs: 0 },
      },
    } as FlowDefinition['nodes'][string]
    const h = harness({
      definition: flow,
      caller: {
        callTool: async () => ({ task: { taskId: 'slow' } }),
        waitTask: async () => new Promise(() => {}),
      },
    })
    const completion = h.drive()
    await vi.advanceTimersByTimeAsync(10)
    const completed = await completion
    expect(completed.structuredContent?.error).toMatchObject({ reason: 'total_timeout' })
    expect(h.cancelled).toEqual([{ id: tool.id, taskId: 'slow' }])
  } finally {
    vi.useRealTimers()
  }
})

test('an early sibling total timer waits for the deadline before total_timeout', async () => {
  vi.useFakeTimers()
  let now: ReturnType<typeof vi.spyOn> | undefined
  try {
    const flow = definition('tool')
    flow.nodes.work = {
      ...flow.nodes.work,
      retry: {
        maxAttempts: 2,
        attemptTimeoutMs: 100,
        totalTimeoutMs: 10,
        backoff: { initialMs: 0 },
      },
    } as FlowDefinition['nodes'][string]
    const entered = Promise.withResolvers<void>()
    const h = harness({
      definition: flow,
      caller: {
        callTool: async () => ({ task: { taskId: 'slow' } }),
        waitTask: async () => {
          entered.resolve()
          return new Promise(() => {})
        },
      },
    })
    const completion = h.drive()
    await entered.promise
    now = vi
      .spyOn(Date, 'now')
      .mockImplementation(() => (vi.getMockedSystemTime()?.getTime() ?? 0) - 2)
    await vi.advanceTimersByTimeAsync(10)
    expect(h.cancelled).toEqual([])
    await vi.advanceTimersByTimeAsync(2)
    expect((await completion).structuredContent?.error).toMatchObject({ reason: 'total_timeout' })
    expect(h.cancelled).toEqual([{ id: tool.id, taskId: 'slow' }])
  } finally {
    now?.mockRestore()
    vi.useRealTimers()
  }
})

test('a total deadline keeps its failed-value resume when cancellation crosses the attempt deadline', async () => {
  vi.useFakeTimers()
  try {
    const flow = definition('tool')
    flow.nodes.work = {
      ...flow.nodes.work,
      retry: {
        maxAttempts: 2,
        attemptTimeoutMs: 100,
        totalTimeoutMs: 10,
        backoff: { initialMs: 0 },
      },
    } as FlowDefinition['nodes'][string]
    const h = harness({
      definition: flow,
      caller: {
        callTool: async () => ({ task: { taskId: 'slow' } }),
        waitTask: async () => new Promise(() => {}),
        cancelTask: async () => new Promise((resolve) => setTimeout(resolve, 150)),
      },
    })
    const resume = vi.spyOn(h.graph, 'resume')
    const completion = h.drive()
    await vi.advanceTimersByTimeAsync(160)
    await completion
    expect(resume.mock.calls[0]?.[0].event).toMatchObject({
      type: 'value',
      value: { ok: false, status: 'failed' },
    })
  } finally {
    vi.useRealTimers()
  }
})

test('a sibling deadline passed during downtime expires before waiting on recovery', async () => {
  const flow = definition('tool')
  flow.nodes.work = {
    ...flow.nodes.work,
    retry: { maxAttempts: 2, attemptTimeoutMs: 100, backoff: { initialMs: 0 } },
  } as FlowDefinition['nodes'][string]
  let calls = 0
  let waits = 0
  const h = harness({
    definition: flow,
    caller: {
      callTool: async () => (++calls === 1 ? { task: { taskId: 'expired' } } : { result }),
      waitTask: async () => {
        waits++
        return result
      },
    },
  })
  let suspended: Awaited<ReturnType<typeof h.run.next>>
  do {
    suspended = await h.run.next()
  } while (!suspended.done && suspended.value.status !== 'suspended')
  if (suspended.done || suspended.value.status !== 'suspended' || !suspended.value.pending)
    throw new Error('No suspension')
  h.resumeData.runState = {
    ...suspended.value,
    pending: { ...suspended.value.pending, deadline: new Date(Date.now() - 1).toISOString() },
  }
  expect((await h.drive()).structuredContent).toMatchObject({ outcome: 'finished' })
  expect(waits).toBe(0)
  expect(calls).toBe(2)
  expect(h.cancelled).toEqual([{ id: tool.id, taskId: 'expired' }])
})

test('a sibling completed before its deadline resumes normally', async () => {
  vi.useFakeTimers()
  try {
    const flow = definition('tool')
    flow.nodes.work = {
      ...flow.nodes.work,
      retry: { maxAttempts: 2, attemptTimeoutMs: 100, backoff: { initialMs: 0 } },
    } as FlowDefinition['nodes'][string]
    let calls = 0
    const h = harness({
      definition: flow,
      caller: {
        callTool: async () => {
          calls++
          return { task: { taskId: 'fast' } }
        },
      },
    })
    expect((await h.drive()).structuredContent).toMatchObject({ outcome: 'finished' })
    expect(h.checkpoints.some((entry) => entry.runState.pending?.deadline !== undefined)).toBe(true)
    expect(calls).toBe(1)
    expect(h.cancelled).toEqual([])
  } finally {
    vi.useRealTimers()
  }
})
