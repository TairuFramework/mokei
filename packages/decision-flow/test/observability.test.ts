/// <reference types="node" />

import { AsyncLocalStorage } from 'node:async_hooks'
import {
  type SystemOneBackend,
  SystemOneClient,
  SystemOneConnectionError,
  SystemOneRateLimitError,
  type SystemOneResult,
} from '@mokei/system-one-client'
import { type Context, context, ROOT_CONTEXT, trace } from '@opentelemetry/api'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import type { FlowDefinition } from '@sozai/flow-graph'
import { type LogRecord, reset as resetLogging, setup as setupLogging } from '@sozai/log'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

import { createDecisionFlowGraph } from '../src/index.js'

const storage = new AsyncLocalStorage<Context>()
const exporter = new InMemorySpanExporter()
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
})

beforeAll(() => {
  context.setGlobalContextManager({
    active: () => storage.getStore() ?? ROOT_CONTEXT,
    with: <A extends Array<unknown>, F extends (...args: A) => ReturnType<F>>(
      ctx: Context,
      fn: F,
      thisArg?: ThisParameterType<F>,
      ...args: A
    ): ReturnType<F> => storage.run(ctx, () => fn.call(thisArg, ...args)),
    bind: <T>(_ctx: Context, target: T): T => target,
    enable() {
      return this
    },
    disable() {
      return this
    },
  })
  trace.setGlobalTracerProvider(provider)
})

beforeEach(() => {
  exporter.reset()
})

afterEach(() => {
  resetLogging()
  vi.useRealTimers()
})

afterAll(() => {
  void provider.shutdown()
  trace.disable()
  context.disable()
})

function makeBackend(response: SystemOneResult | Error): SystemOneBackend {
  return {
    async predict() {
      if (response instanceof Error) throw response
      return response
    },
  }
}

function makeDefinition(overrides: Record<string, unknown> = {}): FlowDefinition {
  return {
    id: 'observability-test',
    name: 'Observability test',
    version: 1,
    start: 'decide',
    nodes: {
      decide: {
        kind: 'decide',
        state: { ref: ['input'] },
        questions: {
          department: {
            type: 'choice',
            instructions: 'PRIVATE_INSTRUCTIONS',
            criteria: { billing: 'PRIVATE_CRITERION_DESCRIPTION' },
          },
          urgency: {
            type: 'score',
            instructions: 'PRIVATE_SCORE_INSTRUCTIONS',
            criteria: ['low urgency', 'high urgency'],
          },
          request: { type: 'noul', instructions: 'PRIVATE_NOUL_INSTRUCTIONS' },
        },
        cases: [],
        default: 'finish',
        ...overrides,
      },
      finish: { kind: 'end', outcome: 'done' },
      ...(overrides.onError ? { handled: { kind: 'end', outcome: 'handled' } } : {}),
    },
  } as unknown as FlowDefinition
}

function configureLogSink(records: Array<LogRecord>) {
  setupLogging({
    sinks: {
      test: (record) => records.push(record),
    },
    loggers: [{ category: ['mokei'], lowestLevel: 'trace', sinks: ['test'] }],
  })
}

