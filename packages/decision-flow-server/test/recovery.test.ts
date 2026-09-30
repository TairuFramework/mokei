import { createMemoryTaskStore, createTaskManager, type JSONValue } from '@mokei/context-server'
import {
  createFlowGraph,
  digestDefinition,
  type FlowDefinition,
  type RunState,
} from '@sozai/flow-graph'
import { expect, test } from 'vitest'

import type { ResumeDataV1 } from '../src/driver.js'
import { createDecisionFlowServer } from '../src/server.js'
import type { ToolCaller } from '../src/tool-caller.js'
import { toolKind } from '../src/tool-node.js'

const flow: FlowDefinition = {
  id: 'recover-me',
  name: 'Recover me',
  version: 1,
  start: 'done',
  nodes: { done: { kind: 'end', outcome: 'finished', output: { answer: { value: 42 } } } },
}
const predictor = {
  predict: async () => {
    throw new Error('Unexpected prediction')
  },
}

function fixture(
  options: {
    definition?: FlowDefinition
    storedDefinition?: FlowDefinition
    state?: RunState
    registered?: boolean
    catalogue?: ToolCaller['listTools']
    siblings?: ResumeDataV1['siblings']
    onCancel?: ToolCaller['cancelTask']
    flowRef?: ResumeDataV1['flow']
    caller?: Partial<ToolCaller>
    approved?: Array<string>
  } = {},
) {
  const store = createMemoryTaskStore()
  const first = createTaskManager({ store })
  const storedFlow = options.storedDefinition ?? flow
  const caller: ToolCaller = {
    listTools: options.catalogue ?? (() => []),
    callTool: async () => {
      throw new Error('Unexpected tool call')
    },
    waitTask: async () => {
      throw new Error('Unexpected sibling wait')
    },
    cancelTask: options.onCancel ?? (async () => {}),
    ...options.caller,
  }
  const graph = createFlowGraph({
    kinds: [
      toolKind({
        caller,
        catalogue: caller.listTools(),
        depth: 0,
        approved: new Set(['sibling:work']),
      }),
    ],
  })
  const state =
    options.state ?? graph.start({ definition: storedFlow, runID: 'run-recover' }).getState()
  const data: ResumeDataV1 = {
    v: 1,
    flow: options.flowRef ?? {
      id: storedFlow.id,
      digest: digestDefinition(storedFlow as unknown as JSONValue),
    },
    approved: options.approved ?? [],
    depth: 0,
    runState: state,
    siblings: options.siblings ?? [],
  }
  const createSecond = () => {
    const server = createDecisionFlowServer({
      caller,
      predictor,
      tasks: {} as ReturnType<typeof createTaskManager>,
      flows: options.registered === false ? [] : [options.definition ?? storedFlow],
      approval: () => ({ tools: [] }),
      elicitation: () => true,
    })
    const second = createTaskManager({ store, recover: server.recover })
    return { second, server }
  }
  return { store, first, data, createSecond }
}

const inputFlow: FlowDefinition = {
  id: flow.id,
  name: 'Input recovery',
  version: 1,
  start: 'ask',
  nodes: {
    ask: {
      kind: 'input',
      prompt: { value: 'Your name?' },
      schema: { type: 'string' },
      next: 'done',
      timeout: { afterMs: 60_000, to: 'timed' },
    },
    done: { kind: 'end', outcome: 'answered', output: { answer: { ref: ['results', 'ask'] } } },
    timed: { kind: 'end', outcome: 'timed' },
  },
}

async function suspendedState(definition: FlowDefinition, caller?: ToolCaller): Promise<RunState> {
  const graph = createFlowGraph(
    caller === undefined
      ? {}
      : {
          kinds: [
            toolKind({
              caller,
              catalogue: caller.listTools(),
              depth: 0,
              approved: new Set(['sibling:work']),
            }),
          ],
        },
  )
  const run = graph.start({ definition, runID: 'run-recover' })
  for (let index = 0; index < 20; index++) {
    const step = await run.next()
    if (step.done) throw new Error('Run ended before suspension')
    if (step.value.status === 'suspended') return step.value
  }
  throw new Error('Run did not suspend')
}

function inputKey(state: RunState): string {
  const pending = state.pending
  if (pending === undefined) throw new Error('No pending input')
  const frame = state.frames.at(-1)
  const invocation =
    frame?.attempts[pending.node]?.invocationID ?? `${pending.node}.${state.invocation}`
  return `${state.runID}:${invocation}:input:0`
}

