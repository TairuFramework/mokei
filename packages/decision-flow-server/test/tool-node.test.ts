import type { CallToolResult } from '@mokei/context-protocol'
import { RPCError } from '@mokei/context-rpc'
import type { JSONValue } from '@mokei/context-server'
import { createFlowGraph, type FlowDefinition, type RunState } from '@sozai/flow-graph'
import { describe, expect, test } from 'vitest'

import type { CatalogTool, ToolCaller } from '../src/tool-caller.js'
import { type ToolErrorCode, ToolNodeError } from '../src/tool-errors.js'
import { toolKind } from '../src/tool-node.js'

const inputSchema = {
  type: 'object' as const,
  properties: { count: { type: 'number' as const } },
  required: ['count'],
  additionalProperties: false,
}
const outputSchema = {
  type: 'object' as const,
  properties: { value: { type: 'number' as const } },
  required: ['value'],
  additionalProperties: false,
}
const tool: CatalogTool = { id: 'sibling:work', inputSchema }
const signal = new AbortController().signal

function definition(node: Record<string, unknown> = {}): FlowDefinition {
  const work = Object.fromEntries(
    Object.entries({
      kind: 'tool',
      tool: tool.id,
      args: { count: { value: 1 } },
      next: 'done',
      ...node,
    }).filter(([, value]) => value !== undefined),
  )
  return {
    id: 'tool-test',
    name: 'Tool test',
    version: 1,
    start: 'work',
    nodes: {
      work: work as FlowDefinition['nodes'][string],
      done: { kind: 'end', outcome: 'done' },
      alternate: { kind: 'end', outcome: 'alternate' },
      handled: { kind: 'end', outcome: 'handled' },
    },
  }
}

function fakeCaller(
  dispatch: ToolCaller['callTool'] = async () => ({ result: { content: [] } }),
): ToolCaller {
  return {
    listTools: () => [tool],
    callTool: dispatch,
    waitTask: async () => ({ content: [] }),
    cancelTask: async () => {},
  }
}

function graph(
  options: {
    caller?: ToolCaller
    catalogue?: Array<CatalogTool>
    approved?: ReadonlySet<string>
    depth?: number
  } = {},
) {
  return createFlowGraph({
    kinds: [
      toolKind({
        caller: options.caller ?? fakeCaller(),
        catalogue: options.catalogue ?? [tool],
        depth: options.depth ?? 0,
        approved: options.approved ?? new Set([tool.id]),
      }),
    ],
  })
}

function issue(def: FlowDefinition, catalogue: Array<CatalogTool> = [tool]) {
  return graph({ catalogue }).check(def).issues
}

