import type { InputRequest, InputResponse } from '@mokei/context-protocol'
import {
  createMemoryTaskStore,
  createTaskManager,
  type InputRecord,
  type JSONValue,
  type TaskHandle,
  type TaskRecord,
} from '@mokei/context-server'
import { createFlowGraph, type FlowDefinition, type RunState } from '@sozai/flow-graph'
import { expect, test } from 'vitest'

import { type ResumeDataV1, startRun } from '../src/driver.js'
import type { ToolCaller } from '../src/tool-caller.js'

const caller: ToolCaller = {
  listTools: () => [],
  callTool: async () => {
    throw new Error('unexpected tool')
  },
  waitTask: async () => {
    throw new Error('unexpected wait')
  },
  cancelTask: async () => {},
}

function inputFlow(
  schema: Record<string, JSONValue>,
  options: {
    prompt?: FlowDefinition['nodes'][string]
    timeout?: { afterMs: number; to: string }
  } = {},
): FlowDefinition {
  return {
    id: 'input-driver',
    name: 'Input driver',
    version: 1,
    start: 'ask',
    nodes: {
      ask: {
        kind: 'input',
        prompt: { value: 'Choose' },
        schema,
        next: 'done',
        ...(options.timeout ? { timeout: options.timeout } : {}),
      },
      done: { kind: 'end', outcome: 'done', output: { answer: { ref: ['results', 'ask'] } } },
      timed: { kind: 'end', outcome: 'timed' },
    },
  }
}

function harness(flow: FlowDefinition, response: InputResponse | ((key: string) => InputResponse)) {
  const graph = createFlowGraph()
  const run = graph.start({ definition: flow, runID: 'run-input' })
  const resumeData: ResumeDataV1 = {
    v: 1,
    flow: { definition: flow },
    approved: [],
    depth: 0,
    runState: run.getState(),
    siblings: [],
  }
  let requested: Record<string, unknown> | undefined
  const keys: Array<string> = []
  let cancelled = false
  const handle: TaskHandle = {
    taskID: 'task-input',
    signal: new AbortController().signal,
    requestMeta: {},
    setStatus: async () => {},
    checkpoint: async () => {},
    requestInput: async (requests) => {
      requested = requests
      const key = Object.keys(requests)[0] as string
      keys.push(key)
      return { [key]: typeof response === 'function' ? response(key) : response }
    },
    awaitInput: async () => {
      throw new Error('unexpected await')
    },
    cancel: async () => {
      cancelled = true
      return true
    },
  }
  const drive = () => startRun({ handle, graph, run, definition: flow, resumeData, caller })
  return {
    drive,
    keys,
    resumeData,
    get requested() {
      return requested
    },
    get cancelled() {
      return cancelled
    },
  }
}

test('flat object elicitation accepts content without wrapping', async () => {
  const h = harness(inputFlow({ type: 'object', properties: { name: { type: 'string' } } }), {
    action: 'accept',
    content: { name: 'Ada' },
  })
  const completed = await h.drive()
  expect(completed.structuredContent).toEqual({
    outcome: 'done',
    output: { answer: { name: 'Ada' } },
  })
  expect(Object.keys(h.requested ?? {})).toEqual(['run-input:ask.1:input:0'])
  expect(Object.values(h.requested ?? {})[0]).toMatchObject({
    method: 'elicitation/create',
    params: {
      message: 'Choose',
      requestedSchema: { type: 'object', properties: { name: { type: 'string' } } },
    },
  })
})

test('primitive elicitation wraps schema and unwraps accepted value', async () => {
  const h = harness(inputFlow({ type: 'string' }), { action: 'accept', content: { value: 'Ada' } })
  expect((await h.drive()).structuredContent).toEqual({
    outcome: 'done',
    output: { answer: 'Ada' },
  })
  expect(Object.values(h.requested ?? {})[0]).toMatchObject({
    params: {
      requestedSchema: {
        type: 'object',
        properties: { value: { type: 'string' } },
        required: ['value'],
      },
    },
  })
})

test.each(['decline', 'cancel'] as const)('%s cancels the flow task', async (action) => {
  const h = harness(inputFlow({ type: 'string' }), { action })
  await h.drive()
  expect(h.cancelled).toBe(true)
})

