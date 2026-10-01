import type { CallToolResult } from '@mokei/context-protocol'
import { createMemoryTaskStore, type JSONValue } from '@mokei/context-server'
import {
  type AgentEvent,
  AgentSession,
  Session,
  type ToolApprovalRequest,
  type ToolApprovalStrategy,
} from '@mokei/session'
import type { FlowDefinition } from '@sozai/flow-graph'
import { afterEach, expect, test, vi } from 'vitest'

import { type AuthorizeResult, type FlowApprovalRequest, flowToolName } from '../src/index.js'
import {
  hostToolCaller,
  markDecisionFlowContext,
  unmarkDecisionFlowContext,
} from '../src/tool-caller.js'
import { addDecisionFlow } from '../src/wiring.js'

const flow: FlowDefinition = {
  id: 'support/triage',
  name: 'Triage',
  version: 1,
  start: 'done',
  nodes: { done: { kind: 'end', outcome: 'done' } },
}
const toolFlow: FlowDefinition = {
  ...flow,
  id: 'uses-echo',
  name: 'Uses echo',
  start: 'use',
  nodes: {
    use: { kind: 'tool', tool: 'local:echo', args: {}, next: 'done' },
    done: { kind: 'end', outcome: 'done' },
  },
}
const sessions: Array<Session> = []
const wirings: Array<{ dispose(): Promise<void> }> = []

function session() {
  const value = new Session()
  sessions.push(value)
  return value
}

function request(name: string, args: unknown): ToolApprovalRequest {
  return {
    iteration: 1,
    history: [],
    signal: new AbortController().signal,
    toolCall: { id: 'call', name, arguments: JSON.stringify(args), raw: {} },
  }
}

function text(result: CallToolResult): string {
  return result.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('')
}

async function runAgentCall(
  value: Session,
  toolCall: ToolApprovalRequest['toolCall'],
  approval: ToolApprovalStrategy,
): Promise<Array<AgentEvent>> {
  const events: Array<AgentEvent> = []
  let turn = 0
  const provider = {
    listModels: async () => [{ id: 'test-model', raw: { id: 'test-model' } }],
    embed: async () => ({ embeddings: [] }),
    toolFromMCP: (tool: { name: string; description?: string }) => ({
      name: tool.name,
      description: tool.description ?? '',
    }),
    streamChat: () => {
      const parts = [
        ...(turn++ === 0
          ? [{ type: 'tool-call', toolCalls: [toolCall], raw: {} }]
          : [{ type: 'text-delta', text: 'done', raw: {} }]),
        { type: 'done', inputTokens: 1, outputTokens: 1, raw: {} },
      ]
      const stream = new ReadableStream({
        start(controller) {
          for (const part of parts) controller.enqueue(part)
          controller.close()
        },
      })
      return Object.assign(Promise.resolve(stream), {
        signal: new AbortController().signal,
        abort: () => undefined,
      })
    },
    aggregateMessage: (parts: Array<{ text?: string; toolCalls?: Array<unknown> }>) => ({
      source: 'aggregated',
      role: 'assistant',
      text: parts.map((part) => part.text ?? '').join(''),
      toolCalls: parts.flatMap((part) => part.toolCalls ?? []),
      inputTokens: 1,
      outputTokens: 1,
    }),
  } as unknown as ConstructorParameters<typeof AgentSession>[0]['provider']
  const agent = new AgentSession({
    session: value,
    provider,
    model: 'test-model',
    toolApproval: approval,
    onEvent(event) {
      events.push(event)
    },
  })
  try {
    await agent.run({ prompt: 'run the flow' })
    return events
  } finally {
    await agent.dispose()
  }
}

async function call(
  value: Session,
  name: string,
  args: Record<string, unknown>,
  meta: Record<string, string> = {},
): Promise<CallToolResult> {
  return value.contextHost.callNamespacedTool({ id: name, arguments: args, _meta: meta })
}

afterEach(async () => {
  for (const wiring of wirings.splice(0)) await wiring.dispose()
  for (const value of sessions.splice(0)) await value.dispose()
  vi.useRealTimers()
})

