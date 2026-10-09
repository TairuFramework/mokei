import type { TaskStore } from '@mokei/context-server'
import { TaskStoreConflictError } from '@mokei/context-server'
import { describe, expect, test } from 'vitest'

import { mutateNested, taskRecord } from '../support/records.js'

export function taskStoreContract(
  name: string,
  create: () => TaskStore | Promise<TaskStore>,
): void {
  describe(name, () => {
    test('preserves nested JSON-looking strings through get, list and update', async () => {
      const store = await create()
      const task = taskRecord({ resumeData: { nested: ['{"a":1}', '[1,2]'] } })
      await store.create(task)
      expect(await store.get(task.taskID)).toEqual(task)
      expect(await store.list({ status: ['working'] })).toEqual([task])
      const updated = await store.update(task.taskID, {}, { revision: 0 })
      expect(await store.get(task.taskID)).toEqual(updated)
      expect(updated.resumeData).toEqual(task.resumeData)
    })
    test('rejects duplicates, missing updates and stale revisions', async () => {
      const store = await create()
      const task = taskRecord()
      await store.create(task)
      await expect(store.create(task)).rejects.toThrow(`Task already exists: ${task.taskID}`)
      await expect(store.create(task)).rejects.toBeInstanceOf(Error)
      await expect(store.update('missing', {}, { revision: 0 })).rejects.toThrow(
        'Task not found: missing',
      )
      await expect(store.update(task.taskID, {}, { revision: 1 })).rejects.toThrow(
        'Task revision conflict',
      )
      await expect(store.update(task.taskID, {}, { revision: 1 })).rejects.toBeInstanceOf(
        TaskStoreConflictError,
      )
    })
    test('forces the key and revision and admits one concurrent CAS winner', async () => {
      const store = await create()
      const task = taskRecord()
      await store.create(task)
      expect(
        await store.update(task.taskID, { taskID: 'replacement', revision: 99 }, { revision: 0 }),
      ).toMatchObject({ taskID: task.taskID, revision: 1 })
      expect(await store.get('replacement')).toBeUndefined()
      const results = await Promise.allSettled([
        store.update(task.taskID, {}, { revision: 1 }),
        store.update(task.taskID, {}, { revision: 1 }),
      ])
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      expect(results.find((result) => result.status === 'rejected')).toMatchObject({
        reason: new TaskStoreConflictError(),
      })
      expect((await store.get(task.taskID))?.revision).toBe(2)
    })
    test('isolates nested records, task inputs and nullable TTL across every boundary', async () => {
      const store = await create()
      const input = taskRecord()
      const expected = taskRecord()
      await store.create(input)
      mutateNested(input)
      expect(await store.get(expected.taskID)).toEqual(expected)
      mutateNested(await store.get(expected.taskID))
      expect(await store.get(expected.taskID)).toEqual(expected)
      const patch = taskRecord({
        ttlMs: 500,
        inputs: taskRecord().inputs.map((input) => ({ ...input, id: 2, outcome: 'answered' })),
      })
      const updated = await store.update(expected.taskID, patch, { revision: 0 })
      const wanted = taskRecord({
        ttlMs: 500,
        revision: 1,
        inputs: taskRecord().inputs.map((input) => ({ ...input, id: 2, outcome: 'answered' })),
      })
      mutateNested(patch)
      mutateNested(updated)
      expect(await store.get(expected.taskID)).toEqual(wanted)
      mutateNested(await store.list({ status: ['working'] }))
      expect(await store.get(expected.taskID)).toEqual(wanted)
      expect(
        (await store.update(expected.taskID, { ttlMs: null }, { revision: 1 })).ttlMs,
      ).toBeNull()
    })
    test('preserves insertion order and filters statuses including an empty set', async () => {
      const store = await create()
      await store.create(taskRecord({ taskID: 'first' }))
      await store.create(taskRecord({ taskID: 'second', status: 'input_required' }))
      await store.create(taskRecord({ taskID: 'third' }))
      expect(
        (await store.list({ status: ['input_required', 'working'] })).map((task) => task.taskID),
      ).toEqual(['first', 'second', 'third'])
      expect((await store.list({ status: ['working'] })).map((task) => task.taskID)).toEqual([
        'first',
        'third',
      ])
      expect(await store.list({ status: [] })).toEqual([])
    })
    test('deletes existing and missing records', async () => {
      const store = await create()
      expect(await store.get('missing')).toBeUndefined()
      await store.create(taskRecord())
      await store.delete('task-one')
      await store.delete('missing')
      expect(await store.list({ status: ['working'] })).toEqual([])
    })
  })
}
