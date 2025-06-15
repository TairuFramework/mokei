# @mokei/context-server

Mokei MCP server.

## Installation

```sh
npm install @mokei/context-server
```

## Classes

### ContextServer

#### Extends

- [`ContextRPC`](../context-rpc/index.md#contextrpc)\<`ServerTypes`\>

#### Constructors

##### Constructor

> **new ContextServer**(`params`): [`ContextServer`](#contextserver)

###### Parameters

###### params

[`ServerParams`](#serverparams)

###### Returns

[`ContextServer`](#contextserver)

###### Overrides

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`constructor`](../context-rpc/index.md#contextrpc#constructor)

#### Accessors

##### clientInitialize

###### Get Signature

> **get** **clientInitialize**(): `undefined` \| \{[`key`: `string`]: `unknown`; `_meta?`: \{[`key`: `string`]: `unknown`; `progressToken?`: `string` \| `number`; \}; `capabilities`: \{[`key`: `string`]: `unknown`; `experimental?`: \{[`key`: `string`]: `object`; \}; `roots?`: \{[`key`: `string`]: `unknown`; `listChanged?`: `boolean`; \}; `sampling?`: \{[`key`: `string`]: `unknown`; \}; \}; `clientInfo`: \{[`key`: `string`]: `unknown`; `name`: `string`; `version`: `string`; \}; `protocolVersion`: `string`; \}

###### Returns

`undefined` \| \{[`key`: `string`]: `unknown`; `_meta?`: \{[`key`: `string`]: `unknown`; `progressToken?`: `string` \| `number`; \}; `capabilities`: \{[`key`: `string`]: `unknown`; `experimental?`: \{[`key`: `string`]: `object`; \}; `roots?`: \{[`key`: `string`]: `unknown`; `listChanged?`: `boolean`; \}; `sampling?`: \{[`key`: `string`]: `unknown`; \}; \}; `clientInfo`: \{[`key`: `string`]: `unknown`; `name`: `string`; `version`: `string`; \}; `protocolVersion`: `string`; \}

##### events

###### Get Signature

> **get** **events**(): `EventEmitter`\<`T`\[`"Events"`\]\>

###### Returns

`EventEmitter`\<`T`\[`"Events"`\]\>

###### Inherited from

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`events`](../context-rpc/index.md#contextrpc#events)

#### Methods

##### \_getNextRequestID()

> **\_getNextRequestID**(): `string` \| `number`

###### Returns

`string` \| `number`

###### Inherited from

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`_getNextRequestID`](../context-rpc/index.md#contextrpc#_getnextrequestid)

##### \_handle()

> **\_handle**(): `void`

###### Returns

`void`

###### Overrides

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`_handle`](../context-rpc/index.md#contextrpc#_handle)

##### \_handleNotification()

> **\_handleNotification**(`notification`): `void`

###### Parameters

###### notification

`HandleNotification`

###### Returns

`void`

###### Overrides

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`_handleNotification`](../context-rpc/index.md#contextrpc#_handlenotification)

##### \_handleRequest()

> **\_handleRequest**(`request`, `signal`): `Promise`\<\{[`key`: `string`]: `unknown`; `_meta?`: \{[`key`: `string`]: `unknown`; \}; \} \| \{[`key`: `string`]: `unknown`; `_meta?`: \{[`key`: `string`]: `unknown`; \}; `capabilities`: \{[`key`: `string`]: `unknown`; `completions?`: \{[`key`: `string`]: `unknown`; \}; `experimental?`: \{[`key`: `string`]: `object`; \}; `logging?`: \{[`key`: `string`]: `unknown`; \}; `prompts?`: \{[`key`: `string`]: `unknown`; `listChanged?`: `boolean`; \}; `resources?`: \{[`key`: `string`]: `unknown`; `listChanged?`: `boolean`; `subscribe?`: `boolean`; \}; `tools?`: \{[`key`: `string`]: `unknown`; `listChanged?`: `boolean`; \}; \}; `instructions?`: `string`; `protocolVersion`: `string`; `serverInfo`: \{[`key`: `string`]: `unknown`; `name`: `string`; `version`: `string`; \}; \} \| \{[`key`: `string`]: `unknown`; `_meta?`: \{[`key`: `string`]: `unknown`; \}; `completion`: \{[`key`: `string`]: `unknown`; `hasMore?`: `boolean`; `total?`: `number`; `values`: `string`[]; \}; \} \| \{[`key`: `string`]: `unknown`; `_meta?`: \{[`key`: `string`]: `unknown`; \}; `description?`: `string`; `messages`: `object`[]; \} \| \{[`key`: `string`]: `unknown`; `_meta?`: \{[`key`: `string`]: `unknown`; \}; `nextCursor?`: `string`; `prompts`: `object`[]; \} \| \{[`key`: `string`]: `unknown`; `_meta?`: \{[`key`: `string`]: `unknown`; \}; `nextCursor?`: `string`; `resources`: `object`[]; \} \| \{[`key`: `string`]: `unknown`; `_meta?`: \{[`key`: `string`]: `unknown`; \}; `nextCursor?`: `string`; `resourceTemplates`: `object`[]; \} \| \{[`key`: `string`]: `unknown`; `_meta?`: \{[`key`: `string`]: `unknown`; \}; `contents`: (\{[`key`: `string`]: `unknown`; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{[`key`: `string`]: `unknown`; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \})[]; \} \| \{[`key`: `string`]: `unknown`; `_meta?`: \{[`key`: `string`]: `unknown`; \}; `content`: (\{[`key`: `string`]: `unknown`; `annotations?`: \{[`key`: `string`]: `unknown`; `audience?`: (... \| ...)[]; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{[`key`: `string`]: `unknown`; `annotations?`: \{[`key`: `string`]: `unknown`; `audience?`: (... \| ...)[]; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{[`key`: `string`]: `unknown`; `annotations?`: \{[`key`: `string`]: `unknown`; `audience?`: (... \| ...)[]; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{[`key`: `string`]: `unknown`; `annotations?`: \{[`key`: `string`]: `unknown`; `audience?`: (... \| ...)[]; `priority?`: `number`; \}; `resource`: \{[`key`: `string`]: `unknown`; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{[`key`: `string`]: `unknown`; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; \} \| \{[`key`: `string`]: `unknown`; `_meta?`: \{[`key`: `string`]: `unknown`; \}; `nextCursor?`: `string`; `tools`: `object`[]; \}\>

###### Parameters

###### request

\{[`key`: `string`]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"ping"`; `params?`: \{[`key`: `string`]: `unknown`; `_meta?`: \{[`key`: `string`]: `unknown`; `progressToken?`: `string` \| `number`; \}; \}; \} | \{[`key`: `string`]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"initialize"`; `params`: \{[`key`: `string`]: `unknown`; `_meta?`: \{[`key`: `string`]: `unknown`; `progressToken?`: `string` \| `number`; \}; `capabilities`: \{[`key`: `string`]: `unknown`; `experimental?`: \{[`key`: `string`]: `object`; \}; `roots?`: \{[`key`: `string`]: `unknown`; `listChanged?`: `boolean`; \}; `sampling?`: \{[`key`: `string`]: `unknown`; \}; \}; `clientInfo`: \{[`key`: `string`]: `unknown`; `name`: `string`; `version`: `string`; \}; `protocolVersion`: `string`; \}; \} | \{[`key`: `string`]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"completion/complete"`; `params`: \{[`key`: `string`]: `unknown`; `_meta?`: \{[`key`: `string`]: `unknown`; `progressToken?`: `string` \| `number`; \}; `argument`: \{[`key`: `string`]: `unknown`; `name`: `string`; `value`: `string`; \}; `ref`: \{[`key`: `string`]: `unknown`; `name`: `string`; `type`: `"ref/prompt"`; \} \| \{[`key`: `string`]: `unknown`; `type`: `"ref/resource"`; `uri`: `string`; \}; \}; \} | \{[`key`: `string`]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"logging/setLevel"`; `params`: \{[`key`: `string`]: `unknown`; `_meta?`: \{[`key`: `string`]: `unknown`; `progressToken?`: `string` \| `number`; \}; `level`: `"alert"` \| `"critical"` \| `"debug"` \| `"emergency"` \| `"error"` \| `"info"` \| `"notice"` \| `"warning"`; \}; \} | \{[`key`: `string`]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"prompts/get"`; `params`: \{[`key`: `string`]: `unknown`; `_meta?`: \{[`key`: `string`]: `unknown`; `progressToken?`: `string` \| `number`; \}; `arguments?`: \{[`key`: `string`]: `string`; \}; `name`: `string`; \}; \} | \{[`key`: `string`]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"prompts/list"`; `params?`: \{[`key`: `string`]: `unknown`; `_meta?`: \{[`key`: `string`]: `unknown`; `progressToken?`: `string` \| `number`; \}; `cursor?`: `string`; \}; \} | \{[`key`: `string`]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/list"`; `params?`: \{[`key`: `string`]: `unknown`; `_meta?`: \{[`key`: `string`]: `unknown`; `progressToken?`: `string` \| `number`; \}; `cursor?`: `string`; \}; \} | \{[`key`: `string`]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/templates/list"`; `params?`: \{[`key`: `string`]: `unknown`; `_meta?`: \{[`key`: `string`]: `unknown`; `progressToken?`: `string` \| `number`; \}; `cursor?`: `string`; \}; \} | \{[`key`: `string`]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/read"`; `params`: \{[`key`: `string`]: `unknown`; `_meta?`: \{[`key`: `string`]: `unknown`; `progressToken?`: `string` \| `number`; \}; `uri`: `string`; \}; \} | \{[`key`: `string`]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/subscribe"`; `params`: \{[`key`: `string`]: `unknown`; `_meta?`: \{[`key`: `string`]: `unknown`; `progressToken?`: `string` \| `number`; \}; `uri`: `string`; \}; \} | \{[`key`: `string`]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/unsubscribe"`; `params`: \{[`key`: `string`]: `unknown`; `_meta?`: \{[`key`: `string`]: `unknown`; `progressToken?`: `string` \| `number`; \}; `uri`: `string`; \}; \} | \{[`key`: `string`]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"tools/list"`; `params?`: \{[`key`: `string`]: `unknown`; `_meta?`: \{[`key`: `string`]: `unknown`; `progressToken?`: `string` \| `number`; \}; `cursor?`: `string`; \}; \} | \{[`key`: `string`]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"tools/call"`; `params`: \{[`key`: `string`]: `unknown`; `_meta?`: \{[`key`: `string`]: `unknown`; `progressToken?`: `string` \| `number`; \}; `arguments?`: \{[`key`: `string`]: `unknown`; \}; `name`: `string`; \}; \}

###### signal

`AbortSignal`

###### Returns

`Promise`\<\{[`key`: `string`]: `unknown`; `_meta?`: \{[`key`: `string`]: `unknown`; \}; \} \| \{[`key`: `string`]: `unknown`; `_meta?`: \{[`key`: `string`]: `unknown`; \}; `capabilities`: \{[`key`: `string`]: `unknown`; `completions?`: \{[`key`: `string`]: `unknown`; \}; `experimental?`: \{[`key`: `string`]: `object`; \}; `logging?`: \{[`key`: `string`]: `unknown`; \}; `prompts?`: \{[`key`: `string`]: `unknown`; `listChanged?`: `boolean`; \}; `resources?`: \{[`key`: `string`]: `unknown`; `listChanged?`: `boolean`; `subscribe?`: `boolean`; \}; `tools?`: \{[`key`: `string`]: `unknown`; `listChanged?`: `boolean`; \}; \}; `instructions?`: `string`; `protocolVersion`: `string`; `serverInfo`: \{[`key`: `string`]: `unknown`; `name`: `string`; `version`: `string`; \}; \} \| \{[`key`: `string`]: `unknown`; `_meta?`: \{[`key`: `string`]: `unknown`; \}; `completion`: \{[`key`: `string`]: `unknown`; `hasMore?`: `boolean`; `total?`: `number`; `values`: `string`[]; \}; \} \| \{[`key`: `string`]: `unknown`; `_meta?`: \{[`key`: `string`]: `unknown`; \}; `description?`: `string`; `messages`: `object`[]; \} \| \{[`key`: `string`]: `unknown`; `_meta?`: \{[`key`: `string`]: `unknown`; \}; `nextCursor?`: `string`; `prompts`: `object`[]; \} \| \{[`key`: `string`]: `unknown`; `_meta?`: \{[`key`: `string`]: `unknown`; \}; `nextCursor?`: `string`; `resources`: `object`[]; \} \| \{[`key`: `string`]: `unknown`; `_meta?`: \{[`key`: `string`]: `unknown`; \}; `nextCursor?`: `string`; `resourceTemplates`: `object`[]; \} \| \{[`key`: `string`]: `unknown`; `_meta?`: \{[`key`: `string`]: `unknown`; \}; `contents`: (\{[`key`: `string`]: `unknown`; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{[`key`: `string`]: `unknown`; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \})[]; \} \| \{[`key`: `string`]: `unknown`; `_meta?`: \{[`key`: `string`]: `unknown`; \}; `content`: (\{[`key`: `string`]: `unknown`; `annotations?`: \{[`key`: `string`]: `unknown`; `audience?`: (... \| ...)[]; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{[`key`: `string`]: `unknown`; `annotations?`: \{[`key`: `string`]: `unknown`; `audience?`: (... \| ...)[]; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{[`key`: `string`]: `unknown`; `annotations?`: \{[`key`: `string`]: `unknown`; `audience?`: (... \| ...)[]; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{[`key`: `string`]: `unknown`; `annotations?`: \{[`key`: `string`]: `unknown`; `audience?`: (... \| ...)[]; `priority?`: `number`; \}; `resource`: \{[`key`: `string`]: `unknown`; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{[`key`: `string`]: `unknown`; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; \} \| \{[`key`: `string`]: `unknown`; `_meta?`: \{[`key`: `string`]: `unknown`; \}; `nextCursor?`: `string`; `tools`: `object`[]; \}\>

###### Overrides

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`_handleRequest`](../context-rpc/index.md#contextrpc#_handlerequest)

##### \_handleSingleMessage()

> **\_handleSingleMessage**(`message`): `null` \| \{[`key`: `string`]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; \} \| `Promise`\<`null` \| \{[`key`: `string`]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; \}\>

###### Parameters

###### message

[`SingleMessage`](../context-protocol/index.md#singlemessage)

###### Returns

`null` \| \{[`key`: `string`]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; \} \| `Promise`\<`null` \| \{[`key`: `string`]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; \}\>

###### Inherited from

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`_handleSingleMessage`](../context-rpc/index.md#contextrpc#_handlesinglemessage)

##### \_read()

> **\_read**(): `Promise`\<`ReadableStreamReadResult`\<[`ClientMessage`](../context-protocol/index.md#clientmessage)\>\>

###### Returns

`Promise`\<`ReadableStreamReadResult`\<[`ClientMessage`](../context-protocol/index.md#clientmessage)\>\>

###### Inherited from

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`_read`](../context-rpc/index.md#contextrpc#_read)

##### \_write()

> **\_write**(`message`): `Promise`\<`void`\>

###### Parameters

###### message

[`ServerMessage`](../context-protocol/index.md#servermessage)

###### Returns

`Promise`\<`void`\>

###### Inherited from

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`_write`](../context-rpc/index.md#contextrpc#_write)

##### createMessage()

> **createMessage**(`params`): [`SentRequest`](../context-rpc/index.md#sentrequest)\<\{[`key`: `string`]: `unknown`; `_meta?`: \{[`key`: `string`]: `unknown`; \}; `content`: \{[`key`: `string`]: `unknown`; `annotations?`: \{[`key`: `string`]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{[`key`: `string`]: `unknown`; `annotations?`: \{[`key`: `string`]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \}; `model`: `string`; `role`: `"assistant"` \| `"user"`; `stopReason?`: `string`; \}\>

###### Parameters

###### params

###### _meta?

\{[`key`: `string`]: `unknown`; `progressToken?`: `string` \| `number`; \}

###### _meta.progressToken?

`string` \| `number`

###### includeContext?

`"allServers"` \| `"none"` \| `"thisServer"`

###### maxTokens

`number`

###### messages

`object`[]

###### metadata?

\{[`key`: `string`]: `unknown`; \}

###### modelPreferences?

\{[`key`: `string`]: `unknown`; `costPriority?`: `number`; `hints?`: `object`[]; `intelligencePriority?`: `number`; `speedPriority?`: `number`; \}

###### modelPreferences.costPriority?

`number`

###### modelPreferences.hints?

`object`[]

###### modelPreferences.intelligencePriority?

`number`

###### modelPreferences.speedPriority?

`number`

###### stopSequences?

`string`[]

###### systemPrompt?

`string`

###### temperature?

`number`

###### Returns

[`SentRequest`](../context-rpc/index.md#sentrequest)\<\{[`key`: `string`]: `unknown`; `_meta?`: \{[`key`: `string`]: `unknown`; \}; `content`: \{[`key`: `string`]: `unknown`; `annotations?`: \{[`key`: `string`]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{[`key`: `string`]: `unknown`; `annotations?`: \{[`key`: `string`]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \}; `model`: `string`; `role`: `"assistant"` \| `"user"`; `stopReason?`: `string`; \}\>

##### listRoots()

> **listRoots**(): [`SentRequest`](../context-rpc/index.md#sentrequest)\<`object`[]\>

###### Returns

[`SentRequest`](../context-rpc/index.md#sentrequest)\<`object`[]\>

##### log()

> **log**(`level`, `data`, `logger?`): `void`

###### Parameters

###### level

`"alert"` | `"critical"` | `"debug"` | `"emergency"` | `"error"` | `"info"` | `"notice"` | `"warning"`

###### data

`unknown`

###### logger?

`string`

###### Returns

`void`

##### notify()

> **notify**\<`Event`\>(`event`, `params`): `Promise`\<`void`\>

###### Type Parameters

###### Event

`Event` *extends* `"prompts/list_changed"` \| `"resources/list_changed"` \| `"tools/list_changed"`

###### Parameters

###### event

`Event`

###### params

[`ServerNotifications`](../context-protocol/index.md#servernotifications)\[`Event`\]\[`"params"`\]

###### Returns

`Promise`\<`void`\>

###### Inherited from

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`notify`](../context-rpc/index.md#contextrpc#notify)

##### request()

> **request**\<`Method`\>(`method`, `params`): [`SentRequest`](../context-rpc/index.md#sentrequest)\<[`ServerRequests`](../context-protocol/index.md#serverrequests)\[`Method`\]\[`"Result"`\]\>

###### Type Parameters

###### Method

`Method` *extends* keyof [`ServerRequests`](../context-protocol/index.md#serverrequests)

###### Parameters

###### method

`Method`

###### params

[`ServerRequests`](../context-protocol/index.md#serverrequests)\[`Method`\]\[`"Params"`\]

###### Returns

[`SentRequest`](../context-rpc/index.md#sentrequest)\<[`ServerRequests`](../context-protocol/index.md#serverrequests)\[`Method`\]\[`"Result"`\]\>

###### Inherited from

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`request`](../context-rpc/index.md#contextrpc#request)

##### requestValue()

> **requestValue**\<`Method`, `Value`\>(`method`, `params`, `getValue`): [`SentRequest`](../context-rpc/index.md#sentrequest)\<`Value`\>

###### Type Parameters

###### Method

`Method` *extends* keyof [`ServerRequests`](../context-protocol/index.md#serverrequests)

###### Value

`Value`

###### Parameters

###### method

`Method`

###### params

[`ServerRequests`](../context-protocol/index.md#serverrequests)\[`Method`\]\[`"Params"`\]

###### getValue

(`result`) => `Value`

###### Returns

[`SentRequest`](../context-rpc/index.md#sentrequest)\<`Value`\>

###### Inherited from

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`requestValue`](../context-rpc/index.md#contextrpc#requestvalue)

## Type Aliases

### ClientInitialize

> **ClientInitialize** = [`InitializeRequest`](../context-protocol/index.md#initializerequest)\[`"params"`\]

***

### ServerConfig

> **ServerConfig** = `object`

#### Properties

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

##### version

> **version**: `string`

***

### ServerEvents

> **ServerEvents** = `object`

#### Properties

##### initialize

> **initialize**: [`ClientInitialize`](#clientinitialize-1)

##### initialized

> **initialized**: `undefined`

##### log

> **log**: [`Log`](../context-protocol/index.md#log)

***

### ServerParams

> **ServerParams** = [`ServerConfig`](#serverconfig) & `object`

#### Type declaration

##### transport

> **transport**: [`ServerTransport`](#servertransport)

***

### ServerTransport

> **ServerTransport** = `TransportType`\<[`ClientMessage`](../context-protocol/index.md#clientmessage), [`ServerMessage`](../context-protocol/index.md#servermessage)\>

## Functions

### createPrompt()

> **createPrompt**\<`ArgumentsSchema`, `Arguments`\>(`description`, `argumentsSchema`, `handler`): `GenericPromptDefinition`

#### Type Parameters

##### ArgumentsSchema

`ArgumentsSchema` *extends* `Readonly`\<\{ \}\>

##### Arguments

`Arguments` = `FromSchema`\<`ArgumentsSchema`\>

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

##### InputSchema

`InputSchema` *extends* `Readonly`\<\{ \}\>

##### Input

`Input` = `FromSchema`\<`InputSchema`\>

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

### serveProcess()

> **serveProcess**(`config`): [`ContextServer`](#contextserver)

#### Parameters

##### config

[`ServerConfig`](#serverconfig)

#### Returns

[`ContextServer`](#contextserver)