test('wiring exposes registered flow lookup and summaries as snapshots', async () => {
  const value = session()
  const definition = structuredClone(flow)
  const wiring = await addDecisionFlow(value, { key: 'flow', flows: [definition] })
  wirings.push(wiring)
  definition.name = 'Changed'
  expect(wiring.lookupFlow(flow.id)).toEqual(flow)
  expect(wiring.lookupFlow('missing')).toBeUndefined()
  const summaries = wiring.flows()
  expect(summaries).toEqual([
    {
      id: flow.id,
      name: flow.name,
      version: flow.version,
      input: { type: 'object' },
      outputs: [],
      outcomes: ['done'],
    },
  ])
  const found = wiring.lookupFlow(flow.id)
  if (found === undefined) throw new Error('Expected registered flow')
  found.name = 'Changed lookup'
  const summary = summaries[0]
  if (summary === undefined) throw new Error('Expected flow summary')
  summary.name = 'Changed summary'
  expect(wiring.lookupFlow(flow.id)?.name).toBe(flow.name)
  expect(wiring.flows()[0]?.name).toBe(flow.name)
})

test('authorize returns plan, digest and a grant for a registered flow', async () => {
  const value = session()
  value.contextHost.addLocalTool({
    name: 'echo',
    inputSchema: { type: 'object' },
    execute: () => ({ content: [] }),
  })
  const wiring = await addDecisionFlow(value, { key: 'flow', flows: [toolFlow] })
  wirings.push(wiring)
  const toolName = flowToolName('uses-echo')
  const result: AuthorizeResult = await wiring.authorize({ toolName, arguments: {} })
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.issues.join('\n'))
  expect(result.plan).toEqual(['local:echo'])
  expect(result.digest).toEqual(expect.any(String))
  expect(result.digest?.length).toBeGreaterThan(0)
  const meta = result.grant()
  expect(meta).toEqual({ 'dev.mokei/flow-grant': expect.any(String) })
  const invoke = () =>
    value.contextHost.callNamespacedTool({
      id: `flow:${toolName}`,
      arguments: {},
      _meta: meta,
    })
  expect((await invoke()).isError).not.toBe(true)
  expect(text(await invoke())).toBe('Flow denied')
})

test('authorize for run_flow has no digest', async () => {
  const value = session()
  const wiring = await addDecisionFlow(value, { key: 'flow', flows: [flow] })
  wirings.push(wiring)
  const result = await wiring.authorize({
    toolName: 'run_flow',
    arguments: { definition: flow as unknown as JSONValue },
  })
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.issues.join('\n'))
  expect(result.digest).toBeUndefined()
  expect(result.plan).toEqual([])
  expect(
    (
      await value.contextHost.callNamespacedTool({
        id: 'flow:run_flow',
        arguments: { definition: flow },
        _meta: result.grant(),
      })
    ).isError,
  ).not.toBe(true)
})

test.each(['registered', 'inline'] as const)(
  'grant retains the checked arguments for a %s flow after caller mutation',
  async (kind) => {
    const value = session()
    const wiring = await addDecisionFlow(value, { key: 'flow', flows: [flow] })
    wirings.push(wiring)
    const toolName = kind === 'registered' ? flowToolName(flow.id) : 'run_flow'
    const args = {
      ...(kind === 'inline' ? { definition: structuredClone(flow) as unknown as JSONValue } : {}),
      input: { message: 'original' },
    }
    const original = structuredClone(args)
    const result = await wiring.authorize({ toolName, arguments: args })
    if (!result.ok) throw new Error(result.issues.join('\n'))
    args.input.message = 'mutated'

    expect(
      (
        await value.contextHost.callNamespacedTool({
          id: `flow:${toolName}`,
          arguments: original,
          _meta: result.grant(),
        })
      ).isError,
    ).not.toBe(true)
    const rejected = await value.contextHost.callNamespacedTool({
      id: `flow:${toolName}`,
      arguments: args,
      _meta: result.grant(),
    })
    expect(rejected.isError).toBe(true)
    expect(text(rejected)).toBe('Flow denied')
  },
)

