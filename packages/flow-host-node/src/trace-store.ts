import type { StoreProvider } from '@hozon/db'
import type { StoredLog } from '@hozon/store-log'
import { getLogStore, isTracedLog } from '@hozon/store-log'
import type { StoredSpan } from '@hozon/store-telemetry'
import { getTelemetryStore } from '@hozon/store-telemetry'
import type { TraceStore } from '@mokei/flow-host'

export function createFlowTraceStore(provider: StoreProvider): TraceStore {
  return {
    async addSpans(spans) {
      // Mokei's unknown attribute values cross the boundary as persisted JSON.
      const stored = JSON.parse(JSON.stringify(spans)) as Array<StoredSpan>
      await (await getTelemetryStore(provider)).addSpans(stored)
    },
    async addLogs(logs) {
      const stored = JSON.parse(JSON.stringify(logs)) as Array<StoredLog>
      await (await getLogStore(provider)).addLogs(stored)
    },
    async getTrace(traceID) {
      const telemetryStore = await getTelemetryStore(provider)
      const logStore = await getLogStore(provider)
      return {
        spans: await telemetryStore.getSpans(traceID),
        logs: (await logStore.getTraceLogs(traceID)).filter(isTracedLog),
      }
    },
    async deleteTraces(traceIDs) {
      if (traceIDs.length === 0) return { spans: 0, logs: 0 }
      return provider.withTransaction(async (tx) => {
        const telemetryStore = await getTelemetryStore(tx)
        const logStore = await getLogStore(tx)
        const spans = await telemetryStore.deleteByTrace(traceIDs)
        const logs = await logStore.deleteByTrace(traceIDs)
        return { spans, logs }
      })
    },
    async deleteBefore(time, keepTraceIDs) {
      return provider.withTransaction(async (tx) => {
        const telemetryStore = await getTelemetryStore(tx)
        const logStore = await getLogStore(tx)
        const spans = await telemetryStore.deleteBefore(time, { keepTraceIDs })
        const logs = await logStore.deleteBefore(time, { keepTraceIDs })
        return { spans, logs }
      })
    },
  }
}
