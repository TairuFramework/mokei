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

### BaseClientMessage

> **BaseClientMessage** = `AnyClientMessageOf`\<[`BaseProtocol`](#baseprotocol)\>

***

### BaseProtocol

> **BaseProtocol** = `Pick`\<[`Protocol`](#protocol), `"events"` \| `"info"` \| `"shutdown"` \| `"spawn"`\>

***

### BaseServerMessage

> **BaseServerMessage** = `AnyServerMessageOf`\<[`BaseProtocol`](#baseprotocol)\>

***

### ClientMessage

> **ClientMessage** = `AnyClientMessageOf`\<[`Protocol`](#protocol)\>

***

### FlowCheckResult

> **FlowCheckResult** = `FromSchema`\<*typeof* [`flowCheckResultSchema`](#flowcheckresultschema)\>

***

### FlowIssue

> **FlowIssue** = `FromSchema`\<*typeof* [`flowIssueSchema`](#flowissueschema)\>

***

### FlowProcedure

> **FlowProcedure** = `Exclude`\<keyof [`Protocol`](#protocol), keyof [`BaseProtocol`](#baseprotocol) \| [`MonitorProcedure`](#monitorprocedure) \| [`TraceProcedure`](#traceprocedure)\>

***

### FlowRunSnapshot

> **FlowRunSnapshot** = `FromSchema`\<*typeof* [`flowRunSnapshotSchema`](#flowrunsnapshotschema)\>

***

### FlowServiceStatus

> **FlowServiceStatus** = `FromSchema`\<*typeof* [`flowServiceStatusSchema`](#flowservicestatusschema)\>

***

### FlowSummary

> **FlowSummary** = `FromSchema`\<*typeof* [`flowSummarySchema`](#flowsummaryschema)\>

***

### HostEvent

> **HostEvent** = `FromSchema`\<*typeof* [`hostEventSchema`](#hosteventschema)\>

***

### HostEventMeta

> **HostEventMeta** = `FromSchema`\<*typeof* [`hostEventMetaSchema`](#hosteventmetaschema)\>

***

### HostEvents

> **HostEvents** = `{ [Type in HostEvent["type"]]: Omit<Extract<HostEvent, { type: Type }>, "type"> }`

***

### HostInfoResult

> **HostInfoResult** = `FromSchema`\<*typeof* [`hostInfoResultSchema`](#hostinforesultschema)\>

***

### InboxItem

> **InboxItem** = `FromSchema`\<*typeof* [`inboxItemSchema`](#inboxitemschema)\>

***

### MonitorPresenceReceive

> **MonitorPresenceReceive** = `FromSchema`\<*typeof* [`monitorPresenceReceiveSchema`](#monitorpresencereceiveschema)\>

***

### MonitorPresenceSend

> **MonitorPresenceSend** = `FromSchema`\<*typeof* [`monitorPresenceSendSchema`](#monitorpresencesendschema)\>

***

### MonitorProcedure

> **MonitorProcedure** = `"monitor.attach"` \| `"monitor.presence"`

***

### OpenSpan

> **OpenSpan** = `FromSchema`\<*typeof* [`openSpanSchema`](#openspanschema)\>

***

### Protocol

> **Protocol** = *typeof* [`protocol`](#protocol-1)

***

### ServerMessage

> **ServerMessage** = `AnyServerMessageOf`\<[`Protocol`](#protocol)\>

***

### ServiceEventMeta

> **ServiceEventMeta** = `FromSchema`\<*typeof* [`serviceEventMetaSchema`](#serviceeventmetaschema)\>

***

### StoredLog

> **StoredLog** = `FromSchema`\<*typeof* [`storedLogSchema`](#storedlogschema)\>

***

### StoredSpan

> **StoredSpan** = `FromSchema`\<*typeof* [`storedSpanSchema`](#storedspanschema)\>

***

### TraceLog

> **TraceLog** = `FromSchema`\<*typeof* [`traceLogSchema`](#tracelogschema)\>

***

### TraceProcedure

> **TraceProcedure** = `"traces.list"` \| `"traces.get"`

***

### TraceProtocol

> **TraceProtocol** = `Pick`\<[`Protocol`](#protocol), [`TraceProcedure`](#traceprocedure)\>

***

### TracesGetResult

> **TracesGetResult** = `FromSchema`\<*typeof* [`tracesGetResultSchema`](#tracesgetresultschema)\>

***

### TracesListParams

> **TracesListParams** = `FromSchema`\<*typeof* [`tracesListParamsSchema`](#traceslistparamsschema)\>

***

### TracesListResult

> **TracesListResult** = `FromSchema`\<*typeof* [`tracesListResultSchema`](#traceslistresultschema)\>

***

### TraceSummary

> **TraceSummary** = `FromSchema`\<*typeof* [`traceSummarySchema`](#tracesummaryschema)\>

***

### TracingInfo

> **TracingInfo** = `FromSchema`\<*typeof* [`tracingInfoSchema`](#tracinginfoschema)\>

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

### flowCheckResultSchema

> `const` **flowCheckResultSchema**: `object`

#### Type Declaration

##### anyOf

> `readonly` **anyOf**: readonly \[\{ `additionalProperties`: `false`; `properties`: \{ `formatted`: \{ `type`: `"string"`; \}; `value`: \{ `additionalProperties`: \{ `$ref`: `string`; \}; `type`: `"object"`; \}; `warnings`: \{ `items`: \{ `additionalProperties`: `false`; `properties`: \{ `code`: \{ `type`: `"string"`; \}; `hint`: \{ `type`: `"string"`; \}; `message`: \{ `type`: `"string"`; \}; `path`: \{ `items`: \{ `anyOf`: readonly \[\{ `type`: ...; \}, \{ `type`: ...; \}\]; \}; `type`: `"array"`; \}; `severity`: \{ `enum`: readonly \[`"error"`, `"warning"`\]; `type`: `"string"`; \}; \}; `required`: readonly \[`"path"`, `"severity"`, `"code"`, `"message"`\]; `type`: `"object"`; \}; `type`: `"array"`; \}; \}; `required`: readonly \[`"value"`, `"warnings"`, `"formatted"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `formatted`: \{ `type`: `"string"`; \}; `issues`: \{ `items`: \{ `additionalProperties`: `false`; `properties`: \{ `code`: \{ `type`: `"string"`; \}; `hint`: \{ `type`: `"string"`; \}; `message`: \{ `type`: `"string"`; \}; `path`: \{ `items`: \{ `anyOf`: readonly \[\{ `type`: ...; \}, \{ `type`: ...; \}\]; \}; `type`: `"array"`; \}; `severity`: \{ `enum`: readonly \[`"error"`, `"warning"`\]; `type`: `"string"`; \}; \}; `required`: readonly \[`"path"`, `"severity"`, `"code"`, `"message"`\]; `type`: `"object"`; \}; `type`: `"array"`; \}; `warnings`: \{ `items`: \{ `additionalProperties`: `false`; `properties`: \{ `code`: \{ `type`: `"string"`; \}; `hint`: \{ `type`: `"string"`; \}; `message`: \{ `type`: `"string"`; \}; `path`: \{ `items`: \{ `anyOf`: readonly \[\{ `type`: ...; \}, \{ `type`: ...; \}\]; \}; `type`: `"array"`; \}; `severity`: \{ `enum`: readonly \[`"error"`, `"warning"`\]; `type`: `"string"`; \}; \}; `required`: readonly \[`"path"`, `"severity"`, `"code"`, `"message"`\]; `type`: `"object"`; \}; `type`: `"array"`; \}; \}; `required`: readonly \[`"issues"`, `"warnings"`, `"formatted"`\]; `type`: `"object"`; \}\]

##### definitions

> `readonly` **definitions**: `object` = `jsonDefinitions`

###### definitions.json

> `readonly` **json**: `object`

###### definitions.json.anyOf

> **anyOf**: (\{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"string"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"number"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"boolean"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"null"`; \} \| \{ `additionalProperties?`: `undefined`; `items`: \{ `$ref`: `string`; \}; `type`: `"array"`; \} \| \{ `additionalProperties`: \{ `$ref`: `string`; \}; `items?`: `undefined`; `type`: `"object"`; \})[]

##### type

> `readonly` **type**: `"object"` = `'object'`

***

### flowIssueSchema

> `const` **flowIssueSchema**: `object`

#### Type Declaration

##### additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

##### properties

> `readonly` **properties**: `object`

###### properties.code

> `readonly` **code**: `object`

###### properties.code.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.hint

> `readonly` **hint**: `object`

###### properties.hint.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.message

> `readonly` **message**: `object`

###### properties.message.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.path

> `readonly` **path**: `object`

###### properties.path.items

> `readonly` **items**: `object`

###### properties.path.items.anyOf

> `readonly` **anyOf**: readonly \[\{ `type`: `"string"`; \}, \{ `type`: `"number"`; \}\]

###### properties.path.type

> `readonly` **type**: `"array"` = `'array'`

###### properties.severity

> `readonly` **severity**: `object`

###### properties.severity.enum

> `readonly` **enum**: readonly \[`"error"`, `"warning"`\]

###### properties.severity.type

> `readonly` **type**: `"string"` = `'string'`

##### required

> `readonly` **required**: readonly \[`"path"`, `"severity"`, `"code"`, `"message"`\]

##### type

> `readonly` **type**: `"object"` = `'object'`

***

### flowRunSnapshotSchema

> `const` **flowRunSnapshotSchema**: `object`

#### Type Declaration

##### additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

##### definitions

> `readonly` **definitions**: `object` = `jsonDefinitions`

###### definitions.json

> `readonly` **json**: `object`

###### definitions.json.anyOf

> **anyOf**: (\{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"string"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"number"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"boolean"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"null"`; \} \| \{ `additionalProperties?`: `undefined`; `items`: \{ `$ref`: `string`; \}; `type`: `"array"`; \} \| \{ `additionalProperties`: \{ `$ref`: `string`; \}; `items?`: `undefined`; `type`: `"object"`; \})[]

##### properties

> `readonly` **properties**: `object`

###### properties.createdAt

> `readonly` **createdAt**: `object`

###### properties.createdAt.type

> `readonly` **type**: `"number"` = `'number'`

###### properties.error

> `readonly` **error**: `object`

###### properties.error.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### properties.error.properties

> `readonly` **properties**: `object`

###### properties.error.properties.code

> `readonly` **code**: `object`

###### properties.error.properties.code.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.error.properties.message

> `readonly` **message**: `object`

###### properties.error.properties.message.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.error.properties.type

> `readonly` **type**: `object`

###### properties.error.properties.type.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.error.required

> `readonly` **required**: readonly \[`"type"`, `"message"`\]

###### properties.error.type

> `readonly` **type**: `"object"` = `'object'`

###### properties.flowID

> `readonly` **flowID**: `object`

###### properties.flowID.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.label

> `readonly` **label**: `object`

###### properties.label.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.plan

> `readonly` **plan**: `object` = `runPlanSchema`

###### properties.plan.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### properties.plan.properties

> `readonly` **properties**: `object`

###### properties.plan.properties.tools

> `readonly` **tools**: `object`

###### properties.plan.properties.tools.items

> `readonly` **items**: `object`

###### properties.plan.properties.tools.items.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.plan.properties.tools.type

> `readonly` **type**: `"array"` = `'array'`

###### properties.plan.required

> `readonly` **required**: readonly \[`"tools"`\]

###### properties.plan.type

> `readonly` **type**: `"object"` = `'object'`

###### properties.result

> `readonly` **result**: `object`

###### properties.result.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### properties.result.properties

> `readonly` **properties**: `object`

###### properties.result.properties.content

> `readonly` **content**: `object`

###### properties.result.properties.content.items

> `readonly` **items**: `object` = `jsonObjectSchema`

###### properties.result.properties.content.items.additionalProperties

> `readonly` **additionalProperties**: `object` = `jsonValueSchema`

###### properties.result.properties.content.items.additionalProperties.$ref

> **$ref**: `string`

###### properties.result.properties.content.items.type

> `readonly` **type**: `"object"` = `'object'`

###### properties.result.properties.content.type

> `readonly` **type**: `"array"` = `'array'`

###### properties.result.properties.outcome

> `readonly` **outcome**: `object`

###### properties.result.properties.outcome.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.result.properties.output

> `readonly` **output**: `object` = `jsonValueSchema`

###### properties.result.properties.output.$ref

> **$ref**: `string`

###### properties.result.required

> `readonly` **required**: readonly \[`"content"`\]

###### properties.result.type

> `readonly` **type**: `"object"` = `'object'`

###### properties.runID

> `readonly` **runID**: `object`

###### properties.runID.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.state

> `readonly` **state**: `object` = `runStateSchema`

###### properties.state.enum

> `readonly` **enum**: readonly \[`"awaiting_approval"`, `"denied"`, `"working"`, `"input_required"`, `"completed"`, `"failed"`, `"cancelled"`\]

###### properties.state.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.traceID

> `readonly` **traceID**: `object`

###### properties.traceID.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.updatedAt

> `readonly` **updatedAt**: `object`

###### properties.updatedAt.type

> `readonly` **type**: `"number"` = `'number'`

##### required

> `readonly` **required**: readonly \[`"runID"`, `"label"`, `"state"`, `"createdAt"`, `"updatedAt"`, `"plan"`\]

##### type

> `readonly` **type**: `"object"` = `'object'`

***

### flowServiceStatusSchema

> `const` **flowServiceStatusSchema**: `object`

#### Type Declaration

##### anyOf

> `readonly` **anyOf**: readonly \[\{ `additionalProperties`: `false`; `properties`: \{ `state`: \{ `const`: `"starting"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"state"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `state`: \{ `const`: `"ready"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"state"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `error`: \{ `additionalProperties`: `false`; `properties`: \{ `issues`: \{ `items`: \{ `type`: `"string"`; \}; `type`: `"array"`; \}; `message`: \{ `type`: `"string"`; \}; `path`: \{ `type`: `"string"`; \}; `type`: \{ `type`: `"string"`; \}; \}; `required`: readonly \[`"type"`, `"message"`\]; `type`: `"object"`; \}; `state`: \{ `const`: `"failed"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"state"`, `"error"`\]; `type`: `"object"`; \}\]

***

### flowSummarySchema

> `const` **flowSummarySchema**: `object`

#### Type Declaration

##### additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

##### definitions

> `readonly` **definitions**: `object` = `jsonDefinitions`

###### definitions.json

> `readonly` **json**: `object`

###### definitions.json.anyOf

> **anyOf**: (\{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"string"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"number"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"boolean"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"null"`; \} \| \{ `additionalProperties?`: `undefined`; `items`: \{ `$ref`: `string`; \}; `type`: `"array"`; \} \| \{ `additionalProperties`: \{ `$ref`: `string`; \}; `items?`: `undefined`; `type`: `"object"`; \})[]

##### properties

> `readonly` **properties**: `object`

###### properties.id

> `readonly` **id**: `object`

###### properties.id.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.input

> `readonly` **input**: `object` = `jsonObjectSchema`

###### properties.input.additionalProperties

> `readonly` **additionalProperties**: `object` = `jsonValueSchema`

###### properties.input.additionalProperties.$ref

> **$ref**: `string`

###### properties.input.type

> `readonly` **type**: `"object"` = `'object'`

###### properties.name

> `readonly` **name**: `object`

###### properties.name.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.outcomes

> `readonly` **outcomes**: `object`

###### properties.outcomes.items

> `readonly` **items**: `object`

###### properties.outcomes.items.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.outcomes.type

> `readonly` **type**: `"array"` = `'array'`

###### properties.outputs

> `readonly` **outputs**: `object`

###### properties.outputs.items

> `readonly` **items**: `object`

###### properties.outputs.items.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.outputs.type

> `readonly` **type**: `"array"` = `'array'`

###### properties.version

> `readonly` **version**: `object`

###### properties.version.type

> `readonly` **type**: `"number"` = `'number'`

##### required

> `readonly` **required**: readonly \[`"id"`, `"name"`, `"version"`, `"input"`, `"outputs"`, `"outcomes"`\]

##### type

> `readonly` **type**: `"object"` = `'object'`

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

> `readonly` **anyOf**: readonly \[\{ `additionalProperties`: `false`; `properties`: \{ `data`: \{ `additionalProperties`: `false`; `properties`: \{ `args`: \{ `items`: \{ `type`: `"string"`; \}; `type`: `"array"`; \}; `command`: \{ `type`: `"string"`; \}; `transport`: \{ `const`: `"stdio"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"transport"`, `"command"`, `"args"`\]; `type`: `"object"`; \}; `meta`: \{ `additionalProperties`: `false`; `properties`: \{ `contextID`: \{ `type`: `"string"`; \}; `eventID`: \{ `type`: `"string"`; \}; `time`: \{ `type`: `"integer"`; \}; \}; `required`: readonly \[`"contextID"`, `"eventID"`, `"time"`\]; `type`: `"object"`; \}; `type`: \{ `const`: `"context:start"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"type"`, `"meta"`, `"data"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `data`: \{ `additionalProperties`: `false`; `properties`: \{ `service`: \{ `const`: `"flow"`; `type`: `"string"`; \}; `status`: \{ `anyOf`: readonly \[\{ `additionalProperties`: `false`; `properties`: \{ `state`: \{ `const`: ...; `type`: ...; \}; \}; `required`: readonly \[`"state"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `state`: \{ `const`: ...; `type`: ...; \}; \}; `required`: readonly \[`"state"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `error`: \{ `additionalProperties`: ...; `properties`: ...; `required`: ...; `type`: ...; \}; `state`: \{ `const`: ...; `type`: ...; \}; \}; `required`: readonly \[`"state"`, `"error"`\]; `type`: `"object"`; \}\]; \}; \}; `required`: readonly \[`"service"`, `"status"`\]; `type`: `"object"`; \}; `meta`: \{ `additionalProperties`: `false`; `properties`: \{ `eventID`: \{ `type`: `"string"`; \}; `time`: \{ `type`: `"integer"`; \}; \}; `required`: readonly \[`"eventID"`, `"time"`\]; `type`: `"object"`; \}; `type`: \{ `const`: `"service:status"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"type"`, `"meta"`, `"data"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `data`: \{ `additionalProperties`: `false`; `definitions`: \{ `json`: \{ `anyOf`: (\{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"string"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"number"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"boolean"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"null"`; \} \| \{ `additionalProperties?`: `undefined`; `items`: \{ `$ref`: ...; \}; `type`: `"array"`; \} \| \{ `additionalProperties`: \{ `$ref`: ...; \}; `items?`: `undefined`; `type`: `"object"`; \})[]; \}; \}; `properties`: \{ `createdAt`: \{ `type`: `"number"`; \}; `error`: \{ `additionalProperties`: `false`; `properties`: \{ `code`: \{ `type`: `"string"`; \}; `message`: \{ `type`: `"string"`; \}; `type`: \{ `type`: `"string"`; \}; \}; `required`: readonly \[`"type"`, `"message"`\]; `type`: `"object"`; \}; `flowID`: \{ `type`: `"string"`; \}; `label`: \{ `type`: `"string"`; \}; `plan`: \{ `additionalProperties`: `false`; `properties`: \{ `tools`: \{ `items`: \{ `type`: `"string"`; \}; `type`: `"array"`; \}; \}; `required`: readonly \[`"tools"`\]; `type`: `"object"`; \}; `result`: \{ `additionalProperties`: `false`; `properties`: \{ `content`: \{ `items`: \{ `additionalProperties`: \{ `$ref`: ...; \}; `type`: `"object"`; \}; `type`: `"array"`; \}; `outcome`: \{ `type`: `"string"`; \}; `output`: \{ `$ref`: `string`; \}; \}; `required`: readonly \[`"content"`\]; `type`: `"object"`; \}; `runID`: \{ `type`: `"string"`; \}; `state`: \{ `enum`: readonly \[`"awaiting_approval"`, `"denied"`, `"working"`, `"input_required"`, `"completed"`, `"failed"`, `"cancelled"`\]; `type`: `"string"`; \}; `traceID`: \{ `type`: `"string"`; \}; `updatedAt`: \{ `type`: `"number"`; \}; \}; `required`: readonly \[`"runID"`, `"label"`, `"state"`, `"createdAt"`, `"updatedAt"`, `"plan"`\]; `type`: `"object"`; \}; `meta`: \{ `additionalProperties`: `false`; `properties`: \{ `eventID`: \{ `type`: `"string"`; \}; `time`: \{ `type`: `"integer"`; \}; \}; `required`: readonly \[`"eventID"`, `"time"`\]; `type`: `"object"`; \}; `type`: \{ `const`: `"run:state"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"type"`, `"meta"`, `"data"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `data`: \{ `anyOf`: readonly \[\{ `additionalProperties`: `false`; `properties`: \{ `createdAt`: \{ `type`: `"number"`; \}; `id`: \{ `type`: `"string"`; \}; `kind`: \{ `const`: `"approval"`; `type`: `"string"`; \}; `plan`: \{ `additionalProperties`: `false`; `properties`: \{ `tools`: \{ `items`: ...; `type`: ...; \}; \}; `required`: readonly \[`"tools"`\]; `type`: `"object"`; \}; `runID`: \{ `type`: `"string"`; \}; \}; `required`: readonly \[`"id"`, `"runID"`, `"kind"`, `"plan"`, `"createdAt"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `createdAt`: \{ `type`: `"number"`; \}; `id`: \{ `type`: `"string"`; \}; `inputKey`: \{ `type`: `"string"`; \}; `kind`: \{ `const`: `"input"`; `type`: `"string"`; \}; `message`: \{ `type`: `"string"`; \}; `requestedSchema`: \{ `additionalProperties`: \{ `$ref`: `string`; \}; `type`: `"object"`; \}; `runID`: \{ `type`: `"string"`; \}; \}; `required`: readonly \[`"id"`, `"runID"`, `"kind"`, `"inputKey"`, `"message"`, `"requestedSchema"`, `"createdAt"`\]; `type`: `"object"`; \}\]; `definitions`: \{ `json`: \{ `anyOf`: (\{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"string"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"number"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"boolean"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"null"`; \} \| \{ `additionalProperties?`: `undefined`; `items`: \{ `$ref`: ...; \}; `type`: `"array"`; \} \| \{ `additionalProperties`: \{ `$ref`: ...; \}; `items?`: `undefined`; `type`: `"object"`; \})[]; \}; \}; `type`: `"object"`; \}; `meta`: \{ `additionalProperties`: `false`; `properties`: \{ `eventID`: \{ `type`: `"string"`; \}; `time`: \{ `type`: `"integer"`; \}; \}; `required`: readonly \[`"eventID"`, `"time"`\]; `type`: `"object"`; \}; `type`: \{ `const`: `"inbox:added"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"type"`, `"meta"`, `"data"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `data`: \{ `additionalProperties`: `false`; `properties`: \{ `item`: \{ `anyOf`: readonly \[\{ `additionalProperties`: `false`; `properties`: \{ `createdAt`: \{ `type`: ...; \}; `id`: \{ `type`: ...; \}; `kind`: \{ `const`: ...; `type`: ...; \}; `plan`: \{ `additionalProperties`: ...; `properties`: ...; `required`: ...; `type`: ...; \}; `runID`: \{ `type`: ...; \}; \}; `required`: readonly \[`"id"`, `"runID"`, `"kind"`, `"plan"`, `"createdAt"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `createdAt`: \{ `type`: ...; \}; `id`: \{ `type`: ...; \}; `inputKey`: \{ `type`: ...; \}; `kind`: \{ `const`: ...; `type`: ...; \}; `message`: \{ `type`: ...; \}; `requestedSchema`: \{ `additionalProperties`: ...; `type`: ...; \}; `runID`: \{ `type`: ...; \}; \}; `required`: readonly \[`"id"`, `"runID"`, `"kind"`, `"inputKey"`, `"message"`, `"requestedSchema"`, `"createdAt"`\]; `type`: `"object"`; \}\]; `definitions`: \{ `json`: \{ `anyOf`: (... \| ... \| ... \| ... \| ... \| ...)[]; \}; \}; `type`: `"object"`; \}; `outcome`: \{ `enum`: readonly \[`"answered"`, `"declined"`, `"cancelled"`, `"withdrawn"`\]; `type`: `"string"`; \}; \}; `required`: readonly \[`"item"`, `"outcome"`\]; `type`: `"object"`; \}; `meta`: \{ `additionalProperties`: `false`; `properties`: \{ `eventID`: \{ `type`: `"string"`; \}; `time`: \{ `type`: `"integer"`; \}; \}; `required`: readonly \[`"eventID"`, `"time"`\]; `type`: `"object"`; \}; `type`: \{ `const`: `"inbox:settled"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"type"`, `"meta"`, `"data"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `meta`: \{ `additionalProperties`: `false`; `properties`: \{ `contextID`: \{ `type`: `"string"`; \}; `eventID`: \{ `type`: `"string"`; \}; `time`: \{ `type`: `"integer"`; \}; \}; `required`: readonly \[`"contextID"`, `"eventID"`, `"time"`\]; `type`: `"object"`; \}; `type`: \{ `const`: `"context:stop"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"type"`, `"meta"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `data`: \{ `additionalProperties`: `false`; `properties`: \{ `from`: \{ `enum`: readonly \[`"client"`, `"server"`\]; `type`: `"string"`; \}; `message`: \{ `type`: `"object"`; \}; \}; `required`: readonly \[`"from"`, `"message"`\]; `type`: `"object"`; \}; `meta`: \{ `additionalProperties`: `false`; `properties`: \{ `contextID`: \{ `type`: `"string"`; \}; `eventID`: \{ `type`: `"string"`; \}; `time`: \{ `type`: `"integer"`; \}; \}; `required`: readonly \[`"contextID"`, `"eventID"`, `"time"`\]; `type`: `"object"`; \}; `type`: \{ `const`: `"context:message"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"type"`, `"meta"`, `"data"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `data`: \{ `additionalProperties`: `false`; `definitions`: \{ `json`: \{ `anyOf`: (\{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"string"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"number"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"boolean"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"null"`; \} \| \{ `additionalProperties?`: `undefined`; `items`: \{ `$ref`: ...; \}; `type`: `"array"`; \} \| \{ `additionalProperties`: \{ `$ref`: ...; \}; `items?`: `undefined`; `type`: `"object"`; \})[]; \}; \}; `properties`: \{ `attributes`: \{ `additionalProperties`: \{ `$ref`: `string`; \}; `type`: `"object"`; \}; `kind`: \{ `type`: `"number"`; \}; `links`: \{ `items`: \{ `additionalProperties`: `false`; `properties`: \{ `spanID`: \{ `type`: `"string"`; \}; `traceID`: \{ `type`: `"string"`; \}; \}; `required`: readonly \[`"traceID"`, `"spanID"`\]; `type`: `"object"`; \}; `type`: `"array"`; \}; `name`: \{ `type`: `"string"`; \}; `parentSpanID`: \{ `type`: `"string"`; \}; `spanID`: \{ `type`: `"string"`; \}; `startTime`: \{ `type`: `"number"`; \}; `traceID`: \{ `type`: `"string"`; \}; \}; `required`: readonly \[`"traceID"`, `"spanID"`, `"name"`, `"kind"`, `"startTime"`, `"attributes"`, `"links"`\]; `type`: `"object"`; \}; `meta`: \{ `additionalProperties`: `false`; `properties`: \{ `eventID`: \{ `type`: `"string"`; \}; `time`: \{ `type`: `"integer"`; \}; \}; `required`: readonly \[`"eventID"`, `"time"`\]; `type`: `"object"`; \}; `type`: \{ `const`: `"span:start"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"type"`, `"meta"`, `"data"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `data`: \{ `additionalProperties`: `false`; `definitions`: \{ `json`: \{ `anyOf`: (\{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"string"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"number"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"boolean"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"null"`; \} \| \{ `additionalProperties?`: `undefined`; `items`: \{ `$ref`: ...; \}; `type`: `"array"`; \} \| \{ `additionalProperties`: \{ `$ref`: ...; \}; `items?`: `undefined`; `type`: `"object"`; \})[]; \}; \}; `properties`: \{ `attributes`: \{ `additionalProperties`: \{ `$ref`: `string`; \}; `type`: `"object"`; \}; `endTime`: \{ `type`: `"number"`; \}; `events`: \{ `items`: \{ `additionalProperties`: `false`; `properties`: \{ `attributes`: \{ `additionalProperties`: \{ `$ref`: ...; \}; `type`: `"object"`; \}; `name`: \{ `type`: `"string"`; \}; `time`: \{ `type`: `"number"`; \}; \}; `required`: readonly \[`"name"`, `"time"`, `"attributes"`\]; `type`: `"object"`; \}; `type`: `"array"`; \}; `kind`: \{ `type`: `"number"`; \}; `links`: \{ `items`: \{ `additionalProperties`: `false`; `properties`: \{ `spanID`: \{ `type`: `"string"`; \}; `traceID`: \{ `type`: `"string"`; \}; \}; `required`: readonly \[`"traceID"`, `"spanID"`\]; `type`: `"object"`; \}; `type`: `"array"`; \}; `name`: \{ `type`: `"string"`; \}; `parentSpanID`: \{ `type`: `"string"`; \}; `spanID`: \{ `type`: `"string"`; \}; `startTime`: \{ `type`: `"number"`; \}; `status`: \{ `additionalProperties`: `false`; `properties`: \{ `code`: \{ `type`: `"number"`; \}; `message`: \{ `type`: `"string"`; \}; \}; `required`: readonly \[`"code"`\]; `type`: `"object"`; \}; `traceID`: \{ `type`: `"string"`; \}; \}; `required`: readonly \[`"traceID"`, `"spanID"`, `"name"`, `"kind"`, `"startTime"`, `"endTime"`, `"status"`, `"attributes"`, `"events"`, `"links"`\]; `type`: `"object"`; \}; `meta`: \{ `additionalProperties`: `false`; `properties`: \{ `eventID`: \{ `type`: `"string"`; \}; `time`: \{ `type`: `"integer"`; \}; \}; `required`: readonly \[`"eventID"`, `"time"`\]; `type`: `"object"`; \}; `type`: \{ `const`: `"span:end"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"type"`, `"meta"`, `"data"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `data`: \{ `additionalProperties`: `false`; `definitions`: \{ `json`: \{ `anyOf`: (\{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"string"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"number"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"boolean"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"null"`; \} \| \{ `additionalProperties?`: `undefined`; `items`: \{ `$ref`: ...; \}; `type`: `"array"`; \} \| \{ `additionalProperties`: \{ `$ref`: ...; \}; `items?`: `undefined`; `type`: `"object"`; \})[]; \}; \}; `properties`: \{ `category`: \{ `items`: \{ `type`: `"string"`; \}; `type`: `"array"`; \}; `level`: \{ `enum`: readonly \[`"trace"`, `"debug"`, `"info"`, `"warning"`, `"error"`, `"fatal"`\]; `type`: `"string"`; \}; `logID`: \{ `type`: `"string"`; \}; `message`: \{ `type`: `"string"`; \}; `properties`: \{ `additionalProperties`: \{ `$ref`: `string`; \}; `type`: `"object"`; \}; `spanID`: \{ `type`: `"string"`; \}; `timestamp`: \{ `type`: `"number"`; \}; `traceID`: \{ `type`: `"string"`; \}; \}; `required`: readonly \[`"traceID"`, `"spanID"`, `"timestamp"`, `"level"`, `"category"`, `"message"`, `"properties"`, `"logID"`\]; `type`: `"object"`; \}; `meta`: \{ `additionalProperties`: `false`; `properties`: \{ `eventID`: \{ `type`: `"string"`; \}; `time`: \{ `type`: `"integer"`; \}; \}; `required`: readonly \[`"eventID"`, `"time"`\]; `type`: `"object"`; \}; `type`: \{ `const`: `"log"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"type"`, `"meta"`, `"data"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `data`: \{ `additionalProperties`: `false`; `definitions`: \{ `json`: \{ `anyOf`: (\{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"string"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"number"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"boolean"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"null"`; \} \| \{ `additionalProperties?`: `undefined`; `items`: \{ `$ref`: ...; \}; `type`: `"array"`; \} \| \{ `additionalProperties`: \{ `$ref`: ...; \}; `items?`: `undefined`; `type`: `"object"`; \})[]; \}; \}; `properties`: \{ `active`: \{ `type`: `"boolean"`; \}; `activeSegmentSpanID`: \{ `type`: `"string"`; \}; `attributes`: \{ `additionalProperties`: `false`; `properties`: \{ `label`: \{ `type`: `"string"`; \}; `mokei.context.id`: \{ `type`: `"string"`; \}; `mokei.flow.id`: \{ `type`: `"string"`; \}; `mokei.run.id`: \{ `type`: `"string"`; \}; \}; `type`: `"object"`; \}; `droppedCount`: \{ `type`: `"integer"`; \}; `endTime`: \{ `type`: `"number"`; \}; `errorCount`: \{ `type`: `"integer"`; \}; `kind`: \{ `enum`: readonly \[`"context"`, `"mcp"`, `"flow"`, `"step"`\]; `type`: `"string"`; \}; `name`: \{ `type`: `"string"`; \}; `outcome`: \{ `enum`: readonly \[`"ok"`, `"error"`, `"interrupted"`, `null`\]; `type`: readonly \[`"string"`, `"null"`\]; \}; `revision`: \{ `type`: `"integer"`; \}; `rootSpanID`: \{ `type`: `"string"`; \}; `spanCount`: \{ `type`: `"integer"`; \}; `startTime`: \{ `type`: `"number"`; \}; `traceID`: \{ `type`: `"string"`; \}; \}; `required`: readonly \[`"traceID"`, `"rootSpanID"`, `"kind"`, `"name"`, `"active"`, `"outcome"`, `"startTime"`, `"attributes"`, `"spanCount"`, `"errorCount"`, `"droppedCount"`, `"revision"`\]; `type`: `"object"`; \}; `meta`: \{ `additionalProperties`: `false`; `properties`: \{ `eventID`: \{ `type`: `"string"`; \}; `time`: \{ `type`: `"integer"`; \}; \}; `required`: readonly \[`"eventID"`, `"time"`\]; `type`: `"object"`; \}; `type`: \{ `const`: `"trace:summary"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"type"`, `"meta"`, `"data"`\]; `type`: `"object"`; \}\]

##### definitions

> `readonly` **definitions**: `object` = `jsonDefinitions`

###### definitions.json

> `readonly` **json**: `object`

###### definitions.json.anyOf

> **anyOf**: (\{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"string"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"number"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"boolean"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"null"`; \} \| \{ `additionalProperties?`: `undefined`; `items`: \{ `$ref`: `string`; \}; `type`: `"array"`; \} \| \{ `additionalProperties`: \{ `$ref`: `string`; \}; `items?`: `undefined`; `type`: `"object"`; \})[]

##### type

> `readonly` **type**: `"object"` = `'object'`

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

###### properties.flowService

> `readonly` **flowService**: `object` = `flowServiceStatusSchema`

###### properties.flowService.anyOf

> `readonly` **anyOf**: readonly \[\{ `additionalProperties`: `false`; `properties`: \{ `state`: \{ `const`: `"starting"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"state"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `state`: \{ `const`: `"ready"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"state"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `error`: \{ `additionalProperties`: `false`; `properties`: \{ `issues`: \{ `items`: \{ `type`: `"string"`; \}; `type`: `"array"`; \}; `message`: \{ `type`: `"string"`; \}; `path`: \{ `type`: `"string"`; \}; `type`: \{ `type`: `"string"`; \}; \}; `required`: readonly \[`"type"`, `"message"`\]; `type`: `"object"`; \}; `state`: \{ `const`: `"failed"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"state"`, `"error"`\]; `type`: `"object"`; \}\]

###### properties.startedTime

> `readonly` **startedTime**: `object`

###### properties.startedTime.type

> `readonly` **type**: `"integer"` = `'integer'`

###### properties.tracing

> `readonly` **tracing**: `object` = `tracingInfoSchema`

###### properties.tracing.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### properties.tracing.properties

> `readonly` **properties**: `object`

###### properties.tracing.properties.droppedCount

> `readonly` **droppedCount**: `object`

###### properties.tracing.properties.droppedCount.type

> `readonly` **type**: `"integer"` = `'integer'`

###### properties.tracing.properties.lostSummaryCount

> `readonly` **lostSummaryCount**: `object`

###### properties.tracing.properties.lostSummaryCount.type

> `readonly` **type**: `"integer"` = `'integer'`

###### properties.tracing.required

> `readonly` **required**: readonly \[`"lostSummaryCount"`, `"droppedCount"`\]

###### properties.tracing.type

> `readonly` **type**: `"object"` = `'object'`

##### required

> `readonly` **required**: readonly \[`"activeContexts"`, `"startedTime"`, `"flowService"`\]

##### type

> `readonly` **type**: `"object"` = `'object'`

***

### inboxItemSchema

> `const` **inboxItemSchema**: `object`

#### Type Declaration

##### anyOf

> `readonly` **anyOf**: readonly \[\{ `additionalProperties`: `false`; `properties`: \{ `createdAt`: \{ `type`: `"number"`; \}; `id`: \{ `type`: `"string"`; \}; `kind`: \{ `const`: `"approval"`; `type`: `"string"`; \}; `plan`: \{ `additionalProperties`: `false`; `properties`: \{ `tools`: \{ `items`: \{ `type`: `"string"`; \}; `type`: `"array"`; \}; \}; `required`: readonly \[`"tools"`\]; `type`: `"object"`; \}; `runID`: \{ `type`: `"string"`; \}; \}; `required`: readonly \[`"id"`, `"runID"`, `"kind"`, `"plan"`, `"createdAt"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `createdAt`: \{ `type`: `"number"`; \}; `id`: \{ `type`: `"string"`; \}; `inputKey`: \{ `type`: `"string"`; \}; `kind`: \{ `const`: `"input"`; `type`: `"string"`; \}; `message`: \{ `type`: `"string"`; \}; `requestedSchema`: \{ `additionalProperties`: \{ `$ref`: `string`; \}; `type`: `"object"`; \}; `runID`: \{ `type`: `"string"`; \}; \}; `required`: readonly \[`"id"`, `"runID"`, `"kind"`, `"inputKey"`, `"message"`, `"requestedSchema"`, `"createdAt"`\]; `type`: `"object"`; \}\]

##### definitions

> `readonly` **definitions**: `object` = `jsonDefinitions`

###### definitions.json

> `readonly` **json**: `object`

###### definitions.json.anyOf

> **anyOf**: (\{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"string"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"number"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"boolean"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"null"`; \} \| \{ `additionalProperties?`: `undefined`; `items`: \{ `$ref`: `string`; \}; `type`: `"array"`; \} \| \{ `additionalProperties`: \{ `$ref`: `string`; \}; `items?`: `undefined`; `type`: `"object"`; \})[]

##### type

> `readonly` **type**: `"object"` = `'object'`

***

### monitorAttachParamSchema

> `const` **monitorAttachParamSchema**: `object`

#### Type Declaration

##### additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

##### properties

> `readonly` **properties**: `object`

###### properties.url

> `readonly` **url**: `object`

###### properties.url.type

> `readonly` **type**: `"string"` = `'string'`

##### required

> `readonly` **required**: readonly \[`"url"`\]

##### type

> `readonly` **type**: `"object"` = `'object'`

***

### monitorAttachReceiveSchema

> `const` **monitorAttachReceiveSchema**: `object`

#### Type Declaration

##### additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

##### properties

> `readonly` **properties**: `object`

###### properties.attachmentID

> `readonly` **attachmentID**: `object`

###### properties.attachmentID.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.type

> `readonly` **type**: `object`

###### properties.type.const

> `readonly` **const**: `"attached"` = `'attached'`

###### properties.type.type

> `readonly` **type**: `"string"` = `'string'`

##### required

> `readonly` **required**: readonly \[`"type"`, `"attachmentID"`\]

##### type

> `readonly` **type**: `"object"` = `'object'`

***

### monitorPresenceParamSchema

> `const` **monitorPresenceParamSchema**: `object`

#### Type Declaration

##### additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

##### properties

> `readonly` **properties**: `object`

###### properties.attachmentID

> `readonly` **attachmentID**: `object`

###### properties.attachmentID.type

> `readonly` **type**: `"string"` = `'string'`

##### type

> `readonly` **type**: `"object"` = `'object'`

***

### monitorPresenceReceiveSchema

> `const` **monitorPresenceReceiveSchema**: `object`

#### Type Declaration

##### anyOf

> `readonly` **anyOf**: readonly \[\{ `additionalProperties`: `false`; `properties`: \{ `nonce`: \{ `type`: `"string"`; \}; `type`: \{ `const`: `"ping"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"type"`, `"nonce"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `attemptID`: \{ `type`: `"string"`; \}; `deadline`: \{ `type`: `"number"`; \}; `itemID`: \{ `type`: `"string"`; \}; `message`: \{ `type`: `"string"`; \}; `title`: \{ `type`: `"string"`; \}; `type`: \{ `const`: `"notify"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"type"`, `"attemptID"`, `"deadline"`, `"itemID"`, `"title"`, `"message"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `attemptID`: \{ `type`: `"string"`; \}; `deadline`: \{ `type`: `"number"`; \}; `itemID`: \{ `type`: `"string"`; \}; `type`: \{ `const`: `"prompt"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"type"`, `"attemptID"`, `"deadline"`, `"itemID"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `attemptID`: \{ `type`: `"string"`; \}; `type`: \{ `const`: `"withdraw"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"type"`, `"attemptID"`\]; `type`: `"object"`; \}\]

***

### monitorPresenceSendSchema

> `const` **monitorPresenceSendSchema**: `object`

#### Type Declaration

##### anyOf

> `readonly` **anyOf**: readonly \[\{ `additionalProperties`: `false`; `properties`: \{ `activeItemID`: \{ `type`: `"string"`; \}; `canNotify`: \{ `type`: `"boolean"`; \}; `type`: \{ `const`: `"state"`; `type`: `"string"`; \}; `visible`: \{ `type`: `"boolean"`; \}; \}; `required`: readonly \[`"type"`, `"visible"`, `"canNotify"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `nonce`: \{ `type`: `"string"`; \}; `type`: \{ `const`: `"pong"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"type"`, `"nonce"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `attemptID`: \{ `type`: `"string"`; \}; `shown`: \{ `type`: `"boolean"`; \}; `type`: \{ `const`: `"ack"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"type"`, `"attemptID"`, `"shown"`\]; `type`: `"object"`; \}\]

***

### openSpanSchema

> `const` **openSpanSchema**: `object`

#### Type Declaration

##### additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

##### definitions

> `readonly` **definitions**: `object` = `jsonDefinitions`

###### definitions.json

> `readonly` **json**: `object`

###### definitions.json.anyOf

> **anyOf**: (\{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"string"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"number"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"boolean"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"null"`; \} \| \{ `additionalProperties?`: `undefined`; `items`: \{ `$ref`: `string`; \}; `type`: `"array"`; \} \| \{ `additionalProperties`: \{ `$ref`: `string`; \}; `items?`: `undefined`; `type`: `"object"`; \})[]

##### properties

> `readonly` **properties**: `object`

###### properties.attributes

> `readonly` **attributes**: `object` = `jsonObjectSchema`

###### properties.attributes.additionalProperties

> `readonly` **additionalProperties**: `object` = `jsonValueSchema`

###### properties.attributes.additionalProperties.$ref

> **$ref**: `string`

###### properties.attributes.type

> `readonly` **type**: `"object"` = `'object'`

###### properties.kind

> `readonly` **kind**: `object`

###### properties.kind.type

> `readonly` **type**: `"number"` = `'number'`

###### properties.links

> `readonly` **links**: `object`

###### properties.links.items

> `readonly` **items**: `object` = `storedSpanSchema.properties.links.items`

###### properties.links.items.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### properties.links.items.properties

> `readonly` **properties**: `object`

###### properties.links.items.properties.spanID

> `readonly` **spanID**: `object`

###### properties.links.items.properties.spanID.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.links.items.properties.traceID

> `readonly` **traceID**: `object`

###### properties.links.items.properties.traceID.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.links.items.required

> `readonly` **required**: readonly \[`"traceID"`, `"spanID"`\]

###### properties.links.items.type

> `readonly` **type**: `"object"` = `'object'`

###### properties.links.type

> `readonly` **type**: `"array"` = `'array'`

###### properties.name

> `readonly` **name**: `object`

###### properties.name.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.parentSpanID

> `readonly` **parentSpanID**: `object`

###### properties.parentSpanID.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.spanID

> `readonly` **spanID**: `object`

###### properties.spanID.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.startTime

> `readonly` **startTime**: `object`

###### properties.startTime.type

> `readonly` **type**: `"number"` = `'number'`

###### properties.traceID

> `readonly` **traceID**: `object`

###### properties.traceID.type

> `readonly` **type**: `"string"` = `'string'`

##### required

> `readonly` **required**: readonly \[`"traceID"`, `"spanID"`, `"name"`, `"kind"`, `"startTime"`, `"attributes"`, `"links"`\]

##### type

> `readonly` **type**: `"object"` = `'object'`

***

### protocol

> `const` **protocol**: `object`

#### Type Declaration

##### events

> `readonly` **events**: `object`

###### events.receive

> `readonly` **receive**: `object` = `hostEventSchema`

###### events.receive.anyOf

> `readonly` **anyOf**: readonly \[\{ `additionalProperties`: `false`; `properties`: \{ `data`: \{ `additionalProperties`: `false`; `properties`: \{ `args`: \{ `items`: \{ `type`: `"string"`; \}; `type`: `"array"`; \}; `command`: \{ `type`: `"string"`; \}; `transport`: \{ `const`: `"stdio"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"transport"`, `"command"`, `"args"`\]; `type`: `"object"`; \}; `meta`: \{ `additionalProperties`: `false`; `properties`: \{ `contextID`: \{ `type`: `"string"`; \}; `eventID`: \{ `type`: `"string"`; \}; `time`: \{ `type`: `"integer"`; \}; \}; `required`: readonly \[`"contextID"`, `"eventID"`, `"time"`\]; `type`: `"object"`; \}; `type`: \{ `const`: `"context:start"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"type"`, `"meta"`, `"data"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `data`: \{ `additionalProperties`: `false`; `properties`: \{ `service`: \{ `const`: `"flow"`; `type`: `"string"`; \}; `status`: \{ `anyOf`: readonly \[\{ `additionalProperties`: ...; `properties`: ...; `required`: ...; `type`: ...; \}, \{ `additionalProperties`: ...; `properties`: ...; `required`: ...; `type`: ...; \}, \{ `additionalProperties`: ...; `properties`: ...; `required`: ...; `type`: ...; \}\]; \}; \}; `required`: readonly \[`"service"`, `"status"`\]; `type`: `"object"`; \}; `meta`: \{ `additionalProperties`: `false`; `properties`: \{ `eventID`: \{ `type`: `"string"`; \}; `time`: \{ `type`: `"integer"`; \}; \}; `required`: readonly \[`"eventID"`, `"time"`\]; `type`: `"object"`; \}; `type`: \{ `const`: `"service:status"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"type"`, `"meta"`, `"data"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `data`: \{ `additionalProperties`: `false`; `definitions`: \{ `json`: \{ `anyOf`: (... \| ... \| ... \| ... \| ... \| ...)[]; \}; \}; `properties`: \{ `createdAt`: \{ `type`: `"number"`; \}; `error`: \{ `additionalProperties`: `false`; `properties`: \{ `code`: \{ `type`: ...; \}; `message`: \{ `type`: ...; \}; `type`: \{ `type`: ...; \}; \}; `required`: readonly \[`"type"`, `"message"`\]; `type`: `"object"`; \}; `flowID`: \{ `type`: `"string"`; \}; `label`: \{ `type`: `"string"`; \}; `plan`: \{ `additionalProperties`: `false`; `properties`: \{ `tools`: \{ `items`: ...; `type`: ...; \}; \}; `required`: readonly \[`"tools"`\]; `type`: `"object"`; \}; `result`: \{ `additionalProperties`: `false`; `properties`: \{ `content`: \{ `items`: ...; `type`: ...; \}; `outcome`: \{ `type`: ...; \}; `output`: \{ `$ref`: ...; \}; \}; `required`: readonly \[`"content"`\]; `type`: `"object"`; \}; `runID`: \{ `type`: `"string"`; \}; `state`: \{ `enum`: readonly \[`"awaiting_approval"`, `"denied"`, `"working"`, `"input_required"`, `"completed"`, `"failed"`, `"cancelled"`\]; `type`: `"string"`; \}; `traceID`: \{ `type`: `"string"`; \}; `updatedAt`: \{ `type`: `"number"`; \}; \}; `required`: readonly \[`"runID"`, `"label"`, `"state"`, `"createdAt"`, `"updatedAt"`, `"plan"`\]; `type`: `"object"`; \}; `meta`: \{ `additionalProperties`: `false`; `properties`: \{ `eventID`: \{ `type`: `"string"`; \}; `time`: \{ `type`: `"integer"`; \}; \}; `required`: readonly \[`"eventID"`, `"time"`\]; `type`: `"object"`; \}; `type`: \{ `const`: `"run:state"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"type"`, `"meta"`, `"data"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `data`: \{ `anyOf`: readonly \[\{ `additionalProperties`: `false`; `properties`: \{ `createdAt`: \{ `type`: ...; \}; `id`: \{ `type`: ...; \}; `kind`: \{ `const`: ...; `type`: ...; \}; `plan`: \{ `additionalProperties`: ...; `properties`: ...; `required`: ...; `type`: ...; \}; `runID`: \{ `type`: ...; \}; \}; `required`: readonly \[`"id"`, `"runID"`, `"kind"`, `"plan"`, `"createdAt"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `createdAt`: \{ `type`: ...; \}; `id`: \{ `type`: ...; \}; `inputKey`: \{ `type`: ...; \}; `kind`: \{ `const`: ...; `type`: ...; \}; `message`: \{ `type`: ...; \}; `requestedSchema`: \{ `additionalProperties`: ...; `type`: ...; \}; `runID`: \{ `type`: ...; \}; \}; `required`: readonly \[`"id"`, `"runID"`, `"kind"`, `"inputKey"`, `"message"`, `"requestedSchema"`, `"createdAt"`\]; `type`: `"object"`; \}\]; `definitions`: \{ `json`: \{ `anyOf`: (... \| ... \| ... \| ... \| ... \| ...)[]; \}; \}; `type`: `"object"`; \}; `meta`: \{ `additionalProperties`: `false`; `properties`: \{ `eventID`: \{ `type`: `"string"`; \}; `time`: \{ `type`: `"integer"`; \}; \}; `required`: readonly \[`"eventID"`, `"time"`\]; `type`: `"object"`; \}; `type`: \{ `const`: `"inbox:added"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"type"`, `"meta"`, `"data"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `data`: \{ `additionalProperties`: `false`; `properties`: \{ `item`: \{ `anyOf`: readonly \[\{ `additionalProperties`: ...; `properties`: ...; `required`: ...; `type`: ...; \}, \{ `additionalProperties`: ...; `properties`: ...; `required`: ...; `type`: ...; \}\]; `definitions`: \{ `json`: \{ `anyOf`: ...; \}; \}; `type`: `"object"`; \}; `outcome`: \{ `enum`: readonly \[`"answered"`, `"declined"`, `"cancelled"`, `"withdrawn"`\]; `type`: `"string"`; \}; \}; `required`: readonly \[`"item"`, `"outcome"`\]; `type`: `"object"`; \}; `meta`: \{ `additionalProperties`: `false`; `properties`: \{ `eventID`: \{ `type`: `"string"`; \}; `time`: \{ `type`: `"integer"`; \}; \}; `required`: readonly \[`"eventID"`, `"time"`\]; `type`: `"object"`; \}; `type`: \{ `const`: `"inbox:settled"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"type"`, `"meta"`, `"data"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `meta`: \{ `additionalProperties`: `false`; `properties`: \{ `contextID`: \{ `type`: `"string"`; \}; `eventID`: \{ `type`: `"string"`; \}; `time`: \{ `type`: `"integer"`; \}; \}; `required`: readonly \[`"contextID"`, `"eventID"`, `"time"`\]; `type`: `"object"`; \}; `type`: \{ `const`: `"context:stop"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"type"`, `"meta"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `data`: \{ `additionalProperties`: `false`; `properties`: \{ `from`: \{ `enum`: readonly \[`"client"`, `"server"`\]; `type`: `"string"`; \}; `message`: \{ `type`: `"object"`; \}; \}; `required`: readonly \[`"from"`, `"message"`\]; `type`: `"object"`; \}; `meta`: \{ `additionalProperties`: `false`; `properties`: \{ `contextID`: \{ `type`: `"string"`; \}; `eventID`: \{ `type`: `"string"`; \}; `time`: \{ `type`: `"integer"`; \}; \}; `required`: readonly \[`"contextID"`, `"eventID"`, `"time"`\]; `type`: `"object"`; \}; `type`: \{ `const`: `"context:message"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"type"`, `"meta"`, `"data"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `data`: \{ `additionalProperties`: `false`; `definitions`: \{ `json`: \{ `anyOf`: (... \| ... \| ... \| ... \| ... \| ...)[]; \}; \}; `properties`: \{ `attributes`: \{ `additionalProperties`: \{ `$ref`: `string`; \}; `type`: `"object"`; \}; `kind`: \{ `type`: `"number"`; \}; `links`: \{ `items`: \{ `additionalProperties`: `false`; `properties`: \{ `spanID`: ...; `traceID`: ...; \}; `required`: readonly \[..., ...\]; `type`: `"object"`; \}; `type`: `"array"`; \}; `name`: \{ `type`: `"string"`; \}; `parentSpanID`: \{ `type`: `"string"`; \}; `spanID`: \{ `type`: `"string"`; \}; `startTime`: \{ `type`: `"number"`; \}; `traceID`: \{ `type`: `"string"`; \}; \}; `required`: readonly \[`"traceID"`, `"spanID"`, `"name"`, `"kind"`, `"startTime"`, `"attributes"`, `"links"`\]; `type`: `"object"`; \}; `meta`: \{ `additionalProperties`: `false`; `properties`: \{ `eventID`: \{ `type`: `"string"`; \}; `time`: \{ `type`: `"integer"`; \}; \}; `required`: readonly \[`"eventID"`, `"time"`\]; `type`: `"object"`; \}; `type`: \{ `const`: `"span:start"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"type"`, `"meta"`, `"data"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `data`: \{ `additionalProperties`: `false`; `definitions`: \{ `json`: \{ `anyOf`: (... \| ... \| ... \| ... \| ... \| ...)[]; \}; \}; `properties`: \{ `attributes`: \{ `additionalProperties`: \{ `$ref`: `string`; \}; `type`: `"object"`; \}; `endTime`: \{ `type`: `"number"`; \}; `events`: \{ `items`: \{ `additionalProperties`: `false`; `properties`: \{ `attributes`: ...; `name`: ...; `time`: ...; \}; `required`: readonly \[..., ..., ...\]; `type`: `"object"`; \}; `type`: `"array"`; \}; `kind`: \{ `type`: `"number"`; \}; `links`: \{ `items`: \{ `additionalProperties`: `false`; `properties`: \{ `spanID`: ...; `traceID`: ...; \}; `required`: readonly \[..., ...\]; `type`: `"object"`; \}; `type`: `"array"`; \}; `name`: \{ `type`: `"string"`; \}; `parentSpanID`: \{ `type`: `"string"`; \}; `spanID`: \{ `type`: `"string"`; \}; `startTime`: \{ `type`: `"number"`; \}; `status`: \{ `additionalProperties`: `false`; `properties`: \{ `code`: \{ `type`: ...; \}; `message`: \{ `type`: ...; \}; \}; `required`: readonly \[`"code"`\]; `type`: `"object"`; \}; `traceID`: \{ `type`: `"string"`; \}; \}; `required`: readonly \[`"traceID"`, `"spanID"`, `"name"`, `"kind"`, `"startTime"`, `"endTime"`, `"status"`, `"attributes"`, `"events"`, `"links"`\]; `type`: `"object"`; \}; `meta`: \{ `additionalProperties`: `false`; `properties`: \{ `eventID`: \{ `type`: `"string"`; \}; `time`: \{ `type`: `"integer"`; \}; \}; `required`: readonly \[`"eventID"`, `"time"`\]; `type`: `"object"`; \}; `type`: \{ `const`: `"span:end"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"type"`, `"meta"`, `"data"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `data`: \{ `additionalProperties`: `false`; `definitions`: \{ `json`: \{ `anyOf`: (... \| ... \| ... \| ... \| ... \| ...)[]; \}; \}; `properties`: \{ `category`: \{ `items`: \{ `type`: `"string"`; \}; `type`: `"array"`; \}; `level`: \{ `enum`: readonly \[`"trace"`, `"debug"`, `"info"`, `"warning"`, `"error"`, `"fatal"`\]; `type`: `"string"`; \}; `logID`: \{ `type`: `"string"`; \}; `message`: \{ `type`: `"string"`; \}; `properties`: \{ `additionalProperties`: \{ `$ref`: `string`; \}; `type`: `"object"`; \}; `spanID`: \{ `type`: `"string"`; \}; `timestamp`: \{ `type`: `"number"`; \}; `traceID`: \{ `type`: `"string"`; \}; \}; `required`: readonly \[`"traceID"`, `"spanID"`, `"timestamp"`, `"level"`, `"category"`, `"message"`, `"properties"`, `"logID"`\]; `type`: `"object"`; \}; `meta`: \{ `additionalProperties`: `false`; `properties`: \{ `eventID`: \{ `type`: `"string"`; \}; `time`: \{ `type`: `"integer"`; \}; \}; `required`: readonly \[`"eventID"`, `"time"`\]; `type`: `"object"`; \}; `type`: \{ `const`: `"log"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"type"`, `"meta"`, `"data"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `data`: \{ `additionalProperties`: `false`; `definitions`: \{ `json`: \{ `anyOf`: (... \| ... \| ... \| ... \| ... \| ...)[]; \}; \}; `properties`: \{ `active`: \{ `type`: `"boolean"`; \}; `activeSegmentSpanID`: \{ `type`: `"string"`; \}; `attributes`: \{ `additionalProperties`: `false`; `properties`: \{ `label`: \{ `type`: ...; \}; `mokei.context.id`: \{ `type`: ...; \}; `mokei.flow.id`: \{ `type`: ...; \}; `mokei.run.id`: \{ `type`: ...; \}; \}; `type`: `"object"`; \}; `droppedCount`: \{ `type`: `"integer"`; \}; `endTime`: \{ `type`: `"number"`; \}; `errorCount`: \{ `type`: `"integer"`; \}; `kind`: \{ `enum`: readonly \[`"context"`, `"mcp"`, `"flow"`, `"step"`\]; `type`: `"string"`; \}; `name`: \{ `type`: `"string"`; \}; `outcome`: \{ `enum`: readonly \[`"ok"`, `"error"`, `"interrupted"`, `null`\]; `type`: readonly \[`"string"`, `"null"`\]; \}; `revision`: \{ `type`: `"integer"`; \}; `rootSpanID`: \{ `type`: `"string"`; \}; `spanCount`: \{ `type`: `"integer"`; \}; `startTime`: \{ `type`: `"number"`; \}; `traceID`: \{ `type`: `"string"`; \}; \}; `required`: readonly \[`"traceID"`, `"rootSpanID"`, `"kind"`, `"name"`, `"active"`, `"outcome"`, `"startTime"`, `"attributes"`, `"spanCount"`, `"errorCount"`, `"droppedCount"`, `"revision"`\]; `type`: `"object"`; \}; `meta`: \{ `additionalProperties`: `false`; `properties`: \{ `eventID`: \{ `type`: `"string"`; \}; `time`: \{ `type`: `"integer"`; \}; \}; `required`: readonly \[`"eventID"`, `"time"`\]; `type`: `"object"`; \}; `type`: \{ `const`: `"trace:summary"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"type"`, `"meta"`, `"data"`\]; `type`: `"object"`; \}\]

###### events.receive.definitions

> `readonly` **definitions**: `object` = `jsonDefinitions`

###### events.receive.definitions.json

> `readonly` **json**: `object`

###### events.receive.definitions.json.anyOf

> **anyOf**: (\{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"string"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"number"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"boolean"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"null"`; \} \| \{ `additionalProperties?`: `undefined`; `items`: \{ `$ref`: `string`; \}; `type`: `"array"`; \} \| \{ `additionalProperties`: \{ `$ref`: `string`; \}; `items?`: `undefined`; `type`: `"object"`; \})[]

###### events.receive.type

> `readonly` **type**: `"object"` = `'object'`

###### events.type

> `readonly` **type**: `"stream"` = `'stream'`

###### flows.check

> `readonly` **flows.check**: `object`

###### flows.check.param

> `readonly` **param**: `object`

###### flows.check.param.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### flows.check.param.definitions

> `readonly` **definitions**: `object` = `jsonDefinitions`

###### flows.check.param.definitions.json

> `readonly` **json**: `object`

###### flows.check.param.definitions.json.anyOf

> **anyOf**: (\{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"string"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"number"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"boolean"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"null"`; \} \| \{ `additionalProperties?`: `undefined`; `items`: \{ `$ref`: `string`; \}; `type`: `"array"`; \} \| \{ `additionalProperties`: \{ `$ref`: `string`; \}; `items?`: `undefined`; `type`: `"object"`; \})[]

###### flows.check.param.properties

> `readonly` **properties**: `object`

###### flows.check.param.properties.definition

> `readonly` **definition**: `object` = `jsonObjectSchema`

###### flows.check.param.properties.definition.additionalProperties

> `readonly` **additionalProperties**: `object` = `jsonValueSchema`

###### flows.check.param.properties.definition.additionalProperties.$ref

> **$ref**: `string`

###### flows.check.param.properties.definition.type

> `readonly` **type**: `"object"` = `'object'`

###### flows.check.param.required

> `readonly` **required**: readonly \[`"definition"`\]

###### flows.check.param.type

> `readonly` **type**: `"object"` = `'object'`

###### flows.check.result

> `readonly` **result**: `object` = `flowCheckResultSchema`

###### flows.check.result.anyOf

> `readonly` **anyOf**: readonly \[\{ `additionalProperties`: `false`; `properties`: \{ `formatted`: \{ `type`: `"string"`; \}; `value`: \{ `additionalProperties`: \{ `$ref`: `string`; \}; `type`: `"object"`; \}; `warnings`: \{ `items`: \{ `additionalProperties`: `false`; `properties`: \{ `code`: \{ `type`: `"string"`; \}; `hint`: \{ `type`: `"string"`; \}; `message`: \{ `type`: `"string"`; \}; `path`: \{ `items`: \{ `anyOf`: ...; \}; `type`: `"array"`; \}; `severity`: \{ `enum`: readonly \[..., ...\]; `type`: `"string"`; \}; \}; `required`: readonly \[`"path"`, `"severity"`, `"code"`, `"message"`\]; `type`: `"object"`; \}; `type`: `"array"`; \}; \}; `required`: readonly \[`"value"`, `"warnings"`, `"formatted"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `formatted`: \{ `type`: `"string"`; \}; `issues`: \{ `items`: \{ `additionalProperties`: `false`; `properties`: \{ `code`: \{ `type`: `"string"`; \}; `hint`: \{ `type`: `"string"`; \}; `message`: \{ `type`: `"string"`; \}; `path`: \{ `items`: \{ `anyOf`: ...; \}; `type`: `"array"`; \}; `severity`: \{ `enum`: readonly \[..., ...\]; `type`: `"string"`; \}; \}; `required`: readonly \[`"path"`, `"severity"`, `"code"`, `"message"`\]; `type`: `"object"`; \}; `type`: `"array"`; \}; `warnings`: \{ `items`: \{ `additionalProperties`: `false`; `properties`: \{ `code`: \{ `type`: `"string"`; \}; `hint`: \{ `type`: `"string"`; \}; `message`: \{ `type`: `"string"`; \}; `path`: \{ `items`: \{ `anyOf`: ...; \}; `type`: `"array"`; \}; `severity`: \{ `enum`: readonly \[..., ...\]; `type`: `"string"`; \}; \}; `required`: readonly \[`"path"`, `"severity"`, `"code"`, `"message"`\]; `type`: `"object"`; \}; `type`: `"array"`; \}; \}; `required`: readonly \[`"issues"`, `"warnings"`, `"formatted"`\]; `type`: `"object"`; \}\]

###### flows.check.result.definitions

> `readonly` **definitions**: `object` = `jsonDefinitions`

###### flows.check.result.definitions.json

> `readonly` **json**: `object`

###### flows.check.result.definitions.json.anyOf

> **anyOf**: (\{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"string"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"number"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"boolean"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"null"`; \} \| \{ `additionalProperties?`: `undefined`; `items`: \{ `$ref`: `string`; \}; `type`: `"array"`; \} \| \{ `additionalProperties`: \{ `$ref`: `string`; \}; `items?`: `undefined`; `type`: `"object"`; \})[]

###### flows.check.result.type

> `readonly` **type**: `"object"` = `'object'`

###### flows.check.type

> `readonly` **type**: `"request"` = `'request'`

###### flows.list

> `readonly` **flows.list**: `object`

###### flows.list.result

> `readonly` **result**: `object`

###### flows.list.result.definitions

> `readonly` **definitions**: `object` = `jsonDefinitions`

###### flows.list.result.definitions.json

> `readonly` **json**: `object`

###### flows.list.result.definitions.json.anyOf

> **anyOf**: (\{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"string"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"number"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"boolean"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"null"`; \} \| \{ `additionalProperties?`: `undefined`; `items`: \{ `$ref`: `string`; \}; `type`: `"array"`; \} \| \{ `additionalProperties`: \{ `$ref`: `string`; \}; `items?`: `undefined`; `type`: `"object"`; \})[]

###### flows.list.result.items

> `readonly` **items**: `object` = `flowSummarySchema`

###### flows.list.result.items.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### flows.list.result.items.definitions

> `readonly` **definitions**: `object` = `jsonDefinitions`

###### flows.list.result.items.definitions.json

> `readonly` **json**: `object`

###### flows.list.result.items.definitions.json.anyOf

> **anyOf**: (\{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"string"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"number"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"boolean"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"null"`; \} \| \{ `additionalProperties?`: `undefined`; `items`: \{ `$ref`: `string`; \}; `type`: `"array"`; \} \| \{ `additionalProperties`: \{ `$ref`: `string`; \}; `items?`: `undefined`; `type`: `"object"`; \})[]

###### flows.list.result.items.properties

> `readonly` **properties**: `object`

###### flows.list.result.items.properties.id

> `readonly` **id**: `object`

###### flows.list.result.items.properties.id.type

> `readonly` **type**: `"string"` = `'string'`

###### flows.list.result.items.properties.input

> `readonly` **input**: `object` = `jsonObjectSchema`

###### flows.list.result.items.properties.input.additionalProperties

> `readonly` **additionalProperties**: `object` = `jsonValueSchema`

###### flows.list.result.items.properties.input.additionalProperties.$ref

> **$ref**: `string`

###### flows.list.result.items.properties.input.type

> `readonly` **type**: `"object"` = `'object'`

###### flows.list.result.items.properties.name

> `readonly` **name**: `object`

###### flows.list.result.items.properties.name.type

> `readonly` **type**: `"string"` = `'string'`

###### flows.list.result.items.properties.outcomes

> `readonly` **outcomes**: `object`

###### flows.list.result.items.properties.outcomes.items

> `readonly` **items**: `object`

###### flows.list.result.items.properties.outcomes.items.type

> `readonly` **type**: `"string"` = `'string'`

###### flows.list.result.items.properties.outcomes.type

> `readonly` **type**: `"array"` = `'array'`

###### flows.list.result.items.properties.outputs

> `readonly` **outputs**: `object`

###### flows.list.result.items.properties.outputs.items

> `readonly` **items**: `object`

###### flows.list.result.items.properties.outputs.items.type

> `readonly` **type**: `"string"` = `'string'`

###### flows.list.result.items.properties.outputs.type

> `readonly` **type**: `"array"` = `'array'`

###### flows.list.result.items.properties.version

> `readonly` **version**: `object`

###### flows.list.result.items.properties.version.type

> `readonly` **type**: `"number"` = `'number'`

###### flows.list.result.items.required

> `readonly` **required**: readonly \[`"id"`, `"name"`, `"version"`, `"input"`, `"outputs"`, `"outcomes"`\]

###### flows.list.result.items.type

> `readonly` **type**: `"object"` = `'object'`

###### flows.list.result.type

> `readonly` **type**: `"array"` = `'array'`

###### flows.list.type

> `readonly` **type**: `"request"` = `'request'`

###### inbox.answer

> `readonly` **inbox.answer**: `object`

###### inbox.answer.param

> `readonly` **param**: `object`

###### inbox.answer.param.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### inbox.answer.param.definitions

> `readonly` **definitions**: `object` = `jsonDefinitions`

###### inbox.answer.param.definitions.json

> `readonly` **json**: `object`

###### inbox.answer.param.definitions.json.anyOf

> **anyOf**: (\{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"string"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"number"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"boolean"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"null"`; \} \| \{ `additionalProperties?`: `undefined`; `items`: \{ `$ref`: `string`; \}; `type`: `"array"`; \} \| \{ `additionalProperties`: \{ `$ref`: `string`; \}; `items?`: `undefined`; `type`: `"object"`; \})[]

###### inbox.answer.param.properties

> `readonly` **properties**: `object`

###### inbox.answer.param.properties.content

> `readonly` **content**: `object` = `jsonObjectSchema`

###### inbox.answer.param.properties.content.additionalProperties

> `readonly` **additionalProperties**: `object` = `jsonValueSchema`

###### inbox.answer.param.properties.content.additionalProperties.$ref

> **$ref**: `string`

###### inbox.answer.param.properties.content.type

> `readonly` **type**: `"object"` = `'object'`

###### inbox.answer.param.properties.id

> `readonly` **id**: `object`

###### inbox.answer.param.properties.id.type

> `readonly` **type**: `"string"` = `'string'`

###### inbox.answer.param.required

> `readonly` **required**: readonly \[`"id"`\]

###### inbox.answer.param.type

> `readonly` **type**: `"object"` = `'object'`

###### inbox.answer.result

> `readonly` **result**: `object` = `settledResultSchema`

###### inbox.answer.result.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### inbox.answer.result.properties

> `readonly` **properties**: `object`

###### inbox.answer.result.properties.settled

> `readonly` **settled**: `object`

###### inbox.answer.result.properties.settled.const

> `readonly` **const**: `true` = `true`

###### inbox.answer.result.properties.settled.type

> `readonly` **type**: `"boolean"` = `'boolean'`

###### inbox.answer.result.required

> `readonly` **required**: readonly \[`"settled"`\]

###### inbox.answer.result.type

> `readonly` **type**: `"object"` = `'object'`

###### inbox.answer.type

> `readonly` **type**: `"request"` = `'request'`

###### inbox.cancel

> `readonly` **inbox.cancel**: `object`

###### inbox.cancel.param

> `readonly` **param**: `object` = `inboxIDParamSchema`

###### inbox.cancel.param.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### inbox.cancel.param.properties

> `readonly` **properties**: `object`

###### inbox.cancel.param.properties.id

> `readonly` **id**: `object`

###### inbox.cancel.param.properties.id.type

> `readonly` **type**: `"string"` = `'string'`

###### inbox.cancel.param.required

> `readonly` **required**: readonly \[`"id"`\]

###### inbox.cancel.param.type

> `readonly` **type**: `"object"` = `'object'`

###### inbox.cancel.result

> `readonly` **result**: `object` = `settledResultSchema`

###### inbox.cancel.result.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### inbox.cancel.result.properties

> `readonly` **properties**: `object`

###### inbox.cancel.result.properties.settled

> `readonly` **settled**: `object`

###### inbox.cancel.result.properties.settled.const

> `readonly` **const**: `true` = `true`

###### inbox.cancel.result.properties.settled.type

> `readonly` **type**: `"boolean"` = `'boolean'`

###### inbox.cancel.result.required

> `readonly` **required**: readonly \[`"settled"`\]

###### inbox.cancel.result.type

> `readonly` **type**: `"object"` = `'object'`

###### inbox.cancel.type

> `readonly` **type**: `"request"` = `'request'`

###### inbox.decline

> `readonly` **inbox.decline**: `object`

###### inbox.decline.param

> `readonly` **param**: `object`

###### inbox.decline.param.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### inbox.decline.param.properties

> `readonly` **properties**: `object`

###### inbox.decline.param.properties.id

> `readonly` **id**: `object`

###### inbox.decline.param.properties.id.type

> `readonly` **type**: `"string"` = `'string'`

###### inbox.decline.param.properties.reason

> `readonly` **reason**: `object`

###### inbox.decline.param.properties.reason.type

> `readonly` **type**: `"string"` = `'string'`

###### inbox.decline.param.required

> `readonly` **required**: readonly \[`"id"`\]

###### inbox.decline.param.type

> `readonly` **type**: `"object"` = `'object'`

###### inbox.decline.result

> `readonly` **result**: `object` = `settledResultSchema`

###### inbox.decline.result.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### inbox.decline.result.properties

> `readonly` **properties**: `object`

###### inbox.decline.result.properties.settled

> `readonly` **settled**: `object`

###### inbox.decline.result.properties.settled.const

> `readonly` **const**: `true` = `true`

###### inbox.decline.result.properties.settled.type

> `readonly` **type**: `"boolean"` = `'boolean'`

###### inbox.decline.result.required

> `readonly` **required**: readonly \[`"settled"`\]

###### inbox.decline.result.type

> `readonly` **type**: `"object"` = `'object'`

###### inbox.decline.type

> `readonly` **type**: `"request"` = `'request'`

###### inbox.get

> `readonly` **inbox.get**: `object`

###### inbox.get.param

> `readonly` **param**: `object` = `inboxIDParamSchema`

###### inbox.get.param.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### inbox.get.param.properties

> `readonly` **properties**: `object`

###### inbox.get.param.properties.id

> `readonly` **id**: `object`

###### inbox.get.param.properties.id.type

> `readonly` **type**: `"string"` = `'string'`

###### inbox.get.param.required

> `readonly` **required**: readonly \[`"id"`\]

###### inbox.get.param.type

> `readonly` **type**: `"object"` = `'object'`

###### inbox.get.result

> `readonly` **result**: `object` = `inboxItemSchema`

###### inbox.get.result.anyOf

> `readonly` **anyOf**: readonly \[\{ `additionalProperties`: `false`; `properties`: \{ `createdAt`: \{ `type`: `"number"`; \}; `id`: \{ `type`: `"string"`; \}; `kind`: \{ `const`: `"approval"`; `type`: `"string"`; \}; `plan`: \{ `additionalProperties`: `false`; `properties`: \{ `tools`: \{ `items`: \{ `type`: `"string"`; \}; `type`: `"array"`; \}; \}; `required`: readonly \[`"tools"`\]; `type`: `"object"`; \}; `runID`: \{ `type`: `"string"`; \}; \}; `required`: readonly \[`"id"`, `"runID"`, `"kind"`, `"plan"`, `"createdAt"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `createdAt`: \{ `type`: `"number"`; \}; `id`: \{ `type`: `"string"`; \}; `inputKey`: \{ `type`: `"string"`; \}; `kind`: \{ `const`: `"input"`; `type`: `"string"`; \}; `message`: \{ `type`: `"string"`; \}; `requestedSchema`: \{ `additionalProperties`: \{ `$ref`: `string`; \}; `type`: `"object"`; \}; `runID`: \{ `type`: `"string"`; \}; \}; `required`: readonly \[`"id"`, `"runID"`, `"kind"`, `"inputKey"`, `"message"`, `"requestedSchema"`, `"createdAt"`\]; `type`: `"object"`; \}\]

###### inbox.get.result.definitions

> `readonly` **definitions**: `object` = `jsonDefinitions`

###### inbox.get.result.definitions.json

> `readonly` **json**: `object`

###### inbox.get.result.definitions.json.anyOf

> **anyOf**: (\{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"string"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"number"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"boolean"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"null"`; \} \| \{ `additionalProperties?`: `undefined`; `items`: \{ `$ref`: `string`; \}; `type`: `"array"`; \} \| \{ `additionalProperties`: \{ `$ref`: `string`; \}; `items?`: `undefined`; `type`: `"object"`; \})[]

###### inbox.get.result.type

> `readonly` **type**: `"object"` = `'object'`

###### inbox.get.type

> `readonly` **type**: `"request"` = `'request'`

###### inbox.list

> `readonly` **inbox.list**: `object`

###### inbox.list.param

> `readonly` **param**: `object`

###### inbox.list.param.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### inbox.list.param.properties

> `readonly` **properties**: `object`

###### inbox.list.param.properties.runID

> `readonly` **runID**: `object`

###### inbox.list.param.properties.runID.type

> `readonly` **type**: `"string"` = `'string'`

###### inbox.list.param.type

> `readonly` **type**: `"object"` = `'object'`

###### inbox.list.result

> `readonly` **result**: `object`

###### inbox.list.result.definitions

> `readonly` **definitions**: `object` = `jsonDefinitions`

###### inbox.list.result.definitions.json

> `readonly` **json**: `object`

###### inbox.list.result.definitions.json.anyOf

> **anyOf**: (\{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"string"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"number"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"boolean"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"null"`; \} \| \{ `additionalProperties?`: `undefined`; `items`: \{ `$ref`: `string`; \}; `type`: `"array"`; \} \| \{ `additionalProperties`: \{ `$ref`: `string`; \}; `items?`: `undefined`; `type`: `"object"`; \})[]

###### inbox.list.result.items

> `readonly` **items**: `object` = `inboxItemSchema`

###### inbox.list.result.items.anyOf

> `readonly` **anyOf**: readonly \[\{ `additionalProperties`: `false`; `properties`: \{ `createdAt`: \{ `type`: `"number"`; \}; `id`: \{ `type`: `"string"`; \}; `kind`: \{ `const`: `"approval"`; `type`: `"string"`; \}; `plan`: \{ `additionalProperties`: `false`; `properties`: \{ `tools`: \{ `items`: \{ `type`: ...; \}; `type`: `"array"`; \}; \}; `required`: readonly \[`"tools"`\]; `type`: `"object"`; \}; `runID`: \{ `type`: `"string"`; \}; \}; `required`: readonly \[`"id"`, `"runID"`, `"kind"`, `"plan"`, `"createdAt"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `createdAt`: \{ `type`: `"number"`; \}; `id`: \{ `type`: `"string"`; \}; `inputKey`: \{ `type`: `"string"`; \}; `kind`: \{ `const`: `"input"`; `type`: `"string"`; \}; `message`: \{ `type`: `"string"`; \}; `requestedSchema`: \{ `additionalProperties`: \{ `$ref`: `string`; \}; `type`: `"object"`; \}; `runID`: \{ `type`: `"string"`; \}; \}; `required`: readonly \[`"id"`, `"runID"`, `"kind"`, `"inputKey"`, `"message"`, `"requestedSchema"`, `"createdAt"`\]; `type`: `"object"`; \}\]

###### inbox.list.result.items.definitions

> `readonly` **definitions**: `object` = `jsonDefinitions`

###### inbox.list.result.items.definitions.json

> `readonly` **json**: `object`

###### inbox.list.result.items.definitions.json.anyOf

> **anyOf**: (\{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"string"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"number"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"boolean"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"null"`; \} \| \{ `additionalProperties?`: `undefined`; `items`: \{ `$ref`: `string`; \}; `type`: `"array"`; \} \| \{ `additionalProperties`: \{ `$ref`: `string`; \}; `items?`: `undefined`; `type`: `"object"`; \})[]

###### inbox.list.result.items.type

> `readonly` **type**: `"object"` = `'object'`

###### inbox.list.result.type

> `readonly` **type**: `"array"` = `'array'`

###### inbox.list.type

> `readonly` **type**: `"request"` = `'request'`

###### inbox.prompt

> `readonly` **inbox.prompt**: `object`

###### inbox.prompt.param

> `readonly` **param**: `object` = `inboxIDParamSchema`

###### inbox.prompt.param.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### inbox.prompt.param.properties

> `readonly` **properties**: `object`

###### inbox.prompt.param.properties.id

> `readonly` **id**: `object`

###### inbox.prompt.param.properties.id.type

> `readonly` **type**: `"string"` = `'string'`

###### inbox.prompt.param.required

> `readonly` **required**: readonly \[`"id"`\]

###### inbox.prompt.param.type

> `readonly` **type**: `"object"` = `'object'`

###### inbox.prompt.result

> `readonly` **result**: `object`

###### inbox.prompt.result.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### inbox.prompt.result.properties

> `readonly` **properties**: `object`

###### inbox.prompt.result.properties.action

> `readonly` **action**: `object`

###### inbox.prompt.result.properties.action.enum

> `readonly` **enum**: readonly \[`"accept"`, `"decline"`, `"cancel"`\]

###### inbox.prompt.result.properties.action.type

> `readonly` **type**: `"string"` = `'string'`

###### inbox.prompt.result.required

> `readonly` **required**: readonly \[`"action"`\]

###### inbox.prompt.result.type

> `readonly` **type**: `"object"` = `'object'`

###### inbox.prompt.type

> `readonly` **type**: `"request"` = `'request'`

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

###### info.result.properties.flowService

> `readonly` **flowService**: `object` = `flowServiceStatusSchema`

###### info.result.properties.flowService.anyOf

> `readonly` **anyOf**: readonly \[\{ `additionalProperties`: `false`; `properties`: \{ `state`: \{ `const`: `"starting"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"state"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `state`: \{ `const`: `"ready"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"state"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `error`: \{ `additionalProperties`: `false`; `properties`: \{ `issues`: \{ `items`: ...; `type`: ...; \}; `message`: \{ `type`: ...; \}; `path`: \{ `type`: ...; \}; `type`: \{ `type`: ...; \}; \}; `required`: readonly \[`"type"`, `"message"`\]; `type`: `"object"`; \}; `state`: \{ `const`: `"failed"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"state"`, `"error"`\]; `type`: `"object"`; \}\]

###### info.result.properties.startedTime

> `readonly` **startedTime**: `object`

###### info.result.properties.startedTime.type

> `readonly` **type**: `"integer"` = `'integer'`

###### info.result.properties.tracing

> `readonly` **tracing**: `object` = `tracingInfoSchema`

###### info.result.properties.tracing.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### info.result.properties.tracing.properties

> `readonly` **properties**: `object`

###### info.result.properties.tracing.properties.droppedCount

> `readonly` **droppedCount**: `object`

###### info.result.properties.tracing.properties.droppedCount.type

> `readonly` **type**: `"integer"` = `'integer'`

###### info.result.properties.tracing.properties.lostSummaryCount

> `readonly` **lostSummaryCount**: `object`

###### info.result.properties.tracing.properties.lostSummaryCount.type

> `readonly` **type**: `"integer"` = `'integer'`

###### info.result.properties.tracing.required

> `readonly` **required**: readonly \[`"lostSummaryCount"`, `"droppedCount"`\]

###### info.result.properties.tracing.type

> `readonly` **type**: `"object"` = `'object'`

###### info.result.required

> `readonly` **required**: readonly \[`"activeContexts"`, `"startedTime"`, `"flowService"`\]

###### info.result.type

> `readonly` **type**: `"object"` = `'object'`

###### info.type

> `readonly` **type**: `"request"` = `'request'`

###### monitor.attach

> `readonly` **monitor.attach**: `object`

###### monitor.attach.param

> `readonly` **param**: `object` = `monitorAttachParamSchema`

###### monitor.attach.param.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### monitor.attach.param.properties

> `readonly` **properties**: `object`

###### monitor.attach.param.properties.url

> `readonly` **url**: `object`

###### monitor.attach.param.properties.url.type

> `readonly` **type**: `"string"` = `'string'`

###### monitor.attach.param.required

> `readonly` **required**: readonly \[`"url"`\]

###### monitor.attach.param.type

> `readonly` **type**: `"object"` = `'object'`

###### monitor.attach.receive

> `readonly` **receive**: `object` = `monitorAttachReceiveSchema`

###### monitor.attach.receive.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### monitor.attach.receive.properties

> `readonly` **properties**: `object`

###### monitor.attach.receive.properties.attachmentID

> `readonly` **attachmentID**: `object`

###### monitor.attach.receive.properties.attachmentID.type

> `readonly` **type**: `"string"` = `'string'`

###### monitor.attach.receive.properties.type

> `readonly` **type**: `object`

###### monitor.attach.receive.properties.type.const

> `readonly` **const**: `"attached"` = `'attached'`

###### monitor.attach.receive.properties.type.type

> `readonly` **type**: `"string"` = `'string'`

###### monitor.attach.receive.required

> `readonly` **required**: readonly \[`"type"`, `"attachmentID"`\]

###### monitor.attach.receive.type

> `readonly` **type**: `"object"` = `'object'`

###### monitor.attach.type

> `readonly` **type**: `"stream"` = `'stream'`

###### monitor.presence

> `readonly` **monitor.presence**: `object`

###### monitor.presence.param

> `readonly` **param**: `object` = `monitorPresenceParamSchema`

###### monitor.presence.param.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### monitor.presence.param.properties

> `readonly` **properties**: `object`

###### monitor.presence.param.properties.attachmentID

> `readonly` **attachmentID**: `object`

###### monitor.presence.param.properties.attachmentID.type

> `readonly` **type**: `"string"` = `'string'`

###### monitor.presence.param.type

> `readonly` **type**: `"object"` = `'object'`

###### monitor.presence.receive

> `readonly` **receive**: `object`

###### monitor.presence.receive.anyOf

> `readonly` **anyOf**: \[\{ `additionalProperties`: `false`; `properties`: \{ `nonce`: \{ `type`: `"string"`; \}; `type`: \{ `const`: `"ping"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"type"`, `"nonce"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `attemptID`: \{ `type`: `"string"`; \}; `deadline`: \{ `type`: `"number"`; \}; `itemID`: \{ `type`: `"string"`; \}; `message`: \{ `type`: `"string"`; \}; `title`: \{ `type`: `"string"`; \}; `type`: \{ `const`: `"notify"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"type"`, `"attemptID"`, `"deadline"`, `"itemID"`, `"title"`, `"message"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `attemptID`: \{ `type`: `"string"`; \}; `deadline`: \{ `type`: `"number"`; \}; `itemID`: \{ `type`: `"string"`; \}; `type`: \{ `const`: `"prompt"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"type"`, `"attemptID"`, `"deadline"`, `"itemID"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `attemptID`: \{ `type`: `"string"`; \}; `type`: \{ `const`: `"withdraw"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"type"`, `"attemptID"`\]; `type`: `"object"`; \}\]

###### monitor.presence.send

> `readonly` **send**: `object`

###### monitor.presence.send.anyOf

> `readonly` **anyOf**: \[\{ `additionalProperties`: `false`; `properties`: \{ `activeItemID`: \{ `type`: `"string"`; \}; `canNotify`: \{ `type`: `"boolean"`; \}; `type`: \{ `const`: `"state"`; `type`: `"string"`; \}; `visible`: \{ `type`: `"boolean"`; \}; \}; `required`: readonly \[`"type"`, `"visible"`, `"canNotify"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `nonce`: \{ `type`: `"string"`; \}; `type`: \{ `const`: `"pong"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"type"`, `"nonce"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `attemptID`: \{ `type`: `"string"`; \}; `shown`: \{ `type`: `"boolean"`; \}; `type`: \{ `const`: `"ack"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"type"`, `"attemptID"`, `"shown"`\]; `type`: `"object"`; \}\]

###### monitor.presence.type

> `readonly` **type**: `"channel"` = `'channel'`

###### runs.cancel

> `readonly` **runs.cancel**: `object`

###### runs.cancel.param

> `readonly` **param**: `object` = `runIDParamSchema`

###### runs.cancel.param.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### runs.cancel.param.properties

> `readonly` **properties**: `object`

###### runs.cancel.param.properties.runID

> `readonly` **runID**: `object`

###### runs.cancel.param.properties.runID.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.cancel.param.required

> `readonly` **required**: readonly \[`"runID"`\]

###### runs.cancel.param.type

> `readonly` **type**: `"object"` = `'object'`

###### runs.cancel.result

> `readonly` **result**: `object` = `flowRunSnapshotSchema`

###### runs.cancel.result.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### runs.cancel.result.definitions

> `readonly` **definitions**: `object` = `jsonDefinitions`

###### runs.cancel.result.definitions.json

> `readonly` **json**: `object`

###### runs.cancel.result.definitions.json.anyOf

> **anyOf**: (\{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"string"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"number"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"boolean"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"null"`; \} \| \{ `additionalProperties?`: `undefined`; `items`: \{ `$ref`: `string`; \}; `type`: `"array"`; \} \| \{ `additionalProperties`: \{ `$ref`: `string`; \}; `items?`: `undefined`; `type`: `"object"`; \})[]

###### runs.cancel.result.properties

> `readonly` **properties**: `object`

###### runs.cancel.result.properties.createdAt

> `readonly` **createdAt**: `object`

###### runs.cancel.result.properties.createdAt.type

> `readonly` **type**: `"number"` = `'number'`

###### runs.cancel.result.properties.error

> `readonly` **error**: `object`

###### runs.cancel.result.properties.error.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### runs.cancel.result.properties.error.properties

> `readonly` **properties**: `object`

###### runs.cancel.result.properties.error.properties.code

> `readonly` **code**: `object`

###### runs.cancel.result.properties.error.properties.code.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.cancel.result.properties.error.properties.message

> `readonly` **message**: `object`

###### runs.cancel.result.properties.error.properties.message.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.cancel.result.properties.error.properties.type

> `readonly` **type**: `object`

###### runs.cancel.result.properties.error.properties.type.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.cancel.result.properties.error.required

> `readonly` **required**: readonly \[`"type"`, `"message"`\]

###### runs.cancel.result.properties.error.type

> `readonly` **type**: `"object"` = `'object'`

###### runs.cancel.result.properties.flowID

> `readonly` **flowID**: `object`

###### runs.cancel.result.properties.flowID.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.cancel.result.properties.label

> `readonly` **label**: `object`

###### runs.cancel.result.properties.label.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.cancel.result.properties.plan

> `readonly` **plan**: `object` = `runPlanSchema`

###### runs.cancel.result.properties.plan.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### runs.cancel.result.properties.plan.properties

> `readonly` **properties**: `object`

###### runs.cancel.result.properties.plan.properties.tools

> `readonly` **tools**: `object`

###### runs.cancel.result.properties.plan.properties.tools.items

> `readonly` **items**: `object`

###### runs.cancel.result.properties.plan.properties.tools.items.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.cancel.result.properties.plan.properties.tools.type

> `readonly` **type**: `"array"` = `'array'`

###### runs.cancel.result.properties.plan.required

> `readonly` **required**: readonly \[`"tools"`\]

###### runs.cancel.result.properties.plan.type

> `readonly` **type**: `"object"` = `'object'`

###### runs.cancel.result.properties.result

> `readonly` **result**: `object`

###### runs.cancel.result.properties.result.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### runs.cancel.result.properties.result.properties

> `readonly` **properties**: `object`

###### runs.cancel.result.properties.result.properties.content

> `readonly` **content**: `object`

###### runs.cancel.result.properties.result.properties.content.items

> `readonly` **items**: `object` = `jsonObjectSchema`

###### runs.cancel.result.properties.result.properties.content.items.additionalProperties

> `readonly` **additionalProperties**: `object` = `jsonValueSchema`

###### runs.cancel.result.properties.result.properties.content.items.additionalProperties.$ref

> **$ref**: `string`

###### runs.cancel.result.properties.result.properties.content.items.type

> `readonly` **type**: `"object"` = `'object'`

###### runs.cancel.result.properties.result.properties.content.type

> `readonly` **type**: `"array"` = `'array'`

###### runs.cancel.result.properties.result.properties.outcome

> `readonly` **outcome**: `object`

###### runs.cancel.result.properties.result.properties.outcome.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.cancel.result.properties.result.properties.output

> `readonly` **output**: `object` = `jsonValueSchema`

###### runs.cancel.result.properties.result.properties.output.$ref

> **$ref**: `string`

###### runs.cancel.result.properties.result.required

> `readonly` **required**: readonly \[`"content"`\]

###### runs.cancel.result.properties.result.type

> `readonly` **type**: `"object"` = `'object'`

###### runs.cancel.result.properties.runID

> `readonly` **runID**: `object`

###### runs.cancel.result.properties.runID.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.cancel.result.properties.state

> `readonly` **state**: `object` = `runStateSchema`

###### runs.cancel.result.properties.state.enum

> `readonly` **enum**: readonly \[`"awaiting_approval"`, `"denied"`, `"working"`, `"input_required"`, `"completed"`, `"failed"`, `"cancelled"`\]

###### runs.cancel.result.properties.state.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.cancel.result.properties.traceID

> `readonly` **traceID**: `object`

###### runs.cancel.result.properties.traceID.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.cancel.result.properties.updatedAt

> `readonly` **updatedAt**: `object`

###### runs.cancel.result.properties.updatedAt.type

> `readonly` **type**: `"number"` = `'number'`

###### runs.cancel.result.required

> `readonly` **required**: readonly \[`"runID"`, `"label"`, `"state"`, `"createdAt"`, `"updatedAt"`, `"plan"`\]

###### runs.cancel.result.type

> `readonly` **type**: `"object"` = `'object'`

###### runs.cancel.type

> `readonly` **type**: `"request"` = `'request'`

###### runs.get

> `readonly` **runs.get**: `object`

###### runs.get.param

> `readonly` **param**: `object` = `runIDParamSchema`

###### runs.get.param.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### runs.get.param.properties

> `readonly` **properties**: `object`

###### runs.get.param.properties.runID

> `readonly` **runID**: `object`

###### runs.get.param.properties.runID.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.get.param.required

> `readonly` **required**: readonly \[`"runID"`\]

###### runs.get.param.type

> `readonly` **type**: `"object"` = `'object'`

###### runs.get.result

> `readonly` **result**: `object` = `flowRunSnapshotSchema`

###### runs.get.result.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### runs.get.result.definitions

> `readonly` **definitions**: `object` = `jsonDefinitions`

###### runs.get.result.definitions.json

> `readonly` **json**: `object`

###### runs.get.result.definitions.json.anyOf

> **anyOf**: (\{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"string"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"number"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"boolean"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"null"`; \} \| \{ `additionalProperties?`: `undefined`; `items`: \{ `$ref`: `string`; \}; `type`: `"array"`; \} \| \{ `additionalProperties`: \{ `$ref`: `string`; \}; `items?`: `undefined`; `type`: `"object"`; \})[]

###### runs.get.result.properties

> `readonly` **properties**: `object`

###### runs.get.result.properties.createdAt

> `readonly` **createdAt**: `object`

###### runs.get.result.properties.createdAt.type

> `readonly` **type**: `"number"` = `'number'`

###### runs.get.result.properties.error

> `readonly` **error**: `object`

###### runs.get.result.properties.error.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### runs.get.result.properties.error.properties

> `readonly` **properties**: `object`

###### runs.get.result.properties.error.properties.code

> `readonly` **code**: `object`

###### runs.get.result.properties.error.properties.code.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.get.result.properties.error.properties.message

> `readonly` **message**: `object`

###### runs.get.result.properties.error.properties.message.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.get.result.properties.error.properties.type

> `readonly` **type**: `object`

###### runs.get.result.properties.error.properties.type.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.get.result.properties.error.required

> `readonly` **required**: readonly \[`"type"`, `"message"`\]

###### runs.get.result.properties.error.type

> `readonly` **type**: `"object"` = `'object'`

###### runs.get.result.properties.flowID

> `readonly` **flowID**: `object`

###### runs.get.result.properties.flowID.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.get.result.properties.label

> `readonly` **label**: `object`

###### runs.get.result.properties.label.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.get.result.properties.plan

> `readonly` **plan**: `object` = `runPlanSchema`

###### runs.get.result.properties.plan.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### runs.get.result.properties.plan.properties

> `readonly` **properties**: `object`

###### runs.get.result.properties.plan.properties.tools

> `readonly` **tools**: `object`

###### runs.get.result.properties.plan.properties.tools.items

> `readonly` **items**: `object`

###### runs.get.result.properties.plan.properties.tools.items.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.get.result.properties.plan.properties.tools.type

> `readonly` **type**: `"array"` = `'array'`

###### runs.get.result.properties.plan.required

> `readonly` **required**: readonly \[`"tools"`\]

###### runs.get.result.properties.plan.type

> `readonly` **type**: `"object"` = `'object'`

###### runs.get.result.properties.result

> `readonly` **result**: `object`

###### runs.get.result.properties.result.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### runs.get.result.properties.result.properties

> `readonly` **properties**: `object`

###### runs.get.result.properties.result.properties.content

> `readonly` **content**: `object`

###### runs.get.result.properties.result.properties.content.items

> `readonly` **items**: `object` = `jsonObjectSchema`

###### runs.get.result.properties.result.properties.content.items.additionalProperties

> `readonly` **additionalProperties**: `object` = `jsonValueSchema`

###### runs.get.result.properties.result.properties.content.items.additionalProperties.$ref

> **$ref**: `string`

###### runs.get.result.properties.result.properties.content.items.type

> `readonly` **type**: `"object"` = `'object'`

###### runs.get.result.properties.result.properties.content.type

> `readonly` **type**: `"array"` = `'array'`

###### runs.get.result.properties.result.properties.outcome

> `readonly` **outcome**: `object`

###### runs.get.result.properties.result.properties.outcome.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.get.result.properties.result.properties.output

> `readonly` **output**: `object` = `jsonValueSchema`

###### runs.get.result.properties.result.properties.output.$ref

> **$ref**: `string`

###### runs.get.result.properties.result.required

> `readonly` **required**: readonly \[`"content"`\]

###### runs.get.result.properties.result.type

> `readonly` **type**: `"object"` = `'object'`

###### runs.get.result.properties.runID

> `readonly` **runID**: `object`

###### runs.get.result.properties.runID.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.get.result.properties.state

> `readonly` **state**: `object` = `runStateSchema`

###### runs.get.result.properties.state.enum

> `readonly` **enum**: readonly \[`"awaiting_approval"`, `"denied"`, `"working"`, `"input_required"`, `"completed"`, `"failed"`, `"cancelled"`\]

###### runs.get.result.properties.state.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.get.result.properties.traceID

> `readonly` **traceID**: `object`

###### runs.get.result.properties.traceID.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.get.result.properties.updatedAt

> `readonly` **updatedAt**: `object`

###### runs.get.result.properties.updatedAt.type

> `readonly` **type**: `"number"` = `'number'`

###### runs.get.result.required

> `readonly` **required**: readonly \[`"runID"`, `"label"`, `"state"`, `"createdAt"`, `"updatedAt"`, `"plan"`\]

###### runs.get.result.type

> `readonly` **type**: `"object"` = `'object'`

###### runs.get.type

> `readonly` **type**: `"request"` = `'request'`

###### runs.list

> `readonly` **runs.list**: `object`

###### runs.list.param

> `readonly` **param**: `object`

###### runs.list.param.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### runs.list.param.properties

> `readonly` **properties**: `object`

###### runs.list.param.properties.limit

> `readonly` **limit**: `object`

###### runs.list.param.properties.limit.minimum

> `readonly` **minimum**: `0` = `0`

###### runs.list.param.properties.limit.type

> `readonly` **type**: `"integer"` = `'integer'`

###### runs.list.param.properties.states

> `readonly` **states**: `object`

###### runs.list.param.properties.states.items

> `readonly` **items**: `object` = `runStateSchema`

###### runs.list.param.properties.states.items.enum

> `readonly` **enum**: readonly \[`"awaiting_approval"`, `"denied"`, `"working"`, `"input_required"`, `"completed"`, `"failed"`, `"cancelled"`\]

###### runs.list.param.properties.states.items.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.list.param.properties.states.type

> `readonly` **type**: `"array"` = `'array'`

###### runs.list.param.properties.updatedBefore

> `readonly` **updatedBefore**: `object`

###### runs.list.param.properties.updatedBefore.type

> `readonly` **type**: `"number"` = `'number'`

###### runs.list.param.type

> `readonly` **type**: `"object"` = `'object'`

###### runs.list.result

> `readonly` **result**: `object`

###### runs.list.result.definitions

> `readonly` **definitions**: `object` = `jsonDefinitions`

###### runs.list.result.definitions.json

> `readonly` **json**: `object`

###### runs.list.result.definitions.json.anyOf

> **anyOf**: (\{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"string"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"number"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"boolean"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"null"`; \} \| \{ `additionalProperties?`: `undefined`; `items`: \{ `$ref`: `string`; \}; `type`: `"array"`; \} \| \{ `additionalProperties`: \{ `$ref`: `string`; \}; `items?`: `undefined`; `type`: `"object"`; \})[]

###### runs.list.result.items

> `readonly` **items**: `object` = `flowRunSnapshotSchema`

###### runs.list.result.items.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### runs.list.result.items.definitions

> `readonly` **definitions**: `object` = `jsonDefinitions`

###### runs.list.result.items.definitions.json

> `readonly` **json**: `object`

###### runs.list.result.items.definitions.json.anyOf

> **anyOf**: (\{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"string"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"number"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"boolean"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"null"`; \} \| \{ `additionalProperties?`: `undefined`; `items`: \{ `$ref`: `string`; \}; `type`: `"array"`; \} \| \{ `additionalProperties`: \{ `$ref`: `string`; \}; `items?`: `undefined`; `type`: `"object"`; \})[]

###### runs.list.result.items.properties

> `readonly` **properties**: `object`

###### runs.list.result.items.properties.createdAt

> `readonly` **createdAt**: `object`

###### runs.list.result.items.properties.createdAt.type

> `readonly` **type**: `"number"` = `'number'`

###### runs.list.result.items.properties.error

> `readonly` **error**: `object`

###### runs.list.result.items.properties.error.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### runs.list.result.items.properties.error.properties

> `readonly` **properties**: `object`

###### runs.list.result.items.properties.error.properties.code

> `readonly` **code**: `object`

###### runs.list.result.items.properties.error.properties.code.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.list.result.items.properties.error.properties.message

> `readonly` **message**: `object`

###### runs.list.result.items.properties.error.properties.message.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.list.result.items.properties.error.properties.type

> `readonly` **type**: `object`

###### runs.list.result.items.properties.error.properties.type.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.list.result.items.properties.error.required

> `readonly` **required**: readonly \[`"type"`, `"message"`\]

###### runs.list.result.items.properties.error.type

> `readonly` **type**: `"object"` = `'object'`

###### runs.list.result.items.properties.flowID

> `readonly` **flowID**: `object`

###### runs.list.result.items.properties.flowID.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.list.result.items.properties.label

> `readonly` **label**: `object`

###### runs.list.result.items.properties.label.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.list.result.items.properties.plan

> `readonly` **plan**: `object` = `runPlanSchema`

###### runs.list.result.items.properties.plan.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### runs.list.result.items.properties.plan.properties

> `readonly` **properties**: `object`

###### runs.list.result.items.properties.plan.properties.tools

> `readonly` **tools**: `object`

###### runs.list.result.items.properties.plan.properties.tools.items

> `readonly` **items**: `object`

###### runs.list.result.items.properties.plan.properties.tools.items.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.list.result.items.properties.plan.properties.tools.type

> `readonly` **type**: `"array"` = `'array'`

###### runs.list.result.items.properties.plan.required

> `readonly` **required**: readonly \[`"tools"`\]

###### runs.list.result.items.properties.plan.type

> `readonly` **type**: `"object"` = `'object'`

###### runs.list.result.items.properties.result

> `readonly` **result**: `object`

###### runs.list.result.items.properties.result.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### runs.list.result.items.properties.result.properties

> `readonly` **properties**: `object`

###### runs.list.result.items.properties.result.properties.content

> `readonly` **content**: `object`

###### runs.list.result.items.properties.result.properties.content.items

> `readonly` **items**: `object` = `jsonObjectSchema`

###### runs.list.result.items.properties.result.properties.content.items.additionalProperties

> `readonly` **additionalProperties**: `object` = `jsonValueSchema`

###### runs.list.result.items.properties.result.properties.content.items.additionalProperties.$ref

> **$ref**: `string`

###### runs.list.result.items.properties.result.properties.content.items.type

> `readonly` **type**: `"object"` = `'object'`

###### runs.list.result.items.properties.result.properties.content.type

> `readonly` **type**: `"array"` = `'array'`

###### runs.list.result.items.properties.result.properties.outcome

> `readonly` **outcome**: `object`

###### runs.list.result.items.properties.result.properties.outcome.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.list.result.items.properties.result.properties.output

> `readonly` **output**: `object` = `jsonValueSchema`

###### runs.list.result.items.properties.result.properties.output.$ref

> **$ref**: `string`

###### runs.list.result.items.properties.result.required

> `readonly` **required**: readonly \[`"content"`\]

###### runs.list.result.items.properties.result.type

> `readonly` **type**: `"object"` = `'object'`

###### runs.list.result.items.properties.runID

> `readonly` **runID**: `object`

###### runs.list.result.items.properties.runID.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.list.result.items.properties.state

> `readonly` **state**: `object` = `runStateSchema`

###### runs.list.result.items.properties.state.enum

> `readonly` **enum**: readonly \[`"awaiting_approval"`, `"denied"`, `"working"`, `"input_required"`, `"completed"`, `"failed"`, `"cancelled"`\]

###### runs.list.result.items.properties.state.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.list.result.items.properties.traceID

> `readonly` **traceID**: `object`

###### runs.list.result.items.properties.traceID.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.list.result.items.properties.updatedAt

> `readonly` **updatedAt**: `object`

###### runs.list.result.items.properties.updatedAt.type

> `readonly` **type**: `"number"` = `'number'`

###### runs.list.result.items.required

> `readonly` **required**: readonly \[`"runID"`, `"label"`, `"state"`, `"createdAt"`, `"updatedAt"`, `"plan"`\]

###### runs.list.result.items.type

> `readonly` **type**: `"object"` = `'object'`

###### runs.list.result.type

> `readonly` **type**: `"array"` = `'array'`

###### runs.list.type

> `readonly` **type**: `"request"` = `'request'`

###### runs.start

> `readonly` **runs.start**: `object`

###### runs.start.param

> `readonly` **param**: `object`

###### runs.start.param.anyOf

> `readonly` **anyOf**: \[\{ `additionalProperties`: `false`; `properties`: \{ `flow`: \{ `type`: `"string"`; \}; `input`: \{ `additionalProperties`: \{ `$ref`: `string`; \}; `type`: `"object"`; \}; `label`: \{ `type`: `"string"`; \}; \}; `required`: readonly \[`"flow"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `definition`: \{ `additionalProperties`: \{ `$ref`: `string`; \}; `type`: `"object"`; \}; `input`: \{ `additionalProperties`: \{ `$ref`: `string`; \}; `type`: `"object"`; \}; `label`: \{ `type`: `"string"`; \}; \}; `required`: readonly \[`"definition"`\]; `type`: `"object"`; \}\]

###### runs.start.param.definitions

> `readonly` **definitions**: `object` = `jsonDefinitions`

###### runs.start.param.definitions.json

> `readonly` **json**: `object`

###### runs.start.param.definitions.json.anyOf

> **anyOf**: (\{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"string"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"number"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"boolean"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"null"`; \} \| \{ `additionalProperties?`: `undefined`; `items`: \{ `$ref`: `string`; \}; `type`: `"array"`; \} \| \{ `additionalProperties`: \{ `$ref`: `string`; \}; `items?`: `undefined`; `type`: `"object"`; \})[]

###### runs.start.result

> `readonly` **result**: `object` = `flowRunSnapshotSchema`

###### runs.start.result.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### runs.start.result.definitions

> `readonly` **definitions**: `object` = `jsonDefinitions`

###### runs.start.result.definitions.json

> `readonly` **json**: `object`

###### runs.start.result.definitions.json.anyOf

> **anyOf**: (\{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"string"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"number"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"boolean"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"null"`; \} \| \{ `additionalProperties?`: `undefined`; `items`: \{ `$ref`: `string`; \}; `type`: `"array"`; \} \| \{ `additionalProperties`: \{ `$ref`: `string`; \}; `items?`: `undefined`; `type`: `"object"`; \})[]

###### runs.start.result.properties

> `readonly` **properties**: `object`

###### runs.start.result.properties.createdAt

> `readonly` **createdAt**: `object`

###### runs.start.result.properties.createdAt.type

> `readonly` **type**: `"number"` = `'number'`

###### runs.start.result.properties.error

> `readonly` **error**: `object`

###### runs.start.result.properties.error.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### runs.start.result.properties.error.properties

> `readonly` **properties**: `object`

###### runs.start.result.properties.error.properties.code

> `readonly` **code**: `object`

###### runs.start.result.properties.error.properties.code.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.start.result.properties.error.properties.message

> `readonly` **message**: `object`

###### runs.start.result.properties.error.properties.message.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.start.result.properties.error.properties.type

> `readonly` **type**: `object`

###### runs.start.result.properties.error.properties.type.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.start.result.properties.error.required

> `readonly` **required**: readonly \[`"type"`, `"message"`\]

###### runs.start.result.properties.error.type

> `readonly` **type**: `"object"` = `'object'`

###### runs.start.result.properties.flowID

> `readonly` **flowID**: `object`

###### runs.start.result.properties.flowID.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.start.result.properties.label

> `readonly` **label**: `object`

###### runs.start.result.properties.label.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.start.result.properties.plan

> `readonly` **plan**: `object` = `runPlanSchema`

###### runs.start.result.properties.plan.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### runs.start.result.properties.plan.properties

> `readonly` **properties**: `object`

###### runs.start.result.properties.plan.properties.tools

> `readonly` **tools**: `object`

###### runs.start.result.properties.plan.properties.tools.items

> `readonly` **items**: `object`

###### runs.start.result.properties.plan.properties.tools.items.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.start.result.properties.plan.properties.tools.type

> `readonly` **type**: `"array"` = `'array'`

###### runs.start.result.properties.plan.required

> `readonly` **required**: readonly \[`"tools"`\]

###### runs.start.result.properties.plan.type

> `readonly` **type**: `"object"` = `'object'`

###### runs.start.result.properties.result

> `readonly` **result**: `object`

###### runs.start.result.properties.result.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### runs.start.result.properties.result.properties

> `readonly` **properties**: `object`

###### runs.start.result.properties.result.properties.content

> `readonly` **content**: `object`

###### runs.start.result.properties.result.properties.content.items

> `readonly` **items**: `object` = `jsonObjectSchema`

###### runs.start.result.properties.result.properties.content.items.additionalProperties

> `readonly` **additionalProperties**: `object` = `jsonValueSchema`

###### runs.start.result.properties.result.properties.content.items.additionalProperties.$ref

> **$ref**: `string`

###### runs.start.result.properties.result.properties.content.items.type

> `readonly` **type**: `"object"` = `'object'`

###### runs.start.result.properties.result.properties.content.type

> `readonly` **type**: `"array"` = `'array'`

###### runs.start.result.properties.result.properties.outcome

> `readonly` **outcome**: `object`

###### runs.start.result.properties.result.properties.outcome.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.start.result.properties.result.properties.output

> `readonly` **output**: `object` = `jsonValueSchema`

###### runs.start.result.properties.result.properties.output.$ref

> **$ref**: `string`

###### runs.start.result.properties.result.required

> `readonly` **required**: readonly \[`"content"`\]

###### runs.start.result.properties.result.type

> `readonly` **type**: `"object"` = `'object'`

###### runs.start.result.properties.runID

> `readonly` **runID**: `object`

###### runs.start.result.properties.runID.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.start.result.properties.state

> `readonly` **state**: `object` = `runStateSchema`

###### runs.start.result.properties.state.enum

> `readonly` **enum**: readonly \[`"awaiting_approval"`, `"denied"`, `"working"`, `"input_required"`, `"completed"`, `"failed"`, `"cancelled"`\]

###### runs.start.result.properties.state.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.start.result.properties.traceID

> `readonly` **traceID**: `object`

###### runs.start.result.properties.traceID.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.start.result.properties.updatedAt

> `readonly` **updatedAt**: `object`

###### runs.start.result.properties.updatedAt.type

> `readonly` **type**: `"number"` = `'number'`

###### runs.start.result.required

> `readonly` **required**: readonly \[`"runID"`, `"label"`, `"state"`, `"createdAt"`, `"updatedAt"`, `"plan"`\]

###### runs.start.result.type

> `readonly` **type**: `"object"` = `'object'`

###### runs.start.type

> `readonly` **type**: `"request"` = `'request'`

###### runs.trace

> `readonly` **runs.trace**: `object`

###### runs.trace.param

> `readonly` **param**: `object` = `runIDParamSchema`

###### runs.trace.param.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### runs.trace.param.properties

> `readonly` **properties**: `object`

###### runs.trace.param.properties.runID

> `readonly` **runID**: `object`

###### runs.trace.param.properties.runID.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.trace.param.required

> `readonly` **required**: readonly \[`"runID"`\]

###### runs.trace.param.type

> `readonly` **type**: `"object"` = `'object'`

###### runs.trace.result

> `readonly` **result**: `object`

###### runs.trace.result.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### runs.trace.result.definitions

> `readonly` **definitions**: `object` = `jsonDefinitions`

###### runs.trace.result.definitions.json

> `readonly` **json**: `object`

###### runs.trace.result.definitions.json.anyOf

> **anyOf**: (\{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"string"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"number"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"boolean"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"null"`; \} \| \{ `additionalProperties?`: `undefined`; `items`: \{ `$ref`: `string`; \}; `type`: `"array"`; \} \| \{ `additionalProperties`: \{ `$ref`: `string`; \}; `items?`: `undefined`; `type`: `"object"`; \})[]

###### runs.trace.result.properties

> `readonly` **properties**: `object`

###### runs.trace.result.properties.logs

> `readonly` **logs**: `object`

###### runs.trace.result.properties.logs.items

> `readonly` **items**: `object` = `storedLogSchema`

###### runs.trace.result.properties.logs.items.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### runs.trace.result.properties.logs.items.definitions

> `readonly` **definitions**: `object` = `jsonDefinitions`

###### runs.trace.result.properties.logs.items.definitions.json

> `readonly` **json**: `object`

###### runs.trace.result.properties.logs.items.definitions.json.anyOf

> **anyOf**: (\{ `additionalProperties?`: ...; `items?`: ...; `type`: ...; \} \| \{ `additionalProperties?`: ...; `items?`: ...; `type`: ...; \} \| \{ `additionalProperties?`: ...; `items?`: ...; `type`: ...; \} \| \{ `additionalProperties?`: ...; `items?`: ...; `type`: ...; \} \| \{ `additionalProperties?`: ...; `items`: ...; `type`: ...; \} \| \{ `additionalProperties`: ...; `items?`: ...; `type`: ...; \})[]

###### runs.trace.result.properties.logs.items.properties

> `readonly` **properties**: `object`

###### runs.trace.result.properties.logs.items.properties.category

> `readonly` **category**: `object`

###### runs.trace.result.properties.logs.items.properties.category.items

> `readonly` **items**: `object`

###### runs.trace.result.properties.logs.items.properties.category.items.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.trace.result.properties.logs.items.properties.category.type

> `readonly` **type**: `"array"` = `'array'`

###### runs.trace.result.properties.logs.items.properties.level

> `readonly` **level**: `object`

###### runs.trace.result.properties.logs.items.properties.level.enum

> `readonly` **enum**: readonly \[`"trace"`, `"debug"`, `"info"`, `"warning"`, `"error"`, `"fatal"`\]

###### runs.trace.result.properties.logs.items.properties.level.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.trace.result.properties.logs.items.properties.message

> `readonly` **message**: `object`

###### runs.trace.result.properties.logs.items.properties.message.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.trace.result.properties.logs.items.properties.properties

> `readonly` **properties**: `object` = `jsonObjectSchema`

###### runs.trace.result.properties.logs.items.properties.properties.additionalProperties

> `readonly` **additionalProperties**: `object` = `jsonValueSchema`

###### runs.trace.result.properties.logs.items.properties.properties.additionalProperties.$ref

> **$ref**: `string`

###### runs.trace.result.properties.logs.items.properties.properties.type

> `readonly` **type**: `"object"` = `'object'`

###### runs.trace.result.properties.logs.items.properties.spanID

> `readonly` **spanID**: `object`

###### runs.trace.result.properties.logs.items.properties.spanID.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.trace.result.properties.logs.items.properties.timestamp

> `readonly` **timestamp**: `object`

###### runs.trace.result.properties.logs.items.properties.timestamp.type

> `readonly` **type**: `"number"` = `'number'`

###### runs.trace.result.properties.logs.items.properties.traceID

> `readonly` **traceID**: `object`

###### runs.trace.result.properties.logs.items.properties.traceID.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.trace.result.properties.logs.items.required

> `readonly` **required**: readonly \[`"traceID"`, `"spanID"`, `"timestamp"`, `"level"`, `"category"`, `"message"`, `"properties"`\]

###### runs.trace.result.properties.logs.items.type

> `readonly` **type**: `"object"` = `'object'`

###### runs.trace.result.properties.logs.type

> `readonly` **type**: `"array"` = `'array'`

###### runs.trace.result.properties.spans

> `readonly` **spans**: `object`

###### runs.trace.result.properties.spans.items

> `readonly` **items**: `object` = `storedSpanSchema`

###### runs.trace.result.properties.spans.items.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### runs.trace.result.properties.spans.items.definitions

> `readonly` **definitions**: `object` = `jsonDefinitions`

###### runs.trace.result.properties.spans.items.definitions.json

> `readonly` **json**: `object`

###### runs.trace.result.properties.spans.items.definitions.json.anyOf

> **anyOf**: (\{ `additionalProperties?`: ...; `items?`: ...; `type`: ...; \} \| \{ `additionalProperties?`: ...; `items?`: ...; `type`: ...; \} \| \{ `additionalProperties?`: ...; `items?`: ...; `type`: ...; \} \| \{ `additionalProperties?`: ...; `items?`: ...; `type`: ...; \} \| \{ `additionalProperties?`: ...; `items`: ...; `type`: ...; \} \| \{ `additionalProperties`: ...; `items?`: ...; `type`: ...; \})[]

###### runs.trace.result.properties.spans.items.properties

> `readonly` **properties**: `object`

###### runs.trace.result.properties.spans.items.properties.attributes

> `readonly` **attributes**: `object` = `jsonObjectSchema`

###### runs.trace.result.properties.spans.items.properties.attributes.additionalProperties

> `readonly` **additionalProperties**: `object` = `jsonValueSchema`

###### runs.trace.result.properties.spans.items.properties.attributes.additionalProperties.$ref

> **$ref**: `string`

###### runs.trace.result.properties.spans.items.properties.attributes.type

> `readonly` **type**: `"object"` = `'object'`

###### runs.trace.result.properties.spans.items.properties.endTime

> `readonly` **endTime**: `object`

###### runs.trace.result.properties.spans.items.properties.endTime.type

> `readonly` **type**: `"number"` = `'number'`

###### runs.trace.result.properties.spans.items.properties.events

> `readonly` **events**: `object`

###### runs.trace.result.properties.spans.items.properties.events.items

> `readonly` **items**: `object`

###### runs.trace.result.properties.spans.items.properties.events.items.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### runs.trace.result.properties.spans.items.properties.events.items.properties

> `readonly` **properties**: `object`

###### runs.trace.result.properties.spans.items.properties.events.items.properties.attributes

> `readonly` **attributes**: `object` = `jsonObjectSchema`

###### runs.trace.result.properties.spans.items.properties.events.items.properties.attributes.additionalProperties

> `readonly` **additionalProperties**: ... = `jsonValueSchema`

###### runs.trace.result.properties.spans.items.properties.events.items.properties.attributes.type

> `readonly` **type**: ... = `'object'`

###### runs.trace.result.properties.spans.items.properties.events.items.properties.name

> `readonly` **name**: `object`

###### runs.trace.result.properties.spans.items.properties.events.items.properties.name.type

> `readonly` **type**: ... = `'string'`

###### runs.trace.result.properties.spans.items.properties.events.items.properties.time

> `readonly` **time**: `object`

###### runs.trace.result.properties.spans.items.properties.events.items.properties.time.type

> `readonly` **type**: ... = `'number'`

###### runs.trace.result.properties.spans.items.properties.events.items.required

> `readonly` **required**: readonly \[`"name"`, `"time"`, `"attributes"`\]

###### runs.trace.result.properties.spans.items.properties.events.items.type

> `readonly` **type**: `"object"` = `'object'`

###### runs.trace.result.properties.spans.items.properties.events.type

> `readonly` **type**: `"array"` = `'array'`

###### runs.trace.result.properties.spans.items.properties.kind

> `readonly` **kind**: `object`

###### runs.trace.result.properties.spans.items.properties.kind.type

> `readonly` **type**: `"number"` = `'number'`

###### runs.trace.result.properties.spans.items.properties.links

> `readonly` **links**: `object`

###### runs.trace.result.properties.spans.items.properties.links.items

> `readonly` **items**: `object`

###### runs.trace.result.properties.spans.items.properties.links.items.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### runs.trace.result.properties.spans.items.properties.links.items.properties

> `readonly` **properties**: `object`

###### runs.trace.result.properties.spans.items.properties.links.items.properties.spanID

> `readonly` **spanID**: `object`

###### runs.trace.result.properties.spans.items.properties.links.items.properties.spanID.type

> `readonly` **type**: ... = `'string'`

###### runs.trace.result.properties.spans.items.properties.links.items.properties.traceID

> `readonly` **traceID**: `object`

###### runs.trace.result.properties.spans.items.properties.links.items.properties.traceID.type

> `readonly` **type**: ... = `'string'`

###### runs.trace.result.properties.spans.items.properties.links.items.required

> `readonly` **required**: readonly \[`"traceID"`, `"spanID"`\]

###### runs.trace.result.properties.spans.items.properties.links.items.type

> `readonly` **type**: `"object"` = `'object'`

###### runs.trace.result.properties.spans.items.properties.links.type

> `readonly` **type**: `"array"` = `'array'`

###### runs.trace.result.properties.spans.items.properties.name

> `readonly` **name**: `object`

###### runs.trace.result.properties.spans.items.properties.name.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.trace.result.properties.spans.items.properties.parentSpanID

> `readonly` **parentSpanID**: `object`

###### runs.trace.result.properties.spans.items.properties.parentSpanID.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.trace.result.properties.spans.items.properties.spanID

> `readonly` **spanID**: `object`

###### runs.trace.result.properties.spans.items.properties.spanID.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.trace.result.properties.spans.items.properties.startTime

> `readonly` **startTime**: `object`

###### runs.trace.result.properties.spans.items.properties.startTime.type

> `readonly` **type**: `"number"` = `'number'`

###### runs.trace.result.properties.spans.items.properties.status

> `readonly` **status**: `object`

###### runs.trace.result.properties.spans.items.properties.status.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### runs.trace.result.properties.spans.items.properties.status.properties

> `readonly` **properties**: `object`

###### runs.trace.result.properties.spans.items.properties.status.properties.code

> `readonly` **code**: `object`

###### runs.trace.result.properties.spans.items.properties.status.properties.code.type

> `readonly` **type**: `"number"` = `'number'`

###### runs.trace.result.properties.spans.items.properties.status.properties.message

> `readonly` **message**: `object`

###### runs.trace.result.properties.spans.items.properties.status.properties.message.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.trace.result.properties.spans.items.properties.status.required

> `readonly` **required**: readonly \[`"code"`\]

###### runs.trace.result.properties.spans.items.properties.status.type

> `readonly` **type**: `"object"` = `'object'`

###### runs.trace.result.properties.spans.items.properties.traceID

> `readonly` **traceID**: `object`

###### runs.trace.result.properties.spans.items.properties.traceID.type

> `readonly` **type**: `"string"` = `'string'`

###### runs.trace.result.properties.spans.items.required

> `readonly` **required**: readonly \[`"traceID"`, `"spanID"`, `"name"`, `"kind"`, `"startTime"`, `"endTime"`, `"status"`, `"attributes"`, `"events"`, `"links"`\]

###### runs.trace.result.properties.spans.items.type

> `readonly` **type**: `"object"` = `'object'`

###### runs.trace.result.properties.spans.type

> `readonly` **type**: `"array"` = `'array'`

###### runs.trace.result.required

> `readonly` **required**: readonly \[`"spans"`, `"logs"`\]

###### runs.trace.result.type

> `readonly` **type**: `"object"` = `'object'`

###### runs.trace.type

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

###### traces.get

> `readonly` **traces.get**: `object`

###### traces.get.param

> `readonly` **param**: `object` = `tracesGetParamsSchema`

###### traces.get.param.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### traces.get.param.properties

> `readonly` **properties**: `object`

###### traces.get.param.properties.traceID

> `readonly` **traceID**: `object`

###### traces.get.param.properties.traceID.type

> `readonly` **type**: `"string"` = `'string'`

###### traces.get.param.required

> `readonly` **required**: readonly \[`"traceID"`\]

###### traces.get.param.type

> `readonly` **type**: `"object"` = `'object'`

###### traces.get.result

> `readonly` **result**: `object` = `tracesGetResultSchema`

###### traces.get.result.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### traces.get.result.definitions

> `readonly` **definitions**: `object` = `jsonDefinitions`

###### traces.get.result.definitions.json

> `readonly` **json**: `object`

###### traces.get.result.definitions.json.anyOf

> **anyOf**: (\{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"string"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"number"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"boolean"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"null"`; \} \| \{ `additionalProperties?`: `undefined`; `items`: \{ `$ref`: `string`; \}; `type`: `"array"`; \} \| \{ `additionalProperties`: \{ `$ref`: `string`; \}; `items?`: `undefined`; `type`: `"object"`; \})[]

###### traces.get.result.properties

> `readonly` **properties**: `object`

###### traces.get.result.properties.logs

> `readonly` **logs**: `object`

###### traces.get.result.properties.logs.items

> `readonly` **items**: `object` = `traceLogSchema`

###### traces.get.result.properties.logs.items.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### traces.get.result.properties.logs.items.definitions

> `readonly` **definitions**: `object` = `jsonDefinitions`

###### traces.get.result.properties.logs.items.definitions.json

> `readonly` **json**: `object`

###### traces.get.result.properties.logs.items.definitions.json.anyOf

> **anyOf**: (\{ `additionalProperties?`: ...; `items?`: ...; `type`: ...; \} \| \{ `additionalProperties?`: ...; `items?`: ...; `type`: ...; \} \| \{ `additionalProperties?`: ...; `items?`: ...; `type`: ...; \} \| \{ `additionalProperties?`: ...; `items?`: ...; `type`: ...; \} \| \{ `additionalProperties?`: ...; `items`: ...; `type`: ...; \} \| \{ `additionalProperties`: ...; `items?`: ...; `type`: ...; \})[]

###### traces.get.result.properties.logs.items.properties

> `readonly` **properties**: `object`

###### traces.get.result.properties.logs.items.properties.category

> `readonly` **category**: `object`

###### traces.get.result.properties.logs.items.properties.category.items

> `readonly` **items**: `object`

###### traces.get.result.properties.logs.items.properties.category.items.type

> `readonly` **type**: `"string"` = `'string'`

###### traces.get.result.properties.logs.items.properties.category.type

> `readonly` **type**: `"array"` = `'array'`

###### traces.get.result.properties.logs.items.properties.level

> `readonly` **level**: `object`

###### traces.get.result.properties.logs.items.properties.level.enum

> `readonly` **enum**: readonly \[`"trace"`, `"debug"`, `"info"`, `"warning"`, `"error"`, `"fatal"`\]

###### traces.get.result.properties.logs.items.properties.level.type

> `readonly` **type**: `"string"` = `'string'`

###### traces.get.result.properties.logs.items.properties.logID

> `readonly` **logID**: `object`

###### traces.get.result.properties.logs.items.properties.logID.type

> `readonly` **type**: `"string"` = `'string'`

###### traces.get.result.properties.logs.items.properties.message

> `readonly` **message**: `object`

###### traces.get.result.properties.logs.items.properties.message.type

> `readonly` **type**: `"string"` = `'string'`

###### traces.get.result.properties.logs.items.properties.properties

> `readonly` **properties**: `object` = `jsonObjectSchema`

###### traces.get.result.properties.logs.items.properties.properties.additionalProperties

> `readonly` **additionalProperties**: `object` = `jsonValueSchema`

###### traces.get.result.properties.logs.items.properties.properties.additionalProperties.$ref

> **$ref**: `string`

###### traces.get.result.properties.logs.items.properties.properties.type

> `readonly` **type**: `"object"` = `'object'`

###### traces.get.result.properties.logs.items.properties.spanID

> `readonly` **spanID**: `object`

###### traces.get.result.properties.logs.items.properties.spanID.type

> `readonly` **type**: `"string"` = `'string'`

###### traces.get.result.properties.logs.items.properties.timestamp

> `readonly` **timestamp**: `object`

###### traces.get.result.properties.logs.items.properties.timestamp.type

> `readonly` **type**: `"number"` = `'number'`

###### traces.get.result.properties.logs.items.properties.traceID

> `readonly` **traceID**: `object`

###### traces.get.result.properties.logs.items.properties.traceID.type

> `readonly` **type**: `"string"` = `'string'`

###### traces.get.result.properties.logs.items.required

> `readonly` **required**: readonly \[`"traceID"`, `"spanID"`, `"timestamp"`, `"level"`, `"category"`, `"message"`, `"properties"`, `"logID"`\]

###### traces.get.result.properties.logs.items.type

> `readonly` **type**: `"object"` = `'object'`

###### traces.get.result.properties.logs.type

> `readonly` **type**: `"array"` = `'array'`

###### traces.get.result.properties.logsTruncated

> `readonly` **logsTruncated**: `object`

###### traces.get.result.properties.logsTruncated.type

> `readonly` **type**: `"boolean"` = `'boolean'`

###### traces.get.result.properties.spans

> `readonly` **spans**: `object`

###### traces.get.result.properties.spans.items

> `readonly` **items**: `object`

###### traces.get.result.properties.spans.items.anyOf

> `readonly` **anyOf**: readonly \[\{ `additionalProperties`: `false`; `definitions`: \{ `json`: \{ `anyOf`: ...[]; \}; \}; `properties`: \{ `attributes`: \{ `additionalProperties`: \{ `$ref`: ...; \}; `type`: `"object"`; \}; `endTime`: \{ `type`: `"number"`; \}; `events`: \{ `items`: \{ `additionalProperties`: ...; `properties`: ...; `required`: ...; `type`: ...; \}; `type`: `"array"`; \}; `kind`: \{ `type`: `"number"`; \}; `links`: \{ `items`: \{ `additionalProperties`: ...; `properties`: ...; `required`: ...; `type`: ...; \}; `type`: `"array"`; \}; `name`: \{ `type`: `"string"`; \}; `parentSpanID`: \{ `type`: `"string"`; \}; `spanID`: \{ `type`: `"string"`; \}; `startTime`: \{ `type`: `"number"`; \}; `status`: \{ `additionalProperties`: `false`; `properties`: \{ `code`: ...; `message`: ...; \}; `required`: readonly \[...\]; `type`: `"object"`; \}; `traceID`: \{ `type`: `"string"`; \}; \}; `required`: readonly \[`"traceID"`, `"spanID"`, `"name"`, `"kind"`, `"startTime"`, `"endTime"`, `"status"`, `"attributes"`, `"events"`, `"links"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `definitions`: \{ `json`: \{ `anyOf`: ...[]; \}; \}; `properties`: \{ `attributes`: \{ `additionalProperties`: \{ `$ref`: ...; \}; `type`: `"object"`; \}; `kind`: \{ `type`: `"number"`; \}; `links`: \{ `items`: \{ `additionalProperties`: ...; `properties`: ...; `required`: ...; `type`: ...; \}; `type`: `"array"`; \}; `name`: \{ `type`: `"string"`; \}; `parentSpanID`: \{ `type`: `"string"`; \}; `spanID`: \{ `type`: `"string"`; \}; `startTime`: \{ `type`: `"number"`; \}; `traceID`: \{ `type`: `"string"`; \}; \}; `required`: readonly \[`"traceID"`, `"spanID"`, `"name"`, `"kind"`, `"startTime"`, `"attributes"`, `"links"`\]; `type`: `"object"`; \}\]

###### traces.get.result.properties.spans.type

> `readonly` **type**: `"array"` = `'array'`

###### traces.get.result.properties.summary

> `readonly` **summary**: `object` = `traceSummarySchema`

###### traces.get.result.properties.summary.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### traces.get.result.properties.summary.definitions

> `readonly` **definitions**: `object` = `jsonDefinitions`

###### traces.get.result.properties.summary.definitions.json

> `readonly` **json**: `object`

###### traces.get.result.properties.summary.definitions.json.anyOf

> **anyOf**: (\{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"string"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"number"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"boolean"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"null"`; \} \| \{ `additionalProperties?`: `undefined`; `items`: \{ `$ref`: ...; \}; `type`: `"array"`; \} \| \{ `additionalProperties`: \{ `$ref`: ...; \}; `items?`: `undefined`; `type`: `"object"`; \})[]

###### traces.get.result.properties.summary.properties

> `readonly` **properties**: `object`

###### traces.get.result.properties.summary.properties.active

> `readonly` **active**: `object`

###### traces.get.result.properties.summary.properties.active.type

> `readonly` **type**: `"boolean"` = `'boolean'`

###### traces.get.result.properties.summary.properties.activeSegmentSpanID

> `readonly` **activeSegmentSpanID**: `object`

###### traces.get.result.properties.summary.properties.activeSegmentSpanID.type

> `readonly` **type**: `"string"` = `'string'`

###### traces.get.result.properties.summary.properties.attributes

> `readonly` **attributes**: `object`

###### traces.get.result.properties.summary.properties.attributes.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### traces.get.result.properties.summary.properties.attributes.properties

> `readonly` **properties**: `object`

###### traces.get.result.properties.summary.properties.attributes.properties.label

> `readonly` **label**: `object`

###### traces.get.result.properties.summary.properties.attributes.properties.label.type

> `readonly` **type**: `"string"` = `'string'`

###### traces.get.result.properties.summary.properties.attributes.properties.mokei.context.id

> `readonly` **mokei.context.id**: `object`

###### traces.get.result.properties.summary.properties.attributes.properties.mokei.context.id.type

> `readonly` **type**: `"string"` = `'string'`

###### traces.get.result.properties.summary.properties.attributes.properties.mokei.flow.id

> `readonly` **mokei.flow.id**: `object`

###### traces.get.result.properties.summary.properties.attributes.properties.mokei.flow.id.type

> `readonly` **type**: `"string"` = `'string'`

###### traces.get.result.properties.summary.properties.attributes.properties.mokei.run.id

> `readonly` **mokei.run.id**: `object`

###### traces.get.result.properties.summary.properties.attributes.properties.mokei.run.id.type

> `readonly` **type**: `"string"` = `'string'`

###### traces.get.result.properties.summary.properties.attributes.type

> `readonly` **type**: `"object"` = `'object'`

###### traces.get.result.properties.summary.properties.droppedCount

> `readonly` **droppedCount**: `object`

###### traces.get.result.properties.summary.properties.droppedCount.type

> `readonly` **type**: `"integer"` = `'integer'`

###### traces.get.result.properties.summary.properties.endTime

> `readonly` **endTime**: `object`

###### traces.get.result.properties.summary.properties.endTime.type

> `readonly` **type**: `"number"` = `'number'`

###### traces.get.result.properties.summary.properties.errorCount

> `readonly` **errorCount**: `object`

###### traces.get.result.properties.summary.properties.errorCount.type

> `readonly` **type**: `"integer"` = `'integer'`

###### traces.get.result.properties.summary.properties.kind

> `readonly` **kind**: `object`

###### traces.get.result.properties.summary.properties.kind.enum

> `readonly` **enum**: readonly \[`"context"`, `"mcp"`, `"flow"`, `"step"`\]

###### traces.get.result.properties.summary.properties.kind.type

> `readonly` **type**: `"string"` = `'string'`

###### traces.get.result.properties.summary.properties.name

> `readonly` **name**: `object`

###### traces.get.result.properties.summary.properties.name.type

> `readonly` **type**: `"string"` = `'string'`

###### traces.get.result.properties.summary.properties.outcome

> `readonly` **outcome**: `object`

###### traces.get.result.properties.summary.properties.outcome.enum

> `readonly` **enum**: readonly \[`"ok"`, `"error"`, `"interrupted"`, `null`\]

###### traces.get.result.properties.summary.properties.outcome.type

> `readonly` **type**: readonly \[`"string"`, `"null"`\]

###### traces.get.result.properties.summary.properties.revision

> `readonly` **revision**: `object`

###### traces.get.result.properties.summary.properties.revision.type

> `readonly` **type**: `"integer"` = `'integer'`

###### traces.get.result.properties.summary.properties.rootSpanID

> `readonly` **rootSpanID**: `object`

###### traces.get.result.properties.summary.properties.rootSpanID.type

> `readonly` **type**: `"string"` = `'string'`

###### traces.get.result.properties.summary.properties.spanCount

> `readonly` **spanCount**: `object`

###### traces.get.result.properties.summary.properties.spanCount.type

> `readonly` **type**: `"integer"` = `'integer'`

###### traces.get.result.properties.summary.properties.startTime

> `readonly` **startTime**: `object`

###### traces.get.result.properties.summary.properties.startTime.type

> `readonly` **type**: `"number"` = `'number'`

###### traces.get.result.properties.summary.properties.traceID

> `readonly` **traceID**: `object`

###### traces.get.result.properties.summary.properties.traceID.type

> `readonly` **type**: `"string"` = `'string'`

###### traces.get.result.properties.summary.required

> `readonly` **required**: readonly \[`"traceID"`, `"rootSpanID"`, `"kind"`, `"name"`, `"active"`, `"outcome"`, `"startTime"`, `"attributes"`, `"spanCount"`, `"errorCount"`, `"droppedCount"`, `"revision"`\]

###### traces.get.result.properties.summary.type

> `readonly` **type**: `"object"` = `'object'`

###### traces.get.result.required

> `readonly` **required**: readonly \[`"summary"`, `"spans"`, `"logs"`, `"logsTruncated"`\]

###### traces.get.result.type

> `readonly` **type**: `"object"` = `'object'`

###### traces.get.type

> `readonly` **type**: `"request"` = `'request'`

###### traces.list

> `readonly` **traces.list**: `object`

###### traces.list.param

> `readonly` **param**: `object` = `tracesListParamsSchema`

###### traces.list.param.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### traces.list.param.properties

> `readonly` **properties**: `object`

###### traces.list.param.properties.active

> `readonly` **active**: `object`

###### traces.list.param.properties.active.type

> `readonly` **type**: `"boolean"` = `'boolean'`

###### traces.list.param.properties.cursor

> `readonly` **cursor**: `object`

###### traces.list.param.properties.cursor.type

> `readonly` **type**: `"string"` = `'string'`

###### traces.list.param.properties.kind

> `readonly` **kind**: `object`

###### traces.list.param.properties.kind.enum

> `readonly` **enum**: readonly \[`"context"`, `"mcp"`, `"flow"`, `"step"`\]

###### traces.list.param.properties.kind.type

> `readonly` **type**: `"string"` = `'string'`

###### traces.list.param.properties.limit

> `readonly` **limit**: `object`

###### traces.list.param.properties.limit.type

> `readonly` **type**: `"integer"` = `'integer'`

###### traces.list.param.properties.name

> `readonly` **name**: `object`

###### traces.list.param.properties.name.type

> `readonly` **type**: `"string"` = `'string'`

###### traces.list.param.properties.outcome

> `readonly` **outcome**: `object`

###### traces.list.param.properties.outcome.enum

> `readonly` **enum**: readonly \[`"ok"`, `"error"`, `"interrupted"`, `null`\]

###### traces.list.param.properties.outcome.type

> `readonly` **type**: readonly \[`"string"`, `"null"`\]

###### traces.list.param.properties.since

> `readonly` **since**: `object`

###### traces.list.param.properties.since.type

> `readonly` **type**: `"number"` = `'number'`

###### traces.list.param.properties.until

> `readonly` **until**: `object`

###### traces.list.param.properties.until.type

> `readonly` **type**: `"number"` = `'number'`

###### traces.list.param.required

> `readonly` **required**: readonly \[`"limit"`\]

###### traces.list.param.type

> `readonly` **type**: `"object"` = `'object'`

###### traces.list.result

> `readonly` **result**: `object` = `tracesListResultSchema`

###### traces.list.result.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### traces.list.result.definitions

> `readonly` **definitions**: `object` = `jsonDefinitions`

###### traces.list.result.definitions.json

> `readonly` **json**: `object`

###### traces.list.result.definitions.json.anyOf

> **anyOf**: (\{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"string"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"number"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"boolean"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"null"`; \} \| \{ `additionalProperties?`: `undefined`; `items`: \{ `$ref`: `string`; \}; `type`: `"array"`; \} \| \{ `additionalProperties`: \{ `$ref`: `string`; \}; `items?`: `undefined`; `type`: `"object"`; \})[]

###### traces.list.result.properties

> `readonly` **properties**: `object`

###### traces.list.result.properties.cursor

> `readonly` **cursor**: `object`

###### traces.list.result.properties.cursor.type

> `readonly` **type**: `"string"` = `'string'`

###### traces.list.result.properties.traces

> `readonly` **traces**: `object`

###### traces.list.result.properties.traces.items

> `readonly` **items**: `object` = `traceSummarySchema`

###### traces.list.result.properties.traces.items.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### traces.list.result.properties.traces.items.definitions

> `readonly` **definitions**: `object` = `jsonDefinitions`

###### traces.list.result.properties.traces.items.definitions.json

> `readonly` **json**: `object`

###### traces.list.result.properties.traces.items.definitions.json.anyOf

> **anyOf**: (\{ `additionalProperties?`: ...; `items?`: ...; `type`: ...; \} \| \{ `additionalProperties?`: ...; `items?`: ...; `type`: ...; \} \| \{ `additionalProperties?`: ...; `items?`: ...; `type`: ...; \} \| \{ `additionalProperties?`: ...; `items?`: ...; `type`: ...; \} \| \{ `additionalProperties?`: ...; `items`: ...; `type`: ...; \} \| \{ `additionalProperties`: ...; `items?`: ...; `type`: ...; \})[]

###### traces.list.result.properties.traces.items.properties

> `readonly` **properties**: `object`

###### traces.list.result.properties.traces.items.properties.active

> `readonly` **active**: `object`

###### traces.list.result.properties.traces.items.properties.active.type

> `readonly` **type**: `"boolean"` = `'boolean'`

###### traces.list.result.properties.traces.items.properties.activeSegmentSpanID

> `readonly` **activeSegmentSpanID**: `object`

###### traces.list.result.properties.traces.items.properties.activeSegmentSpanID.type

> `readonly` **type**: `"string"` = `'string'`

###### traces.list.result.properties.traces.items.properties.attributes

> `readonly` **attributes**: `object`

###### traces.list.result.properties.traces.items.properties.attributes.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### traces.list.result.properties.traces.items.properties.attributes.properties

> `readonly` **properties**: `object`

###### traces.list.result.properties.traces.items.properties.attributes.properties.label

> `readonly` **label**: `object`

###### traces.list.result.properties.traces.items.properties.attributes.properties.label.type

> `readonly` **type**: `"string"` = `'string'`

###### traces.list.result.properties.traces.items.properties.attributes.properties.mokei.context.id

> `readonly` **mokei.context.id**: `object`

###### traces.list.result.properties.traces.items.properties.attributes.properties.mokei.context.id.type

> `readonly` **type**: `"string"` = `'string'`

###### traces.list.result.properties.traces.items.properties.attributes.properties.mokei.flow.id

> `readonly` **mokei.flow.id**: `object`

###### traces.list.result.properties.traces.items.properties.attributes.properties.mokei.flow.id.type

> `readonly` **type**: `"string"` = `'string'`

###### traces.list.result.properties.traces.items.properties.attributes.properties.mokei.run.id

> `readonly` **mokei.run.id**: `object`

###### traces.list.result.properties.traces.items.properties.attributes.properties.mokei.run.id.type

> `readonly` **type**: `"string"` = `'string'`

###### traces.list.result.properties.traces.items.properties.attributes.type

> `readonly` **type**: `"object"` = `'object'`

###### traces.list.result.properties.traces.items.properties.droppedCount

> `readonly` **droppedCount**: `object`

###### traces.list.result.properties.traces.items.properties.droppedCount.type

> `readonly` **type**: `"integer"` = `'integer'`

###### traces.list.result.properties.traces.items.properties.endTime

> `readonly` **endTime**: `object`

###### traces.list.result.properties.traces.items.properties.endTime.type

> `readonly` **type**: `"number"` = `'number'`

###### traces.list.result.properties.traces.items.properties.errorCount

> `readonly` **errorCount**: `object`

###### traces.list.result.properties.traces.items.properties.errorCount.type

> `readonly` **type**: `"integer"` = `'integer'`

###### traces.list.result.properties.traces.items.properties.kind

> `readonly` **kind**: `object`

###### traces.list.result.properties.traces.items.properties.kind.enum

> `readonly` **enum**: readonly \[`"context"`, `"mcp"`, `"flow"`, `"step"`\]

###### traces.list.result.properties.traces.items.properties.kind.type

> `readonly` **type**: `"string"` = `'string'`

###### traces.list.result.properties.traces.items.properties.name

> `readonly` **name**: `object`

###### traces.list.result.properties.traces.items.properties.name.type

> `readonly` **type**: `"string"` = `'string'`

###### traces.list.result.properties.traces.items.properties.outcome

> `readonly` **outcome**: `object`

###### traces.list.result.properties.traces.items.properties.outcome.enum

> `readonly` **enum**: readonly \[`"ok"`, `"error"`, `"interrupted"`, `null`\]

###### traces.list.result.properties.traces.items.properties.outcome.type

> `readonly` **type**: readonly \[`"string"`, `"null"`\]

###### traces.list.result.properties.traces.items.properties.revision

> `readonly` **revision**: `object`

###### traces.list.result.properties.traces.items.properties.revision.type

> `readonly` **type**: `"integer"` = `'integer'`

###### traces.list.result.properties.traces.items.properties.rootSpanID

> `readonly` **rootSpanID**: `object`

###### traces.list.result.properties.traces.items.properties.rootSpanID.type

> `readonly` **type**: `"string"` = `'string'`

###### traces.list.result.properties.traces.items.properties.spanCount

> `readonly` **spanCount**: `object`

###### traces.list.result.properties.traces.items.properties.spanCount.type

> `readonly` **type**: `"integer"` = `'integer'`

###### traces.list.result.properties.traces.items.properties.startTime

> `readonly` **startTime**: `object`

###### traces.list.result.properties.traces.items.properties.startTime.type

> `readonly` **type**: `"number"` = `'number'`

###### traces.list.result.properties.traces.items.properties.traceID

> `readonly` **traceID**: `object`

###### traces.list.result.properties.traces.items.properties.traceID.type

> `readonly` **type**: `"string"` = `'string'`

###### traces.list.result.properties.traces.items.required

> `readonly` **required**: readonly \[`"traceID"`, `"rootSpanID"`, `"kind"`, `"name"`, `"active"`, `"outcome"`, `"startTime"`, `"attributes"`, `"spanCount"`, `"errorCount"`, `"droppedCount"`, `"revision"`\]

###### traces.list.result.properties.traces.items.type

> `readonly` **type**: `"object"` = `'object'`

###### traces.list.result.properties.traces.type

> `readonly` **type**: `"array"` = `'array'`

###### traces.list.result.required

> `readonly` **required**: readonly \[`"traces"`\]

###### traces.list.result.type

> `readonly` **type**: `"object"` = `'object'`

###### traces.list.type

> `readonly` **type**: `"request"` = `'request'`

***

### serviceEventMetaSchema

> `const` **serviceEventMetaSchema**: `object`

#### Type Declaration

##### additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

##### properties

> `readonly` **properties**: `object`

###### properties.eventID

> `readonly` **eventID**: `object`

###### properties.eventID.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.time

> `readonly` **time**: `object`

###### properties.time.type

> `readonly` **type**: `"integer"` = `'integer'`

##### required

> `readonly` **required**: readonly \[`"eventID"`, `"time"`\]

##### type

> `readonly` **type**: `"object"` = `'object'`

***

### storedLogSchema

> `const` **storedLogSchema**: `object`

#### Type Declaration

##### additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

##### definitions

> `readonly` **definitions**: `object` = `jsonDefinitions`

###### definitions.json

> `readonly` **json**: `object`

###### definitions.json.anyOf

> **anyOf**: (\{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"string"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"number"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"boolean"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"null"`; \} \| \{ `additionalProperties?`: `undefined`; `items`: \{ `$ref`: `string`; \}; `type`: `"array"`; \} \| \{ `additionalProperties`: \{ `$ref`: `string`; \}; `items?`: `undefined`; `type`: `"object"`; \})[]

##### properties

> `readonly` **properties**: `object`

###### properties.category

> `readonly` **category**: `object`

###### properties.category.items

> `readonly` **items**: `object`

###### properties.category.items.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.category.type

> `readonly` **type**: `"array"` = `'array'`

###### properties.level

> `readonly` **level**: `object`

###### properties.level.enum

> `readonly` **enum**: readonly \[`"trace"`, `"debug"`, `"info"`, `"warning"`, `"error"`, `"fatal"`\]

###### properties.level.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.message

> `readonly` **message**: `object`

###### properties.message.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.properties

> `readonly` **properties**: `object` = `jsonObjectSchema`

###### properties.properties.additionalProperties

> `readonly` **additionalProperties**: `object` = `jsonValueSchema`

###### properties.properties.additionalProperties.$ref

> **$ref**: `string`

###### properties.properties.type

> `readonly` **type**: `"object"` = `'object'`

###### properties.spanID

> `readonly` **spanID**: `object`

###### properties.spanID.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.timestamp

> `readonly` **timestamp**: `object`

###### properties.timestamp.type

> `readonly` **type**: `"number"` = `'number'`

###### properties.traceID

> `readonly` **traceID**: `object`

###### properties.traceID.type

> `readonly` **type**: `"string"` = `'string'`

##### required

> `readonly` **required**: readonly \[`"traceID"`, `"spanID"`, `"timestamp"`, `"level"`, `"category"`, `"message"`, `"properties"`\]

##### type

> `readonly` **type**: `"object"` = `'object'`

***

### storedSpanSchema

> `const` **storedSpanSchema**: `object`

#### Type Declaration

##### additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

##### definitions

> `readonly` **definitions**: `object` = `jsonDefinitions`

###### definitions.json

> `readonly` **json**: `object`

###### definitions.json.anyOf

> **anyOf**: (\{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"string"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"number"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"boolean"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"null"`; \} \| \{ `additionalProperties?`: `undefined`; `items`: \{ `$ref`: `string`; \}; `type`: `"array"`; \} \| \{ `additionalProperties`: \{ `$ref`: `string`; \}; `items?`: `undefined`; `type`: `"object"`; \})[]

##### properties

> `readonly` **properties**: `object`

###### properties.attributes

> `readonly` **attributes**: `object` = `jsonObjectSchema`

###### properties.attributes.additionalProperties

> `readonly` **additionalProperties**: `object` = `jsonValueSchema`

###### properties.attributes.additionalProperties.$ref

> **$ref**: `string`

###### properties.attributes.type

> `readonly` **type**: `"object"` = `'object'`

###### properties.endTime

> `readonly` **endTime**: `object`

###### properties.endTime.type

> `readonly` **type**: `"number"` = `'number'`

###### properties.events

> `readonly` **events**: `object`

###### properties.events.items

> `readonly` **items**: `object`

###### properties.events.items.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### properties.events.items.properties

> `readonly` **properties**: `object`

###### properties.events.items.properties.attributes

> `readonly` **attributes**: `object` = `jsonObjectSchema`

###### properties.events.items.properties.attributes.additionalProperties

> `readonly` **additionalProperties**: `object` = `jsonValueSchema`

###### properties.events.items.properties.attributes.additionalProperties.$ref

> **$ref**: `string`

###### properties.events.items.properties.attributes.type

> `readonly` **type**: `"object"` = `'object'`

###### properties.events.items.properties.name

> `readonly` **name**: `object`

###### properties.events.items.properties.name.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.events.items.properties.time

> `readonly` **time**: `object`

###### properties.events.items.properties.time.type

> `readonly` **type**: `"number"` = `'number'`

###### properties.events.items.required

> `readonly` **required**: readonly \[`"name"`, `"time"`, `"attributes"`\]

###### properties.events.items.type

> `readonly` **type**: `"object"` = `'object'`

###### properties.events.type

> `readonly` **type**: `"array"` = `'array'`

###### properties.kind

> `readonly` **kind**: `object`

###### properties.kind.type

> `readonly` **type**: `"number"` = `'number'`

###### properties.links

> `readonly` **links**: `object`

###### properties.links.items

> `readonly` **items**: `object`

###### properties.links.items.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### properties.links.items.properties

> `readonly` **properties**: `object`

###### properties.links.items.properties.spanID

> `readonly` **spanID**: `object`

###### properties.links.items.properties.spanID.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.links.items.properties.traceID

> `readonly` **traceID**: `object`

###### properties.links.items.properties.traceID.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.links.items.required

> `readonly` **required**: readonly \[`"traceID"`, `"spanID"`\]

###### properties.links.items.type

> `readonly` **type**: `"object"` = `'object'`

###### properties.links.type

> `readonly` **type**: `"array"` = `'array'`

###### properties.name

> `readonly` **name**: `object`

###### properties.name.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.parentSpanID

> `readonly` **parentSpanID**: `object`

###### properties.parentSpanID.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.spanID

> `readonly` **spanID**: `object`

###### properties.spanID.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.startTime

> `readonly` **startTime**: `object`

###### properties.startTime.type

> `readonly` **type**: `"number"` = `'number'`

###### properties.status

> `readonly` **status**: `object`

###### properties.status.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### properties.status.properties

> `readonly` **properties**: `object`

###### properties.status.properties.code

> `readonly` **code**: `object`

###### properties.status.properties.code.type

> `readonly` **type**: `"number"` = `'number'`

###### properties.status.properties.message

> `readonly` **message**: `object`

###### properties.status.properties.message.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.status.required

> `readonly` **required**: readonly \[`"code"`\]

###### properties.status.type

> `readonly` **type**: `"object"` = `'object'`

###### properties.traceID

> `readonly` **traceID**: `object`

###### properties.traceID.type

> `readonly` **type**: `"string"` = `'string'`

##### required

> `readonly` **required**: readonly \[`"traceID"`, `"spanID"`, `"name"`, `"kind"`, `"startTime"`, `"endTime"`, `"status"`, `"attributes"`, `"events"`, `"links"`\]

##### type

> `readonly` **type**: `"object"` = `'object'`

***

### traceLogSchema

> `const` **traceLogSchema**: `object`

#### Type Declaration

##### additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

##### definitions

> `readonly` **definitions**: `object` = `jsonDefinitions`

###### definitions.json

> `readonly` **json**: `object`

###### definitions.json.anyOf

> **anyOf**: (\{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"string"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"number"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"boolean"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"null"`; \} \| \{ `additionalProperties?`: `undefined`; `items`: \{ `$ref`: `string`; \}; `type`: `"array"`; \} \| \{ `additionalProperties`: \{ `$ref`: `string`; \}; `items?`: `undefined`; `type`: `"object"`; \})[]

##### properties

> `readonly` **properties**: `object`

###### properties.category

> `readonly` **category**: `object`

###### properties.category.items

> `readonly` **items**: `object`

###### properties.category.items.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.category.type

> `readonly` **type**: `"array"` = `'array'`

###### properties.level

> `readonly` **level**: `object`

###### properties.level.enum

> `readonly` **enum**: readonly \[`"trace"`, `"debug"`, `"info"`, `"warning"`, `"error"`, `"fatal"`\]

###### properties.level.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.logID

> `readonly` **logID**: `object`

###### properties.logID.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.message

> `readonly` **message**: `object`

###### properties.message.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.properties

> `readonly` **properties**: `object` = `jsonObjectSchema`

###### properties.properties.additionalProperties

> `readonly` **additionalProperties**: `object` = `jsonValueSchema`

###### properties.properties.additionalProperties.$ref

> **$ref**: `string`

###### properties.properties.type

> `readonly` **type**: `"object"` = `'object'`

###### properties.spanID

> `readonly` **spanID**: `object`

###### properties.spanID.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.timestamp

> `readonly` **timestamp**: `object`

###### properties.timestamp.type

> `readonly` **type**: `"number"` = `'number'`

###### properties.traceID

> `readonly` **traceID**: `object`

###### properties.traceID.type

> `readonly` **type**: `"string"` = `'string'`

##### required

> `readonly` **required**: readonly \[`"traceID"`, `"spanID"`, `"timestamp"`, `"level"`, `"category"`, `"message"`, `"properties"`, `"logID"`\]

##### type

> `readonly` **type**: `"object"` = `'object'`

***

### tracesGetParamsSchema

> `const` **tracesGetParamsSchema**: `object`

#### Type Declaration

##### additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

##### properties

> `readonly` **properties**: `object`

###### properties.traceID

> `readonly` **traceID**: `object`

###### properties.traceID.type

> `readonly` **type**: `"string"` = `'string'`

##### required

> `readonly` **required**: readonly \[`"traceID"`\]

##### type

> `readonly` **type**: `"object"` = `'object'`

***

### tracesGetResultSchema

> `const` **tracesGetResultSchema**: `object`

#### Type Declaration

##### additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

##### definitions

> `readonly` **definitions**: `object` = `jsonDefinitions`

###### definitions.json

> `readonly` **json**: `object`

###### definitions.json.anyOf

> **anyOf**: (\{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"string"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"number"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"boolean"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"null"`; \} \| \{ `additionalProperties?`: `undefined`; `items`: \{ `$ref`: `string`; \}; `type`: `"array"`; \} \| \{ `additionalProperties`: \{ `$ref`: `string`; \}; `items?`: `undefined`; `type`: `"object"`; \})[]

##### properties

> `readonly` **properties**: `object`

###### properties.logs

> `readonly` **logs**: `object`

###### properties.logs.items

> `readonly` **items**: `object` = `traceLogSchema`

###### properties.logs.items.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### properties.logs.items.definitions

> `readonly` **definitions**: `object` = `jsonDefinitions`

###### properties.logs.items.definitions.json

> `readonly` **json**: `object`

###### properties.logs.items.definitions.json.anyOf

> **anyOf**: (\{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"string"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"number"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"boolean"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"null"`; \} \| \{ `additionalProperties?`: `undefined`; `items`: \{ `$ref`: `string`; \}; `type`: `"array"`; \} \| \{ `additionalProperties`: \{ `$ref`: `string`; \}; `items?`: `undefined`; `type`: `"object"`; \})[]

###### properties.logs.items.properties

> `readonly` **properties**: `object`

###### properties.logs.items.properties.category

> `readonly` **category**: `object`

###### properties.logs.items.properties.category.items

> `readonly` **items**: `object`

###### properties.logs.items.properties.category.items.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.logs.items.properties.category.type

> `readonly` **type**: `"array"` = `'array'`

###### properties.logs.items.properties.level

> `readonly` **level**: `object`

###### properties.logs.items.properties.level.enum

> `readonly` **enum**: readonly \[`"trace"`, `"debug"`, `"info"`, `"warning"`, `"error"`, `"fatal"`\]

###### properties.logs.items.properties.level.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.logs.items.properties.logID

> `readonly` **logID**: `object`

###### properties.logs.items.properties.logID.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.logs.items.properties.message

> `readonly` **message**: `object`

###### properties.logs.items.properties.message.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.logs.items.properties.properties

> `readonly` **properties**: `object` = `jsonObjectSchema`

###### properties.logs.items.properties.properties.additionalProperties

> `readonly` **additionalProperties**: `object` = `jsonValueSchema`

###### properties.logs.items.properties.properties.additionalProperties.$ref

> **$ref**: `string`

###### properties.logs.items.properties.properties.type

> `readonly` **type**: `"object"` = `'object'`

###### properties.logs.items.properties.spanID

> `readonly` **spanID**: `object`

###### properties.logs.items.properties.spanID.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.logs.items.properties.timestamp

> `readonly` **timestamp**: `object`

###### properties.logs.items.properties.timestamp.type

> `readonly` **type**: `"number"` = `'number'`

###### properties.logs.items.properties.traceID

> `readonly` **traceID**: `object`

###### properties.logs.items.properties.traceID.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.logs.items.required

> `readonly` **required**: readonly \[`"traceID"`, `"spanID"`, `"timestamp"`, `"level"`, `"category"`, `"message"`, `"properties"`, `"logID"`\]

###### properties.logs.items.type

> `readonly` **type**: `"object"` = `'object'`

###### properties.logs.type

> `readonly` **type**: `"array"` = `'array'`

###### properties.logsTruncated

> `readonly` **logsTruncated**: `object`

###### properties.logsTruncated.type

> `readonly` **type**: `"boolean"` = `'boolean'`

###### properties.spans

> `readonly` **spans**: `object`

###### properties.spans.items

> `readonly` **items**: `object`

###### properties.spans.items.anyOf

> `readonly` **anyOf**: readonly \[\{ `additionalProperties`: `false`; `definitions`: \{ `json`: \{ `anyOf`: (\{ `additionalProperties?`: ...; `items?`: ...; `type`: ...; \} \| \{ `additionalProperties?`: ...; `items?`: ...; `type`: ...; \} \| \{ `additionalProperties?`: ...; `items?`: ...; `type`: ...; \} \| \{ `additionalProperties?`: ...; `items?`: ...; `type`: ...; \} \| \{ `additionalProperties?`: ...; `items`: ...; `type`: ...; \} \| \{ `additionalProperties`: ...; `items?`: ...; `type`: ...; \})[]; \}; \}; `properties`: \{ `attributes`: \{ `additionalProperties`: \{ `$ref`: `string`; \}; `type`: `"object"`; \}; `endTime`: \{ `type`: `"number"`; \}; `events`: \{ `items`: \{ `additionalProperties`: `false`; `properties`: \{ `attributes`: \{ `additionalProperties`: ...; `type`: ...; \}; `name`: \{ `type`: ...; \}; `time`: \{ `type`: ...; \}; \}; `required`: readonly \[`"name"`, `"time"`, `"attributes"`\]; `type`: `"object"`; \}; `type`: `"array"`; \}; `kind`: \{ `type`: `"number"`; \}; `links`: \{ `items`: \{ `additionalProperties`: `false`; `properties`: \{ `spanID`: \{ `type`: ...; \}; `traceID`: \{ `type`: ...; \}; \}; `required`: readonly \[`"traceID"`, `"spanID"`\]; `type`: `"object"`; \}; `type`: `"array"`; \}; `name`: \{ `type`: `"string"`; \}; `parentSpanID`: \{ `type`: `"string"`; \}; `spanID`: \{ `type`: `"string"`; \}; `startTime`: \{ `type`: `"number"`; \}; `status`: \{ `additionalProperties`: `false`; `properties`: \{ `code`: \{ `type`: `"number"`; \}; `message`: \{ `type`: `"string"`; \}; \}; `required`: readonly \[`"code"`\]; `type`: `"object"`; \}; `traceID`: \{ `type`: `"string"`; \}; \}; `required`: readonly \[`"traceID"`, `"spanID"`, `"name"`, `"kind"`, `"startTime"`, `"endTime"`, `"status"`, `"attributes"`, `"events"`, `"links"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `definitions`: \{ `json`: \{ `anyOf`: (\{ `additionalProperties?`: ...; `items?`: ...; `type`: ...; \} \| \{ `additionalProperties?`: ...; `items?`: ...; `type`: ...; \} \| \{ `additionalProperties?`: ...; `items?`: ...; `type`: ...; \} \| \{ `additionalProperties?`: ...; `items?`: ...; `type`: ...; \} \| \{ `additionalProperties?`: ...; `items`: ...; `type`: ...; \} \| \{ `additionalProperties`: ...; `items?`: ...; `type`: ...; \})[]; \}; \}; `properties`: \{ `attributes`: \{ `additionalProperties`: \{ `$ref`: `string`; \}; `type`: `"object"`; \}; `kind`: \{ `type`: `"number"`; \}; `links`: \{ `items`: \{ `additionalProperties`: `false`; `properties`: \{ `spanID`: \{ `type`: ...; \}; `traceID`: \{ `type`: ...; \}; \}; `required`: readonly \[`"traceID"`, `"spanID"`\]; `type`: `"object"`; \}; `type`: `"array"`; \}; `name`: \{ `type`: `"string"`; \}; `parentSpanID`: \{ `type`: `"string"`; \}; `spanID`: \{ `type`: `"string"`; \}; `startTime`: \{ `type`: `"number"`; \}; `traceID`: \{ `type`: `"string"`; \}; \}; `required`: readonly \[`"traceID"`, `"spanID"`, `"name"`, `"kind"`, `"startTime"`, `"attributes"`, `"links"`\]; `type`: `"object"`; \}\]

###### properties.spans.type

> `readonly` **type**: `"array"` = `'array'`

###### properties.summary

> `readonly` **summary**: `object` = `traceSummarySchema`

###### properties.summary.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### properties.summary.definitions

> `readonly` **definitions**: `object` = `jsonDefinitions`

###### properties.summary.definitions.json

> `readonly` **json**: `object`

###### properties.summary.definitions.json.anyOf

> **anyOf**: (\{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"string"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"number"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"boolean"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"null"`; \} \| \{ `additionalProperties?`: `undefined`; `items`: \{ `$ref`: `string`; \}; `type`: `"array"`; \} \| \{ `additionalProperties`: \{ `$ref`: `string`; \}; `items?`: `undefined`; `type`: `"object"`; \})[]

###### properties.summary.properties

> `readonly` **properties**: `object`

###### properties.summary.properties.active

> `readonly` **active**: `object`

###### properties.summary.properties.active.type

> `readonly` **type**: `"boolean"` = `'boolean'`

###### properties.summary.properties.activeSegmentSpanID

> `readonly` **activeSegmentSpanID**: `object`

###### properties.summary.properties.activeSegmentSpanID.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.summary.properties.attributes

> `readonly` **attributes**: `object`

###### properties.summary.properties.attributes.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### properties.summary.properties.attributes.properties

> `readonly` **properties**: `object`

###### properties.summary.properties.attributes.properties.label

> `readonly` **label**: `object`

###### properties.summary.properties.attributes.properties.label.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.summary.properties.attributes.properties.mokei.context.id

> `readonly` **mokei.context.id**: `object`

###### properties.summary.properties.attributes.properties.mokei.context.id.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.summary.properties.attributes.properties.mokei.flow.id

> `readonly` **mokei.flow.id**: `object`

###### properties.summary.properties.attributes.properties.mokei.flow.id.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.summary.properties.attributes.properties.mokei.run.id

> `readonly` **mokei.run.id**: `object`

###### properties.summary.properties.attributes.properties.mokei.run.id.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.summary.properties.attributes.type

> `readonly` **type**: `"object"` = `'object'`

###### properties.summary.properties.droppedCount

> `readonly` **droppedCount**: `object`

###### properties.summary.properties.droppedCount.type

> `readonly` **type**: `"integer"` = `'integer'`

###### properties.summary.properties.endTime

> `readonly` **endTime**: `object`

###### properties.summary.properties.endTime.type

> `readonly` **type**: `"number"` = `'number'`

###### properties.summary.properties.errorCount

> `readonly` **errorCount**: `object`

###### properties.summary.properties.errorCount.type

> `readonly` **type**: `"integer"` = `'integer'`

###### properties.summary.properties.kind

> `readonly` **kind**: `object`

###### properties.summary.properties.kind.enum

> `readonly` **enum**: readonly \[`"context"`, `"mcp"`, `"flow"`, `"step"`\]

###### properties.summary.properties.kind.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.summary.properties.name

> `readonly` **name**: `object`

###### properties.summary.properties.name.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.summary.properties.outcome

> `readonly` **outcome**: `object`

###### properties.summary.properties.outcome.enum

> `readonly` **enum**: readonly \[`"ok"`, `"error"`, `"interrupted"`, `null`\]

###### properties.summary.properties.outcome.type

> `readonly` **type**: readonly \[`"string"`, `"null"`\]

###### properties.summary.properties.revision

> `readonly` **revision**: `object`

###### properties.summary.properties.revision.type

> `readonly` **type**: `"integer"` = `'integer'`

###### properties.summary.properties.rootSpanID

> `readonly` **rootSpanID**: `object`

###### properties.summary.properties.rootSpanID.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.summary.properties.spanCount

> `readonly` **spanCount**: `object`

###### properties.summary.properties.spanCount.type

> `readonly` **type**: `"integer"` = `'integer'`

###### properties.summary.properties.startTime

> `readonly` **startTime**: `object`

###### properties.summary.properties.startTime.type

> `readonly` **type**: `"number"` = `'number'`

###### properties.summary.properties.traceID

> `readonly` **traceID**: `object`

###### properties.summary.properties.traceID.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.summary.required

> `readonly` **required**: readonly \[`"traceID"`, `"rootSpanID"`, `"kind"`, `"name"`, `"active"`, `"outcome"`, `"startTime"`, `"attributes"`, `"spanCount"`, `"errorCount"`, `"droppedCount"`, `"revision"`\]

###### properties.summary.type

> `readonly` **type**: `"object"` = `'object'`

##### required

> `readonly` **required**: readonly \[`"summary"`, `"spans"`, `"logs"`, `"logsTruncated"`\]

##### type

> `readonly` **type**: `"object"` = `'object'`

***

### tracesListParamsSchema

> `const` **tracesListParamsSchema**: `object`

#### Type Declaration

##### additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

##### properties

> `readonly` **properties**: `object`

###### properties.active

> `readonly` **active**: `object`

###### properties.active.type

> `readonly` **type**: `"boolean"` = `'boolean'`

###### properties.cursor

> `readonly` **cursor**: `object`

###### properties.cursor.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.kind

> `readonly` **kind**: `object`

###### properties.kind.enum

> `readonly` **enum**: readonly \[`"context"`, `"mcp"`, `"flow"`, `"step"`\]

###### properties.kind.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.limit

> `readonly` **limit**: `object`

###### properties.limit.type

> `readonly` **type**: `"integer"` = `'integer'`

###### properties.name

> `readonly` **name**: `object`

###### properties.name.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.outcome

> `readonly` **outcome**: `object`

###### properties.outcome.enum

> `readonly` **enum**: readonly \[`"ok"`, `"error"`, `"interrupted"`, `null`\]

###### properties.outcome.type

> `readonly` **type**: readonly \[`"string"`, `"null"`\]

###### properties.since

> `readonly` **since**: `object`

###### properties.since.type

> `readonly` **type**: `"number"` = `'number'`

###### properties.until

> `readonly` **until**: `object`

###### properties.until.type

> `readonly` **type**: `"number"` = `'number'`

##### required

> `readonly` **required**: readonly \[`"limit"`\]

##### type

> `readonly` **type**: `"object"` = `'object'`

***

### tracesListResultSchema

> `const` **tracesListResultSchema**: `object`

#### Type Declaration

##### additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

##### definitions

> `readonly` **definitions**: `object` = `jsonDefinitions`

###### definitions.json

> `readonly` **json**: `object`

###### definitions.json.anyOf

> **anyOf**: (\{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"string"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"number"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"boolean"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"null"`; \} \| \{ `additionalProperties?`: `undefined`; `items`: \{ `$ref`: `string`; \}; `type`: `"array"`; \} \| \{ `additionalProperties`: \{ `$ref`: `string`; \}; `items?`: `undefined`; `type`: `"object"`; \})[]

##### properties

> `readonly` **properties**: `object`

###### properties.cursor

> `readonly` **cursor**: `object`

###### properties.cursor.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.traces

> `readonly` **traces**: `object`

###### properties.traces.items

> `readonly` **items**: `object` = `traceSummarySchema`

###### properties.traces.items.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### properties.traces.items.definitions

> `readonly` **definitions**: `object` = `jsonDefinitions`

###### properties.traces.items.definitions.json

> `readonly` **json**: `object`

###### properties.traces.items.definitions.json.anyOf

> **anyOf**: (\{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"string"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"number"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"boolean"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"null"`; \} \| \{ `additionalProperties?`: `undefined`; `items`: \{ `$ref`: `string`; \}; `type`: `"array"`; \} \| \{ `additionalProperties`: \{ `$ref`: `string`; \}; `items?`: `undefined`; `type`: `"object"`; \})[]

###### properties.traces.items.properties

> `readonly` **properties**: `object`

###### properties.traces.items.properties.active

> `readonly` **active**: `object`

###### properties.traces.items.properties.active.type

> `readonly` **type**: `"boolean"` = `'boolean'`

###### properties.traces.items.properties.activeSegmentSpanID

> `readonly` **activeSegmentSpanID**: `object`

###### properties.traces.items.properties.activeSegmentSpanID.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.traces.items.properties.attributes

> `readonly` **attributes**: `object`

###### properties.traces.items.properties.attributes.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### properties.traces.items.properties.attributes.properties

> `readonly` **properties**: `object`

###### properties.traces.items.properties.attributes.properties.label

> `readonly` **label**: `object`

###### properties.traces.items.properties.attributes.properties.label.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.traces.items.properties.attributes.properties.mokei.context.id

> `readonly` **mokei.context.id**: `object`

###### properties.traces.items.properties.attributes.properties.mokei.context.id.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.traces.items.properties.attributes.properties.mokei.flow.id

> `readonly` **mokei.flow.id**: `object`

###### properties.traces.items.properties.attributes.properties.mokei.flow.id.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.traces.items.properties.attributes.properties.mokei.run.id

> `readonly` **mokei.run.id**: `object`

###### properties.traces.items.properties.attributes.properties.mokei.run.id.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.traces.items.properties.attributes.type

> `readonly` **type**: `"object"` = `'object'`

###### properties.traces.items.properties.droppedCount

> `readonly` **droppedCount**: `object`

###### properties.traces.items.properties.droppedCount.type

> `readonly` **type**: `"integer"` = `'integer'`

###### properties.traces.items.properties.endTime

> `readonly` **endTime**: `object`

###### properties.traces.items.properties.endTime.type

> `readonly` **type**: `"number"` = `'number'`

###### properties.traces.items.properties.errorCount

> `readonly` **errorCount**: `object`

###### properties.traces.items.properties.errorCount.type

> `readonly` **type**: `"integer"` = `'integer'`

###### properties.traces.items.properties.kind

> `readonly` **kind**: `object`

###### properties.traces.items.properties.kind.enum

> `readonly` **enum**: readonly \[`"context"`, `"mcp"`, `"flow"`, `"step"`\]

###### properties.traces.items.properties.kind.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.traces.items.properties.name

> `readonly` **name**: `object`

###### properties.traces.items.properties.name.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.traces.items.properties.outcome

> `readonly` **outcome**: `object`

###### properties.traces.items.properties.outcome.enum

> `readonly` **enum**: readonly \[`"ok"`, `"error"`, `"interrupted"`, `null`\]

###### properties.traces.items.properties.outcome.type

> `readonly` **type**: readonly \[`"string"`, `"null"`\]

###### properties.traces.items.properties.revision

> `readonly` **revision**: `object`

###### properties.traces.items.properties.revision.type

> `readonly` **type**: `"integer"` = `'integer'`

###### properties.traces.items.properties.rootSpanID

> `readonly` **rootSpanID**: `object`

###### properties.traces.items.properties.rootSpanID.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.traces.items.properties.spanCount

> `readonly` **spanCount**: `object`

###### properties.traces.items.properties.spanCount.type

> `readonly` **type**: `"integer"` = `'integer'`

###### properties.traces.items.properties.startTime

> `readonly` **startTime**: `object`

###### properties.traces.items.properties.startTime.type

> `readonly` **type**: `"number"` = `'number'`

###### properties.traces.items.properties.traceID

> `readonly` **traceID**: `object`

###### properties.traces.items.properties.traceID.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.traces.items.required

> `readonly` **required**: readonly \[`"traceID"`, `"rootSpanID"`, `"kind"`, `"name"`, `"active"`, `"outcome"`, `"startTime"`, `"attributes"`, `"spanCount"`, `"errorCount"`, `"droppedCount"`, `"revision"`\]

###### properties.traces.items.type

> `readonly` **type**: `"object"` = `'object'`

###### properties.traces.type

> `readonly` **type**: `"array"` = `'array'`

##### required

> `readonly` **required**: readonly \[`"traces"`\]

##### type

> `readonly` **type**: `"object"` = `'object'`

***

### traceSummarySchema

> `const` **traceSummarySchema**: `object`

#### Type Declaration

##### additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

##### definitions

> `readonly` **definitions**: `object` = `jsonDefinitions`

###### definitions.json

> `readonly` **json**: `object`

###### definitions.json.anyOf

> **anyOf**: (\{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"string"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"number"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"boolean"`; \} \| \{ `additionalProperties?`: `undefined`; `items?`: `undefined`; `type`: `"null"`; \} \| \{ `additionalProperties?`: `undefined`; `items`: \{ `$ref`: `string`; \}; `type`: `"array"`; \} \| \{ `additionalProperties`: \{ `$ref`: `string`; \}; `items?`: `undefined`; `type`: `"object"`; \})[]

##### properties

> `readonly` **properties**: `object`

###### properties.active

> `readonly` **active**: `object`

###### properties.active.type

> `readonly` **type**: `"boolean"` = `'boolean'`

###### properties.activeSegmentSpanID

> `readonly` **activeSegmentSpanID**: `object`

###### properties.activeSegmentSpanID.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.attributes

> `readonly` **attributes**: `object`

###### properties.attributes.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### properties.attributes.properties

> `readonly` **properties**: `object`

###### properties.attributes.properties.label

> `readonly` **label**: `object`

###### properties.attributes.properties.label.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.attributes.properties.mokei.context.id

> `readonly` **mokei.context.id**: `object`

###### properties.attributes.properties.mokei.context.id.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.attributes.properties.mokei.flow.id

> `readonly` **mokei.flow.id**: `object`

###### properties.attributes.properties.mokei.flow.id.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.attributes.properties.mokei.run.id

> `readonly` **mokei.run.id**: `object`

###### properties.attributes.properties.mokei.run.id.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.attributes.type

> `readonly` **type**: `"object"` = `'object'`

###### properties.droppedCount

> `readonly` **droppedCount**: `object`

###### properties.droppedCount.type

> `readonly` **type**: `"integer"` = `'integer'`

###### properties.endTime

> `readonly` **endTime**: `object`

###### properties.endTime.type

> `readonly` **type**: `"number"` = `'number'`

###### properties.errorCount

> `readonly` **errorCount**: `object`

###### properties.errorCount.type

> `readonly` **type**: `"integer"` = `'integer'`

###### properties.kind

> `readonly` **kind**: `object`

###### properties.kind.enum

> `readonly` **enum**: readonly \[`"context"`, `"mcp"`, `"flow"`, `"step"`\]

###### properties.kind.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.name

> `readonly` **name**: `object`

###### properties.name.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.outcome

> `readonly` **outcome**: `object`

###### properties.outcome.enum

> `readonly` **enum**: readonly \[`"ok"`, `"error"`, `"interrupted"`, `null`\]

###### properties.outcome.type

> `readonly` **type**: readonly \[`"string"`, `"null"`\]

###### properties.revision

> `readonly` **revision**: `object`

###### properties.revision.type

> `readonly` **type**: `"integer"` = `'integer'`

###### properties.rootSpanID

> `readonly` **rootSpanID**: `object`

###### properties.rootSpanID.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.spanCount

> `readonly` **spanCount**: `object`

###### properties.spanCount.type

> `readonly` **type**: `"integer"` = `'integer'`

###### properties.startTime

> `readonly` **startTime**: `object`

###### properties.startTime.type

> `readonly` **type**: `"number"` = `'number'`

###### properties.traceID

> `readonly` **traceID**: `object`

###### properties.traceID.type

> `readonly` **type**: `"string"` = `'string'`

##### required

> `readonly` **required**: readonly \[`"traceID"`, `"rootSpanID"`, `"kind"`, `"name"`, `"active"`, `"outcome"`, `"startTime"`, `"attributes"`, `"spanCount"`, `"errorCount"`, `"droppedCount"`, `"revision"`\]

##### type

> `readonly` **type**: `"object"` = `'object'`

***

### tracingInfoSchema

> `const` **tracingInfoSchema**: `object`

#### Type Declaration

##### additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

##### properties

> `readonly` **properties**: `object`

###### properties.droppedCount

> `readonly` **droppedCount**: `object`

###### properties.droppedCount.type

> `readonly` **type**: `"integer"` = `'integer'`

###### properties.lostSummaryCount

> `readonly` **lostSummaryCount**: `object`

###### properties.lostSummaryCount.type

> `readonly` **type**: `"integer"` = `'integer'`

##### required

> `readonly` **required**: readonly \[`"lostSummaryCount"`, `"droppedCount"`\]

##### type

> `readonly` **type**: `"object"` = `'object'`
