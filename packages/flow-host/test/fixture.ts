import type { Predictor } from '@mokei/decision-flow'
import { Session } from '@mokei/session'
import type { FlowDefinition } from '@sozai/flow-graph'
import { vi } from 'vitest'

import { createFlowHost } from '../src/host.js'
import type { FlowHostParams } from '../src/types.js'

export const emptyFlow: FlowDefinition = {
  id: 'empty',
  name: 'Empty',
  version: 1,
  start: 'done',
  nodes: { done: { kind: 'end', outcome: 'done', output: { name: { ref: ['input', 'name'] } } } },
}
export const echoFlow: FlowDefinition = {
  ...emptyFlow,
  id: 'echo',
  name: 'Echo',
  start: 'echo',
  nodes: {
    echo: { kind: 'tool', tool: 'local:echo', args: {}, next: 'done' },
    done: { kind: 'end', outcome: 'done' },
  },
}
export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
export async function createFixture(
  params: {
    flows?: Array<FlowDefinition>
    predictor?: FlowHostParams['predictor']
    allow?: Array<string>
    runStore?: FlowHostParams['runStore']
    taskStore?: FlowHostParams['taskStore']
  } = {},
) {
  const elicit = vi.fn(async () => {
    throw new Error('Unexpected session elicitation')
  })
  const session = new Session({ elicit })
  const echo = vi.fn(() => ({ content: [{ type: 'text' as const, text: 'echo' }] }))
  session.contextHost.addLocalTool({ name: 'echo', inputSchema: { type: 'object' }, execute: echo })
  const held = deferred<void>()
  session.contextHost.addLocalTool({
    name: 'hold',
    inputSchema: { type: 'object' },
    execute: async ({ signal }) => {
      await Promise.race([
        held.promise,
        new Promise<void>((_, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
        }),
      ])
      return { content: [] }
    },
  })
  const predictor: Predictor = {
    predict: async () => {
      throw new Error('Unexpected prediction')
    },
  }
  const host = await createFlowHost({
    session,
    flows: params.flows,
    predictor: params.predictor ?? predictor,
    approval: { allow: params.allow },
    runStore: params.runStore,
    taskStore: params.taskStore,
    pollMs: 10,
  })
  return {
    session,
    host,
    echo,
    elicit,
    held,
    dispose: async () => {
      await host.dispose()
      await session.dispose()
    },
  }
}
