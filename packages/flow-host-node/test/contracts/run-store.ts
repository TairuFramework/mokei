import type { RunStore } from '@mokei/flow-host'
import { RunStoreConflictError } from '@mokei/flow-host'
import { describe, expect, test } from 'vitest'

import { mutateNested, runRecord } from '../support/records.js'

export function runStoreContract(name: string, create: () => RunStore | Promise<RunStore>): void {
  describe(name, () => {
    test('rejects duplicates, missing updates and stale revisions', async () => {
      const store = await create()
      const run = runRecord()
      await store.create(run)
      await expect(store.create(run)).rejects.toThrow(`Run already exists: ${run.runID}`)
      await expect(store.create(run)).rejects.toBeInstanceOf(RunStoreConflictError)
      await expect(store.update('missing', {}, { revision: 0 })).rejects.toThrow(
        'Run not found: missing',
      )
      await expect(store.update(run.runID, {}, { revision: 1 })).rejects.toThrow(
        'Run store revision conflict',
      )
      await expect(store.update(run.runID, {}, { revision: 1 })).rejects.toBeInstanceOf(
        RunStoreConflictError,
      )
    })
    test('forces the key and revision and admits one concurrent CAS winner', async () => {
      const store = await create()
      const run = runRecord()
      await store.create(run)
      expect(
        await store.update(run.runID, { runID: 'replacement', revision: 99 }, { revision: 0 }),
      ).toMatchObject({ runID: run.runID, revision: 1 })
      expect(await store.get('replacement')).toBeUndefined()
      const results = await Promise.allSettled([
        store.update(run.runID, {}, { revision: 1 }),
        store.update(run.runID, {}, { revision: 1 }),
      ])
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      expect(results.find((result) => result.status === 'rejected')).toMatchObject({
        reason: new RunStoreConflictError(),
      })
      expect((await store.get(run.runID))?.revision).toBe(2)
    })
    test('isolates all nested input, patch, get, update and list boundaries', async () => {
      const store = await create()
      const input = runRecord()
      const expected = runRecord()
      await store.create(input)
      mutateNested(input)
      expect(await store.get(expected.runID)).toEqual(expected)
      const got = await store.get(expected.runID)
      mutateNested(got)
      expect(await store.get(expected.runID)).toEqual(expected)
      const patch = runRecord({ label: 'updated' })
      const updated = await store.update(expected.runID, patch, { revision: 0 })
      const wanted = runRecord({ label: 'updated', revision: 1 })
      mutateNested(patch)
      mutateNested(updated)
      expect(await store.get(expected.runID)).toEqual(wanted)
      mutateNested(await store.list({}))
      expect(await store.get(expected.runID)).toEqual(wanted)
    })
    test('orders creation ties by insertion and combines filters, limits and strict cutoff', async () => {
      const store = await create()
      await store.create(runRecord({ runID: 'first', createdAt: 10, updatedAt: 19 }))
      await store.create(runRecord({ runID: 'second', createdAt: 10, updatedAt: 20 }))
      await store.create(
        runRecord({ runID: 'newest', createdAt: 30, updatedAt: 18, state: 'input_required' }),
      )
      expect((await store.list({})).map((run) => run.runID)).toEqual(['newest', 'first', 'second'])
      expect(
        (await store.list({ states: ['working'], updatedBefore: 20, limit: 1 })).map(
          (run) => run.runID,
        ),
      ).toEqual(['first'])
      expect(await store.list({ states: [] })).toEqual([])
      expect(await store.list({ limit: 0 })).toEqual([])
      expect(await store.list({ updatedBefore: 18 })).toEqual([])
    })
    test('accepts large non-negative integer limits', async () => {
      const store = await create()
      await store.create(runRecord())
      expect(await store.list({ limit: Number.MAX_VALUE })).toEqual([runRecord()])
    })
    test.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
      'rejects invalid limit %s',
      async (limit) => {
        await expect((await create()).list({ limit })).rejects.toBeInstanceOf(RangeError)
      },
    )
    test('deletes existing and missing records', async () => {
      const store = await create()
      expect(await store.get('missing')).toBeUndefined()
      await store.create(runRecord())
      await store.delete('run-one')
      await store.delete('missing')
      expect(await store.list({})).toEqual([])
    })
  })
}
