---
'@mokei/app-node': patch
'@mokei/flow-host-node': patch
'@mokei/flow-host': patch
mokei: patch
---

Add `@mokei/app-node`: `mokei.json` configuration, the single `mokei.db` hozon database (`openMokeiDatabase`) and telemetry (`setupMokeiTelemetry`), owned by the daemon. Flow runs and tasks are hozon stores registered in that database; `createFlowService` takes the database instead of opening one, and logging/tracing settings move from `flows.json` to `mokei.json`. `@mokei/flow-host` drops `createTraceStoreSpanExporter` and `createTraceStoreLogSink` in favour of `@hozon/otel` and `@hozon/logtape`.
