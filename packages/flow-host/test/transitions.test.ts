import { describe, expect, it } from 'vitest'

import { createMemoryRunStore, RunStoreConflictError } from '../src/run-store.js'
import { createRunQueue, transition } from '../src/transitions.js'
import type { RunRecord } from '../src/types.js'

function record(): RunRecord {
  return {
    runID: 'one',
    label: 'one',
    state: 'working',
    createdAt: 1,
    updatedAt: 1,
    plan: { tools: [] },
    revision: 0,
    request: { toolName: 'run_flow', arguments: {} },
  }
}

describe('transitions', () => {
  it('does not change terminal records', async () => {
    const store = createMemoryRunStore()
    await store.create({ ...record(), state: 'completed' })
    const result = await transition(store, 'one', () => ({ state: 'failed' }))
    expect(result.changed).toBe(false)
    expect(result.record.state).toBe('completed')
  })

  it('recomputes after concurrent compare-and-set conflicts', async () => {
    const store = createMemoryRunStore()
    await store.create(record())
    await Promise.all([
      transition(store, 'one', (item) => ({ plan: { tools: [...item.plan.tools, 'a'] } }), {
        now: () => 2,
      }),
      transition(store, 'one', (item) => ({ plan: { tools: [...item.plan.tools, 'b'] } }), {
        now: () => 2,
      }),
    ])
    expect((await store.get('one'))?.plan.tools).toEqual(['a', 'b'])
  })

  it('rethrows after five conflicts', async () => {
    const store = createMemoryRunStore()
    await store.create(record())
    const conflict = new RunStoreConflictError('conflict')
    let calls = 0
    const conflicted = {
      ...store,
      update: async () => {
        calls += 1
        throw conflict
      },
    }
    await expect(transition(conflicted, 'one', () => ({ state: 'failed' }))).rejects.toBe(conflict)
    expect(calls).toBe(6)
  })

  it('reports state changes only when state differs', async () => {
    const store = createMemoryRunStore()
    await store.create(record())
    expect((await transition(store, 'one', () => ({ updatedAt: 2 }))).stateChanged).toBe(false)
    expect((await transition(store, 'one', () => ({ state: 'input_required' }))).stateChanged).toBe(
      true,
    )
  })
})

describe('run queue', () => {
  it('serialises jobs for one run and allows different runs concurrently', async () => {
    const queue = createRunQueue()
    let release: (() => void) | undefined
    let entered = 0
    const first = queue.run('one', async () => {
      entered += 1
      await new Promise<void>((resolve) => {
        release = resolve
      })
    })
    const second = queue.run('one', async () => {
      entered += 1
    })
    await Promise.resolve()
    const other = queue.run('two', async () => {
      entered += 1
    })
    await other
    expect(entered).toBe(2)
    release?.()
    await Promise.all([first, second])
    expect(entered).toBe(3)
  })

  it('continues after a job rejects', async () => {
    const queue = createRunQueue()
    await expect(queue.run('one', async () => Promise.reject(new Error('failed')))).rejects.toThrow(
      'failed',
    )
    await expect(queue.run('one', async () => 'ok')).resolves.toBe('ok')
  })
})
