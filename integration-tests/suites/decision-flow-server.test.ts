import { AgentSession } from '@mokei/session'
import type { SystemOneResult } from '@mokei/system-one-client'
import { afterEach, expect, test, vi } from 'vitest'

import {
  createDecisionFlowFixture,
  decisionFlowProvider,
} from '../support/interop/decision-flow-fixture.ts'

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
  const elicitations: Array<unknown> = []
  const agent = new AgentSession({
    session: fixture.session,
    provider: decisionFlowProvider(fixture.definition),
    model: 'test-model',
    toolApproval: fixture.wiring.wrapApproval('auto'),
    onEvent(event) {
      if (event.type === 'tool-call-complete') completed.push(event.result)
    },
    onElicitation: ({ params }) => {
      elicitations.push(params)
      return { action: 'accept', content: { value: 'billing' } }
    },
  })
  try {
    await agent.run({ prompt: 'Route my support request' })
    expect(elicitations).toEqual([
      expect.objectContaining({
        requestedSchema: {
          type: 'object',
          properties: { value: { type: 'string', enum: ['billing', 'technical'] } },
          required: ['value'],
        },
      }),
    ])
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
    provider: decisionFlowProvider(fixture.definition),
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
