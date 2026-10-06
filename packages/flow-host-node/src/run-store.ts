import type { Adapter } from '@hozon/adapter'
import type { MigrationContext, StoreDefinition, StoreProvider } from '@hozon/db'
import type { RunRecord, RunStore } from '@mokei/flow-host'
import { RunStoreConflictError } from '@mokei/flow-host'
import type { ColumnType, Generated, Kysely } from 'kysely'
import type { Migration } from 'kysely/migration'

export const FLOW_RUN_STORE = 'mokei-flow-runs'

export type FlowRunTables = {
  mokei_flow_runs: {
    seq: Generated<number>
    run_id: string
    state: string
    revision: number
    created_at: number
    updated_at: number
    trace_id: string | null
    task_id: string | null
    data: ColumnType<RunRecord, unknown, unknown>
  }
}

function flowRunStoreMigrations(ctx: MigrationContext): Record<string, Migration> {
  return {
    '0-init': {
      async up(db) {
        await db.schema
          .createTable('mokei_flow_runs')
          .addColumn('seq', ctx.types.serial, (column) => {
            const primary = column.primaryKey()
            return ctx.kind === 'sqlite' ? primary.autoIncrement() : primary
          })
          .addColumn('run_id', ctx.types.text, (column) => column.notNull().unique())
          .addColumn('state', ctx.types.text, (column) => column.notNull())
          .addColumn('revision', 'integer', (column) => column.notNull())
          .addColumn('created_at', ctx.types.bigint, (column) => column.notNull())
          .addColumn('updated_at', ctx.types.bigint, (column) => column.notNull())
          .addColumn('trace_id', ctx.types.text)
          .addColumn('task_id', ctx.types.text)
          .addColumn('data', ctx.types.json, (column) => column.notNull())
          .execute()
        await db.schema
          .createIndex('mokei_flow_runs_state')
          .on('mokei_flow_runs')
          .columns(['state', 'updated_at'])
          .execute()
        await db.schema
          .createIndex('mokei_flow_runs_created')
          .on('mokei_flow_runs')
          .columns(['created_at desc', 'seq'])
          .execute()
      },
      async down(db) {
        await db.schema.dropTable('mokei_flow_runs').execute()
      },
    },
  }
}

export const runStoreDefinition: StoreDefinition<FlowRunTables, RunStore> = {
  name: FLOW_RUN_STORE,
  migrations: flowRunStoreMigrations,
  createAPI: createRunStoreAPI,
}

function createRunStoreAPI(db: Kysely<FlowRunTables>, adapter: Adapter): RunStore {
  async function read(runID: string): Promise<RunRecord | undefined> {
    const row = await db
      .selectFrom('mokei_flow_runs')
      .select('data')
      .where('run_id', '=', runID)
      .executeTakeFirst()
    return row?.data
  }

  return {
    async create(record) {
      const data = JSON.stringify(record)
      const stored = JSON.parse(data) as RunRecord
      const result = await db
        .insertInto('mokei_flow_runs')
        .values({
          run_id: stored.runID,
          state: stored.state,
          revision: stored.revision,
          created_at: stored.createdAt,
          updated_at: stored.updatedAt,
          trace_id: stored.traceID ?? null,
          task_id: stored.taskID ?? null,
          data: adapter.encodeJSON(stored),
        })
        .onConflict((conflict) => conflict.column('run_id').doNothing())
        .executeTakeFirstOrThrow()
      if (Number(result.numInsertedOrUpdatedRows) === 0)
        throw new RunStoreConflictError({ message: `Run already exists: ${stored.runID}` })
    },
    async get(runID) {
      return read(runID)
    },
    async update(runID, patch, expected) {
      const record = await read(runID)
      if (record == null) throw new Error(`Run not found: ${runID}`)
      if (record.revision !== expected.revision) throw new RunStoreConflictError()
      const data = JSON.stringify({ ...record, ...patch, runID, revision: record.revision + 1 })
      const stored = JSON.parse(data) as RunRecord
      const result = await db
        .updateTable('mokei_flow_runs')
        .set({
          state: stored.state,
          revision: stored.revision,
          created_at: stored.createdAt,
          updated_at: stored.updatedAt,
          trace_id: stored.traceID ?? null,
          task_id: stored.taskID ?? null,
          data: adapter.encodeJSON(stored),
        })
        .where('run_id', '=', runID)
        .where('revision', '=', expected.revision)
        .executeTakeFirstOrThrow()
      if (Number(result.numUpdatedRows) === 0) throw new RunStoreConflictError()
      return stored
    },
    async list(filter) {
      if (filter.limit != null && (!Number.isInteger(filter.limit) || filter.limit < 0)) {
        throw new RangeError('Run list limit must be a non-negative integer')
      }
      if (filter.states?.length === 0 || filter.limit === 0) return []
      let query = db.selectFrom('mokei_flow_runs').select('data')
      if (filter.states != null) query = query.where('state', 'in', filter.states)
      if (filter.updatedBefore != null) query = query.where('updated_at', '<', filter.updatedBefore)
      query = query.orderBy('created_at', 'desc').orderBy('seq', 'asc')
      if (filter.limit != null) query = query.limit(Math.min(filter.limit, Number.MAX_SAFE_INTEGER))
      return (await query.execute()).map((row) => row.data)
    },
    async delete(runID) {
      await db.deleteFrom('mokei_flow_runs').where('run_id', '=', runID).execute()
    },
  }
}

export async function getFlowRunStore(provider: StoreProvider): Promise<RunStore> {
  return provider.getStore(FLOW_RUN_STORE) as Promise<RunStore>
}
