import { DirectTransports } from '@enkaku/transport'
import { ContextClient } from '@mokei/context-client'
import type { ClientMessage, ClientRequest, ServerMessage } from '@mokei/context-protocol'
import { META_CLIENT_CAPABILITIES, META_PROTOCOL_VERSION } from '@mokei/context-protocol'
import { ContextServer, createTaskManager } from '@mokei/context-server'
import type { createDecisionFlowGraph } from '@mokei/decision-flow'
import type { FlowDefinition } from '@sozai/flow-graph'
import { afterEach, expect, test, vi } from 'vitest'

import { createDecisionFlowServer, flowToolName } from '../src/index.js'
import type { ToolCaller } from '../src/tool-caller.js'

const startedSignals = vi.hoisted(() => [] as Array<AbortSignal | undefined>)

vi.mock('@mokei/decision-flow', async (importOriginal) => {
  const original = await importOriginal<{
    createDecisionFlowGraph: typeof createDecisionFlowGraph
  }>()
  return {
    ...original,
    createDecisionFlowGraph: (...args: Parameters<typeof createDecisionFlowGraph>) => {
      const graph = original.createDecisionFlowGraph(...args)
      return {
        ...graph,
        start: (params: Parameters<typeof graph.start>[0]) => {
          startedSignals.push(params.signal)
          return graph.start(params)
        },
      }
    },
  }
})

vi.mock('../src/driver.js', () => ({ startRun: () => new Promise(() => {}) }))

const predictor = {
  predict: async () => {
    throw new Error('unused')
  },
}
const caller: ToolCaller = {
  listTools: () => [],
  callTool: async () => {
    throw new Error('unused')
  },
  waitTask: async () => {
    throw new Error('unused')
  },
  cancelTask: async () => {},
}
const flow = (id = 'support/triage', input?: FlowDefinition['input']): FlowDefinition => ({
  id,
  name: 'Triage',
  version: 1,
  ...(input === undefined ? {} : { input }),
  start: 'done',
  nodes: { done: { kind: 'end', outcome: 'done' } },
})
const invalid = { ...flow(), start: 'missing' }

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

function setup(
  options: {
    flows?: Array<FlowDefinition>
    approval?: () => { tools: Array<string> } | undefined
    elicitation?: () => boolean
  } = {},
) {
  const pair = new DirectTransports<ServerMessage, ClientMessage>()
  const tasks = createTaskManager()
  const create = vi.spyOn(tasks, 'create')
  const approval = vi.fn(options.approval ?? (() => undefined))
  const definition = createDecisionFlowServer({
    caller,
    predictor,
    tasks,
    flows: options.flows,
    approval,
    elicitation: options.elicitation,
  })
  const server = new ContextServer({ ...definition.config, transport: pair.server })
  const client = new ContextClient({ protocolVersion: '2026-07-28', transport: pair.client })
  cleanups.push(async () => {
    await client.dispose()
    await server.dispose()
    await tasks.dispose()
    await pair.dispose()
  })
  return { client, create, approval, definition, tasks }
}

test('check_flow returns issues, formatted text, and the elicitation warning', async () => {
  const { client, create } = setup()
  const result = await client.callTool({
    name: 'check_flow',
    arguments: {
      definition: {
        ...flow(),
        start: 'ask',
        nodes: {
          ask: {
            kind: 'input',
            prompt: { value: 'Name?' },
            schema: { type: 'string' },
            next: 'done',
          },
          done: { kind: 'end', outcome: 'done' },
        },
      },
    },
  })
  expect(result.structuredContent).toMatchObject({
    ok: true,
    issues: [{ code: 'input_without_elicitation', severity: 'warning' }],
  })
  expect(result.structuredContent?.formatted).toContain('input_without_elicitation')
  expect(create).not.toHaveBeenCalled()
})

test('invalid run_flow returns formatted issues before approval or task creation', async () => {
  const { client, create, approval } = setup()
  const result = await client.callTool({ name: 'run_flow', arguments: { definition: invalid } })
  expect(result.isError).toBe(true)
  expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('start') })
  expect(create).not.toHaveBeenCalled()
  expect(approval).not.toHaveBeenCalled()
  await expect(client.tasks.get('unknown-task')).rejects.toThrow()
})

test.each([
  ['invalid', 'bad', 'Invalid flow depth'],
  ['negative', -1, 'Invalid flow depth'],
  ['limit', 4, 'Invalid flow depth'],
])('rejects %s depth before creating a task', async (_name, depth, message) => {
  const { client, create, approval } = setup()
  const result = await client.callTool({
    name: 'run_flow',
    arguments: { definition: flow() },
    _meta: { 'io.mokei/flow-depth': depth },
  })
  expect(result).toMatchObject({ isError: true, content: [{ type: 'text', text: message }] })
  expect(create).not.toHaveBeenCalled()
  expect(approval).not.toHaveBeenCalled()
})

test('absent depth is zero and reaches approval', async () => {
  const { client, create, approval } = setup()
  const result = await client.callTool({ name: 'run_flow', arguments: { definition: flow() } })
  expect(result).toMatchObject({ isError: true, content: [{ type: 'text', text: 'Flow denied' }] })
  expect(approval).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'run_flow' }))
  expect(create).not.toHaveBeenCalled()
})

