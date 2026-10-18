# Mokei model provider

## Installation

```sh
npm install @mokei/model-provider
```

## [Documentation](https://mokei.dev)

## Telemetry

A provider reports its identity to OpenTelemetry through the optional `telemetry` property. A custom provider sets it with `telemetryFromBaseURL('acme', baseURL)`, or with `{ providerName: 'acme' }` when there is no base URL. Without `telemetry`, inference spans omit `gen_ai.provider.name`.
