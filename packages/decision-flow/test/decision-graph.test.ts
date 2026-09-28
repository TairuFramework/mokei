import { type SystemOneBackend, SystemOneClient } from '@mokei/system-one-client'
import { trace } from '@opentelemetry/api'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import {
  defineNodeKind,
  type FlowDefinition,
  type FlowGraphOptions,
  type FlowRetryPolicy,
} from '@sozai/flow-graph'
import { createValidator } from '@sozai/schema'
import { describe, expect, test, vi } from 'vitest'

import {
  createDecisionFlowGraph,
  flowDefinitionSchema,
  flowStorageSchema,
  formatIssues,
} from '../src/index.js'

function makeClient(
  backend: SystemOneBackend = {
    async predict() {
      throw new Error('unused')
    },
  },
) {
  return new SystemOneClient({ backend, defaultModel: 'test-model' })
}

function makeDefinition(
  node: Record<string, unknown> = { kind: 'end', outcome: 'done' },
): FlowDefinition {
  return {
    id: 'decision-graph-test',
    name: 'Decision graph test',
    version: 1,
    start: 'finish',
    nodes: { finish: node },
  } as unknown as FlowDefinition
}

function makeDecisionDefinition(retry?: FlowRetryPolicy): FlowDefinition {
  return {
    id: 'decision-retry-test',
    name: 'Decision retry test',
    version: 1,
    start: 'decide',
    nodes: {
      decide: {
        kind: 'decide',
        state: { value: 'hello' },
        questions: { intent: { type: 'noul', instructions: 'Is this a request?' } },
        cases: [],
        default: 'finish',
        ...(retry ? { retry } : {}),
      },
      finish: { kind: 'end', outcome: 'done' },
    },
  } as FlowDefinition
}

async function startedDecisionPolicy(
  graph: ReturnType<typeof createDecisionFlowGraph>,
  retry?: FlowRetryPolicy,
) {
  const run = graph.start({ definition: makeDecisionDefinition(retry), runID: 'retry-test' })
  const first = await run.next()
  return first.value.frames[0]?.attempts.decide?.policy
}

const customKind = defineNodeKind({
  kind: 'custom',
  schema: {
    type: 'object',
    properties: { kind: { const: 'custom' } },
    required: ['kind'],
    additionalProperties: false,
    description: 'A custom test node.',
    examples: [{ kind: 'custom' }],
  },
  targets: () => [],
  execute: () => ({ next: 'done' }),
})

const observableKind = defineNodeKind<{ kind: 'observable'; next: string }>({
  kind: 'observable',
  schema: {
    type: 'object',
    properties: { kind: { const: 'observable' }, next: { type: 'string' } },
    required: ['kind', 'next'],
    additionalProperties: false,
    description: 'Observable test node.',
    examples: [{ kind: 'observable', next: 'finish' }],
  },
  targets: (node) => [{ path: ['next'], id: String(node.next) }],
  execute: (_node, ctx) => {
    observedRuntime = ctx.runtime
    ctx.logger.info('observable kind executed')
    return { next: 'finish' }
  },
})

let observedRuntime: unknown

const retryingKind = defineNodeKind<{ kind: 'retrying'; next: string }>({
  kind: 'retrying',
  schema: {
    type: 'object',
    properties: { kind: { const: 'retrying' }, next: { type: 'string' } },
    required: ['kind', 'next'],
    additionalProperties: false,
    description: 'Retrying test node.',
    examples: [{ kind: 'retrying', next: 'finish' }],
  },
  retries: true,
  retryable: () => true,
  targets: (node) => [{ path: ['next'], id: String(node.next) }],
  execute: () => {
    throw new Error('retry this node')
  },
})