const inputRequest = {
  method: 'elicitation/create' as const,
  params: {
    message: 'Your name?',
    requestedSchema: {
      type: 'object' as const,
      properties: { value: { type: 'string' as const } },
      required: ['value'],
    },
  },
}

async function persist(f: ReturnType<typeof fixture>) {
  const created = await f.first.create({
    toolName: 'flow_recover_me',
    tool: {
      description: 'Flow',
      inputSchema: { type: 'object' },
      handler: () => ({ content: [] }),
    },
    clientCapabilities: { elicitation: {} },
    resumeData: f.data as unknown as JSONValue,
    work: () => new Promise(() => {}),
  })
  await f.first.dispose()
  return created.taskId
}

test('recovers a running registered flow and completes it', async () => {
  const f = fixture()
  const id = await persist(f)
  const { second, server } = f.createSecond()
  try {
    await second.recover(server.recoveryTools)
    await expect.poll(async () => (await second.get(id)).status).toBe('completed')
    expect(await second.get(id)).toMatchObject({
      result: { structuredContent: { outcome: 'finished', output: { answer: 42 } } },
    })
  } finally {
    await second.dispose()
  }
})

test('recovery ignores malformed saved siblings and cancels the valid sibling', async () => {
  const cancelled: Array<string> = []
  const f = fixture({
    siblings: [
      null,
      { tool: 1 },
      { tool: 'sibling:work', taskId: 'valid' },
    ] as unknown as ResumeDataV1['siblings'],
    onCancel: async ({ taskId }) => {
      cancelled.push(taskId)
    },
  })
  f.data.runState = { ...f.data.runState, status: 'ended', outcome: 'finished' }
  const id = await persist(f)
  const { second, server } = f.createSecond()
  try {
    await second.recover(server.recoveryTools)
    await expect.poll(async () => (await second.get(id)).status).toBe('completed')
    expect(cancelled).toEqual(['valid'])
  } finally {
    await second.dispose()
  }
})

test('rejects an unknown resume data version and cancels saved siblings', async () => {
  const cancelled: Array<string> = []
  const f = fixture({
    siblings: [{ tool: 'sibling:work', taskId: 'child-1' }],
    onCancel: async ({ taskId }) => {
      cancelled.push(taskId)
    },
  })
  f.data.v = 2 as 1
  const id = await persist(f)
  const { second, server } = f.createSecond()
  try {
    await second.recover(server.recoveryTools)
    await expect.poll(async () => (await second.get(id)).status).toBe('failed')
    expect(await second.get(id)).toMatchObject({
      error: { code: -32603, message: 'Unsupported flow resume data version' },
    })
    expect(cancelled).toEqual(['child-1'])
  } finally {
    await second.dispose()
  }
})

test('resolves unknown flow tools for recovery without listing or calling them', async () => {
  const f = fixture()
  const { second, server } = f.createSecond()
  try {
    expect(Object.keys(server.recoveryTools)).toEqual(Object.keys(server.tools))
    expect(Object.keys(server.recoveryTools)).not.toContain('flow_missing')
    const fallback = server.recoveryTools.flow_missing
    if (fallback === undefined) throw new Error('Recovery lookup did not resolve the flow')
    expect(() => fallback.handler({} as never)).toThrow('Recovery-only flow tool cannot be called')
  } finally {
    await second.dispose()
    await f.first.dispose()
  }
})

const terminalCases = (['ended', 'error', 'aborted'] as const).flatMap((status) =>
  (['removed', 'changed', 'catalogue'] as const).map((drift) => [status, drift] as const),
)

