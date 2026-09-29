import { AgentSession } from '@mokei/session'
import type { SystemOneResult } from '@mokei/system-one-client'
import { createSystemOneClient } from '@mokei/system-one-client'
import { afterEach, describe, expect, inject, test, vi } from 'vitest'

import { createDecisionFlowFixture } from '../support/interop/decision-flow-fixture.ts'

const fixtures: Array<Awaited<ReturnType<typeof createDecisionFlowFixture>>> = []

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.dispose()
})

function result(answers: Record<string, unknown>): SystemOneResult {
  return {
    model: 'test-model',
    answers,
    usage: { input_tokens: 1, output_tokens: 1 },
  } as SystemOneResult
}

function provider(definition: unknown) {
  let turn = 0
  return {
    listModels: async () => [{ id: 'test-model', raw: { id: 'test-model' } }],
    embed: async () => ({ embeddings: [] }),
    toolFromMCP: (tool: { name: string; description?: string }) => ({
      name: tool.name,
      description: tool.description ?? '',
    }),
    streamChat: () => {
      const parts = [
        ...(turn++ === 0
          ? [
              {
                type: 'tool-call',
                toolCalls: [
                  {
                    id: 'run-1',
                    name: 'flow:run_flow',
                    arguments: JSON.stringify({ definition, input: { message: 'Charged twice' } }),
                    raw: {},
                  },
                ],
                raw: {},
              },
            ]
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
}

test('agent runs support triage through System One, elicitation, and a sibling task tool', async () => {
  const answers = [
    result({ jailbreak: { type: 'noul', noul: 0.1 } }),
    result({
      department: {
        type: 'choice',
        choice: 'technical',
        confidence: 0.4,
        probabilities: { technical: 0.4 },
      },
    }),
  ]
  const fixture = await createDecisionFlowFixture({ responses: answers })
  fixtures.push(fixture)
  const completed: Array<unknown> = []
  const agent = new AgentSession({
    session: fixture.session,
    provider: provider(fixture.definition),
    model: 'test-model',
    toolApproval: fixture.wiring.wrapApproval('auto'),
    onEvent(event) {
      if (event.type === 'tool-call-complete') completed.push(event.result)
    },
    onElicitation: ({ params }) => {
      expect(params.requestedSchema).toEqual({
        type: 'object',
        properties: { value: { type: 'string', enum: ['billing', 'technical'] } },
        required: ['value'],
      })
      return { action: 'accept', content: { value: 'billing' } }
    },
  })
  try {
    await agent.run({ prompt: 'Route my support request' })
    expect(fixture.tickets).toEqual([{ team: 'billing', message: 'Charged twice' }])
    expect(completed).toHaveLength(1)
    expect(completed[0]).toMatchObject({ structuredContent: { outcome: 'routed' } })
  } finally {
    await agent.dispose()
  }
})

test('aborting the agent cancels the flow and its sibling ticket task', async () => {
  const fixture = await createDecisionFlowFixture({
    pauseTicket: true,
    responses: [
      result({ jailbreak: { type: 'noul', noul: 0.1 } }),
      result({
        department: {
          type: 'choice',
          choice: 'billing',
          confidence: 0.9,
          probabilities: { billing: 0.9 },
        },
      }),
    ],
  })
  fixtures.push(fixture)
  const controller = new AbortController()
  const agent = new AgentSession({
    session: fixture.session,
    provider: provider(fixture.definition),
    model: 'test-model',
    toolApproval: fixture.wiring.wrapApproval('auto'),
  })
  try {
    const run = agent.run({ prompt: 'Route my support request', signal: controller.signal })
    await fixture.ticketStarted
    controller.abort(new Error('User stopped the agent'))
    await run.catch(() => undefined)
    await vi.waitFor(async () => {
      const flow = await fixture.flowStore.list({ status: ['cancelled'] })
      const sibling = await fixture.siblingStore.list({ status: ['cancelled'] })
      expect(flow).toHaveLength(1)
      expect(sibling).toHaveLength(1)
    })
    expect(fixture.tickets).toEqual([])
  } finally {
    await agent.dispose()
  }
})

const laya = inject('laya')
describe.skipIf(laya == null)('decision flow with laya-serve', () => {
  test('routes a billing message through the MCP predictor and ticket task', async () => {
    if (!laya) throw new Error('laya-serve is not configured')
    const client = createSystemOneClient({
      url: laya.url,
      apiKey: laya.apiKey,
      defaultModel: 'english',
    })
    const fixture = await createDecisionFlowFixture({ client })
    fixtures.push(fixture)
    const agent = new AgentSession({
      session: fixture.session,
      provider: provider(fixture.definition),
      model: 'test-model',
      toolApproval: fixture.wiring.wrapApproval('auto'),
      onElicitation: () => ({ action: 'accept', content: { value: 'billing' } }),
    })
    try {
      await agent.run({ prompt: 'Route my support request' })
      expect(fixture.tickets).toEqual([{ team: 'billing', message: 'Charged twice' }])
    } finally {
      await agent.dispose()
    }
  })
})
