---
'@mokei/app-node': patch
---

Move to OpenTelemetry JS v3: `@opentelemetry/sdk-trace-base` is replaced by `@opentelemetry/sdk-trace` (`TracerProvider`, options-object span processors), and the OTLP exporters move to 0.300. Update `@enkaku/*` to 0.22, `@hozon/db` to 0.3 and the `@tejika/*`, `@sozai/*` and `@kokuin/token` dependencies to their OpenTelemetry v3 releases.
