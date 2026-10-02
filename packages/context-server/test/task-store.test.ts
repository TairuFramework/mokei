import { describe, expect, expectTypeOf, test } from 'vitest'

import {
  createMemoryTaskStore,
  type JSONValue,
  type TaskRecord,
  TaskStoreConflictError,
} from '../src/task-store.js'

function createRecord(patch: Partial<TaskRecord> = {}): TaskRecord {
  return {
    taskID: crypto.randomUUID(),
    revision: 0,
    status: 'working',
    createdAt: '2026-09-29T12:00:00.000Z',
    lastUpdatedAt: '2026-09-29T12:00:00.000Z',
    ttlMs: 3_600_000,
    toolName: 'echo',
    clientCapabilities: {},
    inputs: [],
    ...patch,
  }
}

describe('createMemoryTaskStore', () => {
  test('creates and retrieves a JSON record', async () => {
    const store = createMemoryTaskStore()
    const record = createRecord({
      owner: { issuer: 'issuer', subject: 'alice', scopes: ['read'] },
      resumeData: { input: ['hello', null, true, 2] },
      inputs: [
        {
          id: 1,
          requests: { prompt: { method: 'roots/list' } },
          responses: { prompt: { roots: [] } },
          outcome: 'answered',
        },
      ],
    })
    await store.create(record)
    expect(await store.get(record.taskID)).toEqual(record)
  })

  test('lists only records with matching status', async () => {
    const store = createMemoryTaskStore()
    const working = createRecord()
    const completed = createRecord({ status: 'completed' })
    await store.create(working)
    await store.create(completed)
    expect(await store.list({ status: ['completed'] })).toEqual([completed])
    expect(await store.list({ status: [] })).toEqual([])
  })

  test('deletes a record', async () => {
    const store = createMemoryTaskStore()
    const record = createRecord()
    await store.create(record)
    await store.delete(record.taskID)
    expect(await store.get(record.taskID)).toBeUndefined()
  })

  test('rejects an update based on a stale revision', async () => {
    const store = createMemoryTaskStore()
    await store.create({
      taskID: crypto.randomUUID(),
      revision: 0,
      status: 'working',
      createdAt: '2026-09-29T12:00:00.000Z',
      lastUpdatedAt: '2026-09-29T12:00:00.000Z',
      ttlMs: 3_600_000,
      toolName: 'echo',
      clientCapabilities: {},
      inputs: [],
    })
    const [record] = await store.list({ status: ['working'] })
    if (record === undefined) throw new Error('Expected a working task')
    const changed = await store.update(record.taskID, { statusMessage: 'running' }, { revision: 0 })
    expect(changed.revision).toBe(1)
    await expect(
      store.update(record.taskID, { statusMessage: 'stale' }, { revision: 0 }),
    ).rejects.toBeInstanceOf(TaskStoreConflictError)
    await expect(store.update(record.taskID, {}, { revision: 0 })).rejects.toMatchObject({
      message: 'Task revision conflict',
    })
  })

  test('allows exactly one concurrent write from the same revision', async () => {
    const store = createMemoryTaskStore()
    const record = createRecord()
    await store.create(record)
    const results = await Promise.allSettled([
      store.update(record.taskID, { statusMessage: 'first' }, { revision: 0 }),
      store.update(record.taskID, { statusMessage: 'second' }, { revision: 0 }),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((result) => result.status === 'rejected')
    expect(rejected).toMatchObject({ reason: expect.any(TaskStoreConflictError) })
    expect((await store.get(record.taskID))?.revision).toBe(1)
  })

  test('copies nested values across create, get, list, and update boundaries', async () => {
    const store = createMemoryTaskStore()
    const record = createRecord({ resumeData: { values: ['before'] } })
    await store.create(record)
    const originalData = record.resumeData as { values: Array<string> }
    originalData.values.push('after')
    const fetched = await store.get(record.taskID)
    if (fetched === undefined) throw new Error('Expected a stored task')
    const fetchedData = fetched.resumeData as { values: Array<string> }
    fetchedData.values.push('changed')
    const [listed] = await store.list({ status: ['working'] })
    if (listed === undefined) throw new Error('Expected a working task')
    listed.inputs.push({ id: 1, requests: {}, responses: {} })
    const patch = { resumeData: { values: ['updated'] } }
    const updated = await store.update(record.taskID, patch, { revision: 0 })
    patch.resumeData.values.push('changed')
    const updatedData = updated.resumeData as { values: Array<string> }
    updatedData.values.push('changed')
    expect(await store.get(record.taskID)).toMatchObject({
      revision: 1,
      inputs: [],
      resumeData: { values: ['updated'] },
    })
  })

  test('rejects duplicate IDs and updates to missing records', async () => {
    const store = createMemoryTaskStore()
    const record = createRecord()
    await store.create(record)
    await expect(store.create(record)).rejects.toMatchObject({
      message: `Task already exists: ${record.taskID}`,
    })
    await expect(store.update('missing', {}, { revision: 0 })).rejects.toMatchObject({
      message: 'Task not found: missing',
    })
  })

  test('keeps the task ID and revision controlled by the store on update', async () => {
    const store = createMemoryTaskStore()
    const record = createRecord()
    await store.create(record)
    const changed = await store.update(
      record.taskID,
      { taskID: crypto.randomUUID(), revision: 9, statusMessage: 'running' },
      { revision: 0 },
    )
    expect(changed).toMatchObject({ taskID: record.taskID, revision: 1, statusMessage: 'running' })
    expect(await store.get(record.taskID)).toEqual(changed)
  })

  test('preserves insertion order across updates', async () => {
    const store = createMemoryTaskStore()
    await store.create(createRecord({ taskID: 'b', createdAt: '2026-09-29T12:00:00.000Z' }))
    await store.create(createRecord({ taskID: 'a', createdAt: '2026-09-29T13:00:00.000Z' }))
    await store.update('b', { statusMessage: 'updated' }, { revision: 0 })
    expect((await store.list({ status: ['working'] })).map((record) => record.taskID)).toEqual([
      'b',
      'a',
    ])
  })

  test('preserves a null TTL and JSON copy semantics', async () => {
    const store = createMemoryTaskStore()
    const record = createRecord({
      ttlMs: null,
      statusMessage: undefined,
      resumeData: [null, true, 'hello', 2],
    })
    await store.create(record)
    const fetched = await store.get(record.taskID)
    expectTypeOf(fetched?.error?.data).toEqualTypeOf<JSONValue | undefined>()
    expect(fetched?.ttlMs).toBeNull()
    expect(fetched?.resumeData).toEqual([null, true, 'hello', 2])
    expect(fetched).not.toHaveProperty('statusMessage')
  })
})
