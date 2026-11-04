import { HandlerError, type ProcedureHandlers } from '@enkaku/server'
import type {
  TraceProtocol,
  TracesGetResult,
  TracesListParams,
  TracesListResult,
  TracesLogsParams,
  TracesLogsResult,
} from '@mokei/host-protocol'

export type TraceReader = {
  list(params: TracesListParams): Promise<TracesListResult>
  get(traceID: string): Promise<TracesGetResult | undefined>
  logs(params: TracesLogsParams): Promise<TracesLogsResult>
}

export function createTraceHandlers(params: {
  reader: TraceReader
}): ProcedureHandlers<TraceProtocol> {
  return {
    'traces.list': (ctx) => params.reader.list(ctx.param),
    'traces.logs': (ctx) => params.reader.logs(ctx.param),
    'traces.get': async (ctx) => {
      const result = await params.reader.get(ctx.param.traceID)
      if (result === undefined) {
        throw new HandlerError({
          code: 'TRACE_NOT_FOUND',
          message: `Trace not found: ${ctx.param.traceID}`,
        })
      }
      return result
    },
  }
}
