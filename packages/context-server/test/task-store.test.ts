import { describe, expect, test } from 'vitest'

import {
  createMemoryTaskStore,
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
    issuedInputKeys: [],
    ...patch,
  }
}

describe('createMemoryTaskStore', () => {
  test('creates and retrieves a JSON record', async () => {
    const store = createMemoryTaskStore()
    const record = createRecord({
      owner: { issuer: 'issuer', subject: 'alice', scopes: ['read'] },
      resumeData: { input: ['hello', null, true, 2] },
      issuedInputKeys: ['prompt'],
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
      issuedInputKeys: [],
    })
    const [record] = await store.list({ status: ['working'] })
    if (record === undefined) throw new Error('Expected a working task')
    const changed = await store.update(record.taskID, { statusMessage: 'running' }, { revision: 0 })
    expect(changed.revision).toBe(1)
    await expect(
      store.update(record.taskID, { statusMessage: 'stale' }, { revision: 0 }),
    ).rejects.toBeInstanceOf(TaskStoreConflictError)
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
    listed.issuedInputKeys.push('changed')
    const patch = { resumeData: { values: ['updated'] } }
    const updated = await store.update(record.taskID, patch, { revision: 0 })
    patch.resumeData.values.push('changed')
    const updatedData = updated.resumeData as { values: Array<string> }
    updatedData.values.push('changed')
    expect(await store.get(record.taskID)).toMatchObject({
      revision: 1,
      issuedInputKeys: [],
      resumeData: { values: ['updated'] },
    })
  })

  test('rejects duplicate IDs and updates to missing records', async () => {
    const store = createMemoryTaskStore()
    const record = createRecord()
    await store.create(record)
    await expect(store.create(record)).rejects.toThrow()
    await expect(store.update(crypto.randomUUID(), {}, { revision: 0 })).rejects.toThrow()
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
})