test('grant retains the checked tools after the returned plan is mutated', async () => {
  const value = session()
  const store = createMemoryTaskStore()
  for (const name of ['echo', 'other']) {
    value.contextHost.addLocalTool({
      name,
      inputSchema: { type: 'object' },
      execute: () => ({ content: [] }),
    })
  }
  const wiring = await addDecisionFlow(value, { key: 'flow', store })
  wirings.push(wiring)
  const args = { definition: structuredClone(toolFlow) as unknown as JSONValue }
  const result = await wiring.authorize({ toolName: 'run_flow', arguments: args })
  if (!result.ok) throw new Error(result.issues.join('\n'))
  expect(result.plan).toEqual(['local:echo'])
  result.plan.splice(0, result.plan.length, 'local:other')

  expect(
    (
      await value.contextHost.callNamespacedTool({
        id: 'flow:run_flow',
        arguments: args,
        _meta: result.grant(),
      })
    ).isError,
  ).not.toBe(true)
  const records = await store.list({
    status: ['working', 'input_required', 'completed', 'failed', 'cancelled'],
  })
  expect(records).toHaveLength(1)
  expect(records[0]?.resumeData).toMatchObject({ approved: ['local:echo'] })

  const changed = structuredClone(toolFlow)
  changed.nodes.use = { kind: 'tool', tool: 'local:other', args: {}, next: 'done' }
  const rejected = await value.contextHost.callNamespacedTool({
    id: 'flow:run_flow',
    arguments: { definition: changed },
    _meta: result.grant(),
  })
  expect(rejected.isError).toBe(true)
  expect(text(rejected)).toBe('Flow denied')
})

test('authorize reports issues for an invalid inline definition', async () => {
  const value = session()
  const wiring = await addDecisionFlow(value, { key: 'flow' })
  wirings.push(wiring)
  const result = await wiring.authorize({
    toolName: 'run_flow',
    arguments: { definition: { id: 'x' } },
  })
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('Expected invalid definition')
  expect(result.issues.length).toBeGreaterThan(0)
  expect(result.issues.every((issue) => typeof issue === 'string' && issue.length > 0)).toBe(true)
})

test('authorize rejects an unknown tool name', async () => {
  const value = session()
  const wiring = await addDecisionFlow(value, { key: 'flow' })
  wirings.push(wiring)
  expect(await wiring.authorize({ toolName: 'flow_nope', arguments: {} })).toEqual({
    ok: false,
    issues: ['Unknown flow tool: flow_nope'],
  })
})

test('grant is minted only when called', async () => {
  vi.useFakeTimers()
  const value = session()
  const wiring = await addDecisionFlow(value, { key: 'flow' })
  wirings.push(wiring)
  const args = { definition: flow as unknown as JSONValue }
  const first = await wiring.authorize({ toolName: 'run_flow', arguments: args })
  const second = await wiring.authorize({ toolName: 'run_flow', arguments: args })
  expect(first.ok).toBe(true)
  expect(second.ok).toBe(true)
  expect(text(await call(value, 'flow:run_flow', args))).toBe('Flow denied')
  if (!first.ok) throw new Error(first.issues.join('\n'))
  vi.setSystemTime(Date.now() + 300_001)
  expect(
    (
      await value.contextHost.callNamespacedTool({
        id: 'flow:run_flow',
        arguments: args,
        _meta: first.grant(),
      })
    ).isError,
  ).not.toBe(true)
})

test('check returns the checkFlow result', async () => {
  const value = session()
  const wiring = await addDecisionFlow(value, { key: 'flow', flows: [flow] })
  wirings.push(wiring)
  const checked = await wiring.check(flow)
  expect(checked.issues).toBeUndefined()
  expect(checked).toMatchObject({ value: flow, warnings: [], formatted: '' })
  expect(checked.graphFor({ depth: 0, approved: new Set() }).check(flow).issues).toBeUndefined()
  const invalid = await wiring.check({ ...flow, id: 'invalid', start: 'missing' })
  expect(invalid.issues).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: 'unknown_target', path: ['start'] })]),
  )
  expect(invalid.formatted).toContain('missing')
})