test('non-string resolved prompt yields typed tool error without elicitation', async () => {
  const flow = inputFlow({ type: 'string' })
  flow.nodes.ask = {
    ...flow.nodes.ask,
    prompt: { ref: ['input', 'prompt'] },
  } as FlowDefinition['nodes'][string]
  const graph = createFlowGraph()
  const run = graph.start({ definition: flow, input: { prompt: 42 }, runID: 'run-input' })
  const resumeData: ResumeDataV1 = {
    v: 1,
    flow: { definition: flow },
    approved: [],
    depth: 0,
    runState: run.getState(),
    siblings: [],
  }
  let requested = false
  const handle: TaskHandle = {
    taskID: 'task-input',
    signal: new AbortController().signal,
    requestMeta: {},
    setStatus: async () => {},
    checkpoint: async () => {},
    requestInput: async () => {
      requested = true
      throw new Error('unexpected')
    },
    awaitInput: async () => {
      throw new Error('unexpected')
    },
    cancel: async () => true,
  }
  const completed = await startRun({ handle, graph, run, definition: flow, resumeData, caller })
  expect(completed).toMatchObject({
    isError: true,
    structuredContent: { error: { type: 'input_prompt_not_string', node: 'ask' } },
  })
  expect(requested).toBe(false)
})

test('real input deadline withdraws the request and a late answer cannot change the outcome', async () => {
  const store = createMemoryTaskStore()
  const tasks = createTaskManager({ store })
  const flow = inputFlow({ type: 'string' }, { timeout: { afterMs: 100, to: 'timed' } })
  const graph = createFlowGraph()
  const run = graph.start({ definition: flow, runID: 'run-input' })
  const resumeData: ResumeDataV1 = {
    v: 1,
    flow: { definition: flow },
    approved: [],
    depth: 0,
    runState: run.getState(),
    siblings: [],
  }
  try {
    const started = await tasks.create({
      toolName: 'flow',
      tool: {
        description: 'Input flow',
        inputSchema: { type: 'object' },
        handler: () => ({ content: [] }),
      },
      clientCapabilities: { elicitation: {} },
      resumeData: resumeData as unknown as JSONValue,
      work: (handle) => startRun({ handle, graph, run, definition: flow, resumeData, caller }),
    })
    let key: string | undefined
    for (let attempt = 0; attempt < 100; attempt++) {
      const record = await store.get(started.taskId)
      if (record?.status === 'input_required') {
        key = Object.keys(record.inputs.at(-1)?.requests ?? {})[0]
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    expect(key).toBeDefined()
    let completed = await tasks.get(started.taskId)
    for (let attempt = 0; attempt < 200 && completed.status !== 'completed'; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1))
      completed = await tasks.get(started.taskId)
    }
    expect(completed).toMatchObject({
      status: 'completed',
      result: { structuredContent: { outcome: 'timed' } },
    })
    await expect(
      tasks.update(started.taskId, {
        [key as string]: { action: 'accept', content: { value: 'late' } },
      }),
    ).rejects.toMatchObject({
      code: -32602,
      message: `Task is not awaiting input for ${key}`,
    })
    expect(await tasks.get(started.taskId)).toMatchObject({
      status: 'completed',
      result: { structuredContent: { outcome: 'timed' } },
    })
  } finally {
    await tasks.dispose()
  }
})

const timedFlow = inputFlow({ type: 'string' }, { timeout: { afterMs: 60_000, to: 'timed' } })

const askRequest = {
  method: 'elicitation/create',
  params: {
    message: 'Choose',
    requestedSchema: {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
    },
  },
} as InputRequest

async function suspendedAt(flow: FlowDefinition, deadline?: number) {
  const graph = createFlowGraph()
  const run = graph.start({ definition: flow, runID: 'run-input' })
  let state: RunState | undefined
  for (let index = 0; index < 20 && state === undefined; index++) {
    const step = await run.next()
    if (step.done) throw new Error('Run ended before suspension')
    if (step.value.status === 'suspended') state = step.value
  }
  if (state?.pending === undefined) throw new Error('Run did not suspend')
  if (deadline !== undefined) {
    state = { ...state, pending: { ...state.pending, deadline: new Date(deadline).toISOString() } }
  }
  const frame = state.frames.at(-1)
  const pending = state.pending as NonNullable<RunState['pending']>
  const invocation =
    frame?.attempts[pending.node]?.invocationID ?? `${pending.node}.${frame?.invocation ?? 0}`
  const resumeData: ResumeDataV1 = {
    v: 1,
    flow: { definition: flow },
    approved: [],
    depth: 0,
    runState: state,
    siblings: [],
  }
  return { graph, run, resumeData, key: `${state.runID}:${invocation}:input:0` }
}