describe('toolKind check', () => {
  test('unknown tool reports available IDs', () => {
    const found = issue(definition({ tool: 'missing:work' })).find(
      (entry) => entry.code === 'unknown_tool',
    )
    expect(found).toMatchObject({ path: ['nodes', 'work', 'tool'] })
    expect(found?.hint).toContain(tool.id)
  })

  test('invalid constant arguments report a check issue', () => {
    expect(
      issue(definition({ args: { count: { value: 'wrong' } } })).some(
        (entry) => entry.code === 'tool_invalid_args',
      ),
    ).toBe(true)
  })

  test('references are checked against producer outputSchema', () => {
    const def = definition({ args: { count: { ref: ['results', 'first', 'missing'] } } })
    def.start = 'first'
    def.nodes.first = { kind: 'tool', tool: tool.id, args: { count: { value: 1 } }, next: 'work' }
    const outputTool = { ...tool, outputSchema }
    expect(issue(def, [outputTool]).some((entry) => entry.code === 'invalid_result_path')).toBe(
      true,
    )
  })

  test('accepts a field reference from a tool without outputSchema', () => {
    const def = definition({ args: { count: { ref: ['results', 'first', 'count'] } } })
    def.start = 'first'
    def.nodes.first = { kind: 'tool', tool: tool.id, args: { count: { value: 1 } }, next: 'work' }
    expect(issue(def).some((entry) => entry.code === 'invalid_result_path')).toBe(false)
  })

  test('validates mixed constant args with root definitions and rejects unknown keys', () => {
    const withReferences: CatalogTool = {
      id: tool.id,
      inputSchema: {
        type: 'object',
        definitions: { count: { type: 'number' } },
        properties: {
          count: { $ref: '#/definitions/count' },
          dynamic: { type: 'number' },
        },
        required: ['count', 'dynamic'],
        additionalProperties: false,
      },
    }
    const dynamic = { ref: ['input', 'dynamic'] }
    const invalidValue = definition({
      args: { count: { value: 'wrong' }, dynamic },
    })
    expect(() => issue(invalidValue, [withReferences])).not.toThrow()
    expect(
      issue(invalidValue, [withReferences]).some((entry) => entry.code === 'tool_invalid_args'),
    ).toBe(true)

    const unknownKey = definition({
      args: { count: { value: 1 }, dynamic, unknown: { value: true } },
    })
    expect(
      issue(unknownKey, [withReferences]).some((entry) => entry.code === 'tool_invalid_args'),
    ).toBe(true)

    const valid = definition({ args: { count: { value: 1 }, dynamic } })
    expect(issue(valid, [withReferences]).some((entry) => entry.code === 'tool_invalid_args')).toBe(
      false,
    )
  })

  test('rejects output schema top-level error property', () => {
    const reserved = {
      ...tool,
      outputSchema: { type: 'object' as const, properties: { error: { type: 'string' as const } } },
    }
    expect(
      issue(definition(), [reserved]).some((entry) => entry.code === 'tool_output_reserved_field'),
    ).toBe(true)
  })

  test.each([
    ['neither route', { next: undefined }],
    ['both routes', { cases: [], default: 'done' }],
    ['cases without default', { next: undefined, cases: [] }],
    ['default without cases', { next: undefined, default: 'done' }],
  ])('rejects %s', (_name, node) => {
    expect(issue(definition(node)).some((entry) => entry.code === 'tool_invalid_targets')).toBe(
      true,
    )
  })

  test('targets include cases, default and onError', () => {
    const def = definition({
      next: undefined,
      cases: [{ when: { path: ['input'], is: { equalTo: true } }, to: 'alternate' }],
      default: 'done',
      onError: 'handled',
    })
    expect(graph().check(def).ok).toBe(true)
  })

  test('checks without an approved set', () => {
    const checking = createFlowGraph({
      kinds: [toolKind({ caller: fakeCaller(), catalogue: [tool], depth: 0 })],
    })
    expect(checking.check(definition()).ok).toBe(true)
  })
})

