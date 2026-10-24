# @mokei/context-server-node

## 0.15.0

### Minor Changes

- Align with the current stack line: `@enkaku/*` 0.22.2, `@kokuin/token` 0.6.2, `@hozon/db` 0.5 (registering a different store definition under a taken name now throws `StoreAlreadyRegisteredError`), `@tejika/*`, `@sozai/*` and `@teikyo/oauth` on their OpenTelemetry v3 releases. Consumers sharing `@enkaku` and `@kokuin` types must upgrade in step. No mokei API changes.

### Patch Changes

- Updated dependencies:
  - @mokei/context-protocol@0.15.0
  - @mokei/context-server@0.15.0
