# @mokei/context-server

Mokei MCP server.

## Installation

```sh
npm install @mokei/context-server
```

## Classes

### ContextServer

#### Extends

- `Disposer`

#### Constructors

##### new ContextServer()

> **new ContextServer**(`params`): [`ContextServer`](index.md#contextserver)

###### Parameters

###### params

[`ServerParams`](index.md#serverparams)

###### Returns

[`ContextServer`](index.md#contextserver)

###### Overrides

`Disposer.constructor`

#### Accessors

##### clientInitialize

###### Get Signature

> **get** **clientInitialize**(): `undefined` \| \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `capabilities`: \{ `[key: string]`: `unknown`;  `experimental`: \{\}; `roots`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; \}; `sampling`: \{\}; \}; `clientInfo`: \{ `[key: string]`: `unknown`;  `name`: `string`; `version`: `string`; \}; `protocolVersion`: `string`; \}

###### Returns

`undefined` \| \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `capabilities`: \{ `[key: string]`: `unknown`;  `experimental`: \{\}; `roots`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; \}; `sampling`: \{\}; \}; `clientInfo`: \{ `[key: string]`: `unknown`;  `name`: `string`; `version`: `string`; \}; `protocolVersion`: `string`; \}

***

##### events

###### Get Signature

> **get** **events**(): `EventEmitter`\<[`ServerEvents`](index.md#serverevents)\>

###### Returns

`EventEmitter`\<[`ServerEvents`](index.md#serverevents)\>

#### Methods

##### handle()

> **handle**(`transport`): `void`

###### Parameters

###### transport

[`ServerTransport`](index.md#servertransport)

###### Returns

`void`

***

##### log()

> **log**(`level`, `data`, `logger`?): `void`

###### Parameters

###### level

`"error"` | `"alert"` | `"critical"` | `"debug"` | `"emergency"` | `"info"` | `"notice"` | `"warning"`

###### data

`unknown`

###### logger?

`string`

###### Returns

`void`

***

### RPCError

#### Extends

- `Error`

#### Constructors

##### new RPCError()

> **new RPCError**(`code`, `message`, `data`?): [`RPCError`](index.md#rpcerror)

###### Parameters

###### code

`number`

###### message

`string`

###### data?

`Record`\<`string`, `unknown`\>

###### Returns

[`RPCError`](index.md#rpcerror)

###### Overrides

`Error.constructor`

#### Methods

##### toResponse()

> **toResponse**(`id`): `object`

###### Parameters

###### id

`string` | `number`

###### Returns

`object`

###### error

> **error**: `object`

###### Index Signature

\[`key`: `string`\]: `unknown`

###### error.code

> **error.code**: `number`

###### error.data?

> `optional` **error.data**: `object`

###### Index Signature

\[`key`: `string`\]: `unknown`

###### error.message

> **error.message**: `string`

###### id

> **id**: `string` \| `number`

###### jsonrpc

> **jsonrpc**: `"2.0"`

## Type Aliases

### ClientInitialize

> **ClientInitialize**: [`InitializeRequest`](../context-protocol/index.md#initializerequest)\[`"params"`\]

***

### ServerEvents

> **ServerEvents**: `object`

#### Type declaration

##### initialize

> **initialize**: [`ClientInitialize`](index.md#clientinitialize-4)

##### initialized

> **initialized**: `undefined`

##### log

> **log**: [`Log`](../context-protocol/index.md#log)

***

### ServerParams

> **ServerParams**: `object`

#### Type declaration

##### complete?

> `optional` **complete**: `CompleteHandler`

##### name

> **name**: `string`

##### prompts?

> `optional` **prompts**: `PromptDefinitions`

##### resources?

> `optional` **resources**: `ResourceDefinitions`

##### tools?

> `optional` **tools**: `ToolDefinitions`

##### transport?

> `optional` **transport**: [`ServerTransport`](index.md#servertransport)

##### version

> **version**: `string`

***

### ServerTransport

> **ServerTransport**: `TransportType`\<[`ClientMessage`](../context-protocol/index.md#clientmessage), [`ServerMessage`](../context-protocol/index.md#servermessage)\>

## Functions

### createPrompt()

> **createPrompt**\<`ArgumentsSchema`, `Arguments`\>(`description`, `argumentsSchema`, `handler`): `GenericPromptDefinition`

#### Type Parameters

• **ArgumentsSchema** *extends* `Readonly`\<\{\}\>

• **Arguments** = `FromSchema`\<`ArgumentsSchema`\>

#### Parameters

##### description

`string`

##### argumentsSchema

`ArgumentsSchema`

##### handler

`TypedPromptHandler`\<`Arguments`\>

#### Returns

`GenericPromptDefinition`

***

### createTool()

> **createTool**\<`InputSchema`, `Input`\>(`description`, `inputSchema`, `handler`): `GenericToolDefinition`

#### Type Parameters

• **InputSchema** *extends* `Readonly`\<\{\}\>

• **Input** = `FromSchema`\<`InputSchema`\>

#### Parameters

##### description

`string`

##### inputSchema

`InputSchema`

##### handler

`TypedToolHandler`\<`Input`\>

#### Returns

`GenericToolDefinition`

***

### serve()

> **serve**(`params`): [`ContextServer`](index.md#contextserver)

#### Parameters

##### params

[`ServerParams`](index.md#serverparams)

#### Returns

[`ContextServer`](index.md#contextserver)