test('new AgentSession advertises and executes inline and registered flows without host.setup', async () => {
  const value = session()
  const wiring = await addDecisionFlow(value, { key: 'flow', flows: [flow] })
  wirings.push(wiring)
  const seenTools: Array<Array<string>> = []
  let turn = 0
  const provider = {
    listModels: async () => [{ id: 'test-model', raw: { id: 'test-model' } }],
    embed: async () => ({ embeddings: [] }),
    toolFromMCP: (tool: { name: string; description?: string }) => ({
      name: tool.name,
      description: tool.description ?? '',
    }),
    streamChat: (params: { tools: Array<{ name: string }> }) => {
      seenTools.push(params.tools.map((tool) => tool.name))
      const toolCalls =
        turn++ === 0
          ? [
              {
                id: 'a',
                name: 'flow:run_flow',
                arguments: JSON.stringify({ definition: flow }),
                raw: {},
              },
              { id: 'b', name: 'flow:flow_support_triage', arguments: '{}', raw: {} },
            ]
          : []
      const parts = [
        ...(toolCalls.length
          ? [{ type: 'tool-call', toolCalls, raw: {} }]
          : [{ type: 'text-delta', text: 'done', raw: {} }]),
        { type: 'done', inputTokens: 1, outputTokens: 1, raw: {} },
      ]
      const stream = new ReadableStream({
        start(controller) {
          for (const part of parts) controller.enqueue(part)
          controller.close()
        },
      })
      return Object.assign(Promise.resolve(stream), {
        signal: new AbortController().signal,
        abort: () => undefined,
      })
    },
    aggregateMessage: (parts: Array<{ text?: string; toolCalls?: Array<unknown> }>) => ({
      source: 'aggregated',
      role: 'assistant',
      text: parts.map((part) => part.text ?? '').join(''),
      toolCalls: parts.flatMap((part) => part.toolCalls ?? []),
      inputTokens: 1,
      outputTokens: 1,
    }),
  } as unknown as ConstructorParameters<typeof AgentSession>[0]['provider']
  const results: Array<CallToolResult> = []
  const agent = new AgentSession({
    session: value,
    provider,
    model: 'test-model',
    toolApproval: wiring.wrapApproval('auto'),
    onEvent(event) {
      if (event.type === 'tool-call-complete') results.push(event.result)
    },
  })
  try {
    await agent.run({ prompt: 'run both' })
    expect(seenTools[0]).toEqual(
      expect.arrayContaining(['flow:run_flow', 'flow:flow_support_triage']),
    )
    expect(results).toHaveLength(2)
    expect(results.every((result) => result.isError !== true)).toBe(true)
  } finally {
    await agent.dispose()
  }
})

test.each(['auto', 'never', 'ask'] as const)(
  '%s strategy grants only approved flow calls',
  async (strategy) => {
    const value = session()
    const wiring = await addDecisionFlow(value, { key: 'flow' })
    wirings.push(wiring)
    const wrapped = wiring.wrapApproval(strategy)
    const approval = await (wrapped as (request: ToolApprovalRequest) => Promise<unknown>)(
      request('flow:run_flow', { definition: flow }),
    )
    if (strategy === 'auto') {
      expect(approval).toMatchObject({
        approved: true,
        meta: { 'dev.mokei/flow-grant': expect.any(String) },
      })
      const token = (approval as { meta: Record<string, string> }).meta
      expect((await call(value, 'flow:run_flow', { definition: flow }, token)).isError).not.toBe(
        true,
      )
      expect(text(await call(value, 'flow:run_flow', { definition: flow }, token))).toBe(
        'Flow denied',
      )
    } else {
      expect(approval).toEqual({
        approved: false,
        reason:
          strategy === 'never'
            ? 'Tool execution disabled'
            : 'Tool approval required but no handler configured',
      })
      expect(text(await call(value, 'flow:run_flow', { definition: flow }))).toBe('Flow denied')
    }
  },
)

test('function strategy sees flow plan once and other tools pass through unchanged', async () => {
  const value = session()
  value.contextHost.addLocalTool({
    name: 'echo',
    inputSchema: { type: 'object' },
    execute: () => ({ content: [] }),
  })
  const wiring = await addDecisionFlow(value, { key: 'flow', flows: [toolFlow] })
  wirings.push(wiring)
  const prompts: Array<unknown> = []
  const wrapped = wiring.wrapApproval(async ({ flow, ...prompt }) => {
    const requestFromExport: FlowApprovalRequest = { ...prompt, flow }
    const tools: Array<string> | undefined = flow?.tools
    prompts.push({ ...requestFromExport, tools })
    return true
  }) as (request: ToolApprovalRequest) => Promise<unknown>
  expect(await wrapped(request('local:echo', {}))).toBe(true)
  const approved = await wrapped(request('flow:flow_uses_echo', {}))
  expect(prompts).toHaveLength(2)
  expect(prompts[0]).toMatchObject({ flow: undefined, tools: undefined })
  expect(prompts[1]).toMatchObject({
    flow: { id: 'uses-echo', name: 'Uses echo', inline: false, tools: ['local:echo'] },
  })
  expect(approved).toMatchObject({
    approved: true,
    meta: { 'dev.mokei/flow-grant': expect.any(String) },
  })
  expect(
    (
      await call(
        value,
        'flow:flow_uses_echo',
        {},
        (approved as { meta: Record<string, string> }).meta,
      )
    ).isError,
  ).not.toBe(true)
})

