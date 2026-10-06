# @mokei/app-node

Mokei Node app foundation: configuration, database and telemetry.

```ts
import { loadMokeiConfig, openMokeiDatabase, setupMokeiTelemetry } from '@mokei/app-node'
import { getLogStore } from '@hozon/store-log'
import { getTelemetryStore } from '@hozon/store-telemetry'

const config = await loadMokeiConfig()
const db = await openMokeiDatabase()
const telemetry = setupMokeiTelemetry({
  logStore: await getLogStore(db),
  telemetryStore: await getTelemetryStore(db),
  logs: config.logs,
  otlp: config.tracing.otlp,
  reportCategories: [['my-app', 'report']],
})

// Stop application work before draining telemetry and closing storage.
await telemetry.dispose()
await db.close()
```

`loadMokeiConfig(path?)` reads `mokei.json` from mokei's data directory.
`MOKEI_CONFIG_PATH` overrides that default; an explicit path takes precedence.
Missing files use `{ logs: { level: 'info', file: true }, tracing: {} }`.
Unknown keys, invalid values and malformed JSON reject with `MokeiConfigError`,
which exposes the configuration path and validation issues.

```json
{
  "logs": { "level": "info", "file": true },
  "tracing": {
    "otlp": {
      "endpoint": "http://localhost:4318/v1/traces",
      "headers": { "authorization": "Bearer token" }
    }
  }
}
```

`openMokeiDatabase({ path?, stores? })` opens `mokei.db` in mokei's data directory,
registers the hozon log and telemetry stores plus any supplied stores, and runs migrations.
`MOKEI_DATABASE_PATH` overrides the default; an explicit path wins. Use `:memory:`
for ephemeral storage. `mokeiStoreDefinitions` exposes the two built-in store definitions.

`setupMokeiTelemetry` installs tracing and logging once per process. It stores spans
and correlated logs, optionally exports OTLP spans, and writes daily rotating log files
unless `logs.file` is false. Report categories and hozon storage failures route to the
console errors sink without being captured. Report categories default to an empty list.
Disposal drains owned writes before releasing logging and tracing registrations;
telemetry cannot be reinstalled in the same process.
