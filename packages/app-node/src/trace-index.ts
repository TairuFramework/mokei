import type { ColumnType, Selectable, StoreDefinition, StoreProvider } from '@hozon/db'
import { sql } from '@hozon/db'
import type {
  TraceCall,
  TraceSummary,
  TracesListParams,
  TracesListResult,
} from '@mokei/host-protocol'

import { decodeJSONColumn } from './json-column.js'
import { decodeTraceCursor, encodeTraceCursor } from './trace-cursor.js'

/**
 * The root-span attributes a trace summary keeps. `mokei.server.name` is set after a context's
 * root span starts, so callers re-read it from the live span.
 */
export function pickSummaryAttributes(
  attributes: Readonly<Record<string, unknown>>,
): TraceSummary['attributes'] {
  const picked: TraceSummary['attributes'] = {}
  for (const key of [
    'mokei.run.id',
    'mokei.flow.id',
    'mokei.context.id',
    'mokei.server.name',
  ] as const) {
    const value = attributes[key]
    if (typeof value === 'string') picked[key] = value
  }
  const label = attributes['mokei.run.label']
  if (typeof label === 'string') picked.label = label
  return picked
}

export function traceSearchText(summary: TraceSummary): string {
  return [
    summary.name,
    summary.attributes.label,
    summary.attributes['mokei.flow.id'],
    summary.attributes['mokei.server.name'],
  ]
    .filter((value) => typeof value === 'string')
    .join('\n')
    .toLowerCase()
}

/** A {@link TraceCall} with the trace it called into. */
export type IndexedTraceCall = TraceCall & { contextTraceID: string }

export type TraceIndexStore = {
  upsert(summaries: Array<TraceSummary>): Promise<void>
  /** Records calls into other traces; a call already recorded for the span is replaced. */
  addCalls(calls: Array<IndexedTraceCall>): Promise<void>
  /** Calls into `contextTraceID`, newest first. */
  listCalls(contextTraceID: string, limit: number): Promise<Array<TraceCall>>
  get(traceID: string): Promise<TraceSummary | undefined>
  list(params: TracesListParams): Promise<TracesListResult>
  listActiveIDs(): Promise<Array<string>>
  markInterrupted(): Promise<number>
  deleteByTrace(traceIDs: Array<string>): Promise<number>
  deleteBefore(time: number, params?: { keepTraceIDs?: Array<string> }): Promise<number>
}

export type TraceIndexTables = {
  traces: {
    trace_id: string
    root_span_id: string
    active_segment_span_id: string | null
    kind: TraceSummary['kind']
    name: string
    name_lower: string
    active: number
    outcome: TraceSummary['outcome']
    start_time: number
    end_time: number | null
    attributes: ColumnType<TraceSummary['attributes'] | string, unknown, unknown>
    span_count: number
    error_count: number
    dropped_count: number
    revision: number
  }
  trace_calls: {
    span_id: string
    trace_id: string
    context_trace_id: string
    name: string
    start_time: number
    end_time: number | null
    outcome: TraceCall['outcome']
  }
}

function toSummary(row: Selectable<TraceIndexTables['traces']>): TraceSummary {
  return {
    traceID: row.trace_id,
    rootSpanID: row.root_span_id,
    ...(row.active_segment_span_id == null
      ? {}
      : { activeSegmentSpanID: row.active_segment_span_id }),
    kind: row.kind,
    name: row.name,
    active: row.active === 1,
    outcome: row.outcome,
    startTime: row.start_time,
    ...(row.end_time == null ? {} : { endTime: row.end_time }),
    attributes: decodeJSONColumn<TraceSummary['attributes']>(row.attributes),
    spanCount: row.span_count,
    errorCount: row.error_count,
    droppedCount: row.dropped_count,
    revision: row.revision,
  }
}

