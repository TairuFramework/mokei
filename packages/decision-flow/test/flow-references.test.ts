import {
  type SystemOneBackend,
  SystemOneClient,
  type SystemOneResult,
} from '@mokei/system-one-client'
import { createMapResolver, type FlowDefinition, type RunState } from '@sozai/flow-graph'
import { describe, expect, test } from 'vitest'

import { createDecisionFlowGraph } from '../src/index.js'

function choiceResult(choice: string): SystemOneResult {
  return {
    model: 'test-model',
    answers: {
      label: { type: 'choice', choice, confidence: 0.9, probabilities: { [choice]: 0.9 } },
    },
    usage: { input_tokens: 1, output_tokens: 1 },
  } as SystemOneResult
}

function makeClient(choice = 'billing') {
  const backend: SystemOneBackend = {
    async predict() {
      return choiceResult(choice)
    },
  }
  return new SystemOneClient({ backend, defaultModel: 'test-model' })
}

function flow(definition: Record<string, unknown>): FlowDefinition {
  return { name: definition.id, version: 1, ...definition } as unknown as FlowDefinition
}

const classify = flow({
  id: 'classify',
  start: 'decide',
  input: { type: 'object', required: ['text'] },
  nodes: {
    decide: {
      kind: 'decide',
      state: { ref: ['input', 'text'] },
      questions: {
        label: {
          type: 'choice',
          instructions: 'Which department?',
          criteria: { billing: 'payments', technical: 'bugs' },
        },
      },
      cases: [],
      default: 'done',
    },
    done: {
      kind: 'end',
      output: { label: { ref: ['results', 'decide', 'label', 'choice'] } },
    },
  },
})

describe('flow references', () => {
  test('call runs a decide callee and exposes its output', async () => {
    const main = flow({
      id: 'main',
      start: 'run',
      nodes: {
        run: {
          kind: 'call',
          flow: 'classify',
          version: 1,
          input: { text: { value: 'refund please' } },
          next: 'done',
        },
        done: {
          kind: 'end',
          outcome: 'classified',
          output: { label: { ref: ['results', 'run', 'output', 'label'] } },
        },
      },
    })
    const graph = createDecisionFlowGraph({
      client: makeClient('billing'),
      resolver: createMapResolver([main, classify]),
    })

    const result = await graph.run({ definition: main })

    expect(result.status).toBe('ended')
    expect(result.outcome).toBe('classified')
    expect(result.output).toEqual({ label: 'billing' })
  })

  test('goto hands over to a registered flow', async () => {
    const finish = flow({
      id: 'finish',
      start: 'done',
      nodes: { done: { kind: 'end', outcome: 'finished' } },
    })
    const main = flow({
      id: 'main',
      start: 'jump',
      nodes: { jump: { kind: 'goto', flow: 'finish', version: 1 } },
    })
    const graph = createDecisionFlowGraph({
      client: makeClient(),
      resolver: createMapResolver([main, finish]),
    })

    const result = await graph.run({ definition: main })

    expect(result.status).toBe('ended')
    expect(result.outcome).toBe('finished')
  })

  test('loop body flow runs until while fails', async () => {
    const tick = flow({
      id: 'tick',
      start: 'inc',
      nodes: {
        inc: {
          kind: 'action',
          name: 'inc',
          args: { prev: { ref: ['input', 'prev'] } },
          next: 'done',
        },
        done: { kind: 'end', output: { n: { ref: ['results', 'inc'] } } },
      },
    })
    const counter = flow({
      id: 'counter',
      start: 'count',
      nodes: {
        count: {
          kind: 'loop',
          maxIterations: 5,
          while: {
            not: { path: ['results', 'count', 'output', 'n'], is: { greaterThanOrEqualTo: 3 } },
          },
          body: {
            flow: 'tick',
            version: 1,
            input: { prev: { ref: ['results', 'count', 'output', 'n'] } },
          },
          exit: 'done',
        },
        done: { kind: 'end', output: { n: { ref: ['results', 'count', 'output', 'n'] } } },
      },
    })
    const graph = createDecisionFlowGraph({
      client: makeClient(),
      resolver: createMapResolver([counter, tick]),
      actions: { inc: ({ args }) => ((args.prev as number | null) ?? 0) + 1 },
    })

    const result = await graph.run({ definition: counter })

    expect(result.status).toBe('ended')
    expect(result.output).toEqual({ n: 3 })
  })

  test('resume across a callee suspension', async () => {
    const ask = flow({
      id: 'ask',
      start: 'prompt',
      nodes: {
        prompt: {
          kind: 'input',
          prompt: { value: 'Which team?' },
          schema: { enum: ['billing', 'technical'] },
          next: 'done',
        },
        done: { kind: 'end', output: { team: { ref: ['results', 'prompt'] } } },
      },
    })
    const main = flow({
      id: 'main',
      start: 'run',
      nodes: {
        run: { kind: 'call', flow: 'ask', version: 1, next: 'done' },
        done: {
          kind: 'end',
          outcome: 'asked',
          output: { team: { ref: ['results', 'run', 'output', 'team'] } },
        },
      },
    })
    const resolver = createMapResolver([main, ask])
    const first = await createDecisionFlowGraph({ client: makeClient(), resolver }).run({
      definition: main,
    })

    expect(first.status).toBe('suspended')
    const runState = JSON.parse(JSON.stringify(first.runState)) as RunState
    const graph = createDecisionFlowGraph({ client: makeClient(), resolver })
    let last: RunState | undefined
    for await (const state of graph.resume({
      runState,
      event: { type: 'value', value: 'technical' },
    })) {
      last = state
    }

    expect(last?.status).toBe('ended')
    expect(last?.outcome).toBe('asked')
    expect(last?.output).toEqual({ team: 'technical' })
  })
})