describe('decision flow observability', () => {
  test('records a safe predict span and one fixed-key answer event per question', async () => {
    const graph = createDecisionFlowGraph({
      client: new SystemOneClient({
        backend: makeBackend({
          model: 'system-one-model',
          answers: {
            department: {
              type: 'choice',
              choice: 'billing',
              confidence: 0.92,
              probabilities: { billing: 0.92 },
              rationale: 'PRIVATE_RESULT_EXTRA',
            },
            urgency: {
              type: 'score',
              score: 0.7,
              confidence: 0.8,
              legend: {},
              probabilities: {},
            },
            request: { type: 'noul', noul: 1 },
          },
          usage: { input_tokens: 17, output_tokens: 9 },
        } as SystemOneResult),
        defaultModel: 'default-model',
      }),
    })

    await graph.run({
      definition: makeDefinition(),
      input: { message: 'PRIVATE_STATE' },
    })
    await provider.forceFlush()
    const spans = exporter.getFinishedSpans()
    const predict = spans.find((span) => span.name === 'decision.predict')
    const node = spans.find((span) => span.name === 'flow.node')
    const serialized = JSON.stringify(
      spans.map((span) => ({
        name: span.name,
        attributes: span.attributes,
        events: span.events,
        status: span.status,
      })),
    )

    expect(predict).toBeDefined()
    expect(predict?.parentSpanContext?.spanId).toBe(node?.spanContext().spanId)
    expect(predict?.attributes).toMatchObject({
      'system_one.model': 'system-one-model',
      'system_one.question.count': 3,
      'system_one.usage.input_tokens': 17,
      'system_one.usage.output_tokens': 9,
    })
    expect(
      node?.events
        .filter((event) => event.name === 'decision.answer')
        .map((event) => event.attributes),
    ).toEqual([
      {
        'decision.question': 'department',
        'decision.type': 'choice',
        'decision.choice': 'billing',
        'decision.confidence': 0.92,
      },
      {
        'decision.question': 'urgency',
        'decision.type': 'score',
        'decision.score': 0.7,
        'decision.confidence': 0.8,
      },
      {
        'decision.question': 'request',
        'decision.type': 'noul',
        'decision.noul': 1,
      },
    ])
    expect(serialized).not.toContain('PRIVATE_STATE')
    expect(serialized).not.toContain('PRIVATE_INSTRUCTIONS')
    expect(serialized).not.toContain('PRIVATE_CRITERION_DESCRIPTION')
    expect(serialized).not.toContain('PRIVATE_SCORE_INSTRUCTIONS')
    expect(serialized).not.toContain('PRIVATE_NOUL_INSTRUCTIONS')
    expect(serialized).not.toContain('PRIVATE_RESULT_EXTRA')
  })

  test('keeps prediction payloads and backend messages out of default spans', async () => {
    const graph = createDecisionFlowGraph({
      client: new SystemOneClient({
        backend: makeBackend(
          new SystemOneRateLimitError({
            message: 'PRIVATE_BACKEND_MESSAGE',
            status: 429,
            retryAfterMs: 125,
          }),
        ),
        defaultModel: 'default-model',
      }),
      retryDefaults: { decide: { maxAttempts: 1 } },
    })

    await graph.run({
      definition: makeDefinition(),
      input: { message: 'PRIVATE_STATE' },
    })
    await provider.forceFlush()
    const spans = exporter.getFinishedSpans()
    const predict = spans.find((span) => span.name === 'decision.predict')
    const serialized = JSON.stringify(
      spans.map((span) => ({
        name: span.name,
        attributes: span.attributes,
        events: span.events,
        status: span.status,
      })),
    )

    expect(predict?.status.code).toBe(2)
    expect(predict?.attributes).toMatchObject({
      'error.type': 'SystemOneRateLimitError',
      'http.status_code': 429,
      'system_one.retry_after_ms': 125,
    })
    expect(predict?.events).toEqual([])
    expect(serialized).not.toContain('PRIVATE_STATE')
    expect(serialized).not.toContain('PRIVATE_BACKEND_MESSAGE')
    expect(serialized).not.toContain('PRIVATE_INSTRUCTIONS')
    expect(serialized).not.toContain('PRIVATE_CRITERION_DESCRIPTION')
  })

  test('ignores undeclared top-level answers in results and answer events', async () => {
    const graph = createDecisionFlowGraph({
      client: new SystemOneClient({
        backend: makeBackend({
          model: 'system-one-model',
          answers: {
            department: {
              type: 'choice',
              choice: 'billing',
              confidence: 0.92,
              probabilities: { billing: 0.92 },
            },
            error: { type: 'choice', choice: 'spoofed', confidence: 1 },
            unexpected: { type: 'noul', noul: 1 },
          } as unknown as SystemOneResult['answers'],
          usage: { input_tokens: 2, output_tokens: 1 },
        } as SystemOneResult),
        defaultModel: 'default-model',
      }),
    })
    const definition = makeDefinition({
      questions: {
        department: {
          type: 'choice',
          instructions: 'Which department?',
          criteria: { billing: 'Billing' },
        },
      },
      onError: 'handled',
      cases: [
        {
          when: {
            path: ['results', 'decide', 'error', 'type'],
            is: { equalTo: 'choice' },
          },
          to: 'handled',
        },
      ],
    })

    const run = await graph.run({ definition, input: { message: 'refund' } })
    await provider.forceFlush()
    const node = exporter.getFinishedSpans().find((span) => span.name === 'flow.node')

    expect(run.status).toBe('ended')
    expect(run.outcome).toBe('done')
    expect(run.runState.frames[0]?.results.decide).toMatchObject({
      department: { choice: 'billing' },
      $meta: { model: 'system-one-model' },
    })
    expect(run.runState.frames[0]?.results.decide).not.toHaveProperty('error')
    expect(run.runState.frames[0]?.results.decide).not.toHaveProperty('unexpected')
    expect(
      node?.events
        .filter((event) => event.name === 'decision.answer')
        .map((event) => event.attributes?.['decision.question']),
    ).toEqual(['department'])
  })

  test('ends predict span with timeout metadata when the backend never settles', async () => {
    vi.useFakeTimers()
    const graph = createDecisionFlowGraph({
      client: new SystemOneClient({
        backend: { predict: () => new Promise(() => {}) },
        defaultModel: 'default-model',
      }),
      retryDefaults: { decide: { maxAttempts: 1, attemptTimeoutMs: 10 } },
    })
    const runPromise = graph.run({
      definition: makeDefinition(),
      input: { message: 'refund' },
    })

    await vi.advanceTimersByTimeAsync(20)
    await runPromise
    await provider.forceFlush()

    const predict = exporter.getFinishedSpans().find((span) => span.name === 'decision.predict')
    expect(predict?.status.code).toBe(2)
    expect(predict?.attributes['error.type']).toBe('TimeoutInterruption')
  })

  test('leaves one engine log record per retried, handled, and terminal failure', async () => {
    const records: Array<LogRecord> = []
    configureLogSink(records)
    let retryCalls = 0
    const retryGraph = createDecisionFlowGraph({
      client: new SystemOneClient({
        backend: {
          async predict() {
            retryCalls += 1
            if (retryCalls === 1) {
              throw new SystemOneRateLimitError({
                message: 'PRIVATE_BACKEND_MESSAGE',
                status: 429,
                retryAfterMs: -5,
              })
            }
            return {
              model: 'test-model',
              answers: {
                department: {
                  type: 'choice',
                  choice: 'billing',
                  confidence: 0.9,
                  probabilities: { billing: 0.9 },
                },
                urgency: {
                  type: 'score',
                  score: 0.3,
                  confidence: 0.8,
                  legend: {},
                  probabilities: {},
                },
                request: { type: 'noul', noul: 0 },
              },
              usage: { input_tokens: 1, output_tokens: 1 },
            }
          },
        },
        defaultModel: 'default-model',
      }),
      retryDefaults: { decide: { maxAttempts: 2, backoff: { initialMs: 0 } } },
    })
    const terminalGraph = createDecisionFlowGraph({
      client: new SystemOneClient({
        backend: makeBackend(
          new SystemOneConnectionError({
            message: 'PRIVATE_BACKEND_MESSAGE',
            status: 400,
          }),
        ),
        defaultModel: 'default-model',
      }),
      retryDefaults: { decide: { maxAttempts: 2, backoff: { initialMs: 0 } } },
    })
    const handledGraph = createDecisionFlowGraph({
      client: new SystemOneClient({
        backend: makeBackend(
          new SystemOneConnectionError({
            message: 'PRIVATE_BACKEND_MESSAGE',
            status: 400,
          }),
        ),
        defaultModel: 'default-model',
      }),
      retryDefaults: { decide: { maxAttempts: 2, backoff: { initialMs: 0 } } },
    })

    await retryGraph.run({ definition: makeDefinition(), input: { message: 'PRIVATE_STATE' } })
    await handledGraph.run({
      definition: makeDefinition({ onError: 'handled' }),
      input: { message: 'PRIVATE_STATE' },
    })
    await terminalGraph.run({ definition: makeDefinition(), input: { message: 'PRIVATE_STATE' } })
    await provider.forceFlush()

    const decisionRecords = records.filter(
      (record) => record.category.join('.') === 'mokei.decision-flow',
    )
    expect(retryCalls).toBe(2)
    expect(
      decisionRecords.map((record) => [record.category.join('.'), record.level, record.message]),
    ).toEqual([
      ['mokei.decision-flow', 'warning', ['Flow node retry scheduled']],
      ['mokei.decision-flow', 'warning', ['Flow node failure handled']],
      ['mokei.decision-flow', 'error', ['Flow run failed']],
    ])
    expect(decisionRecords.map((record) => record.level)).toEqual(['warning', 'warning', 'error'])
    expect(decisionRecords).toHaveLength(3)
    expect(decisionRecords[0]?.properties).toMatchObject({
      type: 'SystemOneRateLimitError',
      status: 429,
      retryAfterMs: 0,
    })
    expect(decisionRecords[1]?.properties).toMatchObject({
      type: 'SystemOneConnectionError',
      status: 400,
    })
    expect(decisionRecords[2]?.properties).toMatchObject({
      type: 'SystemOneConnectionError',
      status: 400,
    })
    for (const record of decisionRecords) {
      expect(record.properties).not.toHaveProperty('message')
      expect(record.properties).not.toHaveProperty('cause')
    }
    const nodeContexts = exporter
      .getFinishedSpans()
      .filter((span) => span.name === 'flow.node')
      .map((span) => ({ traceID: span.spanContext().traceId, spanID: span.spanContext().spanId }))
    for (const record of decisionRecords) {
      expect(nodeContexts).toContainEqual({
        traceID: record.properties.traceID,
        spanID: record.properties.spanID,
      })
      expect(record.properties).not.toHaveProperty('error')
      expect(JSON.stringify(record)).not.toContain('PRIVATE_BACKEND_MESSAGE')
    }
    expect(JSON.stringify(records)).not.toContain('PRIVATE_STATE')
  })

  test('forwards recordErrorMessages to the engine when explicitly enabled', async () => {
    const graph = createDecisionFlowGraph({
      client: new SystemOneClient({
        backend: makeBackend(new Error('PRIVATE_BACKEND_MESSAGE')),
        defaultModel: 'default-model',
      }),
      retryDefaults: { decide: { maxAttempts: 1 } },
      recordErrorMessages: true,
    })

    await graph.run({ definition: makeDefinition(), input: { message: 'PRIVATE_STATE' } })
    await provider.forceFlush()
    const spans = exporter.getFinishedSpans()

    expect(spans.map((span) => ({ name: span.name, events: span.events }))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          events: expect.arrayContaining([
            expect.objectContaining({
              name: 'exception',
              attributes: expect.objectContaining({
                'exception.message': 'PRIVATE_BACKEND_MESSAGE',
              }),
            }),
          ]),
        }),
      ]),
    )
  })
})
