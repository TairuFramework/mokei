import type { FlowDefinition } from '@sozai/flow-graph'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import { expect, test } from 'vitest'

import { checkFlow, checkInputNodes, toElicitationSchema } from '../src/definition-checks.js'
import { flowPlan } from '../src/plan.js'
import { createFlowRegistry } from '../src/registry.js'
import type { ToolCaller } from '../src/tool-caller.js'

const predictor = {
  predict: async () => {
    throw new Error('unused')
  },
}
const registry = createFlowRegistry([])
const caller: ToolCaller = {
  listTools: () => [{ id: 'local:fetch', inputSchema: { type: 'object' } }],
  callTool: async () => {
    throw new Error('unused')
  },
  waitTask: async () => {
    throw new Error('unused')
  },
  cancelTask: async () => {},
}

function definition(nodes: FlowDefinition['nodes']): FlowDefinition {
  return {
    id: 'test-flow',
    name: 'Test flow',
    version: 1,
    start: Object.keys(nodes)[0] ?? 'done',
    nodes,
  }
}

test('sends a flat object schema as requestedSchema without wrapping', () => {
  const schema = {
    type: 'object',
    properties: { name: { type: 'string' }, age: { type: 'integer' }, ok: { type: 'boolean' } },
    required: ['name'],
  }
  expect(toElicitationSchema(schema)).toEqual({ requestedSchema: schema, wrapped: false })
})

test.each([{ type: 'string' }, { type: 'number' }, { type: 'integer' }, { type: 'boolean' }])(
  'wraps a primitive schema as a value form: %j',
  (schema) => {
    expect(toElicitationSchema(schema)).toEqual({
      requestedSchema: { type: 'object', properties: { value: schema }, required: ['value'] },
      wrapped: true,
    })
  },
)

test('adds the string type MCP elicitation requires to a bare string enum', () => {
  expect(toElicitationSchema({ enum: ['yes', 'no'] })).toEqual({
    requestedSchema: {
      type: 'object',
      properties: { value: { type: 'string', enum: ['yes', 'no'] } },
      required: ['value'],
    },
    wrapped: true,
  })
  expect(
    toElicitationSchema({ type: 'object', properties: { answer: { enum: ['a', 'b'] } } }),
  ).toEqual({
    requestedSchema: {
      type: 'object',
      properties: { answer: { type: 'string', enum: ['a', 'b'] } },
    },
    wrapped: false,
  })
})

test.each([
  undefined,
  { type: 'array', items: { type: 'string' } },
  { type: 'object', properties: { nested: { type: 'object' } } },
  { type: 'object', properties: { items: { type: 'array' } } },
  { type: 'object', additionalProperties: { type: 'string' } },
  { type: 'object', required: ['name'] },
  { enum: [1, 2] },
  { type: 'number', enum: ['yes'] },
])('rejects a schema that cannot be an elicitation form: %j', (schema) => {
  expect(toElicitationSchema(schema)).toBeUndefined()
})

test('reports missing or nested input schemas at the node', () => {
  const flow = definition({
    ask: { kind: 'input', prompt: { value: 'Question?' }, next: 'done' },
    askAgain: {
      kind: 'input',
      prompt: { value: 'Again?' },
      schema: { type: 'array' },
      next: 'done',
    },
    done: { kind: 'end', outcome: 'done' },
  })
  expect(
    checkInputNodes(flow).filter((issue) => issue.code === 'input_schema_not_elicitable'),
  ).toMatchObject([
    { path: ['nodes', 'ask', 'schema'], severity: 'error' },
    { path: ['nodes', 'askAgain', 'schema'], severity: 'error' },
  ])
})

test('reports missing and constant non-string prompts but permits references', () => {
  const flow = definition({
    missing: { kind: 'input', schema: { type: 'string' }, next: 'done' },
    wrong: { kind: 'input', prompt: { value: 42 }, schema: { type: 'string' }, next: 'done' },
    dynamic: {
      kind: 'input',
      prompt: { ref: ['input', 'question'] },
      schema: { type: 'string' },
      next: 'done',
    },
    done: { kind: 'end', outcome: 'done' },
  })
  expect(
    checkInputNodes(flow).filter((issue) => issue.code === 'input_prompt_not_string'),
  ).toMatchObject([
    { path: ['nodes', 'missing', 'prompt'] },
    { path: ['nodes', 'wrong', 'prompt'] },
  ])
})