/** Persists a task with the given input history, then resumes it with `startRun`. */
async function recoverInput(params: {
  flow: FlowDefinition
  deadline?: number
  status: TaskRecord['status']
  inputs: (key: string) => Array<InputRecord>
}) {
  const store = createMemoryTaskStore()
  const { graph, run, resumeData, key } = await suspendedAt(params.flow, params.deadline)
  const tool = {
    description: 'Input flow',
    inputSchema: { type: 'object' as const },
    handler: () => ({ content: [] }),
  }
  const first = createTaskManager({ store })
  const created = await first.create({
    toolName: 'flow',
    tool,
    clientCapabilities: { elicitation: {} },
    resumeData: resumeData as unknown as JSONValue,
    work: () => new Promise(() => {}),
  })
  await first.dispose()
  const previous = await store.get(created.taskId)
  if (previous === undefined) throw new Error('Task missing')
  await store.update(
    created.taskId,
    { status: params.status, inputs: params.inputs(key) },
    { revision: previous.revision },
  )
  const second = createTaskManager({
    store,
    recover: (_record, resume) =>
      resume((handle) =>
        startRun({ handle, graph, run, definition: params.flow, resumeData, caller }),
      ),
  })
  await second.recover({ flow: tool })
  return { store, tasks: second, taskID: created.taskId, key }
}

async function settled(tasks: ReturnType<typeof createTaskManager>, taskID: string) {
  await expect
    .poll(async () => (await tasks.get(taskID)).status)
    .toSatisfy((status) => status === 'completed' || status === 'failed')
  return tasks.get(taskID)
}

test('expired deadline replays a stored answer', async () => {
  const { tasks, taskID } = await recoverInput({
    flow: timedFlow,
    deadline: Date.now() - 1000,
    status: 'working',
    inputs: (key) => [
      {
        id: 1,
        requests: { [key]: askRequest },
        responses: { [key]: { action: 'accept', content: { value: 'Ada' } } },
        outcome: 'answered',
      },
    ],
  })
  try {
    expect(await settled(tasks, taskID)).toMatchObject({
      status: 'completed',
      result: { structuredContent: { outcome: 'done', output: { answer: 'Ada' } } },
    })
  } finally {
    await tasks.dispose()
  }
})

test('expired deadline with a request never issued takes the timeout edge', async () => {
  const { store, tasks, taskID } = await recoverInput({
    flow: timedFlow,
    deadline: Date.now() - 1000,
    status: 'working',
    inputs: () => [],
  })
  try {
    expect(await settled(tasks, taskID)).toMatchObject({
      status: 'completed',
      result: { structuredContent: { outcome: 'timed' } },
    })
    expect((await store.get(taskID))?.inputs).toEqual([])
  } finally {
    await tasks.dispose()
  }
})

test('expired deadline with an open request withdraws it and takes the timeout edge', async () => {
  const { store, tasks, taskID, key } = await recoverInput({
    flow: timedFlow,
    deadline: Date.now() - 1000,
    status: 'input_required',
    inputs: (key) => [{ id: 1, requests: { [key]: askRequest }, responses: {} }],
  })
  try {
    expect(await settled(tasks, taskID)).toMatchObject({
      status: 'completed',
      result: { structuredContent: { outcome: 'timed' } },
    })
    expect((await store.get(taskID))?.inputs).toEqual([
      { id: 1, requests: { [key]: askRequest }, responses: {}, outcome: 'withdrawn' },
    ])
  } finally {
    await tasks.dispose()
  }
})

test('a reused key with changed contents fails the run', async () => {
  const changed = {
    ...askRequest,
    params: { ...askRequest.params, message: 'Something else' },
  } as InputRequest
  const { store, tasks, taskID } = await recoverInput({
    flow: timedFlow,
    status: 'working',
    inputs: (key) => [
      {
        id: 1,
        requests: { [key]: changed },
        responses: { [key]: { action: 'accept', content: { value: 'Ada' } } },
        outcome: 'answered',
      },
    ],
  })
  try {
    expect(await settled(tasks, taskID)).toMatchObject({
      status: 'failed',
      error: { code: -32603, message: 'Flow input key reused' },
    })
    expect((await store.get(taskID))?.inputs).toHaveLength(1)
  } finally {
    await tasks.dispose()
  }
})

test('a non-deadline rejection propagates', async () => {
  const { graph, run, resumeData } = await suspendedAt(timedFlow)
  const handle: TaskHandle = {
    taskID: 'task-input',
    signal: new AbortController().signal,
    requestMeta: {},
    setStatus: async () => {},
    checkpoint: async () => {},
    requestInput: async () => {
      throw new Error('boom')
    },
    awaitInput: async () => {
      throw new Error('unexpected await')
    },
    cancel: async () => true,
  }
  await expect(
    startRun({ handle, graph, run, definition: timedFlow, resumeData, caller }),
  ).rejects.toThrow('boom')
})
