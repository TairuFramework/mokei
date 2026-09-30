import {
  SystemOneAuthError,
  type SystemOneBackend,
  type SystemOneBackendPredictParams,
  SystemOneClient,
  SystemOneConnectionError,
  SystemOneInputError,
  SystemOneModelError,
  SystemOneResponseError,
  type SystemOneResult,
} from '@mokei/system-one-client'
import {
  createFlowGraph,
  createMapResolver,
  defineNodeKind,
  type FlowDefinition,
  type FlowResolver,
  type RegisteredNodeKind,
} from '@sozai/flow-graph'
import { afterEach, describe, expect, test, vi } from 'vitest'

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

function makeGraph(
  backend: SystemOneBackend,
  extraKinds: Array<RegisteredNodeKind> = [],
  options: { now?: () => number; resolver?: FlowResolver } = {},
) {
  const client = new SystemOneClient({ backend, defaultModel: 'default-model' })
  return createFlowGraph({ kinds: [makeDecideKind({ client }), ...extraKinds], ...options })
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

  test('retries a retryable backend error and succeeds on the next attempt', async () => {
    let calls = 0
    const backend: SystemOneBackend = {
      async predict() {
        calls += 1
        if (calls === 1) {
          throw new SystemOneConnectionError({
            message: 'temporary failure',
            status: 503,
          })
        }
        return answerResult()
      },
    }
    const run = await makeGraph(backend).run({
      definition: makeDefinition({ retry: { maxAttempts: 2, backoff: { initialMs: 0 } } }),
      input: { state: 'refund' },
    })

    expect(run.status).toBe('ended')
    expect(run.outcome).toBe('first')
    expect(calls).toBe(2)
  })

  test.each([408, 500, 502, 503, 504])('retries status %i and then succeeds', async (status) => {
    let calls = 0
    const backend: SystemOneBackend = {
      async predict() {
        calls += 1
        if (calls === 1) throw new SystemOneConnectionError({ message: 'temporary', status })
        return answerResult()
      },
    }
    const run = await makeGraph(backend).run({
      definition: makeDefinition({ retry: { maxAttempts: 2, backoff: { initialMs: 0 } } }),
      input: { state: 'refund' },
    })

    expect(run.status).toBe('ended')
    expect(calls).toBe(2)
  })

  test('waits the server retry-after delay before trying again', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-28T10:00:00.000Z'))
    let calls = 0
    const backend: SystemOneBackend = {
      async predict() {
        calls += 1
        if (calls === 1) {
          const { SystemOneRateLimitError } = await import('@mokei/system-one-client')
          throw new SystemOneRateLimitError({ message: 'wait', status: 429, retryAfterMs: 250 })
        }
        return answerResult()
      },
    }
    const runPromise = makeGraph(backend, [], { now: () => Date.now() }).run({
      definition: makeDefinition({
        retry: { maxAttempts: 2, backoff: { initialMs: 0 } },
      }),
      input: { state: 'refund' },
    })
    for (let flush = 0; flush < 20 && calls === 0; flush += 1) {
      await Promise.resolve()
    }
    expect(calls).toBe(1)
    await vi.advanceTimersByTimeAsync(249)
    expect(calls).toBe(1)
    await vi.advanceTimersByTimeAsync(1)

    const run = await runPromise
    expect(run.status).toBe('ended')
    expect(calls).toBe(2)
  })

  test.each([
    ['bad request', new SystemOneConnectionError({ message: 'bad request', status: 400 })],
    ['auth', new SystemOneAuthError({ message: 'auth' })],
    ['model', new SystemOneModelError({ message: 'model' })],
    ['input', new SystemOneInputError({ message: 'input' })],
    ['response', new SystemOneResponseError({ message: 'response' })],
  ])('does not retry %s failures', async (_label, error) => {
    let calls = 0
    const backend: SystemOneBackend = {
      async predict() {
        calls += 1
        throw error
      },
    }
    const run = await makeGraph(backend).run({
      definition: makeDefinition({ retry: { maxAttempts: 3, backoff: { initialMs: 0 } } }),
      input: { state: 'refund' },
    })

    expect(run.status).toBe('error')
    expect(run.error?.reason).toBe('non_retryable')
    expect(calls).toBe(1)
  })

  test('retries attempt timeouts against a backend that never settles', async () => {
    vi.useFakeTimers()
    const neverSettles: SystemOneBackend = {
      predict: () => new Promise(() => {}),
    }
    const runPromise = makeGraph(neverSettles, [], { now: () => Date.now() }).run({
      definition: makeDefinition({
        onError: 'handled',
        retry: {
          maxAttempts: 2,
          attemptTimeoutMs: 10,
          backoff: { initialMs: 0 },
        },
      }),
      input: { state: 'refund' },
    })
    await vi.advanceTimersByTimeAsync(25)
    const run = await runPromise

    expect(run.status).toBe('ended')
    expect(run.runState.frames[0]?.results.decide).toMatchObject({
      error: { type: 'TimeoutInterruption', reason: 'attempts', attempts: 2 },
    })
  })

  test('suspends a long 429 retry and resumes it with a retry event', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-28T10:00:00.000Z'))
    let calls = 0
    const backend: SystemOneBackend = {
      async predict() {
        calls += 1
        if (calls === 1) {
          const { SystemOneRateLimitError } = await import('@mokei/system-one-client')
          throw new SystemOneRateLimitError({ message: 'wait', status: 429, retryAfterMs: 60_000 })
        }
        return answerResult()
      },
    }
    const definition = makeDefinition({
      retry: {
        maxAttempts: 2,
        backoff: { initialMs: 0 },
        suspendAfterMs: 1_000,
      },
    })
    const graph = makeGraph(backend, [], {
      now: () => Date.now(),
      resolver: createMapResolver([definition]),
    })
    const suspended = await graph.run({
      definition,
      input: { state: 'refund' },
    })

    expect(suspended.status).toBe('suspended')
    expect(suspended.pending?.reason).toBe('retry')
    vi.advanceTimersByTime(60_000)
    const resumedRun = graph.resume({
      runState: suspended.runState,
      event: { type: 'retry' },
    })
    let finalStatus: string | undefined
    let finalOutcome: string | undefined
    for await (const state of resumedRun) {
      finalStatus = state.status
      finalOutcome = state.outcome
    }
    expect(finalStatus).toBe('ended')
    expect(finalOutcome).toBe('first')
    expect(calls).toBe(2)
  })

  test('passes safe failure details to onError and uses node_failed otherwise', async () => {
    const backend: SystemOneBackend = {
      async predict() {
        throw new SystemOneConnectionError({ message: 'private', status: 400 })
      },
    }
    const retry = { maxAttempts: 3, backoff: { initialMs: 0 } }
    const handled = await makeGraph(backend).run({
      definition: makeDefinition({ onError: 'handled', retry }),
      input: { state: 'refund' },
    })
    const failed = await makeGraph(backend).run({
      definition: makeDefinition({ retry }),
      input: { state: 'refund' },
    })

    expect(handled.runState.frames[0]?.results.decide).toMatchObject({
      error: {
        type: 'SystemOneConnectionError',
        status: 400,
        reason: 'non_retryable',
        attempts: 1,
      },
    })
    expect(failed.status).toBe('error')
    expect(failed.error?.code).toBe('node_failed')
    expect(failed.error?.lastFailure).toMatchObject({
      type: 'SystemOneConnectionError',
      status: 400,
    })
  })

  test('fails without retry when neither client nor node specifies a model', async () => {
    let calls = 0
    const client = new SystemOneClient({
      backend: {
        async predict() {
          calls += 1
          return answerResult()
        },
      },
    })
    const graph = createFlowGraph({ kinds: [makeDecideKind({ client })] })
    const run = await graph.run({
      definition: makeDefinition({ retry: { maxAttempts: 3, backoff: { initialMs: 0 } } }),
      input: { state: 'refund' },
    })

    expect(run.status).toBe('error')
    expect(run.error?.reason).toBe('non_retryable')
    expect(run.error?.attempts).toBe(1)
    expect(calls).toBe(0)
  })

  afterEach(() => {
    vi.useRealTimers()
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