test.each(terminalCases)(
  'settles %s from its checkpoint despite %s flow drift',
  async (status, drift) => {
    const tool = { id: 'sibling:work', inputSchema: { type: 'object' as const } }
    const storedFlow: FlowDefinition =
      drift === 'catalogue'
        ? {
            ...flow,
            start: 'work',
            nodes: { work: { kind: 'tool', tool: tool.id, args: {}, next: 'done' }, ...flow.nodes },
          }
        : flow
    let listed = true
    const cancelled: Array<string> = []
    const f = fixture({
      storedDefinition: storedFlow,
      definition: drift === 'changed' ? { ...flow, version: 2 } : storedFlow,
      registered: drift !== 'removed',
      catalogue: () => (listed ? [tool] : []),
      siblings: [{ tool: tool.id, taskId: 'terminal-child' }],
      onCancel: async ({ taskId }) => {
        cancelled.push(taskId)
      },
    })
    f.data.runState = {
      ...f.data.runState,
      status,
      ...(status === 'ended' ? { outcome: 'old', output: { saved: true } } : {}),
      ...(status === 'error' ? { error: { code: 'saved', name: 'Saved error' } } : {}),
    } as RunState
    const id = await persist(f)
    const { second, server } = f.createSecond()
    listed = false
    try {
      await second.recover(server.recoveryTools)
      await expect
        .poll(async () => (await second.get(id)).status)
        .toBe(status === 'aborted' ? 'cancelled' : 'completed')
      if (status === 'ended')
        expect(await second.get(id)).toMatchObject({
          result: { structuredContent: { outcome: 'old', output: { saved: true } } },
        })
      if (status === 'error')
        expect(await second.get(id)).toMatchObject({
          result: { isError: true, structuredContent: { error: { code: 'saved' } } },
        })
      expect(cancelled).toEqual(['terminal-child'])
    } finally {
      await second.dispose()
    }
  },
)

test.each(['changed', 'removed'] as const)(
  'fails a nonterminal %s flow and cancels saved siblings',
  async (caseName) => {
    const cancelled: Array<string> = []
    const changed = { ...flow, version: 2 }
    const f = fixture({
      definition: caseName === 'changed' ? changed : undefined,
      registered: caseName !== 'removed',
      siblings: [{ tool: 'sibling:work', taskId: 'child-1' }],
      onCancel: async ({ taskId }) => {
        cancelled.push(taskId)
      },
    })
    const id = await persist(f)
    const { second, server } = f.createSecond()
    try {
      await second.recover(server.recoveryTools)
      await expect.poll(async () => (await second.get(id)).status).toBe('failed')
      expect(await second.get(id)).toMatchObject({
        error: { code: -32603, message: 'Flow definition changed' },
      })
      expect(cancelled).toEqual(['child-1'])
    } finally {
      await second.dispose()
    }
  },
)

test('catalogue drift fails recovery with formatted issues and cancels siblings', async () => {
  const tool = { id: 'sibling:work', inputSchema: { type: 'object' as const } }
  const definition: FlowDefinition = {
    ...flow,
    start: 'work',
    nodes: { work: { kind: 'tool', tool: tool.id, args: {}, next: 'done' }, ...flow.nodes },
  }
  let listed = true
  const cancelled: Array<string> = []
  const f = fixture({
    storedDefinition: definition,
    catalogue: () => (listed ? [tool] : []),
    siblings: [{ tool: tool.id, taskId: 'child-2' }],
    onCancel: async ({ taskId }) => {
      cancelled.push(taskId)
    },
  })
  const id = await persist(f)
  const { second, server } = f.createSecond()
  listed = false
  try {
    await second.recover(server.recoveryTools)
    await expect.poll(async () => (await second.get(id)).status).toBe('failed')
    expect(await second.get(id)).toMatchObject({
      error: {
        code: -32603,
        message: 'Flow no longer valid',
        data: { formatted: expect.stringContaining('unknown_tool') },
      },
    })
    expect(cancelled).toEqual(['child-2'])
  } finally {
    await second.dispose()
  }
})

test.each(['not-issued', 'outstanding'] as const)(
  'recovers input when the original key is %s',
  async (window) => {
    const state = await suspendedState(inputFlow)
    const f = fixture({ storedDefinition: inputFlow, state })
    const id = await persist(f)
    const key = inputKey(state)
    if (window === 'outstanding') {
      const previous = await f.store.get(id)
      if (previous === undefined) throw new Error('Task missing')
      await f.store.update(
        id,
        {
          status: 'input_required',
          inputs: [{ id: 1, requests: { [key]: inputRequest }, responses: {} }],
        },
        { revision: previous.revision },
      )
    }
    const { second, server } = f.createSecond()
    try {
      await second.recover(server.recoveryTools)
      await expect.poll(async () => (await second.get(id)).status).toBe('input_required')
      expect(await second.get(id)).toMatchObject({ inputRequests: { [key]: inputRequest } })
      expect((await f.store.get(id))?.inputs).toHaveLength(1)
      await second.update(id, { [key]: { action: 'accept', content: { value: 'Ada' } } })
      await expect.poll(async () => (await second.get(id)).status).toBe('completed')
      expect(await second.get(id)).toMatchObject({
        result: { structuredContent: { outcome: 'answered', output: { answer: 'Ada' } } },
      })
    } finally {
      await second.dispose()
    }
  },
)

