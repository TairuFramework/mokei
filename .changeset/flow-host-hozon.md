---
'@mokei/flow-host-node': patch
'@mokei/flow-host': patch
---

Store flow runs, tasks, spans and logs through hozon in `flow.db`; `openFlowDatabase` is now async and returns a `HozonDB`, and the `createSQLite*Store` helpers are replaced by hozon store definitions and getters. Drop `createTraceStoreSpanExporter` and `createTraceStoreLogSink` from `@mokei/flow-host` in favour of `@hozon/otel` and `@hozon/logtape`.