const throwingKind = defineNodeKind<{ kind: 'throwing-test'; next: string }>({
  kind: 'throwing-test',
  schema: {
    type: 'object',
    properties: { kind: { const: 'throwing-test' }, next: { type: 'string' } },
    required: ['kind', 'next'],
    additionalProperties: false,
    description: 'A throwing test node.',
    examples: [{ kind: 'throwing-test', next: 'finish' }],
  },
  targets: (node) => [{ path: ['next'], id: String(node.next) }],
  execute: () => {
    throw new Error('private node error')
  },
})

function walkSchemaProperties(
  schema: Record<string, unknown>,
  path = '#',
): Array<[string, Record<string, unknown>]> {
  const found: Array<[string, Record<string, unknown>]> = []
  const properties = schema.properties
  if (properties && typeof properties === 'object') {
    for (const [name, property] of Object.entries(properties)) {
      if (property && typeof property === 'object' && !Array.isArray(property)) {
        const propertyPath = `${path}/properties/${name}`
        found.push([propertyPath, property as Record<string, unknown>])
        found.push(...walkSchemaProperties(property as Record<string, unknown>, propertyPath))
      }
    }
  }
  for (const key of ['definitions', 'items']) {
    const child = schema[key]
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      found.push(...walkSchemaProperties(child as Record<string, unknown>, `${path}/${key}`))
    }
  }
  const additionalProperties = schema.additionalProperties
  if (
    additionalProperties &&
    typeof additionalProperties === 'object' &&
    !Array.isArray(additionalProperties)
  ) {
    found.push(
      ...walkSchemaProperties(
        additionalProperties as Record<string, unknown>,
        `${path}/additionalProperties`,
      ),
    )
  }
  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    const children = schema[key]
    if (Array.isArray(children)) {
      children.forEach((child, index) => {
        if (child && typeof child === 'object') {
          found.push(
            ...walkSchemaProperties(child as Record<string, unknown>, `${path}/${key}/${index}`),
          )
        }
      })
    }
  }
  return found
}

function definitionWith(node: Record<string, unknown>): FlowDefinition {
  return {
    id: 'decision-graph-option-test',
    name: 'Decision graph option test',
    version: 1,
    start: 'start',
    nodes: { start: node, finish: { kind: 'end', outcome: 'done' } },
  } as unknown as FlowDefinition
}

