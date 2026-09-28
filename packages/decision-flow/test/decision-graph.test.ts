import { type SystemOneBackend, SystemOneClient } from '@mokei/system-one-client'
import {
  defineNodeKind,
  type FlowDefinition,
  type FlowGraphOptions,
  type FlowRetryPolicy,
} from '@sozai/flow-graph'
import { createValidator } from '@sozai/schema'
import { describe, expect, test } from 'vitest'

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

describe('createDecisionFlowGraph', () => {
  test('provides the default retry policy and composed authoring schema', () => {
    const graph = createDecisionFlowGraph({ client: makeClient() })

    expect(graph.authoringSchema).toMatchSnapshot()
    expect(flowDefinitionSchema).toEqual(graph.authoringSchema)
    expect(flowStorageSchema).toEqual(graph.storageSchema)
    expect(graph.check(makeDefinition()).ok).toBe(true)
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

  test('uses caller decide retry defaults without changing action defaults', async () => {
    const retryDefaults: Record<string, FlowRetryPolicy> = {
      decide: { maxAttempts: 2, backoff: { initialMs: 0 } },
      action: { maxAttempts: 4, backoff: { initialMs: 0 } },
    }
    const graph = createDecisionFlowGraph({ client: makeClient(), retryDefaults })

    await expect(startedDecisionPolicy(graph)).resolves.toEqual(retryDefaults.decide)
    expect(retryDefaults.action).toEqual({ maxAttempts: 4, backoff: { initialMs: 0 } })
  })

  test('a node retry policy replaces the default instead of merging with it', async () => {
    const graph = createDecisionFlowGraph({ client: makeClient() })
    const nodeRetry = { maxAttempts: 1, backoff: { initialMs: 0 } }

    await expect(startedDecisionPolicy(graph, nodeRetry)).resolves.toEqual(nodeRetry)
  })

  test('registers decide and caller kinds and forwards supported options', () => {
    const retryDefaults: Record<string, FlowRetryPolicy> = {
      decide: { maxAttempts: 5, backoff: { initialMs: 0 } },
      action: { maxAttempts: 7, backoff: { initialMs: 0 } },
    }
    const runtime = {} as FlowGraphOptions['runtime']
    const logger = {} as FlowGraphOptions['logger']
    const graph = createDecisionFlowGraph({
      client: makeClient(),
      kinds: [customKind],
      actions: { custom: () => ({ value: true }) },
      retryDefaults,
      maxSteps: 12,
      runtime,
      logger,
      recordErrorMessages: true,
      random: () => 0.25,
      now: () => 1_800_000_000_000,
    })

    expect(JSON.stringify(graph.authoringSchema)).toContain('custom')
    expect(JSON.stringify(graph.authoringSchema)).toContain('decide')
    expect(JSON.stringify(graph.authoringSchema)).toContain('branch')
    expect(
      graph.check(makeDefinition({ kind: 'action', name: 'custom', next: 'finish' })).issues,
    ).not.toContainEqual(expect.objectContaining({ code: 'unknown_action' }))
    expect(retryDefaults.action).toEqual({ maxAttempts: 7, backoff: { initialMs: 0 } })
    expect(retryDefaults.decide).toEqual({ maxAttempts: 5, backoff: { initialMs: 0 } })
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
