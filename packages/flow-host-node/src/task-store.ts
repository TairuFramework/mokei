import type { Adapter } from '@hozon/adapter'
import type { MigrationContext, StoreDefinition, StoreProvider } from '@hozon/db'
import type { TaskRecord, TaskStore } from '@mokei/context-server'
import { TaskStoreConflictError } from '@mokei/context-server'
import type { ColumnType, Generated, Kysely } from 'kysely'
import type { Migration } from 'kysely/migration'

import { decodeJSONColumn } from './json-column.js'

export const FLOW_TASK_STORE = 'flow-tasks'

export type FlowTaskTables = {
  flow_tasks: {
    seq: Generated<number>
    task_id: string
    status: string
    revision: number
    data: ColumnType<TaskRecord | string, unknown, unknown>
  }
}

function flowTaskStoreMigrations(ctx: MigrationContext): Record<string, Migration> {
  return {
    '0-init': {
      async up(db) {
        await db.schema
          .createTable('flow_tasks')
          .addColumn('seq', ctx.types.serial, (column) => {
            const primary = column.primaryKey()
            return ctx.kind === 'sqlite' ? primary.autoIncrement() : primary
          })
          .addColumn('task_id', ctx.types.text, (column) => column.notNull().unique())
          .addColumn('status', ctx.types.text, (column) => column.notNull())
          .addColumn('revision', 'integer', (column) => column.notNull())
          .addColumn('data', ctx.types.json, (column) => column.notNull())
          .execute()
        await db.schema
          .createIndex('mokei_flow_tasks_status')
          .on('flow_tasks')
          .columns(['status', 'seq'])
          .execute()
      },
      async down(db) {
        await db.schema.dropTable('flow_tasks').execute()
      },
    },
  }
}

export const taskStoreDefinition: StoreDefinition<FlowTaskTables, TaskStore> = {
  name: FLOW_TASK_STORE,
  migrations: flowTaskStoreMigrations,
  createAPI: createTaskStoreAPI,
}

function createTaskStoreAPI(db: Kysely<FlowTaskTables>, adapter: Adapter): TaskStore {
  async function read(taskID: string): Promise<TaskRecord | undefined> {
    const row = await db
      .selectFrom('flow_tasks')
      .select('data')
      .where('task_id', '=', taskID)
      .executeTakeFirst()
    return row == null ? undefined : decodeJSONColumn<TaskRecord>(row.data)
  }

  return {
    async create(record) {
      const data = JSON.stringify(record)
      const stored = JSON.parse(data) as TaskRecord
      const result = await db
        .insertInto('flow_tasks')
        .values({
          task_id: stored.taskID,
          status: stored.status,
          revision: stored.revision,
          data: adapter.encodeJSON(stored),
        })
        .onConflict((conflict) => conflict.column('task_id').doNothing())
        .executeTakeFirstOrThrow()
      if (Number(result.numInsertedOrUpdatedRows) === 0)
        throw new Error(`Task already exists: ${stored.taskID}`)
    },
    async get(taskID) {
      return read(taskID)
    },
    async update(taskID, patch, expected) {
      const record = await read(taskID)
      if (record == null) throw new Error(`Task not found: ${taskID}`)
      if (record.revision !== expected.revision) throw new TaskStoreConflictError()
      const data = JSON.stringify({ ...record, ...patch, taskID, revision: record.revision + 1 })
      const stored = JSON.parse(data) as TaskRecord
      const result = await db
        .updateTable('flow_tasks')
        .set({
          status: stored.status,
          revision: stored.revision,
          data: adapter.encodeJSON(stored),
        })
        .where('task_id', '=', taskID)
        .where('revision', '=', expected.revision)
        .executeTakeFirstOrThrow()
      if (Number(result.numUpdatedRows) === 0) throw new TaskStoreConflictError()
      return stored
    },
    async list(filter) {
      if (filter.status.length === 0) return []
      const rows = await db
        .selectFrom('flow_tasks')
        .select('data')
        .where('status', 'in', filter.status)
        .orderBy('seq', 'asc')
        .execute()
      return rows.map((row) => decodeJSONColumn<TaskRecord>(row.data))
    },
    async delete(taskID) {
      await db.deleteFrom('flow_tasks').where('task_id', '=', taskID).execute()
    },
  }
}

export async function getFlowTaskStore(provider: StoreProvider): Promise<TaskStore> {
  return provider.getStore(FLOW_TASK_STORE) as Promise<TaskStore>
}