describe('createDecisionFlowGraph', () => {
  test('provides the default retry policy and composed authoring schema', () => {
    const graph = createDecisionFlowGraph({ client: makeClient() })

    expect(graph.authoringSchema).toMatchSnapshot()
    expect(flowDefinitionSchema).toEqual(graph.authoringSchema)
    expect(flowStorageSchema).toEqual(graph.storageSchema)
    expect(graph.check(makeDefinition()).ok).toBe(true)
  })

  test('documents every decide schema property with a description and example', () => {
    const decideVariant = (flowDefinitionSchema.properties as Record<string, unknown>)
      .nodes as Record<string, unknown>
    const nodes = decideVariant.additionalProperties as Record<string, unknown>
    const variants = nodes.oneOf as Array<Record<string, unknown>>
    const decideSchema = variants.find((variant) => {
      const kind = (variant.properties as Record<string, Record<string, unknown>>)?.kind
      return kind?.const === 'decide'
    })
    expect(decideSchema).toBeDefined()
    const properties = walkSchemaProperties(decideSchema ?? {})
    expect(properties.length).toBeGreaterThan(0)
    const missing = properties.flatMap(([path, property]) => {
      const keywords = ['description', 'examples'].filter((keyword) => !(keyword in property))
      return keywords.length > 0 ? [{ path, keywords }] : []
    })
    expect(missing).toEqual([])
  })

  test('uses the default decide retry policy exactly', async () => {
    const graph = createDecisionFlowGraph({ client: makeClient() })

    await expect(startedDecisionPolicy(graph)).resolves.toEqual({
      maxAttempts: 3,
      attemptTimeoutMs: 10000,
      backoff: { initialMs: 500, jitter: true },
      suspendAfterMs: 30000,
    })
  })

  test('uses caller decide retry defaults and applies action retry defaults to an action node', async () => {
    const retryDefaults: Record<string, FlowRetryPolicy> = {
      decide: { maxAttempts: 2, backoff: { initialMs: 0 } },
      action: { maxAttempts: 4, backoff: { initialMs: 0 } },
    }
    const graph = createDecisionFlowGraph({ client: makeClient(), retryDefaults })

    await expect(startedDecisionPolicy(graph)).resolves.toEqual(retryDefaults.decide)
    const actionRun = graph.start({
      definition: definitionWith({ kind: 'action', name: 'test', next: 'finish' }),
      runID: 'action-retry-test',
    })
    const actionEntry = await actionRun.next()
    expect(actionEntry.value.frames[0]?.attempts.start?.policy).toEqual(retryDefaults.action)
  })

  test('a node retry policy replaces the default instead of merging with it', async () => {
    const graph = createDecisionFlowGraph({ client: makeClient() })
    const nodeRetry = { maxAttempts: 1, backoff: { initialMs: 0 } }

    await expect(startedDecisionPolicy(graph, nodeRetry)).resolves.toEqual(nodeRetry)
  })

  test('forwards kinds, actions, and maxSteps to graph execution', async () => {
    const retryDefaults: Record<string, FlowRetryPolicy> = {
      decide: { maxAttempts: 5, backoff: { initialMs: 0 } },
      action: { maxAttempts: 7, backoff: { initialMs: 0 } },
    }
    const runtime = { getRandomID: () => 'injected-id' } as FlowGraphOptions['runtime']
    const logInfo = vi.fn()
    const logger = { info: logInfo } as unknown as NonNullable<FlowGraphOptions['logger']>
    const customAction = vi.fn(() => ({ value: true }))
    const graph = createDecisionFlowGraph({
      client: makeClient(),
      kinds: [customKind, observableKind],
      actions: { custom: customAction },
      retryDefaults,
      maxSteps: 12,
      runtime,
      logger,
      recordErrorMessages: true,
    })

    expect(JSON.stringify(graph.authoringSchema)).toContain('custom')
    expect(JSON.stringify(graph.authoringSchema)).toContain('decide')
    expect(JSON.stringify(graph.authoringSchema)).toContain('branch')
    expect(
      graph.check(makeDefinition({ kind: 'action', name: 'custom', next: 'finish' })).issues,
    ).not.toContainEqual(expect.objectContaining({ code: 'unknown_action' }))
    await graph.run({
      definition: definitionWith({ kind: 'action', name: 'custom', next: 'finish' }),
      runID: 'custom-action-test',
    })
    expect(customAction).toHaveBeenCalledTimes(1)
    const customDefinition = definitionWith({ kind: 'observable', next: 'finish' })
    const run = graph.start({ definition: customDefinition, runID: 'runtime-logger-test' })
    await run.next()
    await run.next()
    expect(observedRuntime).toBe(runtime)
    expect(logInfo).toHaveBeenCalledWith('observable kind executed')

    const chainKind = defineNodeKind<{ kind: 'chain-test'; next: string }>({
      kind: 'chain-test',
      schema: {
        type: 'object',
        properties: { kind: { const: 'chain-test' }, next: { type: 'string' } },
        required: ['kind', 'next'],
        additionalProperties: false,
        description: 'A finite chain test node.',
        examples: [{ kind: 'chain-test', next: 'finish' }],
      },
      targets: (node) => [{ path: ['next'], id: String(node.next) }],
      execute: (node) => ({ next: String(node.next) }),
    })
    const maxStepGraph = createDecisionFlowGraph({
      client: makeClient(),
      kinds: [chainKind],
      maxSteps: 1,
    })
    const longDefinition = {
      ...definitionWith({ kind: 'chain-test', next: 'middle' }),
      nodes: {
        start: { kind: 'chain-test', next: 'middle' },
        middle: { kind: 'chain-test', next: 'finish' },
        finish: { kind: 'end', outcome: 'done' },
      },
    } as FlowDefinition
    await expect(
      maxStepGraph.run({ definition: longDefinition, runID: 'max-steps-test' }),
    ).resolves.toMatchObject({ status: 'error', error: { code: 'max_steps' } })

    const fixedNow = 1_800_000_000_000
    const clockGraph = createDecisionFlowGraph({ client: makeClient(), now: () => fixedNow })
    const timedDefinition = definitionWith({
      kind: 'input',
      next: 'finish',
      timeout: { afterMs: 500, to: 'finish' },
    })
    const timedRun = clockGraph.start({ definition: timedDefinition, runID: 'now-test' })
    const suspended = await timedRun.next()
    expect(suspended.value.pending?.deadline).toBe(new Date(fixedNow + 500).toISOString())

    const retryGraph = createDecisionFlowGraph({
      client: makeClient(),
      kinds: [retryingKind],
      now: () => fixedNow,
      random: () => 0.25,
      retryDefaults: { retrying: { maxAttempts: 2, backoff: { initialMs: 100, jitter: true } } },
    })
    const retryRun = retryGraph.start({
      definition: definitionWith({ kind: 'retrying', next: 'finish' }),
      runID: 'random-test',
    })
    await retryRun.next()
    await retryRun.next()
    const retryScheduled = await retryRun.next()
    expect(retryScheduled.value.frames[0]?.attempts.start?.retryAt).toBe(
      new Date(fixedNow + 25).toISOString(),
    )
  })

  test('records error messages only when recordErrorMessages is enabled', async () => {
    const exporter = new InMemorySpanExporter()
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    })
    trace.setGlobalTracerProvider(provider)
    try {
      const enabledGraph = createDecisionFlowGraph({
        client: makeClient(),
        kinds: [throwingKind],
        recordErrorMessages: true,
      })
      await enabledGraph.run({
        definition: definitionWith({ kind: 'throwing-test', next: 'finish' }),
        runID: 'error-message-on',
      })
      await provider.forceFlush()
      const enabledSpans = exporter.getFinishedSpans()
      expect(
        enabledSpans
          .flatMap((span) => span.events)
          .some(
            (event) =>
              event.name === 'exception' &&
              event.attributes?.['exception.message'] === 'private node error',
          ),
      ).toBe(true)

      exporter.reset()
      const disabledGraph = createDecisionFlowGraph({
        client: makeClient(),
        kinds: [throwingKind],
        recordErrorMessages: false,
      })
      await disabledGraph.run({
        definition: definitionWith({ kind: 'throwing-test', next: 'finish' }),
        runID: 'error-message-off',
      })
      await provider.forceFlush()
      const disabledSpans = exporter.getFinishedSpans().filter((span) => span.name === 'flow.node')
      expect(
        disabledSpans.some((span) => span.events.some((event) => event.name === 'exception')),
      ).toBe(false)
      expect(disabledSpans.some((span) => span.attributes['error.type'] === 'Error')).toBe(true)
    } finally {
      await provider.shutdown()
      trace.disable()
    }
  })

  test('authoring rejects reserved call nodes while storage accepts them', () => {
    const callDefinition = makeDefinition({ kind: 'call', flow: 'later', next: 'finish' })

    expect(createValidator(flowDefinitionSchema)(callDefinition)).toHaveProperty('issues')
    expect(createValidator(flowStorageSchema)(callDefinition)).not.toHaveProperty('issues')
  })

  test('formats validation issues with path, code, message, and hint', () => {
    const graph = createDecisionFlowGraph({ client: makeClient() })
    const result = graph.check({ id: '', name: 'Bad', version: -1, start: 'missing', nodes: {} })
    const formatted = formatIssues(result.issues)

    expect(formatted).toContain('schema')
    expect(formatted).toContain('Fix:')
    expect(formatted).toContain('id:')
    expect(formatted).toContain('must NOT have fewer than 1 characters')
  })
})
