import { createDecisionFlowGraph, flowDefinitionSchema } from '@mokei/decision-flow'
import { createSystemOneClient } from '@mokei/system-one-client'
import {
  type Action,
  createMapResolver,
  type FlowDefinition,
  type RunState,
} from '@sozai/flow-graph'
import { createValidator } from '@sozai/schema'
import { describe, expect, inject, test, vi } from 'vitest'

import example from '../../packages/decision-flow/examples/support-triage.json' with {
  type: 'json',
}
import type { SystemOneTarget } from '../support/system-one-setup.ts'

const definition = example as unknown as FlowDefinition
const targets = inject('systemOne')

const BILLING = 'I was charged twice for my subscription this month.'
const CRASH = 'The app crashes every time I open the settings page.'

type Route = 'rejected' | 'ask' | 'billing' | 'technical' | 'error'

function makeGraph(
  target: SystemOneTarget,
  params: {
    apiKey?: string
    actions?: Record<string, Action>
    fetcher?: typeof globalThis.fetch
  } = {},
) {
  const fetcher =
    params.fetcher ??
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init))
  const client = createSystemOneClient({
    url: target.url,
    apiKey: params.apiKey ?? target.apiKey,
    defaultModel: target.model,
    fetch: fetcher,
  })
  const createTicket = vi.fn<Action>(() => ({ created: true }))
  const graph = createDecisionFlowGraph({
    client,
    actions: { createTicket, ...params.actions },
    resolver: createMapResolver([suspensionDefinition, recoveryDefinition]),
  })
  return { graph, fetcher, createTicket }
}

const suspensionDefinition: FlowDefinition = {
  id: 'system-one/suspension',
  name: 'System One suspension',
  version: 1,
  start: 'decide',
  nodes: {
    decide: {
      kind: 'decide',
      state: { ref: ['input', 'message'] },
      questions: {
        department: {
          type: 'choice',
          instructions: 'Which team?',
          criteria: { billing: 'payments', technical: 'bugs' },
        },
      },
      cases: [
        {
          when: {
            not: {
              path: ['results', 'decide', 'department', 'confidence'],
              is: { greaterThanOrEqualTo: 0 },
            },
          },
          to: 'unreachable',
        },
      ],
      default: 'ask',
    },
    ask: { kind: 'input', schema: { enum: ['billing', 'technical'] }, next: 'route' },
    route: {
      kind: 'branch',
      cases: [{ when: { path: ['results', 'ask'], is: { equalTo: 'billing' } }, to: 'billing' }],
      default: 'technical',
    },
    billing: { kind: 'end', outcome: 'billing' },
    technical: { kind: 'end', outcome: 'technical' },
    unreachable: { kind: 'end', outcome: 'unreachable' },
  },
}

const recoveryDefinition: FlowDefinition = {
  id: 'system-one/recovery',
  name: 'System One recovery',
  version: 1,
  start: 'decide',
  nodes: {
    decide: {
      kind: 'decide',
      state: { ref: ['input', 'message'] },
      questions: {
        department: {
          type: 'choice',
          instructions: 'Which team?',
          criteria: { billing: 'payments', technical: 'bugs' },
        },
      },
      cases: [
        {
          when: {
            path: ['results', 'decide', 'department', 'choice'],
            is: { equalTo: 'billing' },
          },
          to: 'record',
        },
      ],
      default: 'record',
    },
    record: { kind: 'action', name: 'record', next: 'done' },
    done: { kind: 'end', outcome: 'recorded' },
  },
}

const scoreNoulDefinition: FlowDefinition = {
  id: 'system-one/score-noul',
  name: 'System One score and noul',
  version: 1,
  start: 'decide',
  nodes: {
    decide: {
      kind: 'decide',
      state: { ref: ['input', 'message'] },
      questions: {
        urgency: {
          type: 'score',
          instructions: 'How urgent?',
          criteria: ['low', 'medium', 'high'],
        },
        complaint: { type: 'noul', instructions: 'Is this a complaint?' },
      },
      cases: [
        {
          when: { path: ['results', 'decide', 'urgency', 'score'], is: { greaterThan: 1 } },
          to: 'urgent',
        },
        {
          when: { path: ['results', 'decide', 'complaint', 'noul'], is: { greaterThan: 0.5 } },
          to: 'complaint',
        },
      ],
      default: 'ordinary',
    },
    urgent: { kind: 'end', outcome: 'urgent' },
    complaint: { kind: 'end', outcome: 'complaint' },
    ordinary: { kind: 'end', outcome: 'ordinary' },
  },
}

