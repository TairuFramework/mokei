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
})