test('identical concurrent arguments accept only the approved token and reject changed arguments', async () => {
  const value = session()
  const wiring = await addDecisionFlow(value, { key: 'flow' })
  wirings.push(wiring)
  const approved = await (
    wiring.wrapApproval('auto') as (
      request: ToolApprovalRequest,
    ) => Promise<{ meta: Record<string, string> }>
  )(request('flow:run_flow', { definition: flow }))
  const args = { definition: flow }
  const [denied, allowed] = await Promise.all([
    call(value, 'flow:run_flow', args),
    call(value, 'flow:run_flow', args, approved.meta),
  ])
  expect(text(denied)).toBe('Flow denied')
  expect(allowed.isError).not.toBe(true)
  const next = await (
    wiring.wrapApproval('auto') as (
      request: ToolApprovalRequest,
    ) => Promise<{ meta: Record<string, string> }>
  )(request('flow:run_flow', args))
  expect(
    text(
      await call(value, 'flow:run_flow', { definition: { ...flow, name: 'Changed' } }, next.meta),
    ),
  ).toBe('Flow denied')
})

test('invalid definitions skip approval, and an unused expired grant is refused', async () => {
  vi.useFakeTimers()
  const value = session()
  const wiring = await addDecisionFlow(value, { key: 'flow' })
  wirings.push(wiring)
  const strategy = vi.fn(async () => true)
  const wrapped = wiring.wrapApproval(strategy) as (
    request: ToolApprovalRequest,
  ) => Promise<unknown>
  expect(
    await wrapped(request('flow:run_flow', { definition: { ...flow, start: 'missing' } })),
  ).toBe(true)
  expect(strategy).not.toHaveBeenCalled()
  const approved = (await wrapped(request('flow:run_flow', { definition: flow }))) as {
    meta: Record<string, string>
  }
  vi.setSystemTime(Date.now() + 300_001)
  expect(text(await call(value, 'flow:run_flow', { definition: flow }, approved.meta))).toBe(
    'Flow denied',
  )
})

test('invalid inline flow reaches server issues without creating a task', async () => {
  const value = session()
  const store = createMemoryTaskStore()
  const wiring = await addDecisionFlow(value, { key: 'flow', store })
  wirings.push(wiring)
  const events = await runAgentCall(
    value,
    request('flow:run_flow', { definition: { ...flow, start: 'missing' } }).toolCall,
    wiring.wrapApproval('auto'),
  )
  const completed = events.find((event) => event.type === 'tool-call-complete')
  expect(completed).toMatchObject({
    type: 'tool-call-complete',
    result: {
      isError: true,
      content: [{ type: 'text', text: expect.stringContaining('missing') }],
    },
  })
  expect(
    await store.list({ status: ['working', 'input_required', 'completed', 'failed', 'cancelled'] }),
  ).toEqual([])
})

test.each([
  ['never', 'Tool execution disabled'],
  ['ask', 'Tool approval required but no handler configured'],
] as const)('%s strategy preserves the agent denial reason', async (strategy, reason) => {
  const value = session()
  const wiring = await addDecisionFlow(value, { key: 'flow' })
  wirings.push(wiring)
  const events = await runAgentCall(
    value,
    request('flow:run_flow', { definition: flow }).toolCall,
    wiring.wrapApproval(strategy),
  )
  expect(events).toEqual(
    expect.arrayContaining([expect.objectContaining({ type: 'tool-call-denied', reason })]),
  )
  expect(events.some((event) => event.type === 'tool-call-start')).toBe(false)
})

test('registered input flow without elicitation and invalid registered flow leave no context', async () => {
  const value = session()
  const inputFlow: FlowDefinition = {
    ...flow,
    start: 'ask',
    nodes: {
      ask: {
        kind: 'input',
        prompt: { value: 'Question?' },
        schema: { type: 'string' },
        next: 'done',
      },
      done: { kind: 'end', outcome: 'done' },
    },
  }
  await expect(addDecisionFlow(value, { key: 'flow', flows: [inputFlow] })).rejects.toThrow(
    /elicitation/i,
  )
  expect(value.contextHost.getContextKeys()).not.toContain('flow')
  await expect(
    addDecisionFlow(value, { key: 'flow', flows: [{ ...flow, start: 'missing' }] }),
  ).rejects.toThrow(/Invalid registered flow/)
  expect(value.contextHost.getContextKeys()).not.toContain('flow')
})