test('recovers input by replaying an answer committed before the restart', async () => {
  const state = await suspendedState(inputFlow)
  const f = fixture({ storedDefinition: inputFlow, state })
  const id = await persist(f)
  const key = inputKey(state)
  const previous = await f.store.get(id)
  if (previous === undefined) throw new Error('Task missing')
  await f.store.update(
    id,
    {
      status: 'working',
      inputs: [
        {
          id: 1,
          requests: { [key]: inputRequest },
          responses: { [key]: { action: 'accept', content: { value: 'Ada' } } },
          outcome: 'answered',
        },
      ],
    },
    { revision: previous.revision },
  )
  const { second, server } = f.createSecond()
  try {
    await second.recover(server.recoveryTools)
    await expect.poll(async () => (await second.get(id)).status).toBe('completed')
    expect(await second.get(id)).toMatchObject({
      result: { structuredContent: { outcome: 'answered', output: { answer: 'Ada' } } },
    })
    expect((await f.store.get(id))?.inputs).toHaveLength(1)
  } finally {
    await second.dispose()
  }
})

test('an elapsed input deadline resumes the timeout edge without issuing a request', async () => {
  const state = await suspendedState(inputFlow)
  const expired = {
    ...state,
    pending: { ...state.pending, deadline: new Date(Date.now() - 1000).toISOString() },
  } as RunState
  const f = fixture({ storedDefinition: inputFlow, state: expired })
  const id = await persist(f)
  const { second, server } = f.createSecond()
  try {
    await second.recover(server.recoveryTools)
    await expect.poll(async () => (await second.get(id)).status).toBe('completed')
    expect(await second.get(id)).toMatchObject({
      result: { structuredContent: { outcome: 'timed' } },
    })
    expect((await f.store.get(id))?.inputs).toEqual([])
  } finally {
    await second.dispose()
  }
})

test('withdraws an outstanding expired input before asking at the timeout edge', async () => {
  const definition: FlowDefinition = {
    ...inputFlow,
    nodes: {
      ...inputFlow.nodes,
      ask: {
        kind: 'input',
        prompt: { value: 'Your name?' },
        schema: { type: 'string' },
        next: 'done',
        timeout: { afterMs: 60_000, to: 'ask-again' },
      },
      'ask-again': {
        kind: 'input',
        prompt: { value: 'Second answer?' },
        schema: { type: 'string' },
        next: 'done-again',
      },
      'done-again': {
        kind: 'end',
        outcome: 'answered-again',
        output: { answer: { ref: ['results', 'ask-again'] } },
      },
    },
  }
  const state = await suspendedState(definition)
  const expired = {
    ...state,
    pending: { ...state.pending, deadline: new Date(Date.now() - 1000).toISOString() },
  } as RunState
  const f = fixture({ storedDefinition: definition, state: expired })
  const id = await persist(f)
  const oldKey = inputKey(state)
  const previous = await f.store.get(id)
  if (previous === undefined) throw new Error('Task missing')
  await f.store.update(
    id,
    {
      status: 'input_required',
      inputs: [{ id: 1, requests: { [oldKey]: inputRequest }, responses: {} }],
    },
    { revision: previous.revision },
  )
  const { second, server } = f.createSecond()
  try {
    await second.recover(server.recoveryTools)
    await expect
      .poll(
        async () => Object.values((await second.get(id)).inputRequests ?? {})[0]?.params.message,
      )
      .toBe('Second answer?')
    const recovered = await second.get(id)
    expect(recovered.status).toBe('input_required')
    const [newKey] = Object.keys(recovered.inputRequests ?? {})
    if (newKey === undefined) throw new Error('Follow-up input was not issued')
    expect(newKey).not.toBe(oldKey)
    expect((await f.store.get(id))?.inputs[0]).toMatchObject({ outcome: 'withdrawn' })
    await second.update(id, { [newKey]: { action: 'accept', content: { value: 'Ada' } } })
    await expect.poll(async () => (await second.get(id)).status).toBe('completed')
    expect(await second.get(id)).toMatchObject({
      result: { structuredContent: { outcome: 'answered-again', output: { answer: 'Ada' } } },
    })
  } finally {
    await second.dispose()
  }
})