test('denied grant leaves no task; approved grant reaches task.run', async () => {
  const denied = setup()
  const result = await denied.client.callTool({
    name: 'run_flow',
    arguments: { definition: flow() },
  })
  expect(result.isError).toBe(true)
  expect(denied.create).not.toHaveBeenCalled()

  const allowed = setup({ approval: () => ({ tools: [] }) })
  const started = await allowed.client.callTool({
    name: 'run_flow',
    arguments: { definition: flow() },
    task: 'handle',
  })
  expect(started.resultType).toBe('task')
  expect(allowed.create).toHaveBeenCalledTimes(1)
})

test('a flow run uses the task signal and tasks/cancel aborts it', async () => {
  const { client } = setup({ approval: () => ({ tools: [] }) })
  startedSignals.length = 0

  const result = await client.callTool({
    name: 'run_flow',
    arguments: { definition: flow() },
    task: 'handle',
  })
  expect(result).toMatchObject({ resultType: 'task' })
  if (result.resultType !== 'task' || typeof result.taskId !== 'string') return
  expect(startedSignals).toHaveLength(1)
  expect(startedSignals[0]?.aborted).toBe(false)

  await client.tasks.cancel(result.taskId)
  expect(startedSignals[0]?.aborted).toBe(true)
})

test('registered tools advertise normalized names and object input schemas', async () => {
  const { client, definition } = setup({
    flows: [
      flow('support/triage', { type: 'object', properties: { topic: { type: 'string' } } }),
      flow('plain'),
    ],
  })
  expect(flowToolName('support/triage')).toBe('flow_support_triage')
  const listed = (await client.listTools()).tools
  expect(listed.find((tool) => tool.name === 'flow_support_triage')?.inputSchema).toEqual({
    type: 'object',
    properties: { topic: { type: 'string' } },
  })
  expect(listed.find((tool) => tool.name === 'flow_plain')?.inputSchema).toEqual({ type: 'object' })
  expect(Object.keys(definition.recoveryTools)).toEqual(
    expect.arrayContaining(['check_flow', 'run_flow', 'flow_plain']),
  )
})

test('registered run checks depth and grant before task creation', async () => {
  const { client, create } = setup({ flows: [flow()] })
  const result = await client.callTool({ name: 'flow_support_triage', arguments: {} })
  expect(result).toMatchObject({ isError: true, content: [{ type: 'text', text: 'Flow denied' }] })
  expect(create).not.toHaveBeenCalled()
})

test('malformed approval leaves no task', async () => {
  const { client, create } = setup({
    approval: () => ({ tools: [42] as unknown as Array<string> }),
  })
  const result = await client.callTool({ name: 'run_flow', arguments: { definition: flow() } })
  expect(result).toMatchObject({ isError: true, content: [{ type: 'text', text: 'Flow denied' }] })
  expect(create).not.toHaveBeenCalled()
})

test('registered run rejects depth at the limit before approval', async () => {
  const { client, create, approval } = setup({ flows: [flow()] })
  const result = await client.callTool({
    name: 'flow_support_triage',
    arguments: {},
    _meta: { 'io.mokei/flow-depth': 4 },
  })
  expect(result).toMatchObject({
    isError: true,
    content: [{ type: 'text', text: 'Invalid flow depth' }],
  })
  expect(approval).not.toHaveBeenCalled()
  expect(create).not.toHaveBeenCalled()
})

test('task tool requires the client tasks extension', async () => {
  const pair = new DirectTransports<ServerMessage, ClientMessage>()
  const tasks = createTaskManager()
  const create = vi.spyOn(tasks, 'create')
  const definition = createDecisionFlowServer({
    caller,
    predictor,
    tasks,
    approval: () => ({ tools: [] }),
  })
  const server = new ContextServer({ ...definition.config, transport: pair.server })
  cleanups.push(async () => {
    await server.dispose()
    await tasks.dispose()
    await pair.dispose()
  })
  pair.client.write({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'run_flow',
      arguments: { definition: flow() },
      _meta: { [META_PROTOCOL_VERSION]: '2026-07-28', [META_CLIENT_CAPABILITIES]: {} },
    },
  } as ClientRequest)
  const response = await pair.client.read()
  expect(response.done).toBe(false)
  expect(response.value).toMatchObject({ error: { code: -32021 } })
  expect(create).not.toHaveBeenCalled()
})

test('construction rejects invalid registered schemas, collisions, and invalid flows', () => {
  const tasks = createTaskManager()
  cleanups.push(() => tasks.dispose())
  const params = { caller, predictor, tasks, approval: () => undefined }
  expect(() =>
    createDecisionFlowServer({ ...params, flows: [flow('bad', { type: 'string' })] }),
  ).toThrow()
  expect(() => createDecisionFlowServer({ ...params, flows: [flow('a/b'), flow('a_b')] })).toThrow()
  expect(() => createDecisionFlowServer({ ...params, flows: [invalid] })).toThrow()
})