test('checkFlow adds a non-blocking warning without elicitation', async () => {
  const flow = definition({
    ask: {
      kind: 'input',
      prompt: { value: 'Question?' },
      schema: { type: 'string' },
      next: 'done',
    },
    done: { kind: 'end', outcome: 'done' },
  })
  const checked = await checkFlow({
    definition: flow,
    registry,
    caller,
    predictor,
    elicitation: false,
  })
  expect(checked.issues).toBeUndefined()
  expect(checked).toMatchObject({ value: flow })
  expect(checked.warnings).toMatchObject([
    { code: 'input_without_elicitation', severity: 'warning' },
  ])
  expect(checked.formatted).toContain('input_without_elicitation')
  expect(
    (await checkFlow({ definition: flow, registry, caller, predictor, elicitation: true }))
      .warnings,
  ).toEqual([])
})

test('checkFlow returns a Standard Schema result', async () => {
  const flow = definition({ done: { kind: 'end', outcome: 'done' } })
  const result: StandardSchemaV1.Result<FlowDefinition> = await checkFlow({
    definition: flow,
    registry,
    caller,
    predictor,
    elicitation: true,
  })
  expect(result).toMatchObject({ value: flow })
})

test('checkFlow includes input node errors in its formatted result', async () => {
  const flow = definition({
    ask: { kind: 'input', prompt: { value: 123 }, next: 'done' },
    done: { kind: 'end', outcome: 'done' },
  })
  const checked = await checkFlow({
    definition: flow,
    registry,
    caller,
    predictor,
    elicitation: true,
  })
  expect(checked).not.toHaveProperty('value')
  expect(checked.issues?.map((issue) => issue.code)).toEqual([
    'input_schema_not_elicitable',
    'input_prompt_not_string',
  ])
  expect(checked.formatted).toContain('input_schema_not_elicitable')
  expect(checked.formatted).toContain('input_prompt_not_string')
})

test('checkFlow returns input issues and a run graph bound to the live catalogue', async () => {
  const flow = definition({
    use: { kind: 'tool', tool: 'local:fetch', args: {}, next: 'done' },
    done: { kind: 'end', outcome: 'done' },
  })
  expect(
    (await checkFlow({ definition: flow, registry, caller, predictor, elicitation: true })).issues,
  ).toBeUndefined()
  const unavailable = await checkFlow({
    definition: flow,
    registry,
    caller: { ...caller, listTools: () => [] },
    predictor,
    elicitation: true,
  })
  expect(unavailable.issues?.some((issue) => issue.code === 'unknown_tool')).toBe(true)
  expect(unavailable.graphFor({ depth: 0, approved: new Set() }).check(flow).issues).toBeDefined()
})

test('graphFor reads a fresh catalogue for each run', async () => {
  const flow = definition({
    use: { kind: 'tool', tool: 'local:fetch', args: {}, next: 'done' },
    done: { kind: 'end', outcome: 'done' },
  })
  let available = true
  const liveCaller = {
    ...caller,
    listTools: () => (available ? caller.listTools() : []),
  }
  const checked = await checkFlow({
    definition: flow,
    registry,
    caller: liveCaller,
    predictor,
    elicitation: true,
  })
  expect(checked.issues).toBeUndefined()
  available = false
  expect(
    checked.graphFor({ depth: 1, approved: new Set(['local:fetch']) }).check(flow).issues,
  ).toBeDefined()
})

