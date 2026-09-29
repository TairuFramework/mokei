import type { InputResponse } from '@mokei/context-protocol'
import {
  createTaskManager,
  type JSONValue,
  type TaskHandle,
  TaskInputKeyReusedError,
} from '@mokei/context-server'
import { createFlowGraph, type FlowDefinition } from '@sozai/flow-graph'
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

test('recovery reissues an already consumed input key with a checkpointed sequence', async () => {
  let requests = 0
  const h = harness(inputFlow({ type: 'string' }), (key) => {
    requests++
    if (requests === 1) throw new TaskInputKeyReusedError(key)
    return { action: 'accept', content: { value: 'Ada' } }
  })
  expect((await h.drive()).structuredContent).toMatchObject({ output: { answer: 'Ada' } })
  expect(h.keys).toEqual(['run-input:ask.1:input:0', 'run-input:ask.1:input:1'])
  expect(h.resumeData.inputSeq).toBe(1)
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
  const tasks = createTaskManager()
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
      const record = await tasks.get(started.taskId)
      if (record.status === 'input_required') {
        key = Object.keys(record.inputRequests)[0]
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