test('a failure after context registration removes it and allows the key to be reused', async () => {
  const value = session()
  const host = value.contextHost
  const original = host.addDirectContext.bind(host)
  vi.spyOn(host, 'addDirectContext').mockImplementation((params) => {
    original(params)
    throw new Error('registration failed after insertion')
  })
  await expect(addDecisionFlow(value, { key: 'flow' })).rejects.toThrow(
    'registration failed after insertion',
  )
  vi.restoreAllMocks()
  expect(host.getContextKeys()).not.toContain('flow')
  const wiring = await addDecisionFlow(value, { key: 'flow' })
  wirings.push(wiring)
  expect(host.getContextKeys()).toContain('flow')
})

test('recovery reads the store before registering the context', async () => {
  const value = session()
  const store = createMemoryTaskStore()
  const list = vi.spyOn(store, 'list').mockImplementation(async () => {
    expect(value.contextHost.getContextKeys()).not.toContain('flow')
    return []
  })
  const wiring = await addDecisionFlow(value, { key: 'flow', store })
  wirings.push(wiring)
  expect(list).toHaveBeenCalled()
})

test('a recovery failure leaves no context and a reusable key', async () => {
  const value = session()
  const store = createMemoryTaskStore()
  vi.spyOn(store, 'list').mockRejectedValueOnce(new Error('store unavailable'))
  await expect(addDecisionFlow(value, { key: 'flow', store })).rejects.toThrow('store unavailable')
  expect(value.contextHost.getContextKeys()).not.toContain('flow')
  const wiring = await addDecisionFlow(value, { key: 'flow' })
  wirings.push(wiring)
})

test('concurrent registration reserves the key and keeps the first context live', async () => {
  const value = session()
  const firstStore = createMemoryTaskStore()
  const secondStore = createMemoryTaskStore()
  let finishFirst!: () => void
  let failSecond!: (error: Error) => void
  vi.spyOn(firstStore, 'list').mockImplementation(
    () =>
      new Promise((resolve) => {
        finishFirst = () => resolve([])
      }),
  )
  vi.spyOn(secondStore, 'list').mockImplementation(
    () =>
      new Promise((_, reject) => {
        failSecond = reject
      }),
  )
  const first = addDecisionFlow(value, { key: 'flow', store: firstStore })
  const second = addDecisionFlow(value, { key: 'flow', store: secondStore })
  finishFirst()
  const wiring = await first
  wirings.push(wiring)
  failSecond?.(new Error('second recovery failed'))
  await expect(second).rejects.toThrow(/already exists/)
  expect(value.contextHost.getContextKeys()).toContain('flow')
  expect(
    hostToolCaller(value.contextHost)
      .listTools()
      .map((tool) => tool.id),
  ).not.toContain('flow:run_flow')
  const approved = await (
    wiring.wrapApproval('auto') as (
      request: ToolApprovalRequest,
    ) => Promise<{ meta: Record<string, string> }>
  )(request('flow:run_flow', { definition: flow }))
  expect(
    (await call(value, 'flow:run_flow', { definition: flow }, approved.meta)).isError,
  ).not.toBe(true)
})

test('rollback keeps the original failure and clears the key when removal rejects', async () => {
  const value = session()
  const host = value.contextHost
  const originalAdd = host.addDirectContext.bind(host)
  const originalRemove = host.remove.bind(host)
  vi.spyOn(host, 'addDirectContext').mockImplementation((params) => {
    originalAdd(params)
    throw new Error('registration failed after insertion')
  })
  vi.spyOn(host, 'remove').mockRejectedValueOnce(new Error('removal failed'))
  await expect(addDecisionFlow(value, { key: 'flow' })).rejects.toThrow(
    'registration failed after insertion',
  )
  expect(host.getContextKeys()).toContain('flow')
  expect(
    hostToolCaller(host)
      .listTools()
      .map((tool) => tool.id),
  ).toContain('flow:run_flow')
  vi.restoreAllMocks()
  await originalRemove('flow')
  const wiring = await addDecisionFlow(value, { key: 'flow' })
  wirings.push(wiring)
})

