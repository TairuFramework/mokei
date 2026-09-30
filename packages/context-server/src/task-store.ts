import type {
  CallToolResult,
  ClientCapabilities,
  InputRequest,
  InputResponse,
  TaskStatus,
} from '@mokei/context-protocol'

export type JSONValue =
  | null
  | boolean
  | number
  | string
  | Array<JSONValue>
  | { [key: string]: JSONValue }

export type TaskOwner = { issuer?: string; subject: string; scopes: Array<string> }

/** One input request a task made, kept for the task's lifetime. */
export type InputRecord = {
  /** Increments per request on this task, starting at 1. */
  id: number
  requests: Record<string, InputRequest>
  responses: Record<string, InputResponse>
  /** Absent while the request is open. A settled entry never changes again. */
  outcome?: 'answered' | 'withdrawn'
}

export type TaskRecord = {
  taskID: string
  revision: number
  status: TaskStatus
  statusMessage?: string
  createdAt: string
  lastUpdatedAt: string
  ttlMs: number | null
  pollIntervalMs?: number
  owner?: TaskOwner
  toolName: string
  clientCapabilities: ClientCapabilities
  requestMeta?: Record<string, JSONValue>
  resumeData?: JSONValue
  result?: CallToolResult & { resultType: 'complete' }
  error?: { code: number; message: string; data?: unknown }
  /** Every input request the task has made, in id order. The last entry is the latest. */
  inputs: Array<InputRecord>
}

export type TaskStore = {
  create(record: TaskRecord): Promise<void>
  get(taskID: string): Promise<TaskRecord | undefined>
  update(
    taskID: string,
    patch: Partial<TaskRecord>,
    expected: { revision: number },
  ): Promise<TaskRecord>
  delete(taskID: string): Promise<void>
  list(filter: { status: Array<TaskStatus> }): Promise<Array<TaskRecord>>
}

export class TaskStoreConflictError extends Error {
  constructor() {
    super('Task revision conflict')
    this.name = 'TaskStoreConflictError'
  }
}

function copyRecord(record: TaskRecord): TaskRecord {
  return JSON.parse(JSON.stringify(record)) as TaskRecord
}

export function createMemoryTaskStore(): TaskStore {
  const records = new Map<string, TaskRecord>()

  return {
    async create(record) {
      if (records.has(record.taskID)) {
        throw new Error(`Task already exists: ${record.taskID}`)
      }
      records.set(record.taskID, copyRecord(record))
    },
    async get(taskID) {
      const record = records.get(taskID)
      return record === undefined ? undefined : copyRecord(record)
    },
    async update(taskID, patch, expected) {
      const record = records.get(taskID)
      if (record === undefined) {
        throw new Error(`Task not found: ${taskID}`)
      }
      if (record.revision !== expected.revision) {
        throw new TaskStoreConflictError()
      }
      const changed = copyRecord({ ...record, ...patch, taskID, revision: record.revision + 1 })
      records.set(taskID, changed)
      return copyRecord(changed)
    },
    async delete(taskID) {
      records.delete(taskID)
    },
    async list(filter) {
      return Array.from(records.values())
        .filter((record) => filter.status.includes(record.status))
        .map(copyRecord)
    },
  }
}