test('flowPlan lists sorted unique tool IDs and a factory predictor tool for decide nodes', () => {
  const flow = definition({
    first: { kind: 'tool', tool: 'z:tool', args: {}, next: 'second' },
    second: { kind: 'tool', tool: 'a:tool', args: {}, next: 'decide' },
    repeat: { kind: 'tool', tool: 'z:tool', args: {}, next: 'done' },
    decide: { kind: 'decide', default: 'done' },
    done: { kind: 'end', outcome: 'done' },
  })
  const factory = Object.assign((_run: { depth: number }) => predictor, { tool: 'm:predict' })
  expect(flowPlan(flow, factory)).toEqual(['a:tool', 'm:predict', 'z:tool'])
  expect(flowPlan(flow, predictor)).toEqual(['a:tool', 'z:tool'])
  expect(flowPlan(definition({ done: { kind: 'end', outcome: 'done' } }), factory)).toEqual([])
})

const end = { kind: 'end', outcome: 'done' } as const

function check(definition: unknown, flows: Array<FlowDefinition> = [], elicitation = true) {
  return checkFlow({
    definition,
    registry: createFlowRegistry(flows),
    caller,
    predictor,
    elicitation,
  })
}

test('reports flow_id_conflict for a runtime definition reusing a registered id', async () => {
  const registered = definition({ done: end })
  const runtime = definition({ done: { kind: 'end', outcome: 'other' } })
  const checked = await check(runtime, [registered])
  expect(checked.issues).toMatchObject([
    { code: 'flow_id_conflict', path: ['id'], severity: 'error' },
  ])
})

test('accepts a digest-equal copy of a registered flow', async () => {
  const registered = definition({ done: end })
  const checked = await check(structuredClone(registered), [registered])
  expect(checked.issues).toBeUndefined()
  expect(checked.warnings).toEqual([])
})

test('reports missing_flow for an unknown call target', async () => {
  const checked = await check(
    definition({ call: { kind: 'call', flow: 'nowhere', next: 'done' }, done: end }),
  )
  expect(checked.issues?.some((issue) => issue.code === 'missing_flow')).toBe(true)
})

const callee: FlowDefinition = {
  id: 'callee',
  name: 'Callee',
  version: 1,
  start: 'ask',
  nodes: {
    ask: { kind: 'input', prompt: { value: 'Question?' }, next: 'done' },
    done: end,
  },
} as unknown as FlowDefinition

test('reports callee input issues with a flows prefix', async () => {
  const checked = await check(
    definition({ call: { kind: 'call', flow: 'callee', version: 1, next: 'done' }, done: end }),
    [callee],
  )
  expect(checked.issues).toContainEqual(
    expect.objectContaining({
      code: 'input_schema_not_elicitable',
      path: ['flows', 'callee', 1, 'nodes', 'ask', 'schema'],
    }),
  )
})

test('warns input_without_elicitation for a callee input node', async () => {
  const valid = {
    ...callee,
    nodes: { ...callee.nodes, ask: { ...callee.nodes.ask, schema: { type: 'string' } } },
  } as FlowDefinition
  const root = definition({
    call: { kind: 'call', flow: 'callee', version: 1, next: 'done' },
    done: end,
  })
  const checked = await check(root, [valid], false)
  expect(checked.issues).toBeUndefined()
  expect(checked.warnings).toMatchObject([{ code: 'input_without_elicitation' }])
  expect((await check(root, [valid], true)).warnings).toEqual([])
})

test('does not duplicate root warnings', async () => {
  const root = { ...definition({ done: end, orphan: end }), start: 'done' }
  const checked = await check(root)
  expect(checked.issues).toBeUndefined()
  expect(checked.warnings.map((issue) => issue.code)).toEqual(['unreachable'])
})

test('malformed definitions return issues and never throw', async () => {
  const bad = { id: 'bad', name: 'Bad', version: 1, start: 'done' } as unknown as FlowDefinition
  const inputs = [
    {},
    { nodes: 3 },
    { id: 'x', version: 1, start: 'c', nodes: { c: { kind: 'call', flow: 'bad' } } },
  ]
  for (const input of inputs) {
    const checked = await check(input, [bad])
    expect(checked.issues).toBeDefined()
  }
})

test('returns a root-first lookup', async () => {
  const registered = definition({ done: end })
  const root = { ...definition({ done: end }), id: 'root' }
  const checked = await check(root, [registered])
  expect(checked.lookup('root', 1)).toBe(root)
  expect(checked.lookup('test-flow')).toEqual(registered)
})
