import { createDecisionFlowGraph, flowDefinitionSchema } from '@mokei/decision-flow'
import { createSystemOneClient } from '@mokei/system-one-client'
import type { Action, FlowDefinition, RunState } from '@sozai/flow-graph'
import { createValidator } from '@sozai/schema'
import { describe, expect, inject, test, vi } from 'vitest'

import example from '../../packages/decision-flow/examples/support-triage.json' with {
  type: 'json',
}

const definition = example as unknown as FlowDefinition
const laya = inject('laya')
const { url, apiKey } = laya ?? { url: '', apiKey: '' }

const BILLING = 'I was charged twice for my subscription this month.'
const CRASH = 'The app crashes every time I open the settings page.'

type Route = 'rejected' | 'ask' | 'billing' | 'technical' | 'error'

function makeGraph(params: { apiKey?: string; actions?: Record<string, Action> } = {}) {
  const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    globalThis.fetch(input, init),
  )
  const client = createSystemOneClient({
    url,
    apiKey: params.apiKey ?? apiKey,
    defaultModel: 'english',
    fetch: fetcher,
  })
  const createTicket = vi.fn<Action>(() => ({ created: true }))
  const graph = createDecisionFlowGraph({
    client,
    actions: { createTicket, ...params.actions },
  })
  return { graph, fetcher, createTicket }
}

function expectedRoute(results: Record<string, unknown>): Route {
  const guard = results.guard as { jailbreak?: { noul: number } } | undefined
  const triage = results.triage as
    | { error?: unknown; department?: { confidence: number; choice: string } }
    | undefined
  if (!guard) return 'error'
  if ((guard.jailbreak?.noul ?? 0) > 0.8) return 'rejected'
  if (triage?.error) return 'technical'
  if ((triage?.department?.confidence ?? 0) < 0.6) return 'ask'
  if (triage?.department?.choice === 'billing') return 'billing'
  return 'technical'
}

function observedRoute(runState: RunState, createTicket: ReturnType<typeof vi.fn>): Route {
  if (runState.status === 'error') return 'error'
  if (runState.status === 'suspended') return runState.pending?.node as Route
  if (runState.outcome === 'rejected') return 'rejected'
  const action = createTicket.mock.calls[0]?.[0] as
    | { args: { ticket: { team: Route } } }
    | undefined
  if (!action) throw new Error('The flow did not create a ticket')
  return action.args.ticket.team
}

test('support-triage example passes validation and graph checking', () => {
  expect(createValidator(flowDefinitionSchema)(example)).not.toHaveProperty('issues')
  expect(makeGraph().graph.check(definition).ok).toBe(true)
})

describe.skipIf(laya == null)('support-triage example against laya-serve', () => {
  test.each([BILLING, CRASH])('routes %s according to the recorded answers', async (message) => {
    const { graph, createTicket } = makeGraph()
    const run = await graph.run({ definition, input: { message } })
    const frame = run.runState.frames[0]
    if (!frame) throw new Error('The flow run has no root frame')
    const results = frame.results
    const guard = results.guard as { jailbreak?: { noul: number } } | undefined
    const triage = results.triage as
      | {
          department?: {
            choice: string
            confidence: number
            probabilities: Record<string, number>
          }
        }
      | undefined

    if (guard?.jailbreak) {
      expect(guard.jailbreak.noul).toBeGreaterThanOrEqual(0)
      expect(guard.jailbreak.noul).toBeLessThanOrEqual(1)
    }
    if (triage?.department) {
      expect(['billing', 'technical', 'other']).toContain(triage.department.choice)
      expect(triage.department.confidence).toBeGreaterThanOrEqual(0)
      expect(triage.department.confidence).toBeLessThanOrEqual(1)
      for (const probability of Object.values(triage.department.probabilities)) {
        expect(probability).toBeGreaterThanOrEqual(0)
        expect(probability).toBeLessThanOrEqual(1)
      }
    }
    expect(observedRoute(run.runState, createTicket)).toBe(expectedRoute(results))
  })
})
