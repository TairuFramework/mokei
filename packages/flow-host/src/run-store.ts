import type { RunRecord, RunState } from './types.js'

export type { RunRecord } from './types.js'

export type RunStore = {
  create(record: RunRecord): Promise<void>
  get(runID: string): Promise<RunRecord | undefined>
  update(
    runID: string,
    patch: Partial<RunRecord>,
    expected: { revision: number },
  ): Promise<RunRecord>
  list(filter: { states?: Array<RunState>; limit?: number }): Promise<Array<RunRecord>>
  delete(runID: string): Promise<void>
}

export class RunStoreConflictError extends Error {
  constructor(message = 'Run store revision conflict') {
    super(message)
    this.name = 'RunStoreConflictError'
  }
}

function copy(record: RunRecord): RunRecord {
  return structuredClone(record)
}

export function createMemoryRunStore(): RunStore {
  const records = new Map<string, RunRecord>()
  return {
    async create(record) {
      if (records.has(record.runID))
        throw new RunStoreConflictError(`Run already exists: ${record.runID}`)
      records.set(record.runID, copy(record))
    },
    async get(runID) {
      const record = records.get(runID)
      return record == null ? undefined : copy(record)
    },
    async update(runID, patch, expected) {
      const record = records.get(runID)
      if (record == null) throw new Error(`Run not found: ${runID}`)
      if (record.revision !== expected.revision) throw new RunStoreConflictError()
      const updated = { ...record, ...structuredClone(patch), revision: record.revision + 1 }
      records.set(runID, updated)
      return copy(updated)
    },
    async list(filter) {
      let result = [...records.values()]
      if (filter.states != null) {
        const states = new Set<RunState>(filter.states)
        result = result.filter(({ state }) => states.has(state))
      }
      result.sort((left, right) => right.createdAt - left.createdAt)
      if (filter.limit != null) result = result.slice(0, filter.limit)
      return result.map(copy)
    },
    async delete(runID) {
      records.delete(runID)
    },
  }
}