describe('toolKind execute', () => {
  test.each([
    ['tool_error', false],
    ['tool_call_failed', true],
    ['tool_rejected', false],
    ['tool_invalid_args', false],
    ['tool_invalid_output', false],
    ['tool_unavailable', false],
    ['tool_not_approved', false],
    ['tool_task_failed', false],
    ['tool_task_cancelled', false],
  ] satisfies Array<[ToolErrorCode, boolean]>)('classifies retry for %s', (code, retryable) => {
    const kind = toolKind({ caller: fakeCaller(), catalogue: [tool], depth: 0 })
    const error = new ToolNodeError(code, code, retryable)
    expect(kind.describeError?.(error)).toMatchObject({ type: code })
    expect(kind.retryable?.(error)).toBe(retryable)
  })

  test('resolves and validates before approval and dispatch', async () => {
    const calls: Array<Record<string, unknown>> = []
    const caller = fakeCaller(async (params) => {
      calls.push(params)
      return { result: { content: [] } }
    })
    const valid = await graph({ caller }).run({
      definition: definition({ args: { count: { ref: ['input', 'count'] } } }),
      input: { count: 2 },
    })
    expect(valid.status).toBe('ended')
    expect(calls[0]?.arguments).toEqual({ count: 2 })

    const invalid = await graph({ caller }).run({
      definition: definition({ args: { count: { ref: ['input', 'count'] } }, onError: 'handled' }),
      input: { count: 'bad' },
    })
    expect(invalid.runState.frames[0]?.results.work).toMatchObject({
      error: { type: 'tool_invalid_args' },
    })
    expect(calls).toHaveLength(1)

    const denied = await graph({ caller, approved: new Set() }).run({
      definition: definition({ onError: 'handled' }),
      input: {},
    })
    expect(denied.runState.frames[0]?.results.work).toMatchObject({
      error: { type: 'tool_not_approved' },
    })
    expect(calls).toHaveLength(1)
  })

  test.each([
    ['structured', { content: [], structuredContent: { value: 3 } }, { value: 3 }],
    ['JSON text', { content: [{ type: 'text', text: '{"value":3}' }] }, { value: 3 }],
    ['plain text', { content: [{ type: 'text', text: 'hello' }] }, 'hello'],
  ] as const)('maps %s without an output schema', async (_name, result, expected) => {
    const run = await graph({
      caller: fakeCaller(async () => ({ result: result as unknown as CallToolResult })),
    }).run({ definition: definition(), input: {} })
    expect(run.runState.frames[0]?.results.work).toEqual(expected)
  })

  test('requires valid structuredContent with outputSchema', async () => {
    const catalogued = { ...tool, outputSchema }
    const good = await graph({
      catalogue: [catalogued],
      caller: fakeCaller(async () => ({
        result: { content: [], structuredContent: { value: 5 } },
      })),
    }).run({ definition: definition(), input: {} })
    expect(good.runState.frames[0]?.results.work).toEqual({ value: 5 })
    for (const result of [{ content: [] }, { content: [], structuredContent: { value: 'bad' } }]) {
      const run = await graph({
        catalogue: [catalogued],
        caller: fakeCaller(async () => ({ result: result as CallToolResult })),
      }).run({ definition: definition({ onError: 'handled' }), input: {} })
      expect(run.runState.frames[0]?.results.work).toMatchObject({
        error: { type: 'tool_invalid_output' },
      })
    }
  })

  test('selects a case using the stored tool result', async () => {
    const catalogued = { ...tool, outputSchema }
    const def = definition({
      next: undefined,
      cases: [
        { when: { path: ['results', 'work', 'value'], is: { equalTo: 5 } }, to: 'alternate' },
      ],
      default: 'done',
    })
    const run = await graph({
      catalogue: [catalogued],
      caller: fakeCaller(async () => ({
        result: { content: [], structuredContent: { value: 5 } },
      })),
    }).run({ definition: def, input: {} })
    expect(run.status).toBe('ended')
    expect(run.outcome).toBe('alternate')
  })

  test.each([
    [
      'tool_invalid_args',
      { args: { count: { ref: ['input', 'count'] } } },
      { count: 'bad' },
      new Set([tool.id]),
      [tool],
    ],
    ['tool_not_approved', {}, {}, new Set<string>(), [tool]],
    ['tool_unavailable', {}, {}, new Set([tool.id]), []],
  ] as const)(
    'surfaces unhandled %s in RunError',
    async (code, node, input, approved, available) => {
      const caller = { ...fakeCaller(), listTools: () => [...available] }
      const run = await graph({ caller, approved }).run({ definition: definition(node), input })
      expect(run.error?.lastFailure).toMatchObject({ type: code })
    },
  )

  test('surfaces unhandled invalid output and tool result errors', async () => {
    const catalogued = { ...tool, outputSchema }
    const invalid = await graph({ catalogue: [catalogued], caller: fakeCaller() }).run({
      definition: definition(),
      input: {},
    })
    expect(invalid.error?.lastFailure).toMatchObject({ type: 'tool_invalid_output' })
    const errored = await graph({
      caller: fakeCaller(async () => ({ result: { content: [], isError: true } })),
    }).run({ definition: definition(), input: {} })
    expect(errored.error?.lastFailure).toMatchObject({ type: 'tool_error' })
  })

  test.each([
    ['tool_error', async () => ({ result: { content: [], isError: true } })],
    [
      'tool_unavailable',
      async () => {
        throw Object.assign(new Error('gone'), { code: 'tool_unavailable' })
      },
    ],
    [
      'tool_rejected',
      async () => {
        throw new RPCError({ code: -32602, message: 'bad' })
      },
    ],
    [
      'tool_call_failed',
      async () => {
        throw new RPCError({ code: -32603, message: 'internal' })
      },
    ],
    [
      'tool_call_failed',
      async () => {
        throw new Error('transport')
      },
    ],
  ] as const)('reports %s in handled and unhandled failures', async (code, dispatch) => {
    const caller = fakeCaller(dispatch as ToolCaller['callTool'])
    const handled = await graph({ caller }).run({
      definition: definition({ onError: 'handled' }),
      input: {},
    })
    expect(handled.runState.frames[0]?.results.work).toMatchObject({ error: { type: code } })
    const failed = await graph({ caller }).run({ definition: definition(), input: {} })
    expect(failed.error?.lastFailure).toMatchObject({ type: code })
  })

  test('suspends on sibling task and maps successful, failed, and cancelled resume', async () => {
    const caller = fakeCaller(async () => ({ task: { taskId: 'task-1' } }))
    const cases: Array<{ value: JSONValue; code?: string }> = [
      { value: { ok: true, result: { content: [{ type: 'text', text: 'done' }] } } },
      { value: { ok: false, status: 'failed', error: 'lost' }, code: 'tool_task_failed' },
      { value: { ok: false, status: 'cancelled' }, code: 'tool_task_cancelled' },
    ]
    for (const { value, code } of cases) {
      const def = definition({ onError: 'handled' })
      const runtime = graph({ caller })
      const suspended = await runtime.run({ definition: def, input: {} })
      expect(suspended.status).toBe('suspended')
      expect(suspended.pending?.data).toEqual({ tool: tool.id, taskId: 'task-1' })
      let final: RunState | undefined
      for await (const state of runtime.resume({
        definition: def,
        runState: suspended.runState,
        event: { type: 'value', value },
      }))
        final = state
      expect(final?.status).toBe('ended')
      expect(final?.frames[0]?.results.work).toEqual(
        code ? { error: expect.objectContaining({ type: code }) } : 'done',
      )
      if (code) {
        const unhandled = definition()
        const second = await runtime.run({ definition: unhandled, input: {} })
        let failed: RunState | undefined
        for await (const state of runtime.resume({
          definition: unhandled,
          runState: second.runState,
          event: { type: 'value', value },
        }))
          failed = state
        expect(failed?.error?.lastFailure).toMatchObject({ type: code })
      }
    }
  })

  test('retries internal RPC errors but does not retry rejected RPC errors', async () => {
    for (const [rpcCode, expectedCalls] of [
      [-32603, 2],
      [-32602, 1],
    ] as const) {
      let calls = 0
      const caller = fakeCaller(async () => {
        calls += 1
        if (calls === 1) throw new RPCError({ code: rpcCode, message: 'sibling failure' })
        return { result: { content: [] } }
      })
      const run = await graph({ caller }).run({
        definition: definition({ retry: { maxAttempts: 2, backoff: { initialMs: 0 } } }),
        input: {},
      })
      expect(calls).toBe(expectedCalls)
      expect(run.status).toBe(rpcCode === -32603 ? 'ended' : 'error')
    }
  })

  test('uses stable operation key and increments attempt across retry', async () => {
    const calls: Array<Parameters<ToolCaller['callTool']>[0]> = []
    const caller = fakeCaller(async (params) => {
      calls.push(params)
      if (calls.length === 1) throw new Error('temporary')
      return { result: { content: [] } }
    })
    const run = await graph({ caller, depth: 2 }).run({
      definition: definition({ retry: { maxAttempts: 2, backoff: { initialMs: 0 } } }),
      input: {},
      signal,
    })
    expect(run.status).toBe('ended')
    expect(calls).toHaveLength(2)
    expect(calls[0]?.meta).toMatchObject({ 'io.mokei/flow-depth': 3, 'io.mokei/attempt': 1 })
    expect(calls[1]?.meta).toMatchObject({ 'io.mokei/flow-depth': 3, 'io.mokei/attempt': 2 })
    expect(calls[0]?.meta['io.mokei/idempotency-key']).toBe(
      calls[1]?.meta['io.mokei/idempotency-key'],
    )
    expect(calls[0]?.meta['io.mokei/idempotency-key']).toMatch(
      new RegExp(`^${run.runState.runID}:.+$`),
    )
  })
})
