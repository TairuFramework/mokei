import type { QuestionMap } from '@mokei/system-one-client'
import { createFlowGraph, type FlowDefinition } from '@sozai/flow-graph'
import { describe, expect, test } from 'vitest'

import { decideKind, type Predictor, type PredictParams } from '../src/index.js'

const questions: QuestionMap = {
  department: {
    type: 'choice',
    instructions: 'Which department?',
    criteria: { billing: 'Billing' },
  },
}

describe('Predictor', () => {
  test('decide passes call identity to the predictor', async () => {
    let received: PredictParams | undefined
    const predictor: Predictor = {
      async predict(params) {
        received = params
        return {
          model: 'english',
          answers: {
            department: {
              type: 'choice',
              choice: 'billing',
              confidence: 1,
              probabilities: { billing: 1 },
            },
          },
          usage: { inputTokens: 1, outputTokens: 1 },
        }
      },
    }
    const graph = createFlowGraph({ kinds: [decideKind({ client: predictor })] })
    const definition = {
      id: 'predictor-call-test',
      name: 'Predictor call test',
      version: 1,
      start: 'decide',
      nodes: {
        decide: {
          kind: 'decide',
          state: { value: 'refund request' },
          questions,
          cases: [],
          default: 'finish',
        },
        finish: { kind: 'end', outcome: 'done' },
      },
    } as FlowDefinition

    const run = await graph.run({ definition, runID: 'predictor-call-test' })

    expect(run.status).toBe('ended')
    expect(received?.call).toEqual({
      runID: 'predictor-call-test',
      invocationID: 'predictor-call-test:1',
      attempt: 1,
    })
  })
})