export const traceIndexStoreDefinition: StoreDefinition<TraceIndexTables, TraceIndexStore> = {
  name: 'trace-index',
  migrations: (ctx) => ({
    '0-init': {
      async up(db) {
        await db.schema
          .createTable('traces')
          .addColumn('trace_id', ctx.types.text, (column) => column.primaryKey())
          .addColumn('root_span_id', ctx.types.text, (column) => column.notNull())
          .addColumn('active_segment_span_id', ctx.types.text)
          .addColumn('kind', ctx.types.text, (column) => column.notNull())
          .addColumn('name', ctx.types.text, (column) => column.notNull())
          .addColumn('name_lower', ctx.types.text, (column) => column.notNull())
          .addColumn('active', 'integer', (column) => column.notNull())
          .addColumn('outcome', ctx.types.text)
          .addColumn('start_time', ctx.types.double, (column) => column.notNull())
          .addColumn('end_time', ctx.types.double)
          .addColumn('attributes', ctx.types.json, (column) => column.notNull())
          .addColumn('span_count', 'integer', (column) => column.notNull())
          .addColumn('error_count', 'integer', (column) => column.notNull())
          .addColumn('dropped_count', 'integer', (column) => column.notNull())
          .addColumn('revision', 'integer', (column) => column.notNull())
          .execute()
        await db.schema
          .createIndex('mokei_traces_start_time')
          .on('traces')
          .column('start_time')
          .execute()
        await db.schema.createIndex('mokei_traces_active').on('traces').column('active').execute()
        await db.schema
          .createIndex('mokei_traces_kind_start_time')
          .on('traces')
          .columns(['kind', 'start_time'])
          .execute()
      },
      async down(db) {
        await db.schema.dropTable('traces').execute()
      },
    },
    '1-calls': {
      async up(db) {
        await db.schema
          .createTable('trace_calls')
          .addColumn('span_id', ctx.types.text, (column) => column.primaryKey())
          .addColumn('trace_id', ctx.types.text, (column) => column.notNull())
          .addColumn('context_trace_id', ctx.types.text, (column) => column.notNull())
          .addColumn('name', ctx.types.text, (column) => column.notNull())
          .addColumn('start_time', ctx.types.double, (column) => column.notNull())
          .addColumn('end_time', ctx.types.double)
          .addColumn('outcome', ctx.types.text)
          .execute()
        await db.schema
          .createIndex('mokei_trace_calls_context_start_time')
          .on('trace_calls')
          .columns(['context_trace_id', 'start_time'])
          .execute()
        await db.schema
          .createIndex('mokei_trace_calls_trace_id')
          .on('trace_calls')
          .column('trace_id')
          .execute()
      },
      async down(db) {
        await db.schema.dropTable('trace_calls').execute()
      },
    },
  }),
  createAPI(db, adapter) {
    return {
      async upsert(summaries) {
        for (const summary of summaries) {
          const row = {
            trace_id: summary.traceID,
            root_span_id: summary.rootSpanID,
            active_segment_span_id: summary.activeSegmentSpanID ?? null,
            kind: summary.kind,
            name: summary.name,
            name_lower: traceSearchText(summary),
            active: summary.active ? 1 : 0,
            outcome: summary.outcome,
            start_time: summary.startTime,
            end_time: summary.endTime ?? null,
            attributes: adapter.encodeJSON(summary.attributes),
            span_count: summary.spanCount,
            error_count: summary.errorCount,
            dropped_count: summary.droppedCount,
            revision: summary.revision,
          }
          await db
            .insertInto('traces')
            .values(row)
            .onConflict((conflict) => {
              return conflict
                .column('trace_id')
                .doUpdateSet(row)
                .where('traces.revision', '<', summary.revision)
            })
            .execute()
        }
      },
      async addCalls(calls) {
        for (const call of calls) {
          const row = {
            span_id: call.spanID,
            trace_id: call.traceID,
            context_trace_id: call.contextTraceID,
            name: call.name,
            start_time: call.startTime,
            end_time: call.endTime ?? null,
            outcome: call.outcome,
          }
          await db
            .insertInto('trace_calls')
            .values(row)
            .onConflict((conflict) => conflict.column('span_id').doUpdateSet(row))
            .execute()
        }
      },
      async listCalls(contextTraceID, limit) {
        if (!Number.isInteger(limit) || limit < 0) {
          throw new RangeError('Trace call limit must be a non-negative integer')
        }
        if (limit === 0) return []
        const rows = await db
          .selectFrom('trace_calls')
          .selectAll()
          .where('context_trace_id', '=', contextTraceID)
          .orderBy('start_time', 'desc')
          .orderBy('span_id', 'desc')
          .limit(limit)
          .execute()
        return rows.map((row) => ({
          traceID: row.trace_id,
          spanID: row.span_id,
          name: row.name,
          startTime: row.start_time,
          ...(row.end_time == null ? {} : { endTime: row.end_time }),
          outcome: row.outcome,
        }))
      },
      async get(traceID) {
        const row = await db
          .selectFrom('traces')
          .selectAll()
          .where('trace_id', '=', traceID)
          .executeTakeFirst()
        return row == null ? undefined : toSummary(row)
      },
      async list(params) {
        if (!Number.isInteger(params.limit) || params.limit < 0) {
          throw new RangeError('Trace list limit must be a non-negative integer')
        }
        if (params.limit === 0) return { traces: [] }
        let query = db.selectFrom('traces').selectAll()
        if (params.kind != null) query = query.where('kind', '=', params.kind)
        if (params.active != null) query = query.where('active', '=', params.active ? 1 : 0)
        if (params.outcome !== undefined) {
          query =
            params.outcome === null
              ? query.where('outcome', 'is', null)
              : query.where('outcome', '=', params.outcome)
        }
        if (params.name != null) {
          const pattern = `%${params.name.toLowerCase().replace(/[!%_]/g, '!$&')}%`
          query = query.where(sql<boolean>`name_lower LIKE ${pattern} ESCAPE '!'`)
        }
        if (params.since != null) query = query.where('start_time', '>=', params.since)
        if (params.until != null) query = query.where('start_time', '<=', params.until)
        if (params.cursor != null) {
          const [startTime, traceID] = decodeTraceCursor(params.cursor)
          query = query.where((eb) =>
            eb.or([
              eb('start_time', '<', startTime),
              eb.and([eb('start_time', '=', startTime), eb('trace_id', '<', traceID)]),
            ]),
          )
        }
        const rows = await query
          .orderBy('start_time', 'desc')
          .orderBy('trace_id', 'desc')
          .limit(params.limit + 1)
          .execute()
        const traces = rows.slice(0, params.limit).map(toSummary)
        const last = traces.at(-1)
        return {
          traces,
          ...(rows.length > params.limit && last != null
            ? {
                cursor: encodeTraceCursor(last.startTime, last.traceID),
              }
            : {}),
        }
      },
      async listActiveIDs() {
        const rows = await db
          .selectFrom('traces')
          .select('trace_id')
          .where('active', '=', 1)
          .execute()
        return rows.map((row) => row.trace_id)
      },
      async markInterrupted() {
        const result = await db
          .updateTable('traces')
          .set((eb) => ({
            active: 0,
            active_segment_span_id: null,
            outcome: 'interrupted',
            revision: eb('revision', '+', 1),
          }))
          .where('active', '=', 1)
          .executeTakeFirstOrThrow()
        return Number(result.numUpdatedRows)
      },
      async deleteByTrace(traceIDs) {
        if (traceIDs.length === 0) return 0
        // A call goes with either end: the trace that made it or the trace it called into.
        await db
          .deleteFrom('trace_calls')
          .where((eb) =>
            eb.or([eb('trace_id', 'in', traceIDs), eb('context_trace_id', 'in', traceIDs)]),
          )
          .execute()
        const result = await db
          .deleteFrom('traces')
          .where('trace_id', 'in', traceIDs)
          .executeTakeFirstOrThrow()
        return Number(result.numDeletedRows)
      },
      async deleteBefore(time, params) {
        let query = db
          .deleteFrom('traces')
          .where('active', '=', 0)
          .where(sql<boolean>`coalesce(end_time, start_time) < ${time}`)
        if (params?.keepTraceIDs?.length)
          query = query.where('trace_id', 'not in', params.keepTraceIDs)
        // Calls age out like spans: unless the trace on either end is kept.
        let calls = db
          .deleteFrom('trace_calls')
          .where(sql<boolean>`coalesce(end_time, start_time) < ${time}`)
        if (params?.keepTraceIDs?.length) {
          calls = calls
            .where('trace_id', 'not in', params.keepTraceIDs)
            .where('context_trace_id', 'not in', params.keepTraceIDs)
        }
        await calls.execute()
        return Number((await query.executeTakeFirstOrThrow()).numDeletedRows)
      },
    }
  },
}

export async function getTraceIndexStore(provider: StoreProvider): Promise<TraceIndexStore> {
  return provider.getStore('trace-index') as Promise<TraceIndexStore>
}
