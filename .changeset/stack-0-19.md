---
'@mokei/app-node': minor
'@mokei/context-client': minor
'@mokei/context-rpc': minor
'@mokei/context-server': minor
'@mokei/context-server-node': minor
'@mokei/decision-flow': minor
'@mokei/decision-flow-server': minor
'@mokei/flow-client': minor
'@mokei/flow-host': minor
'@mokei/flow-host-node': minor
'@mokei/host': minor
'@mokei/host-monitor': minor
'@mokei/host-node': minor
'@mokei/host-protocol': minor
'@mokei/http-client': minor
'@mokei/http-server': minor
'mokei': minor
'@mokei/host-desktop': patch
'@mokei/llama-provider': patch
'@mokei/session': patch
'@mokei/session-node': patch
'@mokei/system-one-client': patch
---

Align with the current stack line. `@hozon/*` moves on to `@hozon/db` 0.5 (adapter 0.2, logtape, otel, store-log and store-telemetry 0.4): registering a different store definition under a taken name now throws `StoreAlreadyRegisteredError`. `@tejika/db` moves to 0.4 and `@tejika/cli`, `@tejika/process`, `@tejika/server` and `@tejika/test` to their `@enkaku` 0.22 releases. `@enkaku/*` requires 0.22.2 and `@kokuin/token` 0.6.2, whose types (`VerifyTokenHook`, the `methods` registry) consumers share with these packages, so they must upgrade in step. `@sozai/otel` 0.4, `@sozai/flow-graph` 0.3 and `@sozai/http-server` 0.2.1 complete the OpenTelemetry v3 alignment. Each of these is a breaking minor upstream, hence the minor bump. Packages that only take the `@sozai/async` 0.4.1 patch move by a patch. No mokei API changes.
