import { getMokeiLogger } from '@mokei/logger'
import type { SystemOneClient } from '@mokei/system-one-client'
import { createFlowGraph, type FlowGraph, type FlowGraphOptions } from '@sozai/flow-graph'
import type { Schema } from '@sozai/schema'

import { decideKind } from './decide-node.js'

export type DecisionFlowGraphOptions = FlowGraphOptions & { client: SystemOneClient }

const defaultDecideRetryPolicy = {
  maxAttempts: 3,
  attemptTimeoutMs: 10000,
  backoff: { initialMs: 500, jitter: true },
  suspendAfterMs: 30000,
} as const

/** Create a flow graph with the System One `decide` node kind registered. */
export function createDecisionFlowGraph({
  client,
  retryDefaults,
  ...options
}: DecisionFlowGraphOptions): FlowGraph {
  return createFlowGraph({
    ...options,
    kinds: [decideKind({ client }), ...(options.kinds ?? [])],
    retryDefaults: { decide: defaultDecideRetryPolicy, ...retryDefaults },
    logger: options.logger ?? getMokeiLogger('decision-flow'),
  })
}

const schemaOnlyClient = {
  predict(): never {
    throw new Error('The schema-only decision graph cannot execute nodes.')
  },
} as unknown as SystemOneClient

const schemaOnlyGraph = createDecisionFlowGraph({ client: schemaOnlyClient })

/** JSON Schema for authorable decision flows. */
export const flowDefinitionSchema: Schema = schemaOnlyGraph.authoringSchema

/** JSON Schema for stored decision flows, including reserved node kinds. */
export const flowStorageSchema: Schema = schemaOnlyGraph.storageSchema
