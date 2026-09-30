import { addDecisionFlow } from '@mokei/decision-flow-server'
import { AgentSession, Session } from '@mokei/session'
import type { SystemOneResult } from '@mokei/system-one-client'
import type { FlowDefinition } from '@sozai/flow-graph'
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

test('run_flow calls a registered flow and routes a declined input', async () => {
  const ask = {
    id: 'ask',
    name: 'Ask',
    version: 1,
    start: 'ask',
    nodes: {
      ask: {
        kind: 'input',
        prompt: { value: 'Which team?' },
        schema: { type: 'string' },
        decline: { to: 'declined' },
        next: 'answered',
      },
      answered: { kind: 'end', outcome: 'answered' },
      declined: {
        kind: 'end',
        outcome: 'declined',
        output: { why: { ref: ['results', 'ask', 'declined'] } },
      },
    },
  } as unknown as FlowDefinition
  const root = {
    id: 'root',
    name: 'Root',
    version: 1,
    start: 'call',
    nodes: {
      call: { kind: 'call', flow: 'ask', version: 1, next: 'after' },
      after: {
        kind: 'end',
        outcome: 'after',
        output: {
          callee: { ref: ['results', 'call', 'outcome'] },
          why: { ref: ['results', 'call', 'output', 'why'] },
        },
      },
    },
  } as unknown as FlowDefinition
  const session = new Session({ elicit: true })
  const wiring = await addDecisionFlow(session, { key: 'flow', flows: [ask] })
  const completed: Array<unknown> = []
  const agent = new AgentSession({
    session,
    provider: decisionFlowProvider(root),
    model: 'test-model',
    toolApproval: wiring.wrapApproval('auto'),
    onEvent(event) {
      if (event.type === 'tool-call-complete') completed.push(event.result)
    },
    onElicitation: () => ({ action: 'decline' }),
  })
  try {
    await agent.run({ prompt: 'Ask the user' })
    expect(completed).toHaveLength(1)
    expect(completed[0]).toMatchObject({
      structuredContent: { outcome: 'after', output: { callee: 'declined', why: 'decline' } },
    })
  } finally {
    await agent.dispose()
    await wiring.dispose()
    await session.dispose()
  }
})
