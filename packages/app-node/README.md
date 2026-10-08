# @mokei/app-node

Node app foundation for Mokei configuration, the shared hozon database and process telemetry.

## Public API

| Export | Behaviour |
|---|---|
| `getMokeiConfigPath()` | Returns `MOKEI_CONFIG_PATH` or `<mokei data dir>/mokei.json`. |
| `loadMokeiConfig(path?)` | Loads and validates configuration; missing files use defaults. |
| `MokeiConfig`, `MokeiConfigError` | Configuration type and validation error (with `path` and `issues`). |
| `mokeiStoreDefinitions` | Built-in hozon log, telemetry and trace index store definitions. |
| `openMokeiDatabase({ path?, stores? }?)` | Opens and migrates the app database, registering built-in stores and any supplied definitions. |
| `setupMokeiTelemetry({ provider, onEvent?, hasListeners?, flushIntervalMs?, otlp?, logs?, reportCategories? })` | Installs process tracing and logging; returns the recorder and asynchronous `dispose()`. |
| `LocalTraceRecorder` | Records spans, correlated logs and trace summaries with bounded queues and live delivery. |
| `createTraceReader({ provider, recorder })` | Queries persisted traces merged with the recorder's live snapshot. |
| `traceIndexStoreDefinition`, `getTraceIndexStore(provider)` | Registers and accesses the trace summary index. |
| `toOpenSpan(span)`, `toStoredSpan(span)` | Converts OpenTelemetry spans into live and persisted representations. |

## `mokei.json`

The default path is `<mokei data dir>/mokei.json`; `MOKEI_CONFIG_PATH` overrides it and an explicit `loadMokeiConfig(path)` wins. The schema rejects unknown keys at every level. Missing file defaults are `{ "logs": { "level": "info", "file": true }, "tracing": { "payloads": "on" } }`.

```json
{
  "logs": { "level": "info", "file": true },
  "tracing": {
    "payloads": "on",
    "otlp": {
      "endpoint": "http://localhost:4318/v1/traces",
      "headers": { "authorization": "Bearer token" }
    }
  }
}
```

`logs.level` accepts `trace`, `debug`, `info`, `warning`, `error` or `fatal`; `logs.file` controls daily rotating file output. `tracing.payloads` accepts `on`, `off` or a positive integer byte cap, and defaults to `on`. `tracing.otlp.endpoint` is required when `otlp` is present; `headers` is an optional string map. Invalid JSON and schema values throw `MokeiConfigError`, naming the path and validation issues.

## Database and telemetry

`openMokeiDatabase()` uses `<mokei data dir>/mokei.db`. `MOKEI_DATABASE_PATH` overrides the default; an explicit `path` takes precedence over the environment variable. `:memory:` selects in-memory storage. The database registers `mokeiStoreDefinitions` (the hozon log, telemetry and trace index stores) plus optional caller-provided stores.

Telemetry stores spans and correlated logs locally, and can export spans to OTLP. File logging is enabled by default. MCP notification logs reach the recorder at debug level without reaching other sinks.

`hasListeners(type)` skips live event cloning and dispatch when no listener exists. `flushIntervalMs` overrides the recorder's flush interval. `reportCategories` is an array of logger category paths; each is routed at error level to the console error sink and excluded from log capture. The `hozon` category is routed there automatically. Hozon storage failures also reach the console error sink without being captured.

Dispose application work first, then telemetry, then close the database. Telemetry is process-wide and can only be installed once.
