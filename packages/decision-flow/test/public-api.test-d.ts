import type { SystemOneClient } from '@mokei/system-one-client'
import type { FlowGraph } from '@sozai/flow-graph'
import type { Schema } from '@sozai/schema'
import { expectTypeOf, test } from 'vitest'

import {
  createDecisionFlowGraph,
  type DecideNode,
  type DecisionFlowGraphOptions,
  decideKind,
  flowDefinitionSchema,
  flowStorageSchema,
  formatIssues,
  type Predictor,
} from '../src/index.js'

test('public decision flow API types', () => {
  expectTypeOf<DecideNode>().toMatchTypeOf<{ kind: 'decide' }>()
  expectTypeOf(decideKind).toBeCallableWith({ client: {} as SystemOneClient })
  expectTypeOf<SystemOneClient>().toMatchTypeOf<Predictor>()
  expectTypeOf(createDecisionFlowGraph).toBeCallableWith({ client: {} as SystemOneClient })
  expectTypeOf(
    createDecisionFlowGraph({ client: {} as SystemOneClient }),
  ).toMatchTypeOf<FlowGraph>()
  expectTypeOf(flowDefinitionSchema).toMatchTypeOf<Schema>()
  expectTypeOf(flowStorageSchema).toMatchTypeOf<Schema>()
  expectTypeOf(formatIssues).toBeCallableWith([])
  expectTypeOf(createDecisionFlowGraph).parameters.toEqualTypeOf<[DecisionFlowGraphOptions]>()
})
