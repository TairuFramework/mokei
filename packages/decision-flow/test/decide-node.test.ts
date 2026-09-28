import {
  type SystemOneBackend,
  type SystemOneBackendPredictParams,
  SystemOneClient,
  type SystemOneResult,
} from '@mokei/system-one-client'
import {
  createFlowGraph,
  defineNodeKind,
  type FlowDefinition,
  type RegisteredNodeKind,
} from '@sozai/flow-graph'
import { describe, expect, test } from 'vitest'

import { InvalidDecisionStateError, decideKind as makeDecideKind } from '../src/index.js'

const questions = {
  department: {
    type: 'choice',
    instructions: 'Which department?',
    criteria: { billing: 'Billing', technical: 'Technical' },
  },
} as const

const billingAnswer = {
  type: 'choice',
  choice: 'billing',
  confidence: 0.9,
  probabilities: { billing: 0.8, technical: 0.2 },
}

function answerResult(
  answers: Record<string, unknown> = { department: billingAnswer },
): SystemOneResult {
  return {
    model: 'english',
    answers,
    usage: { input_tokens: 2, output_tokens: 1 },
  }
}

function makeBackend(
  response: SystemOneResult | Error = answerResult(),
  onPredict?: (params: SystemOneBackendPredictParams) => void,
): SystemOneBackend {
  return {
    async predict(params) {
      onPredict?.(params)
      if (response instanceof Error) throw response
      return response
    },
  }
}

function makeDefinition(overrides: Record<string, unknown> = {}): FlowDefinition {
  const decide = {
    kind: 'decide',
    state: { ref: ['input', 'state'] },
    questions,
    cases: [
      {
        when: {
          path: ['results', 'decide', 'department', 'choice'],
          is: { equalTo: 'billing' },
        },
        to: 'first',
      },
      {
        when: {
          path: ['results', 'decide', 'department', 'choice'],
          is: { equalTo: 'billing' },
        },
        to: 'second',
      },
    ],
    default: 'fallback',
    ...overrides,
  }
  return {
    id: 'decision-test',
    name: 'Decision test',
    version: 1,
    start: 'decide',
    nodes: {
      decide,
      first: { kind: 'end', outcome: 'first' },
      second: { kind: 'end', outcome: 'second' },
      fallback: { kind: 'end', outcome: 'fallback' },
      handled: { kind: 'end', outcome: 'handled' },
    },
  } as FlowDefinition
}

function makeGraph(backend: SystemOneBackend, extraKinds: Array<RegisteredNodeKind> = []) {
  const client = new SystemOneClient({ backend, defaultModel: 'default-model' })
  return createFlowGraph({ kinds: [makeDecideKind({ client }), ...extraKinds] })
}

