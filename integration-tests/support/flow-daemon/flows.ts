import type { FlowDefinition } from '@sozai/flow-graph'

export const flows: Array<FlowDefinition> = [
  {
    id: 'input',
    name: 'Input',
    version: 1,
    start: 'ask',
    nodes: {
      ask: {
        kind: 'input',
        prompt: { value: 'Choose a name' },
        schema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },
        next: 'done',
      },
      done: { kind: 'end', outcome: 'done', output: { answer: { ref: ['results', 'ask'] } } },
    },
  },
  {
    id: 'approval',
    name: 'Approval',
    version: 1,
    start: 'echo',
    nodes: {
      echo: {
        kind: 'tool',
        tool: 'sibling:echo',
        args: { value: { value: 'approved' } },
        next: 'done',
      },
      done: { kind: 'end', outcome: 'done' },
    },
  },
  {
    id: 'end',
    name: 'End',
    version: 1,
    start: 'done',
    nodes: { done: { kind: 'end', outcome: 'done' } },
  },
]