const authDefinition: FlowDefinition = {
  id: 'system-one/auth-fallback',
  name: 'System One auth fallback',
  version: 1,
  start: 'decide',
  nodes: {
    decide: {
      kind: 'decide',
      state: { ref: ['input', 'message'] },
      questions: {
        department: {
          type: 'choice',
          instructions: 'Which team?',
          criteria: { billing: 'payments', technical: 'bugs' },
        },
      },
      cases: [],
      default: 'success',
      onError: 'fallback',
      retry: { maxAttempts: 3 },
    },
    success: { kind: 'end', outcome: 'success' },
    fallback: { kind: 'end', outcome: 'fallback' },
  },
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

// Graph checking is static, so these tests build a graph whose backend must never be called.
function makeCheckGraph(actions: Record<string, Action> = {}) {
  const client = createSystemOneClient({
    backend: {
      predict: () => Promise.reject(new Error('graph checking must not predict')),
    },
    defaultModel: 'english',
  })
  return createDecisionFlowGraph({
    client,
    actions: { createTicket: () => ({ created: true }), ...actions },
  })
}

test('support-triage example passes validation and graph checking', () => {
  expect(createValidator(flowDefinitionSchema)(example)).not.toHaveProperty('issues')
  expect(makeCheckGraph().check(definition).issues).toBeUndefined()
})

test('system-one decision-flow fixtures pass graph checking', () => {
  const graph = makeCheckGraph({ record: () => ({ recorded: true }) })
  for (const fixture of [
    suspensionDefinition,
    recoveryDefinition,
    scoreNoulDefinition,
    authDefinition,
  ]) {
    expect(graph.check(fixture).issues).toBeUndefined()
  }
})

describe.each(targets.map((target) => [target.name, target] as const))(
  'support-triage example against %s',
  (_name, target) => {
    test.each([BILLING, CRASH])('routes %s according to the recorded answers', async (message) => {
      const { graph, createTicket } = makeGraph(target)
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

    // laya's english checkpoint keeps its department confidence for CRASH below 0.6, so it routes
    // to `ask`; only the billing route is stable enough to pin.
    test('routes the billing message to the billing team', async () => {
      const { graph, createTicket } = makeGraph(target)
      const run = await graph.run({ definition, input: { message: BILLING } })
      expect(observedRoute(run.runState, createTicket)).toBe('billing')
    })

    test('suspends after a choice decision and resumes without another prediction', async () => {
      const { graph, fetcher } = makeGraph(target)
      const first = await graph.run({
        definition: suspensionDefinition,
        input: { message: BILLING },
      })
      const decideResult = first.runState.frames[0]?.results.decide as
        | { department: { choice: string; confidence: number } }
        | undefined

      expect(first.status).toBe('suspended')
      expect(first.pending?.node).toBe('ask')
      expect(fetcher).toHaveBeenCalledTimes(1)
      if (!decideResult) throw new Error('The flow run has no decide result')
      expect(['billing', 'technical']).toContain(decideResult.department.choice)
      expect(decideResult.department.confidence).toBeGreaterThanOrEqual(0)
      expect(decideResult.department.confidence).toBeLessThanOrEqual(1)

      const runState = JSON.parse(JSON.stringify(first.runState)) as RunState
      const states: Array<RunState> = []
      for await (const state of graph.resume({
        runState,
        event: { type: 'value', value: 'billing' },
      })) {
        states.push(state)
      }

      expect(states.at(-1)?.outcome).toBe('billing')
      expect(fetcher).toHaveBeenCalledTimes(1)
    })

    test('recovers an in-flight decision checkpoint on a fresh graph', async () => {
      const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        globalThis.fetch(input, init),
      )
      const record = vi.fn<Action>(() => ({ recorded: true }))
      const { graph } = makeGraph(target, { fetcher, actions: { record } })
      const first = graph.start({ definition: recoveryDefinition, input: { message: BILLING } })
      let checkpoint: RunState | undefined
      while (!checkpoint) {
        const { value, done } = await first.next()
        if (done) throw new Error('The flow ended before its in-flight checkpoint')
        if (value.inFlight?.node === 'decide') checkpoint = value
      }
      expect(fetcher).toHaveBeenCalledTimes(0)

      const recovered = makeGraph(target, { fetcher, actions: { record } }).graph.recover({
        runState: checkpoint,
      })
      const states: Array<RunState> = []
      for await (const state of recovered) {
        states.push(state)
      }

      const decideResult = states.at(-1)?.frames[0]?.results.decide as
        | { department: { choice: string; confidence: number } }
        | undefined
      expect(states.at(-1)?.status).toBe('ended')
      expect(states.every((state) => state.revision > checkpoint.revision)).toBe(true)
      expect(fetcher).toHaveBeenCalledTimes(1)
      if (!decideResult) throw new Error('The recovered run has no decide result')
      expect(['billing', 'technical']).toContain(decideResult.department.choice)
      expect(decideResult.department.confidence).toBeGreaterThanOrEqual(0)
      expect(decideResult.department.confidence).toBeLessThanOrEqual(1)
      expect(record).toHaveBeenCalledTimes(1)
    })

    test('routes score and noul answers according to their recorded values', async () => {
      const { graph } = makeGraph(target)
      const run = await graph.run({ definition: scoreNoulDefinition, input: { message: CRASH } })
      const decideResult = run.runState.frames[0]?.results.decide as
        | { urgency: { score: number }; complaint: { noul: number } }
        | undefined
      if (!decideResult) throw new Error('The flow run has no decide result')
      const { urgency, complaint } = decideResult

      expect(Number.isFinite(urgency.score)).toBe(true)
      expect(complaint.noul).toBeGreaterThanOrEqual(0)
      expect(complaint.noul).toBeLessThanOrEqual(1)
      expect(run.outcome).toBe(
        urgency.score > 1 ? 'urgent' : complaint.noul > 0.5 ? 'complaint' : 'ordinary',
      )
    })

    test.skipIf(!target.enforcesAuth)('takes the fallback once for a wrong API key', async () => {
      const { graph, fetcher } = makeGraph(target, { apiKey: 'wrong' })
      const run = await graph.run({ definition: authDefinition, input: { message: BILLING } })

      expect(run.status).toBe('ended')
      expect(run.outcome).toBe('fallback')
      expect(run.runState.frames[0]?.results.decide).toEqual({
        error: { type: 'SystemOneAuthError', reason: 'non_retryable', attempts: 1 },
      })
      expect(run.runState.frames[0]?.results.decide).not.toHaveProperty('error.message')
      expect(fetcher).toHaveBeenCalledTimes(1)
    })
  },
)
