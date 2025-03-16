# @mokei/host-monitor

Mokei Host monitor.

## Installation

```sh
npm install @mokei/host-monitor
```

## Type Aliases

### Monitor

> **Monitor** = `object`

#### Properties

##### disposer

> **disposer**: `Disposer`

***

##### port

> **port**: `number`

***

##### server

> **server**: `ServerType`

***

### MonitorParams

> **MonitorParams** = `object`

#### Properties

##### port?

> `optional` **port**: `number`

***

##### socketPath?

> `optional` **socketPath**: `string`

## Functions

### startMonitor()

> **startMonitor**(`params`): `Promise`\<[`Monitor`](#monitor)\>

#### Parameters

##### params

[`MonitorParams`](#monitorparams) = `{}`

#### Returns

`Promise`\<[`Monitor`](#monitor)\>