describe('decideKind', () => {
  test('stores flat answers and selects the first matching case', async () => {
    let received: SystemOneBackendPredictParams | undefined
    let calls = 0
    const controller = new AbortController()
    const run = await makeGraph(
      makeBackend(answerResult(), (params) => {
        calls += 1
        received = params
      }),
    ).run({
      definition: makeDefinition({ model: 'english' }),
      input: { state: { message: 'refund' } },
      signal: controller.signal,
    })

    expect(run.status).toBe('ended')
    expect(run.outcome).toBe('first')
    expect(received).toMatchObject({
      state: { message: 'refund' },
      questions,
      model: 'english',
    })
    expect(received?.signal).toBeInstanceOf(AbortSignal)
    expect(received?.signal).not.toBe(controller.signal)
    expect(calls).toBe(1)
    expect(run.runState.frames[0]?.results.decide).toMatchObject({
      department: { choice: 'billing' },
      $meta: { model: 'english', usage: { inputTokens: 2, outputTokens: 1 } },
    })
  })

  test('uses default when no case matches', async () => {
    const technicalAnswer = {
      ...billingAnswer,
      choice: 'technical',
      probabilities: { billing: 0.1, technical: 0.9 },
    }
    const run = await makeGraph(makeBackend(answerResult({ department: technicalAnswer }))).run({
      definition: makeDefinition(),
      input: { state: 'outage' },
    })

    expect(run.status).toBe('ended')
    expect(run.outcome).toBe('fallback')
  })

  test('keeps finite extra backend answer fields at runtime', async () => {
    const run = await makeGraph(
      makeBackend(answerResult({ department: { ...billingAnswer, rationale: 'refund request' } })),
    ).run({ definition: makeDefinition(), input: { state: 'refund' } })

    expect(run.runState.frames[0]?.results.decide).toMatchObject({
      department: { rationale: 'refund request' },
    })
  })

  test('rolls back staged answers when a non-JSON answer value is returned', async () => {
    const answer = { ...billingAnswer, rationale: Number.NaN }
    const run = await makeGraph(makeBackend(answerResult({ department: answer }))).run({
      definition: makeDefinition(),
      input: { state: 'refund' },
    })

    expect(run.status).toBe('error')
    expect(run.error).toMatchObject({ code: 'invalid_value' })
    expect(run.runState.frames[0]?.results.decide).toBeUndefined()
  })

  test('sends only handled-error metadata to onError after backend failure', async () => {
    const definition = makeDefinition({ onError: 'handled' })
    const run = await makeGraph(makeBackend(new Error('backend failed'))).run({
      definition,
      input: { state: 'refund' },
    })

    expect(run.status).toBe('ended')
    expect(run.runState.frames[0]?.results.decide).toMatchObject({
      error: { type: 'Error', reason: 'non_retryable', attempts: 1 },
    })
    expect(Object.keys(run.runState.frames[0]?.results.decide ?? {})).toEqual(['error'])
  })

  test('rolls back a result staged by a node that throws before onError', async () => {
    type StageThenThrowNode = { kind: 'stage-then-throw'; onError: string }
    const stageThenThrowKind = defineNodeKind<StageThenThrowNode>({
      kind: 'stage-then-throw',
      schema: { type: 'object' },
      targets: (node) => [{ path: ['onError'], id: node.onError }],
      execute: (_node, ctx) => {
        ctx.setResult({ partial: true })
        throw new Error('after staging')
      },
    })
    const definition = makeDefinition()
    definition.start = 'stage'
    definition.nodes.stage = { kind: 'stage-then-throw', onError: 'handled' }
    const run = await makeGraph(makeBackend(), [stageThenThrowKind]).run({
      definition,
      input: { state: 'refund' },
    })

    expect(run.status).toBe('ended')
    expect(run.runState.frames[0]?.results.stage).toMatchObject({
      error: { type: 'Error', reason: 'non_retryable', attempts: 1 },
    })
    expect(run.runState.frames[0]?.results.stage).not.toHaveProperty('partial')
  })

  test.each([null, 42])(
    'rejects resolved state %s without calling the backend and reports invalid_state',
    async (state) => {
      let calls = 0
      const run = await makeGraph(
        makeBackend(answerResult(), () => {
          calls += 1
        }),
      ).run({
        definition: makeDefinition({ onError: 'handled' }),
        input: { state },
      })

      expect(calls).toBe(0)
      expect(run.status).toBe('ended')
      expect(run.runState.frames[0]?.results.decide).toMatchObject({
        error: { code: 'invalid_state', attempts: 1 },
      })
    },
  )

  test('reports invalid_state under the terminal node failure without onError', async () => {
    let calls = 0
    const run = await makeGraph(
      makeBackend(answerResult(), () => {
        calls += 1
      }),
    ).run({ definition: makeDefinition(), input: { state: 42 } })

    expect(calls).toBe(0)
    expect(run.status).toBe('error')
    expect(run.error).toMatchObject({
      code: 'node_failed',
      lastFailure: { code: 'invalid_state' },
    })
  })

  test('allows string, object, and array states', async () => {
    for (const state of ['text', { message: 'refund' }, ['refund']]) {
      const run = await makeGraph(makeBackend()).run({
        definition: makeDefinition(),
        input: { state },
      })
      expect(run.status).toBe('ended')
    }
  })

  test('converts an undeclared answer choice into handled response-error metadata', async () => {
    const invalidAnswer = { ...billingAnswer, choice: 'unknown' }
    const run = await makeGraph(makeBackend(answerResult({ department: invalidAnswer }))).run({
      definition: makeDefinition({ onError: 'handled' }),
      input: { state: 'refund' },
    })

    expect(run.status).toBe('ended')
    expect(run.runState.frames[0]?.results.decide).toMatchObject({
      error: { type: 'SystemOneResponseError' },
    })
    expect(run.runState.frames[0]?.results.decide).not.toHaveProperty('department')
  })

  test('exposes invalid decision state metadata', () => {
    expect(new InvalidDecisionStateError().code).toBe('invalid_state')
  })
})
