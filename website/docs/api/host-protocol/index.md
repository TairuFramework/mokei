# @mokei/host-protocol

Mokei Host protocol.

## Installation

```sh
npm install @mokei/host-protocol
```

## Type Aliases

### ActiveContextInfo

> **ActiveContextInfo**: `FromSchema`\<*typeof* [`activeContextInfoSchema`](index.md#activecontextinfoschema)\>

***

### ClientMessage

> **ClientMessage**: `AnyClientMessageOf`\<[`Protocol`](index.md#protocol)\>

***

### HostEvent

> **HostEvent**: `FromSchema`\<*typeof* [`hostEventSchema`](index.md#hosteventschema)\>

***

### HostEventMeta

> **HostEventMeta**: `FromSchema`\<*typeof* [`hostEventMetaSchema`](index.md#hosteventmetaschema)\>

***

### HostInfoResult

> **HostInfoResult**: `FromSchema`\<*typeof* [`hostInfoResultSchema`](index.md#hostinforesultschema)\>

***

### Protocol

> **Protocol**: *typeof* [`protocol`](index.md#protocol-1)

***

### ServerMessage

> **ServerMessage**: `AnyServerMessageOf`\<[`Protocol`](index.md#protocol)\>

## Variables

### activeContextInfoSchema

> `const` **activeContextInfoSchema**: `object`

#### Type declaration

##### properties

> `readonly` **properties**: `object`

###### properties.startedTime

> `readonly` **properties.startedTime**: `object`

###### properties.startedTime.type

> `readonly` **properties.startedTime.type**: `"integer"` = `'integer'`

##### required

> `readonly` **required**: readonly \[`"startedTime"`\]

##### type

> `readonly` **type**: `"object"` = `'object'`

***

### DEFAULT\_SOCKET\_PATH

> `const` **DEFAULT\_SOCKET\_PATH**: `string`

***

### hostEventMetaSchema

> `const` **hostEventMetaSchema**: `object`

#### Type declaration

##### additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

##### properties

> `readonly` **properties**: `object`

###### properties.contextID

> `readonly` **properties.contextID**: `object`

###### properties.contextID.type

> `readonly` **properties.contextID.type**: `"string"` = `'string'`

###### properties.eventID

> `readonly` **properties.eventID**: `object`

###### properties.eventID.type

> `readonly` **properties.eventID.type**: `"string"` = `'string'`

###### properties.time

> `readonly` **properties.time**: `object`

###### properties.time.type

> `readonly` **properties.time.type**: `"integer"` = `'integer'`

##### required

> `readonly` **required**: readonly \[`"contextID"`, `"eventID"`, `"time"`\]

##### type

> `readonly` **type**: `"object"` = `'object'`

***

### hostEventSchema

> `const` **hostEventSchema**: `object`

#### Type declaration

##### anyOf

> `readonly` **anyOf**: readonly \[\{ `additionalProperties`: `false`; `properties`: \{ `data`: \{ `additionalProperties`: `false`; `properties`: \{ `args`: \{ `items`: \{ `type`: `"string"`; \}; `type`: `"array"`; \}; `command`: \{ `type`: `"string"`; \}; `transport`: \{ `const`: `"stdio"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"transport"`, `"command"`, `"args"`\]; `type`: `"object"`; \}; `meta`: \{ `additionalProperties`: `false`; `properties`: \{ `contextID`: \{ `type`: `"string"`; \}; `eventID`: \{ `type`: `"string"`; \}; `time`: \{ `type`: `"integer"`; \}; \}; `required`: readonly \[`"contextID"`, `"eventID"`, `"time"`\]; `type`: `"object"`; \}; `type`: \{ `const`: `"context:start"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"type"`, `"meta"`, `"data"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `meta`: \{ `additionalProperties`: `false`; `properties`: \{ `contextID`: \{ `type`: `"string"`; \}; `eventID`: \{ `type`: `"string"`; \}; `time`: \{ `type`: `"integer"`; \}; \}; `required`: readonly \[`"contextID"`, `"eventID"`, `"time"`\]; `type`: `"object"`; \}; `type`: \{ `const`: `"context:stop"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"type"`, `"meta"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `data`: \{ `additionalProperties`: `false`; `properties`: \{ `from`: \{ `enum`: readonly \[`"client"`, `"server"`\]; `type`: `"string"`; \}; `message`: \{ `type`: `"object"`; \}; \}; `required`: readonly \[`"from"`, `"message"`\]; `type`: `"object"`; \}; `meta`: \{ `additionalProperties`: `false`; `properties`: \{ `contextID`: \{ `type`: `"string"`; \}; `eventID`: \{ `type`: `"string"`; \}; `time`: \{ `type`: `"integer"`; \}; \}; `required`: readonly \[`"contextID"`, `"eventID"`, `"time"`\]; `type`: `"object"`; \}; `type`: \{ `const`: `"context:message"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"type"`, `"meta"`, `"data"`\]; `type`: `"object"`; \}\]

***

### hostInfoResultSchema

> `const` **hostInfoResultSchema**: `object`

#### Type declaration

##### additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

##### properties

> `readonly` **properties**: `object`

###### properties.activeContexts

> `readonly` **properties.activeContexts**: `object`

###### properties.activeContexts.additionalProperties

> `readonly` **properties.activeContexts.additionalProperties**: `object` = `activeContextInfoSchema`

###### properties.activeContexts.additionalProperties.properties

> `readonly` **properties.activeContexts.additionalProperties.properties**: `object`

###### properties.activeContexts.additionalProperties.properties.startedTime

> `readonly` **properties.activeContexts.additionalProperties.properties.startedTime**: `object`

###### properties.activeContexts.additionalProperties.properties.startedTime.type

> `readonly` **properties.activeContexts.additionalProperties.properties.startedTime.type**: `"integer"` = `'integer'`

###### properties.activeContexts.additionalProperties.required

> `readonly` **properties.activeContexts.additionalProperties.required**: readonly \[`"startedTime"`\]

###### properties.activeContexts.additionalProperties.type

> `readonly` **properties.activeContexts.additionalProperties.type**: `"object"` = `'object'`

###### properties.activeContexts.type

> `readonly` **properties.activeContexts.type**: `"object"` = `'object'`

###### properties.startedTime

> `readonly` **properties.startedTime**: `object`

###### properties.startedTime.type

> `readonly` **properties.startedTime.type**: `"integer"` = `'integer'`

##### required

> `readonly` **required**: readonly \[`"activeContexts"`, `"startedTime"`\]

##### type

> `readonly` **type**: `"object"` = `'object'`

***

### protocol

> `const` **protocol**: `object`

#### Type declaration

##### events

> `readonly` **events**: `object`

###### events.receive

> `readonly` **events.receive**: `object`

###### events.receive.type

> `readonly` **events.receive.type**: `"object"` = `'object'`

###### events.type

> `readonly` **events.type**: `"stream"` = `'stream'`

##### info

> `readonly` **info**: `object`

###### info.result

> `readonly` **info.result**: `object` = `hostInfoResultSchema`

###### info.result.additionalProperties

> `readonly` **info.result.additionalProperties**: `false` = `false`

###### info.result.properties

> `readonly` **info.result.properties**: `object`

###### info.result.properties.activeContexts

> `readonly` **info.result.properties.activeContexts**: `object`

###### info.result.properties.activeContexts.additionalProperties

> `readonly` **info.result.properties.activeContexts.additionalProperties**: `object` = `activeContextInfoSchema`

###### info.result.properties.activeContexts.additionalProperties.properties

> `readonly` **info.result.properties.activeContexts.additionalProperties.properties**: `object`

###### info.result.properties.activeContexts.additionalProperties.properties.startedTime

> `readonly` **info.result.properties.activeContexts.additionalProperties.properties.startedTime**: `object`

###### info.result.properties.activeContexts.additionalProperties.properties.startedTime.type

> `readonly` **info.result.properties.activeContexts.additionalProperties.properties.startedTime.type**: `"integer"` = `'integer'`

###### info.result.properties.activeContexts.additionalProperties.required

> `readonly` **info.result.properties.activeContexts.additionalProperties.required**: readonly \[`"startedTime"`\]

###### info.result.properties.activeContexts.additionalProperties.type

> `readonly` **info.result.properties.activeContexts.additionalProperties.type**: `"object"` = `'object'`

###### info.result.properties.activeContexts.type

> `readonly` **info.result.properties.activeContexts.type**: `"object"` = `'object'`

###### info.result.properties.startedTime

> `readonly` **info.result.properties.startedTime**: `object`

###### info.result.properties.startedTime.type

> `readonly` **info.result.properties.startedTime.type**: `"integer"` = `'integer'`

###### info.result.required

> `readonly` **info.result.required**: readonly \[`"activeContexts"`, `"startedTime"`\]

###### info.result.type

> `readonly` **info.result.type**: `"object"` = `'object'`

###### info.type

> `readonly` **info.type**: `"request"` = `'request'`

##### shutdown

> `readonly` **shutdown**: `object`

###### shutdown.type

> `readonly` **shutdown.type**: `"request"` = `'request'`

##### spawn

> `readonly` **spawn**: `object`

###### spawn.param

> `readonly` **spawn.param**: `object`

###### spawn.param.additionalProperties

> `readonly` **spawn.param.additionalProperties**: `false` = `false`

###### spawn.param.properties

> `readonly` **spawn.param.properties**: `object`

###### spawn.param.properties.args

> `readonly` **spawn.param.properties.args**: `object`

###### spawn.param.properties.args.items

> `readonly` **spawn.param.properties.args.items**: `object`

###### spawn.param.properties.args.items.type

> `readonly` **spawn.param.properties.args.items.type**: `"string"` = `'string'`

###### spawn.param.properties.args.type

> `readonly` **spawn.param.properties.args.type**: `"array"` = `'array'`

###### spawn.param.properties.command

> `readonly` **spawn.param.properties.command**: `object`

###### spawn.param.properties.command.type

> `readonly` **spawn.param.properties.command.type**: `"string"` = `'string'`

###### spawn.param.required

> `readonly` **spawn.param.required**: readonly \[`"command"`\]

###### spawn.param.type

> `readonly` **spawn.param.type**: `"object"` = `'object'`

###### spawn.receive

> `readonly` **spawn.receive**: `object`

###### spawn.receive.type

> `readonly` **spawn.receive.type**: `"object"` = `'object'`

###### spawn.send

> `readonly` **spawn.send**: `object`

###### spawn.send.type

> `readonly` **spawn.send.type**: `"object"` = `'object'`

###### spawn.type

> `readonly` **spawn.type**: `"channel"` = `'channel'`
