import { describe, expect, it } from 'vitest'

import { createMemoryRunStore, RunStoreConflictError } from '../src/run-store.js'
import type { RunRecord } from '../src/types.js'

function record(runID: string, createdAt: number): RunRecord {
  return {
    runID,
    label: runID,
    state: 'working',
    createdAt,
    updatedAt: createdAt,
    plan: { tools: [] },
    revision: 0,
    request: { toolName: 'run_flow', arguments: {} },
  }
}

describe('memory run store', () => {
  it('copies records in and out', async () => {
    const store = createMemoryRunStore()
    const value = record('one', 1)
    await store.create(value)
    value.plan.tools.push('outside')
    const returned = await store.get('one')
    returned?.plan.tools.push('returned')
    expect((await store.get('one'))?.plan.tools).toEqual([])
  })

  it('compares revisions and increments on update', async () => {
    const store = createMemoryRunStore()
    await store.create(record('one', 1))
    await expect(
      store.update('one', { state: 'completed' }, { revision: 9 }),
    ).rejects.toBeInstanceOf(RunStoreConflictError)
    const updated = await store.update('one', { state: 'completed' }, { revision: 0 })
    expect(updated.revision).toBe(1)
  })

  it('lists newest first and applies state and limit filters', async () => {
    const store = createMemoryRunStore()
    await store.create(record('old', 1))
    await store.create({ ...record('new', 3), state: 'completed' })
    await store.create(record('middle', 2))
    expect((await store.list({ states: ['working'], limit: 1 })).map(({ runID }) => runID)).toEqual(
      ['middle'],
    )
  })

  it('deletes a record', async () => {
    const store = createMemoryRunStore()
    await store.create(record('one', 1))
    await store.delete('one')
    expect(await store.get('one')).toBeUndefined()
  })
})
