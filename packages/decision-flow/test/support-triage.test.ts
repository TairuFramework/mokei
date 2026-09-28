import {
  type SystemOneBackend,
  SystemOneClient,
  type SystemOneResult,
} from '@mokei/system-one-client'
import type { Action, FlowDefinition, FlowRun, RunState } from '@sozai/flow-graph'
import { createValidator } from '@sozai/schema'
import { describe, expect, test, vi } from 'vitest'

import example from '../examples/support-triage.json' with { type: 'json' }
import { createDecisionFlowGraph, flowDefinitionSchema } from '../src/index.js'

const definition = example as unknown as FlowDefinition

function makeBackend(responses: Array<SystemOneResult>): SystemOneBackend {
  let index = 0
  return {
    async predict() {
      const response = responses[index]
      index += 1
      if (!response) throw new Error('Unexpected predict call')
      return response
    },
  }
}

function result(answers: Record<string, unknown>): SystemOneResult {
  return {
    model: 'test-model',
    answers,
    usage: { input_tokens: 1, output_tokens: 1 },
  } as SystemOneResult
}

function guardResult(noul: number): SystemOneResult {
  return result({ jailbreak: { type: 'noul', noul } })
}

function triageResult(choice: 'billing' | 'technical', confidence: number): SystemOneResult {
  return result({
    department: {
      type: 'choice',
      choice,
      confidence,
      probabilities: { [choice]: confidence },
    },
  })
}

function makeGraph(params: {
  responses?: Array<SystemOneResult>
  createTicket?: Action
  now?: () => number
}) {
  const client = new SystemOneClient({
    backend: makeBackend(params.responses ?? []),
    defaultModel: 'test-model',
  })
  const createTicket = params.createTicket ?? vi.fn<Action>(() => ({ created: true }))
  return createDecisionFlowGraph({
    client,
    actions: { createTicket },
    now: params.now,
  })
}

async function collect(run: FlowRun): Promise<Array<RunState>> {
  const states: Array<RunState> = []
  for await (const state of run) states.push(state)
  return states
}

describe('support triage example', () => {
  test('passes the authoring schema and graph checker', () => {
    const validate = createValidator(flowDefinitionSchema)

    expect(validate(example)).not.toHaveProperty('issues')
    expect(makeGraph({}).check(definition).ok).toBe(true)
  })

  test('rejects a message flagged by the guard', async () => {
    const graph = makeGraph({ responses: [guardResult(0.9)] })

    const run = await graph.run({ definition, input: { message: 'help' } })

    expect(run.status).toBe('ended')
    expect(run.outcome).toBe('rejected')
  })

  test('routes a confident billing classification to the billing action', async () => {
    const createTicket = vi.fn<Action>(() => ({ created: true }))
    const graph = makeGraph({
      responses: [guardResult(0.1), triageResult('billing', 0.9)],
      createTicket,
    })

    const run = await graph.run({ definition, input: { message: 'help' } })

    expect(run.status).toBe('ended')
    expect(run.outcome).toBe('routed')
    expect(createTicket).toHaveBeenCalledWith(
      expect.objectContaining({ args: { ticket: { team: 'billing', message: 'help' } } }),
    )
  })

  test('round-trips the suspended ask state and resumes with a value', async () => {
    const createTicket = vi.fn<Action>(() => ({ created: true }))
    const graph = makeGraph({
      responses: [guardResult(0.1), triageResult('technical', 0.4)],
      createTicket,
    })
    const first = await graph.run({ definition, input: { message: 'help' } })

    expect(first.status).toBe('suspended')
    expect(first.pending?.node).toBe('ask')
    const runState = JSON.parse(JSON.stringify(first.runState)) as RunState
    const freshGraph = makeGraph({ createTicket })
    const resumed = freshGraph.resume({
      definition,
      runState,
      event: { type: 'value', value: 'billing' },
    })
    const states = await collect(resumed)

    expect(states.at(-1)?.outcome).toBe('routed')
    expect(createTicket).toHaveBeenCalledWith(
      expect.objectContaining({ args: { ticket: { team: 'billing', message: 'help' } } }),
    )
  })

  test('routes a low-confidence technical choice through ask before routing', async () => {
    const graph = makeGraph({
      responses: [guardResult(0.1), triageResult('technical', 0.4)],
    })

    const first = await graph.run({ definition, input: { message: 'help' } })

    expect(first.status).toBe('suspended')
    expect(first.pending?.node).toBe('ask')
  })

  test('routes to technical when the ask timeout expires', async () => {
    let now = 1_800_000_000_000
    const createTicket = vi.fn<Action>(() => ({ created: true }))
    const graph = makeGraph({
      responses: [guardResult(0.1), triageResult('billing', 0.4)],
      createTicket,
      now: () => now,
    })
    const first = await graph.run({ definition, input: { message: 'help' } })
    const runState = JSON.parse(JSON.stringify(first.runState)) as RunState
    now += 86_400_001
    const freshGraph = makeGraph({ createTicket, now: () => now })
    const resumed = freshGraph.resume({
      definition,
      runState,
      event: { type: 'timeout' },
    })
    const states = await collect(resumed)

    expect(states.at(-1)?.outcome).toBe('routed')
    expect(createTicket).toHaveBeenCalledWith(
      expect.objectContaining({ args: { ticket: { team: 'technical', message: 'help' } } }),
    )
  })

  test('rejects a timeout event before the deadline', async () => {
    const now = 1_800_000_000_000
    const graph = makeGraph({
      responses: [guardResult(0.1), triageResult('billing', 0.4)],
      now: () => now,
    })
    const first = await graph.run({ definition, input: { message: 'help' } })
    const runState = JSON.parse(JSON.stringify(first.runState)) as RunState
    const freshGraph = makeGraph({ now: () => now })

    expect(() => freshGraph.resume({ definition, runState, event: { type: 'timeout' } })).toThrow()
  })
})
