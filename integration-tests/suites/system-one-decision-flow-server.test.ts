import { AgentSession } from '@mokei/session'
import { createSystemOneClient } from '@mokei/system-one-client'
import { afterEach, describe, expect, inject, test } from 'vitest'

import {
  createDecisionFlowFixture,
  decisionFlowProvider,
} from '../support/interop/decision-flow-fixture.ts'

const fixtures: Array<Awaited<ReturnType<typeof createDecisionFlowFixture>>> = []

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.dispose()
})

const targets = inject('systemOne')
describe.each(targets.map((target) => [target.name, target] as const))(
  'decision flow with %s',
  (_name, target) => {
    test('routes a billing message through the MCP predictor and ticket task', async () => {
      const client = createSystemOneClient({
        url: target.url,
        apiKey: target.apiKey,
        defaultModel: target.model,
      })
      const fixture = await createDecisionFlowFixture({ client })
      fixtures.push(fixture)
      const agent = new AgentSession({
        session: fixture.session,
        provider: decisionFlowProvider(fixture.definition),
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
  },
)
