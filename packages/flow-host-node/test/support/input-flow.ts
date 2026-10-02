import type { Predictor } from '@mokei/decision-flow'
import type { FlowDefinition } from '@sozai/flow-graph'

export const inputFlow: FlowDefinition = {
  id: 'input',
  name: 'Input',
  version: 1,
  start: 'ask',
  nodes: {
    ask: {
      kind: 'input',
      prompt: { value: 'Choose' },
      schema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },
      next: 'done',
    },
    done: { kind: 'end', outcome: 'done', output: { answer: { ref: ['results', 'ask'] } } },
  },
}

export const predictor: Predictor = {
  predict: async () => {
    throw new Error('Unexpected prediction')
  },
}