test('flow contexts exclude each other at check and enforce the depth guard', async () => {
  const value = session()
  const first = await addDecisionFlow(value, { key: 'first' })
  const second = await addDecisionFlow(value, { key: 'second' })
  wirings.push(first, second)
  const recursive: FlowDefinition = {
    ...flow,
    start: 'use',
    nodes: {
      use: { kind: 'tool', tool: 'second:run_flow', args: {}, next: 'done' },
      done: { kind: 'end', outcome: 'done' },
    },
  }
  const checked = await call(value, 'first:check_flow', { definition: recursive })
  expect(checked.structuredContent).toMatchObject({
    ok: false,
    issues: expect.arrayContaining([expect.objectContaining({ code: 'unknown_tool' })]),
  })
  const approval = await (
    first.wrapApproval('auto') as (
      request: ToolApprovalRequest,
    ) => Promise<{ meta: Record<string, string> }>
  )(request('first:run_flow', { definition: flow }))
  expect(
    text(
      await call(
        value,
        'first:run_flow',
        { definition: flow },
        { ...approval.meta, 'dev.mokei/flow-depth': '4' },
      ),
    ),
  ).toBe('Invalid flow depth')
  expect(
    (await call(value, 'first:run_flow', { definition: flow }, approval.meta)).isError,
  ).not.toBe(true)
})

test('a tool removed during a run fails at dispatch with tool_unavailable', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const value = session()
  value.contextHost.addLocalTool({
    name: 'remove-target',
    inputSchema: { type: 'object' },
    execute: () => {
      value.contextHost.removeLocalTool('target')
      return { content: [] }
    },
  })
  value.contextHost.addLocalTool({
    name: 'target',
    inputSchema: { type: 'object' },
    execute: () => ({ content: [] }),
  })
  const definition: FlowDefinition = {
    ...flow,
    start: 'remove',
    nodes: {
      remove: { kind: 'tool', tool: 'local:remove-target', args: {}, next: 'target' },
      target: { kind: 'tool', tool: 'local:target', args: {}, next: 'done' },
      done: { kind: 'end', outcome: 'done' },
    },
  }
  const wiring = await addDecisionFlow(value, { key: 'flow' })
  wirings.push(wiring)
  const approved = await (
    wiring.wrapApproval('auto') as (
      request: ToolApprovalRequest,
    ) => Promise<{ meta: Record<string, string> }>
  )(request('flow:run_flow', { definition }))
  const result = await call(value, 'flow:run_flow', { definition }, approved.meta)
  expect(result.isError).toBe(true)
  expect(result.structuredContent).toMatchObject({
    error: { lastFailure: { type: 'tool_unavailable' } },
  })
  log.mockRestore()
})

test('a second flow context becoming excluded before dispatch is tool_unavailable', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const value = session()
  const first = await addDecisionFlow(value, { key: 'first' })
  const second = await addDecisionFlow(value, { key: 'second' })
  wirings.push(first, second)
  value.contextHost.addLocalTool({
    name: 'mark-second',
    inputSchema: { type: 'object' },
    execute: () => {
      markDecisionFlowContext(value.contextHost, 'second')
      return { content: [] }
    },
  })
  unmarkDecisionFlowContext(value.contextHost, 'second')
  const definition: FlowDefinition = {
    ...flow,
    start: 'mark',
    nodes: {
      mark: { kind: 'tool', tool: 'local:mark-second', args: {}, next: 'recurse' },
      recurse: {
        kind: 'tool',
        tool: 'second:run_flow',
        args: { definition: { value: flow } },
        next: 'done',
      },
      done: { kind: 'end', outcome: 'done' },
    },
  }
  const approved = await (
    first.wrapApproval('auto') as (
      request: ToolApprovalRequest,
    ) => Promise<{ meta: Record<string, string> }>
  )(request('first:run_flow', { definition }))
  const result = await call(value, 'first:run_flow', { definition }, approved.meta)
  expect(result.structuredContent).toMatchObject({
    error: { lastFailure: { type: 'tool_unavailable' } },
  })
  log.mockRestore()
})

