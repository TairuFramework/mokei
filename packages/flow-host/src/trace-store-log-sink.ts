import type { LogRecord, Sink } from '@logtape/logtape'
import { isSpanContextValid, trace } from '@opentelemetry/api'
import { getReporter } from '@sozai/log'

import { renderLogMessage, toJSONValue } from './to-json-value.js'
import type { StoredLog, TraceStore } from './trace-store.js'

export function createTraceStoreLogSink(store: TraceStore): Sink & { flush(): Promise<void> } {
  const category = ['mokei', 'flow-host', 'capture']
  const report = getReporter(['mokei', 'flow-host', 'capture'], '@mokei/flow-host')
  const queue: Array<StoredLog> = []
  const waiters: Array<() => void> = []
  let writing = false

  async function drain(): Promise<void> {
    while (queue.length > 0) {
      const batch = queue.splice(0)
      try {
        await store.addLogs(batch)
      } catch (error) {
        report('Failed to capture log batch', error)
      }
    }
    writing = false
    for (const resolve of waiters.splice(0)) resolve()
  }

  const sink = (record: LogRecord): void => {
    if (category.every((part, index) => record.category[index] === part)) return
    const ctx = trace.getActiveSpan()?.spanContext()
    if (ctx === undefined || !isSpanContextValid(ctx)) return
    queue.push({
      traceID: ctx.traceId,
      spanID: ctx.spanId,
      timestamp: record.timestamp,
      level: record.level,
      category: [...record.category],
      message: renderLogMessage(record),
      properties: Object.fromEntries(
        Object.entries(record.properties).map(([key, value]) => [key, toJSONValue(value)]),
      ),
    })
    if (!writing) {
      writing = true
      queueMicrotask(() => {
        void drain()
      })
    }
  }
  sink.flush = (): Promise<void> => {
    if (!writing && queue.length === 0) return Promise.resolve()
    return new Promise((resolve) => waiters.push(resolve))
  }
  return sink
}