test('recovers a suspended sibling wait by its stored task ID', async () => {
  const tool = { id: 'sibling:work', inputSchema: { type: 'object' as const } }
  const definition: FlowDefinition = {
    ...flow,
    start: 'work',
    nodes: { work: { kind: 'tool', tool: tool.id, args: {}, next: 'done' }, ...flow.nodes },
  }
  const originalCaller: ToolCaller = {
    listTools: () => [tool],
    callTool: async () => ({ task: { taskId: 'child-3' } }),
    waitTask: async () => {
      throw new Error('Unexpected wait before crash')
    },
    cancelTask: async () => {},
  }
  const state = await suspendedState(definition, originalCaller)
  expect(state.pending?.data).toMatchObject({ taskId: 'child-3' })
  const waited: Array<string> = []
  const cancelled: Array<string> = []
  const f = fixture({
    storedDefinition: definition,
    state,
    approved: [tool.id],
    catalogue: () => [tool],
    siblings: [{ tool: tool.id, taskId: 'child-3' }],
    caller: {
      waitTask: async ({ taskId }) => {
        waited.push(taskId)
        return { content: [{ type: 'text', text: 'done' }] }
      },
      cancelTask: async ({ taskId }) => {
        cancelled.push(taskId)
      },
    },
  })
  const id = await persist(f)
  const { second, server } = f.createSecond()
  try {
    await second.recover(server.recoveryTools)
    await expect.poll(async () => (await second.get(id)).status).toBe('completed')
    expect(await second.get(id)).toMatchObject({
      result: { structuredContent: { outcome: 'finished' } },
    })
    expect(waited).toEqual(['child-3'])
    expect(cancelled).toEqual([])
  } finally {
    await second.dispose()
  }
})

test('recovers a suspended retry timer then retries the tool', async () => {
  const tool = { id: 'sibling:work', inputSchema: { type: 'object' as const } }
  const definition: FlowDefinition = {
    ...flow,
    start: 'work',
    nodes: {
      work: {
        kind: 'tool',
        tool: tool.id,
        args: {},
        next: 'done',
        retry: { maxAttempts: 2, backoff: { initialMs: 1 }, suspendAfterMs: 0 },
      },
      ...flow.nodes,
    },
  }
  const originalCaller: ToolCaller = {
    listTools: () => [tool],
    callTool: async () => {
      throw new Error('transient')
    },
    waitTask: async () => {
      throw new Error('Unexpected wait')
    },
    cancelTask: async () => {},
  }
  const state = await suspendedState(definition, originalCaller)
  expect(state.pending?.reason).toBe('retry')
  let retried = 0
  const f = fixture({
    storedDefinition: definition,
    state,
    approved: [tool.id],
    catalogue: () => [tool],
    caller: {
      callTool: async () => {
        retried++
        return { result: { content: [{ type: 'text', text: 'done' }] } }
      },
    },
  })
  const id = await persist(f)
  const { second, server } = f.createSecond()
  try {
    await second.recover(server.recoveryTools)
    await expect.poll(async () => (await second.get(id)).status).toBe('completed')
    expect(await second.get(id)).toMatchObject({
      result: { structuredContent: { outcome: 'finished' } },
    })
    expect(retried).toBe(1)
  } finally {
    await second.dispose()
  }
})

test('cancelling a recovered run aborts its graph work', async () => {
  const tool = { id: 'sibling:work', inputSchema: { type: 'object' as const } }
  const definition: FlowDefinition = {
    ...flow,
    start: 'work',
    nodes: { work: { kind: 'tool', tool: tool.id, args: {}, next: 'done' }, ...flow.nodes },
  }
  let entered = false
  let aborted = false
  const f = fixture({
    storedDefinition: definition,
    approved: [tool.id],
    catalogue: () => [tool],
    caller: {
      callTool: async ({ signal }) => {
        entered = true
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              aborted = true
              reject(signal.reason)
            },
            { once: true },
          )
        })
        throw new Error('Unexpected completion')
      },
    },
  })
  const id = await persist(f)
  const { second, server } = f.createSecond()
  try {
    await second.recover(server.recoveryTools)
    await expect.poll(() => entered).toBe(true)
    await second.cancel(id)
    await expect.poll(() => aborted).toBe(true)
    expect(await second.get(id)).toMatchObject({ status: 'cancelled' })
  } finally {
    await second.dispose()
  }
})
