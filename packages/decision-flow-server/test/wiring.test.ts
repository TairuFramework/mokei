import type { CallToolResult } from '@mokei/context-protocol'
import { createMemoryTaskStore } from '@mokei/context-server'
import {
  type AgentEvent,
  AgentSession,
  Session,
  type ToolApprovalRequest,
  type ToolApprovalStrategy,
} from '@mokei/session'
import type { FlowDefinition } from '@sozai/flow-graph'
import { afterEach, expect, test, vi } from 'vitest'

import type { FlowApprovalRequest } from '../src/index.js'
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
        meta: { 'io.mokei/flow-grant': expect.any(String) },
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
    meta: { 'io.mokei/flow-grant': expect.any(String) },
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
        { ...approval.meta, 'io.mokei/flow-depth': '4' },
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
