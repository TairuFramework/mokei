# @mokei/host-protocol

Mokei Host protocol.

## Installation

```sh
npm install @mokei/host-protocol
```

## Type Aliases

### ActiveContextInfo

> **ActiveContextInfo** = `FromSchema`\<*typeof* [`activeContextInfoSchema`](#activecontextinfoschema)\>

***

### ClientMessage

> **ClientMessage** = `AnyClientMessageOf`\<[`Protocol`](#protocol)\>

***

### HostEvent

> **HostEvent** = `FromSchema`\<*typeof* [`hostEventSchema`](#hosteventschema)\>

***

### HostEventMeta

> **HostEventMeta** = `FromSchema`\<*typeof* [`hostEventMetaSchema`](#hosteventmetaschema)\>

***

### HostInfoResult

> **HostInfoResult** = `FromSchema`\<*typeof* [`hostInfoResultSchema`](#hostinforesultschema)\>

***

### Protocol

> **Protocol** = *typeof* [`protocol`](#protocol-1)

***

### ServerMessage

> **ServerMessage** = `AnyServerMessageOf`\<[`Protocol`](#protocol)\>

## Variables

### activeContextInfoSchema

> `const` **activeContextInfoSchema**: `object`

#### Type Declaration

##### properties

> `readonly` **properties**: `object`

###### properties.startedTime

> `readonly` **startedTime**: `object`

###### properties.startedTime.type

> `readonly` **type**: `"integer"` = `'integer'`

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

#### Type Declaration

##### additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

##### properties

> `readonly` **properties**: `object`

###### properties.contextID

> `readonly` **contextID**: `object`

###### properties.contextID.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.eventID

> `readonly` **eventID**: `object`

###### properties.eventID.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.time

> `readonly` **time**: `object`

###### properties.time.type

> `readonly` **type**: `"integer"` = `'integer'`

##### required

> `readonly` **required**: readonly \[`"contextID"`, `"eventID"`, `"time"`\]

##### type

> `readonly` **type**: `"object"` = `'object'`

***

### hostEventSchema

> `const` **hostEventSchema**: `object`

#### Type Declaration

##### anyOf

> `readonly` **anyOf**: readonly \[\{ `additionalProperties`: `false`; `properties`: \{ `data`: \{ `additionalProperties`: `false`; `properties`: \{ `args`: \{ `items`: \{ `type`: `"string"`; \}; `type`: `"array"`; \}; `command`: \{ `type`: `"string"`; \}; `transport`: \{ `const`: `"stdio"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"transport"`, `"command"`, `"args"`\]; `type`: `"object"`; \}; `meta`: \{ `additionalProperties`: `false`; `properties`: \{ `contextID`: \{ `type`: `"string"`; \}; `eventID`: \{ `type`: `"string"`; \}; `time`: \{ `type`: `"integer"`; \}; \}; `required`: readonly \[`"contextID"`, `"eventID"`, `"time"`\]; `type`: `"object"`; \}; `type`: \{ `const`: `"context:start"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"type"`, `"meta"`, `"data"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `meta`: \{ `additionalProperties`: `false`; `properties`: \{ `contextID`: \{ `type`: `"string"`; \}; `eventID`: \{ `type`: `"string"`; \}; `time`: \{ `type`: `"integer"`; \}; \}; `required`: readonly \[`"contextID"`, `"eventID"`, `"time"`\]; `type`: `"object"`; \}; `type`: \{ `const`: `"context:stop"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"type"`, `"meta"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `data`: \{ `additionalProperties`: `false`; `properties`: \{ `from`: \{ `enum`: readonly \[`"client"`, `"server"`\]; `type`: `"string"`; \}; `message`: \{ `type`: `"object"`; \}; \}; `required`: readonly \[`"from"`, `"message"`\]; `type`: `"object"`; \}; `meta`: \{ `additionalProperties`: `false`; `properties`: \{ `contextID`: \{ `type`: `"string"`; \}; `eventID`: \{ `type`: `"string"`; \}; `time`: \{ `type`: `"integer"`; \}; \}; `required`: readonly \[`"contextID"`, `"eventID"`, `"time"`\]; `type`: `"object"`; \}; `type`: \{ `const`: `"context:message"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"type"`, `"meta"`, `"data"`\]; `type`: `"object"`; \}\]

***

### hostInfoResultSchema

> `const` **hostInfoResultSchema**: `object`

#### Type Declaration

##### additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

##### properties

> `readonly` **properties**: `object`

###### properties.activeContexts

> `readonly` **activeContexts**: `object`

###### properties.activeContexts.additionalProperties

> `readonly` **additionalProperties**: `object` = `activeContextInfoSchema`

###### properties.activeContexts.additionalProperties.properties

> `readonly` **properties**: `object`

###### properties.activeContexts.additionalProperties.properties.startedTime

> `readonly` **startedTime**: `object`

###### properties.activeContexts.additionalProperties.properties.startedTime.type

> `readonly` **type**: `"integer"` = `'integer'`

###### properties.activeContexts.additionalProperties.required

> `readonly` **required**: readonly \[`"startedTime"`\]

###### properties.activeContexts.additionalProperties.type

> `readonly` **type**: `"object"` = `'object'`

###### properties.activeContexts.type

> `readonly` **type**: `"object"` = `'object'`

###### properties.startedTime

> `readonly` **startedTime**: `object`

###### properties.startedTime.type

> `readonly` **type**: `"integer"` = `'integer'`

##### required

> `readonly` **required**: readonly \[`"activeContexts"`, `"startedTime"`\]

##### type

> `readonly` **type**: `"object"` = `'object'`

***

### protocol

> `const` **protocol**: `object`

#### Type Declaration

##### events

> `readonly` **events**: `object`

###### events.receive

> `readonly` **receive**: `object`

###### events.receive.type

> `readonly` **type**: `"object"` = `'object'`

###### events.type

> `readonly` **type**: `"stream"` = `'stream'`

##### info

> `readonly` **info**: `object`

###### info.result

> `readonly` **result**: `object` = `hostInfoResultSchema`

###### info.result.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### info.result.properties

> `readonly` **properties**: `object`

###### info.result.properties.activeContexts

> `readonly` **activeContexts**: `object`

###### info.result.properties.activeContexts.additionalProperties

> `readonly` **additionalProperties**: `object` = `activeContextInfoSchema`

###### info.result.properties.activeContexts.additionalProperties.properties

> `readonly` **properties**: `object`

###### info.result.properties.activeContexts.additionalProperties.properties.startedTime

> `readonly` **startedTime**: `object`

###### info.result.properties.activeContexts.additionalProperties.properties.startedTime.type

> `readonly` **type**: `"integer"` = `'integer'`

###### info.result.properties.activeContexts.additionalProperties.required

> `readonly` **required**: readonly \[`"startedTime"`\]

###### info.result.properties.activeContexts.additionalProperties.type

> `readonly` **type**: `"object"` = `'object'`

###### info.result.properties.activeContexts.type

> `readonly` **type**: `"object"` = `'object'`

###### info.result.properties.startedTime

> `readonly` **startedTime**: `object`

###### info.result.properties.startedTime.type

> `readonly` **type**: `"integer"` = `'integer'`

###### info.result.required

> `readonly` **required**: readonly \[`"activeContexts"`, `"startedTime"`\]

###### info.result.type

> `readonly` **type**: `"object"` = `'object'`

###### info.type

> `readonly` **type**: `"request"` = `'request'`

##### shutdown

> `readonly` **shutdown**: `object`

###### shutdown.type

> `readonly` **type**: `"request"` = `'request'`

##### spawn

> `readonly` **spawn**: `object`

###### spawn.param

> `readonly` **param**: `object`

###### spawn.param.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### spawn.param.properties

> `readonly` **properties**: `object`

###### spawn.param.properties.args

> `readonly` **args**: `object`

###### spawn.param.properties.args.items

> `readonly` **items**: `object`

###### spawn.param.properties.args.items.type

> `readonly` **type**: `"string"` = `'string'`

###### spawn.param.properties.args.type

> `readonly` **type**: `"array"` = `'array'`

###### spawn.param.properties.command

> `readonly` **command**: `object`

###### spawn.param.properties.command.type

> `readonly` **type**: `"string"` = `'string'`

###### spawn.param.properties.env

> `readonly` **env**: `object`

###### spawn.param.properties.env.additionalProperties

> `readonly` **additionalProperties**: `object`

###### spawn.param.properties.env.additionalProperties.type

> `readonly` **type**: `"string"` = `'string'`

###### spawn.param.properties.env.type

> `readonly` **type**: `"object"` = `'object'`

###### spawn.param.required

> `readonly` **required**: readonly \[`"command"`\]

###### spawn.param.type

> `readonly` **type**: `"object"` = `'object'`

###### spawn.receive

> `readonly` **receive**: `object`

###### spawn.receive.type

> `readonly` **type**: `"object"` = `'object'`

###### spawn.send

> `readonly` **send**: `object`

###### spawn.send.type

> `readonly` **type**: `"object"` = `'object'`

###### spawn.type

> `readonly` **type**: `"channel"` = `'channel'`
