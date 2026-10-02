import { describe, expect, test } from 'vitest'

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
  test('copies records in and out', async () => {
    const store = createMemoryRunStore()
    const value = record('one', 1)
    await store.create(value)
    value.plan.tools.push('outside')
    const returned = await store.get('one')
    returned?.plan.tools.push('returned')
    expect((await store.get('one'))?.plan.tools).toEqual([])
  })

  test('compares revisions and increments on update', async () => {
    const store = createMemoryRunStore()
    await store.create(record('one', 1))
    await expect(
      store.update('one', { state: 'completed' }, { revision: 9 }),
    ).rejects.toBeInstanceOf(RunStoreConflictError)
    const updated = await store.update('one', { state: 'completed' }, { revision: 0 })
    expect(updated.revision).toBe(1)
  })

  test('lists newest first and applies state and limit filters', async () => {
    const store = createMemoryRunStore()
    await store.create(record('old', 1))
    await store.create({ ...record('new', 3), state: 'completed' })
    await store.create(record('middle', 2))
    expect((await store.list({ states: ['working'], limit: 1 })).map(({ runID }) => runID)).toEqual(
      ['middle'],
    )
  })

  test('deletes a record', async () => {
    const store = createMemoryRunStore()
    await store.create(record('one', 1))
    await store.delete('one')
    expect(await store.get('one')).toBeUndefined()
  })

  test('keeps the run key and revision controlled by the store', async () => {
    const store = createMemoryRunStore()
    await store.create(record('one', 1))
    const changed = await store.update('one', { runID: 'other', revision: 99 }, { revision: 0 })
    expect(changed).toMatchObject({ runID: 'one', revision: 1 })
    expect(await store.get('one')).toEqual(changed)
    expect(await store.get('other')).toBeUndefined()
  })

  test('filters strictly before updatedAt and preserves insertion ties', async () => {
    const store = createMemoryRunStore()
    await store.create({ ...record('a', 10), updatedAt: 20 })
    await store.create({ ...record('b', 10), updatedAt: 20 })
    await store.create({ ...record('c', 30), updatedAt: 21 })
    expect((await store.list({})).map((run) => run.runID)).toEqual(['c', 'a', 'b'])
    expect((await store.list({ updatedBefore: 21 })).map((run) => run.runID)).toEqual(['a', 'b'])
    expect(await store.list({ updatedBefore: 20 })).toEqual([])
    expect(await store.list({ limit: 0 })).toEqual([])
    expect(
      (await store.list({ updatedBefore: 21, states: ['working'], limit: 1 })).map(
        (run) => run.runID,
      ),
    ).toEqual(['a'])
  })

  test.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid list limits: %s',
    async (limit) => {
      const store = createMemoryRunStore()
      await expect(store.list({ states: [], limit })).rejects.toBeInstanceOf(RangeError)
    },
  )

  test('isolates JSON values at every record boundary', async () => {
    const store = createMemoryRunStore()
    const values = ['before']
    const value = { ...record('one', 1), request: { toolName: 'run_flow', arguments: { values } } }
    await store.create(value)
    values.push('outside')
    const fetched = await store.get('one')
    if (fetched === undefined) throw new Error('Expected a stored run')
    const fetchedValues = fetched.request.arguments.values
    if (!Array.isArray(fetchedValues)) throw new Error('Expected an array')
    fetchedValues.push('fetched')
    expect((await store.get('one'))?.request.arguments).toEqual({ values: ['before'] })
    const [listed] = await store.list({})
    if (listed === undefined) throw new Error('Expected a listed run')
    const listedValues = listed.request.arguments.values
    if (!Array.isArray(listedValues)) throw new Error('Expected an array')
    listedValues.push('listed')
    expect((await store.get('one'))?.request.arguments).toEqual({ values: ['before'] })
    const patch = { result: { content: [], output: { values: ['updated'] } } }
    const updated = await store.update('one', patch, { revision: 0 })
    patch.result.output.values.push('patch')
    expect((await store.get('one'))?.result?.output).toEqual({ values: ['updated'] })
    const output = updated.result?.output
    if (
      output === null ||
      typeof output !== 'object' ||
      !('values' in output) ||
      !Array.isArray(output.values)
    ) {
      throw new Error('Expected output values')
    }
    output.values.push('returned')
    expect((await store.get('one'))?.result?.output).toEqual({ values: ['updated'] })
  })

  test('uses JSON copy semantics', async () => {
    const store = createMemoryRunStore()
    await store.create({
      ...record('one', 1),
      flowID: undefined,
      result: { content: [], output: [null, true, 'hello', 2] },
    })
    const fetched = await store.get('one')
    expect(fetched).not.toHaveProperty('flowID')
    expect(fetched?.result?.output).toEqual([null, true, 'hello', 2])
    const updated = await store.update('one', { traceID: undefined }, { revision: 0 })
    expect(updated).not.toHaveProperty('traceID')
    expect((await store.list({}))[0]).not.toHaveProperty('traceID')
  })
})
