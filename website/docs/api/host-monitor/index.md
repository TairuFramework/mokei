# @mokei/host-monitor

Mokei Host monitor.

## Installation

```sh
npm install @mokei/host-monitor
```

## Type Aliases

### Monitor

> **Monitor**: `object`

#### Type declaration

##### disposer

> **disposer**: `Disposer`

##### port

> **port**: `number`

##### server

> **server**: `ServerType`

***

### MonitorParams

> **MonitorParams**: `object`

#### Type declaration

##### port?

> `optional` **port**: `number`

##### socketPath?

> `optional` **socketPath**: `string`

## Functions

### startMonitor()

> **startMonitor**(`params`): `Promise`\<[`Monitor`](index.md#monitor)\>

#### Parameters

##### params

[`MonitorParams`](index.md#monitorparams) = `{}`

#### Returns

`Promise`\<[`Monitor`](index.md#monitor)\>