test('a grant for a removed context cannot authorize a replacement context', async () => {
  const value = session()
  const first = await addDecisionFlow(value, { key: 'flow' })
  const approved = await (
    first.wrapApproval('auto') as (
      request: ToolApprovalRequest,
    ) => Promise<{ meta: Record<string, string> }>
  )(request('flow:run_flow', { definition: flow }))
  await first.dispose()
  const second = await addDecisionFlow(value, { key: 'flow' })
  wirings.push(second)
  expect(text(await call(value, 'flow:run_flow', { definition: flow }, approved.meta))).toBe(
    'Flow denied',
  )
})

test('duplicate registration preserves the first flow context exclusion', async () => {
  const value = session()
  const first = await addDecisionFlow(value, { key: 'flow' })
  wirings.push(first)
  await expect(addDecisionFlow(value, { key: 'flow' })).rejects.toThrow(/already exists/)
  expect(
    hostToolCaller(value.contextHost)
      .listTools()
      .map((tool) => tool.id),
  ).not.toContain('flow:run_flow')
})

test('elicitation guard covers callee input nodes', async () => {
  const value = session()
  const asker: FlowDefinition = {
    ...flow,
    id: 'asker',
    start: 'ask',
    nodes: {
      ask: {
        kind: 'input',
        prompt: { value: 'Question?' },
        schema: { type: 'string' },
        next: 'done',
      },
      done: { kind: 'end', outcome: 'done' },
    },
  }
  const root: FlowDefinition = {
    ...flow,
    id: 'root',
    start: 'call',
    nodes: {
      call: { kind: 'call', flow: 'asker', next: 'done' },
      done: { kind: 'end', outcome: 'done' },
    },
  }
  await expect(addDecisionFlow(value, { key: 'flow', flows: [root, asker] })).rejects.toThrow(
    'Registered flow root requires elicitation',
  )
  expect(value.contextHost.getContextKeys()).not.toContain('flow')
})

test('rejects a registered flow with a null node', async () => {
  const value = session()
  const broken = { ...flow, id: 'broken', nodes: { x: null } } as unknown as FlowDefinition
  await expect(addDecisionFlow(value, { key: 'flow', flows: [broken] })).rejects.toThrow(
    'Invalid registered flow broken',
  )
})

test('approval uses registry snapshots', async () => {
  const value = session()
  value.contextHost.addLocalTool({
    name: 'echo',
    inputSchema: { type: 'object' },
    execute: () => ({ content: [] }),
  })
  const mutable = structuredClone(toolFlow)
  const flows = [mutable]
  const wiring = await addDecisionFlow(value, { key: 'flow', flows })
  wirings.push(wiring)
  ;(mutable.nodes.use as unknown as { tool: string }).tool = 'local:other'
  flows.splice(0, flows.length, { ...flow, id: 'other' })
  flows.push({ ...flow, id: 'extra' })
  const seen: Array<Array<string> | undefined> = []
  const wrapped = wiring.wrapApproval(async ({ flow }) => {
    seen.push(flow?.tools)
    return true
  }) as (request: ToolApprovalRequest) => Promise<unknown>
  await wrapped(request('flow:flow_uses_echo', {}))
  expect(seen).toEqual([['local:echo']])
  const approved = await (
    wiring.wrapApproval('auto') as (
      request: ToolApprovalRequest,
    ) => Promise<{ meta: Record<string, string> }>
  )(request('flow:flow_uses_echo', {}))
  const started = await call(value, 'flow:flow_uses_echo', {}, approved.meta)
  expect(started.isError).not.toBe(true)
  expect(flows.map((item) => item.id)).toEqual(['other', 'extra'])
})

test.each([null, 12_345, undefined])('task TTL is passed through: %s', async (taskTTLMs) => {
  const value = session()
  const store = createMemoryTaskStore()
  const wiring = await addDecisionFlow(value, { key: 'flow', store, taskTTLMs })
  wirings.push(wiring)
  const authorized = await wiring.authorize({
    toolName: 'run_flow',
    arguments: { definition: flow as unknown as JSONValue },
  })
  if (!authorized.ok) throw new Error(authorized.issues.join('\n'))
  await value.contextHost.getContext('flow').client.callTool({
    name: 'run_flow',
    arguments: { definition: flow },
    _meta: authorized.grant(),
    task: 'handle',
  })
  const tasks = await store.list({ status: ['working', 'completed'] })
  expect(tasks).toHaveLength(1)
  expect(tasks[0]?.ttlMs).toBe(taskTTLMs === undefined ? 3_600_000 : taskTTLMs)
})
