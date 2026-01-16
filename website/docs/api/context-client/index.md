# @mokei/context-client

Mokei MCP client.

## Installation

```sh
npm install @mokei/context-client
```

## Classes

### ContextClient

#### Extends

- [`ContextRPC`](../context-rpc/index.md#contextrpc)\<`ClientTypes`\>

#### Type Parameters

##### T

`T` *extends* [`ContextTypes`](#contexttypes) = [`UnknownContextTypes`](#unknowncontexttypes)

#### Constructors

##### Constructor

> **new ContextClient**\<`T`\>(`params`): [`ContextClient`](#contextclient)\<`T`\>

###### Parameters

###### params

[`ClientParams`](#clientparams)

###### Returns

[`ContextClient`](#contextclient)\<`T`\>

###### Overrides

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`constructor`](../context-rpc/index.md#constructor)

#### Accessors

##### events

###### Get Signature

> **get** **events**(): `EventEmitter`\<`T`\[`"Events"`\]\>

###### Returns

`EventEmitter`\<`T`\[`"Events"`\]\>

###### Inherited from

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`events`](../context-rpc/index.md#events)

##### notifications

###### Get Signature

> **get** **notifications**(): `ReadableStream`\<\{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/cancelled"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `reason?`: `string`; `requestId`: `string` \| `number`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/message"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `data`: `unknown`; `level`: `"error"` \| `"alert"` \| `"critical"` \| `"debug"` \| `"emergency"` \| `"info"` \| `"notice"` \| `"warning"`; `logger?`: `string`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/progress"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `message?`: `string`; `progress`: `number`; `progressToken`: `string` \| `number`; `total?`: `number`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/resources/updated"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `uri`: `string`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/resources/list_changed"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; \}; \} \| \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/tools/list_changed"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; \}; \} \| \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/prompts/list_changed"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; \}; \}\>

###### Returns

`ReadableStream`\<\{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/cancelled"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `reason?`: `string`; `requestId`: `string` \| `number`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/message"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `data`: `unknown`; `level`: `"error"` \| `"alert"` \| `"critical"` \| `"debug"` \| `"emergency"` \| `"info"` \| `"notice"` \| `"warning"`; `logger?`: `string`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/progress"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `message?`: `string`; `progress`: `number`; `progressToken`: `string` \| `number`; `total?`: `number`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/resources/updated"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `uri`: `string`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/resources/list_changed"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; \}; \} \| \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/tools/list_changed"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; \}; \} \| \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/prompts/list_changed"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; \}; \}\>

#### Methods

##### \_getNextRequestID()

> **\_getNextRequestID**(): `string` \| `number`

###### Returns

`string` \| `number`

###### Inherited from

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`_getNextRequestID`](../context-rpc/index.md#_getnextrequestid)

##### \_handle()

> **\_handle**(): `void`

###### Returns

`void`

###### Inherited from

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`_handle`](../context-rpc/index.md#_handle)

##### \_handleMessage()

> **\_handleMessage**(`message`): \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; \} \| `Promise`\<\{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; \} \| `null`\> \| `null`

###### Parameters

###### message

\{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"ping"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; \}; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"sampling/createMessage"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `includeContext?`: `"allServers"` \| `"none"` \| `"thisServer"`; `maxTokens`: `number`; `messages`: `object`[]; `metadata?`: \{\[`key`: `string`\]: `unknown`; \}; `modelPreferences?`: \{\[`key`: `string`\]: `unknown`; `costPriority?`: `number`; `hints?`: `object`[]; `intelligencePriority?`: `number`; `speedPriority?`: `number`; \}; `stopSequences?`: `string`[]; `systemPrompt?`: `string`; `temperature?`: `number`; `toolChoice?`: \{\[`key`: `string`\]: `unknown`; `type`: `"auto"`; \} \| \{\[`key`: `string`\]: `unknown`; `type`: `"required"`; \} \| \{\[`key`: `string`\]: `unknown`; `toolName`: `string`; `type`: `"tool"`; \}; `tools?`: `object`[]; \}; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"roots/list"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; \}; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"elicitation/create"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `message`: `string`; `mode?`: `"form"`; `requestedSchema`: \{\[`key`: `string`\]: `unknown`; `properties`: \{\[`key`: `string`\]: \{\[`key`: `string`\]: `unknown`; `default?`: `string`; `description?`: `string`; `format?`: `"uri"` \| `"date-time"` \| `"date"` \| `"email"`; `maxLength?`: `number`; `minLength?`: `number`; `title?`: `string`; `type`: `"string"`; \} \| \{\[`key`: `string`\]: `unknown`; `default?`: `number`; `description?`: `string`; `maximum?`: `number`; `minimum?`: `number`; `title?`: `string`; `type`: `"number"` \| `"integer"`; \} \| \{\[`key`: `string`\]: `unknown`; `default?`: `boolean`; `description?`: `string`; `title?`: `string`; `type`: `"boolean"`; \} \| \{\[`key`: `string`\]: `unknown`; `default?`: `string`; `description?`: `string`; `enum`: `string`[]; `enumNames?`: `string`[]; `title?`: `string`; `type`: `"string"`; \} \| \{\[`key`: `string`\]: `unknown`; `default?`: `string`[]; `description?`: `string`; `items`: \{\[`key`: `string`\]: `unknown`; `enum`: `string`[]; `enumNames?`: ...[]; `type`: `"string"`; \}; `title?`: `string`; `type`: `"array"`; \}; \}; `required?`: `string`[]; `type`: `"object"`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `elicitationId`: `string`; `message`: `string`; `mode`: `"url"`; `url`: `string`; \}; \} | \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/cancelled"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `reason?`: `string`; `requestId`: `string` \| `number`; \}; \} | \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/message"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `data`: `unknown`; `level`: `"error"` \| `"alert"` \| `"critical"` \| `"debug"` \| `"emergency"` \| `"info"` \| `"notice"` \| `"warning"`; `logger?`: `string`; \}; \} | \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/progress"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `message?`: `string`; `progress`: `number`; `progressToken`: `string` \| `number`; `total?`: `number`; \}; \} | \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/resources/updated"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `uri`: `string`; \}; \} | \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/resources/list_changed"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; \}; \} | \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/tools/list_changed"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; \}; \} | \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/prompts/list_changed"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; \}; \} | \{\[`key`: `string`\]: `unknown`; `error`: \{\[`key`: `string`\]: `unknown`; `code`: `number`; `data?`: \{\[`key`: `string`\]: `unknown`; \}; `message`: `string`; \}; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `result`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `capabilities`: \{\[`key`: `string`\]: `unknown`; `completions?`: \{\[`key`: `string`\]: `unknown`; \}; `experimental?`: \{\[`key`: `string`\]: `object`; \}; `logging?`: \{\[`key`: `string`\]: `unknown`; \}; `prompts?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; \}; `resources?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; `subscribe?`: `boolean`; \}; `tools?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; \}; \}; `instructions?`: `string`; `protocolVersion`: `string`; `serverInfo`: \{\[`key`: `string`\]: `unknown`; `description?`: `string`; `icons?`: `object`[]; `name`: `string`; `title?`: `string`; `version`: `string`; `websiteUrl?`: `string`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `completion`: \{\[`key`: `string`\]: `unknown`; `hasMore?`: `boolean`; `total?`: `number`; `values`: `string`[]; \}; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `description?`: `string`; `messages`: `object`[]; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `nextCursor?`: `string`; `prompts`: `object`[]; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `nextCursor?`: `string`; `resources`: `object`[]; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `nextCursor?`: `string`; `resourceTemplates`: `object`[]; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `contents`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \})[]; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: ...[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: ...[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: ...[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: ...[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: ...[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: ...\]: ...; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: ...\]: ...; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; `structuredContent?`: \{\[`key`: `string`\]: `unknown`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `nextCursor?`: `string`; `tools`: `object`[]; \}; \}

###### Returns

\{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; \} \| `Promise`\<\{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; \} \| `null`\> \| `null`

###### Inherited from

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`_handleMessage`](../context-rpc/index.md#_handlemessage)

##### \_handleNotification()

> **\_handleNotification**(`notification`): `void`

###### Parameters

###### notification

`HandleNotification`

###### Returns

`void`

###### Overrides

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`_handleNotification`](../context-rpc/index.md#_handlenotification)

##### \_handleRequest()

> **\_handleRequest**(`request`, `signal`): `Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \}; `model`: `string`; `role`: `"assistant"` \| `"user"`; `stopReason?`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `roots`: `object`[]; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `action`: `"accept"` \| `"cancel"` \| `"decline"`; `content?`: \{\[`key`: `string`\]: `string` \| `number` \| `boolean`; \}; \}\>

###### Parameters

###### request

\{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"ping"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; \}; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"sampling/createMessage"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `includeContext?`: `"allServers"` \| `"none"` \| `"thisServer"`; `maxTokens`: `number`; `messages`: `object`[]; `metadata?`: \{\[`key`: `string`\]: `unknown`; \}; `modelPreferences?`: \{\[`key`: `string`\]: `unknown`; `costPriority?`: `number`; `hints?`: `object`[]; `intelligencePriority?`: `number`; `speedPriority?`: `number`; \}; `stopSequences?`: `string`[]; `systemPrompt?`: `string`; `temperature?`: `number`; `toolChoice?`: \{\[`key`: `string`\]: `unknown`; `type`: `"auto"`; \} \| \{\[`key`: `string`\]: `unknown`; `type`: `"required"`; \} \| \{\[`key`: `string`\]: `unknown`; `toolName`: `string`; `type`: `"tool"`; \}; `tools?`: `object`[]; \}; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"roots/list"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; \}; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"elicitation/create"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `message`: `string`; `mode?`: `"form"`; `requestedSchema`: \{\[`key`: `string`\]: `unknown`; `properties`: \{\[`key`: `string`\]: \{\[`key`: `string`\]: `unknown`; `default?`: `string`; `description?`: `string`; `format?`: `"uri"` \| `"date-time"` \| `"date"` \| `"email"`; `maxLength?`: `number`; `minLength?`: `number`; `title?`: `string`; `type`: `"string"`; \} \| \{\[`key`: `string`\]: `unknown`; `default?`: `number`; `description?`: `string`; `maximum?`: `number`; `minimum?`: `number`; `title?`: `string`; `type`: `"number"` \| `"integer"`; \} \| \{\[`key`: `string`\]: `unknown`; `default?`: `boolean`; `description?`: `string`; `title?`: `string`; `type`: `"boolean"`; \} \| \{\[`key`: `string`\]: `unknown`; `default?`: `string`; `description?`: `string`; `enum`: `string`[]; `enumNames?`: `string`[]; `title?`: `string`; `type`: `"string"`; \} \| \{\[`key`: `string`\]: `unknown`; `default?`: `string`[]; `description?`: `string`; `items`: \{\[`key`: `string`\]: `unknown`; `enum`: `string`[]; `enumNames?`: ...[]; `type`: `"string"`; \}; `title?`: `string`; `type`: `"array"`; \}; \}; `required?`: `string`[]; `type`: `"object"`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `elicitationId`: `string`; `message`: `string`; `mode`: `"url"`; `url`: `string`; \}; \}

###### signal

`AbortSignal`

###### Returns

`Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \}; `model`: `string`; `role`: `"assistant"` \| `"user"`; `stopReason?`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `roots`: `object`[]; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `action`: `"accept"` \| `"cancel"` \| `"decline"`; `content?`: \{\[`key`: `string`\]: `string` \| `number` \| `boolean`; \}; \}\>

###### Overrides

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`_handleRequest`](../context-rpc/index.md#_handlerequest)

##### \_read()

> **\_read**(): `Promise`\<`ReadableStreamReadResult`\<\{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"ping"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; \}; \} \| \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"sampling/createMessage"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `includeContext?`: `"allServers"` \| `"none"` \| `"thisServer"`; `maxTokens`: `number`; `messages`: `object`[]; `metadata?`: \{\[`key`: `string`\]: `unknown`; \}; `modelPreferences?`: \{\[`key`: `string`\]: `unknown`; `costPriority?`: `number`; `hints?`: `object`[]; `intelligencePriority?`: `number`; `speedPriority?`: `number`; \}; `stopSequences?`: `string`[]; `systemPrompt?`: `string`; `temperature?`: `number`; `toolChoice?`: \{\[`key`: `string`\]: `unknown`; `type`: `"auto"`; \} \| \{\[`key`: `string`\]: `unknown`; `type`: `"required"`; \} \| \{\[`key`: `string`\]: `unknown`; `toolName`: `string`; `type`: `"tool"`; \}; `tools?`: `object`[]; \}; \} \| \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"roots/list"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; \}; \} \| \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"elicitation/create"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `message`: `string`; `mode?`: `"form"`; `requestedSchema`: \{\[`key`: `string`\]: `unknown`; `properties`: \{\[`key`: `string`\]: \{\[`key`: `string`\]: `unknown`; `default?`: ... \| ...; `description?`: ... \| ...; `format?`: ... \| ... \| ... \| ... \| ...; `maxLength?`: ... \| ...; `minLength?`: ... \| ...; `title?`: ... \| ...; `type`: `"string"`; \} \| \{\[`key`: `string`\]: `unknown`; `default?`: ... \| ...; `description?`: ... \| ...; `maximum?`: ... \| ...; `minimum?`: ... \| ...; `title?`: ... \| ...; `type`: ... \| ...; \} \| \{\[`key`: `string`\]: `unknown`; `default?`: ... \| ... \| ...; `description?`: ... \| ...; `title?`: ... \| ...; `type`: `"boolean"`; \} \| \{\[`key`: `string`\]: `unknown`; `default?`: ... \| ...; `description?`: ... \| ...; `enum`: ...[]; `enumNames?`: ... \| ...; `title?`: ... \| ...; `type`: `"string"`; \} \| \{\[`key`: `string`\]: `unknown`; `default?`: ... \| ...; `description?`: ... \| ...; `items`: \{\[`key`: ...\]: ...; `enum`: ...; `enumNames?`: ...; `type`: ...; \}; `title?`: ... \| ...; `type`: `"array"`; \}; \}; `required?`: `string`[]; `type`: `"object"`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `elicitationId`: `string`; `message`: `string`; `mode`: `"url"`; `url`: `string`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/cancelled"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `reason?`: `string`; `requestId`: `string` \| `number`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/message"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `data`: `unknown`; `level`: `"error"` \| `"alert"` \| `"critical"` \| `"debug"` \| `"emergency"` \| `"info"` \| `"notice"` \| `"warning"`; `logger?`: `string`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/progress"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `message?`: `string`; `progress`: `number`; `progressToken`: `string` \| `number`; `total?`: `number`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/resources/updated"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `uri`: `string`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/resources/list_changed"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; \}; \} \| \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/tools/list_changed"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; \}; \} \| \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/prompts/list_changed"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; \}; \} \| \{\[`key`: `string`\]: `unknown`; `error`: \{\[`key`: `string`\]: `unknown`; `code`: `number`; `data?`: \{\[`key`: `string`\]: `unknown`; \}; `message`: `string`; \}; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; \} \| \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `result`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `capabilities`: \{\[`key`: `string`\]: `unknown`; `completions?`: \{\[`key`: `string`\]: `unknown`; \}; `experimental?`: \{\[`key`: `string`\]: `object`; \}; `logging?`: \{\[`key`: `string`\]: `unknown`; \}; `prompts?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; \}; `resources?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; `subscribe?`: `boolean`; \}; `tools?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; \}; \}; `instructions?`: `string`; `protocolVersion`: `string`; `serverInfo`: \{\[`key`: `string`\]: `unknown`; `description?`: `string`; `icons?`: `object`[]; `name`: `string`; `title?`: `string`; `version`: `string`; `websiteUrl?`: `string`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `completion`: \{\[`key`: `string`\]: `unknown`; `hasMore?`: `boolean`; `total?`: `number`; `values`: `string`[]; \}; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `description?`: `string`; `messages`: `object`[]; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `nextCursor?`: `string`; `prompts`: `object`[]; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `nextCursor?`: `string`; `resources`: `object`[]; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `nextCursor?`: `string`; `resourceTemplates`: `object`[]; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `contents`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: ...\]: ...; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: ...\]: ...; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \})[]; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: ...\]: ...; \}; `annotations?`: \{\[`key`: ...\]: ...; `audience?`: ...; `lastModified?`: ...; `priority?`: ...; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: ...\]: ...; \}; `annotations?`: \{\[`key`: ...\]: ...; `audience?`: ...; `lastModified?`: ...; `priority?`: ...; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: ...\]: ...; \}; `annotations?`: \{\[`key`: ...\]: ...; `audience?`: ...; `lastModified?`: ...; `priority?`: ...; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: ...\]: ...; \}; `annotations?`: \{\[`key`: ...\]: ...; `audience?`: ...; `lastModified?`: ...; `priority?`: ...; \}; `description?`: `string`; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: ...\]: ...; \}; `annotations?`: \{\[`key`: ...\]: ...; `audience?`: ...; `lastModified?`: ...; `priority?`: ...; \}; `resource`: \{\[`key`: ...\]: ...; `_meta?`: ...; `mimeType?`: ...; `text`: ...; `uri`: ...; \} \| \{\[`key`: ...\]: ...; `_meta?`: ...; `blob`: ...; `mimeType?`: ...; `uri`: ...; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; `structuredContent?`: \{\[`key`: `string`\]: `unknown`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `nextCursor?`: `string`; `tools`: `object`[]; \}; \}\>\>

###### Returns

`Promise`\<`ReadableStreamReadResult`\<\{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"ping"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; \}; \} \| \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"sampling/createMessage"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `includeContext?`: `"allServers"` \| `"none"` \| `"thisServer"`; `maxTokens`: `number`; `messages`: `object`[]; `metadata?`: \{\[`key`: `string`\]: `unknown`; \}; `modelPreferences?`: \{\[`key`: `string`\]: `unknown`; `costPriority?`: `number`; `hints?`: `object`[]; `intelligencePriority?`: `number`; `speedPriority?`: `number`; \}; `stopSequences?`: `string`[]; `systemPrompt?`: `string`; `temperature?`: `number`; `toolChoice?`: \{\[`key`: `string`\]: `unknown`; `type`: `"auto"`; \} \| \{\[`key`: `string`\]: `unknown`; `type`: `"required"`; \} \| \{\[`key`: `string`\]: `unknown`; `toolName`: `string`; `type`: `"tool"`; \}; `tools?`: `object`[]; \}; \} \| \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"roots/list"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; \}; \} \| \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"elicitation/create"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `message`: `string`; `mode?`: `"form"`; `requestedSchema`: \{\[`key`: `string`\]: `unknown`; `properties`: \{\[`key`: `string`\]: \{\[`key`: `string`\]: `unknown`; `default?`: ... \| ...; `description?`: ... \| ...; `format?`: ... \| ... \| ... \| ... \| ...; `maxLength?`: ... \| ...; `minLength?`: ... \| ...; `title?`: ... \| ...; `type`: `"string"`; \} \| \{\[`key`: `string`\]: `unknown`; `default?`: ... \| ...; `description?`: ... \| ...; `maximum?`: ... \| ...; `minimum?`: ... \| ...; `title?`: ... \| ...; `type`: ... \| ...; \} \| \{\[`key`: `string`\]: `unknown`; `default?`: ... \| ... \| ...; `description?`: ... \| ...; `title?`: ... \| ...; `type`: `"boolean"`; \} \| \{\[`key`: `string`\]: `unknown`; `default?`: ... \| ...; `description?`: ... \| ...; `enum`: ...[]; `enumNames?`: ... \| ...; `title?`: ... \| ...; `type`: `"string"`; \} \| \{\[`key`: `string`\]: `unknown`; `default?`: ... \| ...; `description?`: ... \| ...; `items`: \{\[`key`: ...\]: ...; `enum`: ...; `enumNames?`: ...; `type`: ...; \}; `title?`: ... \| ...; `type`: `"array"`; \}; \}; `required?`: `string`[]; `type`: `"object"`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `elicitationId`: `string`; `message`: `string`; `mode`: `"url"`; `url`: `string`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/cancelled"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `reason?`: `string`; `requestId`: `string` \| `number`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/message"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `data`: `unknown`; `level`: `"error"` \| `"alert"` \| `"critical"` \| `"debug"` \| `"emergency"` \| `"info"` \| `"notice"` \| `"warning"`; `logger?`: `string`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/progress"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `message?`: `string`; `progress`: `number`; `progressToken`: `string` \| `number`; `total?`: `number`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/resources/updated"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `uri`: `string`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/resources/list_changed"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; \}; \} \| \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/tools/list_changed"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; \}; \} \| \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/prompts/list_changed"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; \}; \} \| \{\[`key`: `string`\]: `unknown`; `error`: \{\[`key`: `string`\]: `unknown`; `code`: `number`; `data?`: \{\[`key`: `string`\]: `unknown`; \}; `message`: `string`; \}; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; \} \| \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `result`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `capabilities`: \{\[`key`: `string`\]: `unknown`; `completions?`: \{\[`key`: `string`\]: `unknown`; \}; `experimental?`: \{\[`key`: `string`\]: `object`; \}; `logging?`: \{\[`key`: `string`\]: `unknown`; \}; `prompts?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; \}; `resources?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; `subscribe?`: `boolean`; \}; `tools?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; \}; \}; `instructions?`: `string`; `protocolVersion`: `string`; `serverInfo`: \{\[`key`: `string`\]: `unknown`; `description?`: `string`; `icons?`: `object`[]; `name`: `string`; `title?`: `string`; `version`: `string`; `websiteUrl?`: `string`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `completion`: \{\[`key`: `string`\]: `unknown`; `hasMore?`: `boolean`; `total?`: `number`; `values`: `string`[]; \}; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `description?`: `string`; `messages`: `object`[]; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `nextCursor?`: `string`; `prompts`: `object`[]; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `nextCursor?`: `string`; `resources`: `object`[]; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `nextCursor?`: `string`; `resourceTemplates`: `object`[]; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `contents`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: ...\]: ...; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: ...\]: ...; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \})[]; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: ...\]: ...; \}; `annotations?`: \{\[`key`: ...\]: ...; `audience?`: ...; `lastModified?`: ...; `priority?`: ...; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: ...\]: ...; \}; `annotations?`: \{\[`key`: ...\]: ...; `audience?`: ...; `lastModified?`: ...; `priority?`: ...; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: ...\]: ...; \}; `annotations?`: \{\[`key`: ...\]: ...; `audience?`: ...; `lastModified?`: ...; `priority?`: ...; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: ...\]: ...; \}; `annotations?`: \{\[`key`: ...\]: ...; `audience?`: ...; `lastModified?`: ...; `priority?`: ...; \}; `description?`: `string`; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: ...\]: ...; \}; `annotations?`: \{\[`key`: ...\]: ...; `audience?`: ...; `lastModified?`: ...; `priority?`: ...; \}; `resource`: \{\[`key`: ...\]: ...; `_meta?`: ...; `mimeType?`: ...; `text`: ...; `uri`: ...; \} \| \{\[`key`: ...\]: ...; `_meta?`: ...; `blob`: ...; `mimeType?`: ...; `uri`: ...; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; `structuredContent?`: \{\[`key`: `string`\]: `unknown`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `nextCursor?`: `string`; `tools`: `object`[]; \}; \}\>\>

###### Inherited from

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`_read`](../context-rpc/index.md#_read)

##### \_write()

> **\_write**(`message`): `Promise`\<`void`\>

###### Parameters

###### message

\{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"ping"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; \}; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"initialize"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `capabilities`: \{\[`key`: `string`\]: `unknown`; `elicitation?`: \{\[`key`: `string`\]: `unknown`; \}; `experimental?`: \{\[`key`: `string`\]: `object`; \}; `roots?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; \}; `sampling?`: \{\[`key`: `string`\]: `unknown`; `tools?`: \{\[`key`: `string`\]: `unknown`; \}; \}; \}; `clientInfo`: \{\[`key`: `string`\]: `unknown`; `description?`: `string`; `icons?`: `object`[]; `name`: `string`; `title?`: `string`; `version`: `string`; `websiteUrl?`: `string`; \}; `protocolVersion`: `string`; \}; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"completion/complete"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `argument`: \{\[`key`: `string`\]: `unknown`; `name`: `string`; `value`: `string`; \}; `context?`: \{\[`key`: `string`\]: `unknown`; `arguments?`: \{\[`key`: `string`\]: `string`; \}; \}; `ref`: \{\[`key`: `string`\]: `unknown`; `name`: `string`; `title?`: `string`; `type`: `"ref/prompt"`; \} \| \{\[`key`: `string`\]: `unknown`; `type`: `"ref/resource"`; `uri`: `string`; \}; \}; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"logging/setLevel"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `level`: `"error"` \| `"alert"` \| `"critical"` \| `"debug"` \| `"emergency"` \| `"info"` \| `"notice"` \| `"warning"`; \}; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"prompts/get"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `arguments?`: \{\[`key`: `string`\]: `string`; \}; `name`: `string`; \}; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"prompts/list"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `cursor?`: `string`; \}; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/list"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `cursor?`: `string`; \}; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/templates/list"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `cursor?`: `string`; \}; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/read"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `uri`: `string`; \}; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/subscribe"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `uri`: `string`; \}; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/unsubscribe"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `uri`: `string`; \}; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"tools/list"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `cursor?`: `string`; \}; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"tools/call"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `arguments?`: \{\[`key`: `string`\]: `unknown`; \}; `name`: `string`; \}; \} | \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/cancelled"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `reason?`: `string`; `requestId`: `string` \| `number`; \}; \} | \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/progress"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `message?`: `string`; `progress`: `number`; `progressToken`: `string` \| `number`; `total?`: `number`; \}; \} | \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/initialized"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; \}; \} | \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/roots/list_changed"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; \}; \} | \{\[`key`: `string`\]: `unknown`; `error`: \{\[`key`: `string`\]: `unknown`; `code`: `number`; `data?`: \{\[`key`: `string`\]: `unknown`; \}; `message`: `string`; \}; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `result`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \}; `model`: `string`; `role`: `"assistant"` \| `"user"`; `stopReason?`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `roots`: `object`[]; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `action`: `"accept"` \| `"cancel"` \| `"decline"`; `content?`: \{\[`key`: `string`\]: `string` \| `number` \| `boolean`; \}; \}; \}

###### Returns

`Promise`\<`void`\>

###### Overrides

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`_write`](../context-rpc/index.md#_write)

##### callTool()

> **callTool**(`params`): [`SentRequest`](../context-rpc/index.md#sentrequest)\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; `structuredContent?`: \{\[`key`: `string`\]: `unknown`; \}; \}\>

###### Parameters

###### params

[`ToolParams`](#toolparams)\<`T`\>

###### Returns

[`SentRequest`](../context-rpc/index.md#sentrequest)\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; `structuredContent?`: \{\[`key`: `string`\]: `unknown`; \}; \}\>

##### complete()

> **complete**(`params`): [`SentRequest`](../context-rpc/index.md#sentrequest)\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `completion`: \{\[`key`: `string`\]: `unknown`; `hasMore?`: `boolean`; `total?`: `number`; `values`: `string`[]; \}; \}\>

###### Parameters

###### params

###### _meta?

\{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}

###### _meta.progressToken?

`string` \| `number`

###### argument

\{\[`key`: `string`\]: `unknown`; `name`: `string`; `value`: `string`; \}

###### argument.name

`string`

###### argument.value

`string`

###### context?

\{\[`key`: `string`\]: `unknown`; `arguments?`: \{\[`key`: `string`\]: `string`; \}; \}

###### context.arguments?

\{\[`key`: `string`\]: `string`; \}

###### ref

\{\[`key`: `string`\]: `unknown`; `name`: `string`; `title?`: `string`; `type`: `"ref/prompt"`; \} \| \{\[`key`: `string`\]: `unknown`; `type`: `"ref/resource"`; `uri`: `string`; \}

###### Returns

[`SentRequest`](../context-rpc/index.md#sentrequest)\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `completion`: \{\[`key`: `string`\]: `unknown`; `hasMore?`: `boolean`; `total?`: `number`; `values`: `string`[]; \}; \}\>

##### getPrompt()

> **getPrompt**(`params`): [`SentRequest`](../context-rpc/index.md#sentrequest)\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `description?`: `string`; `messages`: `object`[]; \}\>

###### Parameters

###### params

[`PromptParams`](#promptparams)\<`T`\>

###### Returns

[`SentRequest`](../context-rpc/index.md#sentrequest)\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `description?`: `string`; `messages`: `object`[]; \}\>

##### initialize()

> **initialize**(): `Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `capabilities`: \{\[`key`: `string`\]: `unknown`; `completions?`: \{\[`key`: `string`\]: `unknown`; \}; `experimental?`: \{\[`key`: `string`\]: `object`; \}; `logging?`: \{\[`key`: `string`\]: `unknown`; \}; `prompts?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; \}; `resources?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; `subscribe?`: `boolean`; \}; `tools?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; \}; \}; `instructions?`: `string`; `protocolVersion`: `string`; `serverInfo`: \{\[`key`: `string`\]: `unknown`; `description?`: `string`; `icons?`: `object`[]; `name`: `string`; `title?`: `string`; `version`: `string`; `websiteUrl?`: `string`; \}; \}\>

###### Returns

`Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `capabilities`: \{\[`key`: `string`\]: `unknown`; `completions?`: \{\[`key`: `string`\]: `unknown`; \}; `experimental?`: \{\[`key`: `string`\]: `object`; \}; `logging?`: \{\[`key`: `string`\]: `unknown`; \}; `prompts?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; \}; `resources?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; `subscribe?`: `boolean`; \}; `tools?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; \}; \}; `instructions?`: `string`; `protocolVersion`: `string`; `serverInfo`: \{\[`key`: `string`\]: `unknown`; `description?`: `string`; `icons?`: `object`[]; `name`: `string`; `title?`: `string`; `version`: `string`; `websiteUrl?`: `string`; \}; \}\>

##### listPrompts()

> **listPrompts**(`params`): [`SentRequest`](../context-rpc/index.md#sentrequest)\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `nextCursor?`: `string`; `prompts`: `object`[]; \}\>

###### Parameters

###### params

\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `cursor?`: `string`; \} | `undefined`

###### Returns

[`SentRequest`](../context-rpc/index.md#sentrequest)\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `nextCursor?`: `string`; `prompts`: `object`[]; \}\>

##### listResources()

> **listResources**(`params`): [`SentRequest`](../context-rpc/index.md#sentrequest)\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `nextCursor?`: `string`; `resources`: `object`[]; \}\>

###### Parameters

###### params

\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `cursor?`: `string`; \} | `undefined`

###### Returns

[`SentRequest`](../context-rpc/index.md#sentrequest)\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `nextCursor?`: `string`; `resources`: `object`[]; \}\>

##### listResourceTemplates()

> **listResourceTemplates**(`params`): [`SentRequest`](../context-rpc/index.md#sentrequest)\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `nextCursor?`: `string`; `resourceTemplates`: `object`[]; \}\>

###### Parameters

###### params

\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `cursor?`: `string`; \} | `undefined`

###### Returns

[`SentRequest`](../context-rpc/index.md#sentrequest)\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `nextCursor?`: `string`; `resourceTemplates`: `object`[]; \}\>

##### listTools()

> **listTools**(`params`): [`SentRequest`](../context-rpc/index.md#sentrequest)\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `nextCursor?`: `string`; `tools`: `object`[]; \}\>

###### Parameters

###### params

\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `cursor?`: `string`; \} | `undefined`

###### Returns

[`SentRequest`](../context-rpc/index.md#sentrequest)\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `nextCursor?`: `string`; `tools`: `object`[]; \}\>

##### notify()

> **notify**\<`Event`\>(`event`, `params`): `Promise`\<`void`\>

###### Type Parameters

###### Event

`Event` *extends* `"initialized"` \| `"roots/list_changed"`

###### Parameters

###### event

`Event`

###### params

[`ClientNotifications`](../context-protocol/index.md#clientnotifications)\[`Event`\]\[`"params"`\]

###### Returns

`Promise`\<`void`\>

###### Inherited from

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`notify`](../context-rpc/index.md#notify)

##### readResource()

> **readResource**(`params`): [`SentRequest`](../context-rpc/index.md#sentrequest)\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `contents`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \})[]; \}\>

###### Parameters

###### params

###### _meta?

\{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}

###### _meta.progressToken?

`string` \| `number`

###### uri

`string`

###### Returns

[`SentRequest`](../context-rpc/index.md#sentrequest)\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `contents`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \})[]; \}\>

##### request()

> **request**\<`Method`\>(`method`, `params`): [`SentRequest`](../context-rpc/index.md#sentrequest)\<[`ClientRequests`](../context-protocol/index.md#clientrequests)\[`Method`\]\[`"Result"`\]\>

###### Type Parameters

###### Method

`Method` *extends* keyof [`ClientRequests`](../context-protocol/index.md#clientrequests)

###### Parameters

###### method

`Method`

###### params

[`ClientRequests`](../context-protocol/index.md#clientrequests)\[`Method`\]\[`"Params"`\]

###### Returns

[`SentRequest`](../context-rpc/index.md#sentrequest)\<[`ClientRequests`](../context-protocol/index.md#clientrequests)\[`Method`\]\[`"Result"`\]\>

###### Inherited from

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`request`](../context-rpc/index.md#request)

##### requestValue()

> **requestValue**\<`Method`, `Value`\>(`method`, `params`, `getValue`): [`SentRequest`](../context-rpc/index.md#sentrequest)\<`Value`\>

###### Type Parameters

###### Method

`Method` *extends* keyof [`ClientRequests`](../context-protocol/index.md#clientrequests)

###### Value

`Value`

###### Parameters

###### method

`Method`

###### params

[`ClientRequests`](../context-protocol/index.md#clientrequests)\[`Method`\]\[`"Params"`\]

###### getValue

(`result`) => `Value`

###### Returns

[`SentRequest`](../context-rpc/index.md#sentrequest)\<`Value`\>

###### Inherited from

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`requestValue`](../context-rpc/index.md#requestvalue)

##### setLoggingLevel()

> **setLoggingLevel**(`params`): [`SentRequest`](../context-rpc/index.md#sentrequest)\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; \}\>

###### Parameters

###### params

###### _meta?

\{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}

###### _meta.progressToken?

`string` \| `number`

###### level

`"error"` \| `"alert"` \| `"critical"` \| `"debug"` \| `"emergency"` \| `"info"` \| `"notice"` \| `"warning"`

###### Returns

[`SentRequest`](../context-rpc/index.md#sentrequest)\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; \}\>

## Type Aliases

### ClientParams

> **ClientParams** = `object`

#### Properties

##### createMessage?

> `optional` **createMessage**: [`CreateMessageHandler`](#createmessagehandler)

##### elicit?

> `optional` **elicit**: [`ElicitHandler`](#elicithandler)

##### listRoots?

> `optional` **listRoots**: [`Root`](../context-protocol/index.md#root)[] \| [`ListRootsHandler`](#listrootshandler)

##### transport

> **transport**: [`ClientTransport`](#clienttransport)

***

### ClientTransport

> **ClientTransport** = `TransportType`\<[`ServerMessage`](../context-protocol/index.md#servermessage), [`ClientMessage`](../context-protocol/index.md#clientmessage)\>

***

### ContextTypes

> **ContextTypes** = `object`

#### Properties

##### Prompts?

> `optional` **Prompts**: `Record`\<`string`, `Record`\<`string`, `unknown`\> \| `never`\>

##### Tools?

> `optional` **Tools**: `Record`\<`string`, `Record`\<`string`, `unknown`\>\>

***

### CreateMessageHandler()

> **CreateMessageHandler** = (`params`, `signal`) => [`CreateMessageResult`](../context-protocol/index.md#createmessageresult) \| `Promise`\<[`CreateMessageResult`](../context-protocol/index.md#createmessageresult)\>

#### Parameters

##### params

[`CreateMessageRequest`](../context-protocol/index.md#createmessagerequest)\[`"params"`\]

##### signal

`AbortSignal`

#### Returns

[`CreateMessageResult`](../context-protocol/index.md#createmessageresult) \| `Promise`\<[`CreateMessageResult`](../context-protocol/index.md#createmessageresult)\>

***

### ElicitHandler()

> **ElicitHandler** = (`params`, `signal`) => [`ElicitResult`](../context-protocol/index.md#elicitresult) \| `Promise`\<[`ElicitResult`](../context-protocol/index.md#elicitresult)\>

#### Parameters

##### params

[`ElicitRequest`](../context-protocol/index.md#elicitrequest)\[`"params"`\]

##### signal

`AbortSignal`

#### Returns

[`ElicitResult`](../context-protocol/index.md#elicitresult) \| `Promise`\<[`ElicitResult`](../context-protocol/index.md#elicitresult)\>

***

### ListRootsHandler()

> **ListRootsHandler** = (`signal`) => [`Root`](../context-protocol/index.md#root)[] \| `Promise`\<[`Root`](../context-protocol/index.md#root)[]\>

#### Parameters

##### signal

`AbortSignal`

#### Returns

[`Root`](../context-protocol/index.md#root)[] \| `Promise`\<[`Root`](../context-protocol/index.md#root)[]\>

***

### PromptParams

> **PromptParams**\<`T`\> = `object`

#### Type Parameters

##### T

`T` *extends* [`ContextTypes`](#contexttypes)

#### Properties

##### \_meta?

> `optional` **\_meta**: [`Metadata`](../context-protocol/index.md#metadata)

##### arguments

> **arguments**: `T`\[`"Prompts"`\]\[keyof `T`\[`"Prompts"`\]\] *extends* `undefined` ? `never` : `T`\[`"Prompts"`\]\[keyof `T`\[`"Prompts"`\]\]

##### name

> **name**: keyof `T`\[`"Prompts"`\] & `string`

***

### ToolParams

> **ToolParams**\<`T`\> = `object`

#### Type Parameters

##### T

`T` *extends* [`ContextTypes`](#contexttypes)

#### Properties

##### \_meta?

> `optional` **\_meta**: [`Metadata`](../context-protocol/index.md#metadata)

##### arguments

> **arguments**: `T`\[`"Tools"`\]\[keyof `T`\[`"Tools"`\]\] *extends* `undefined` ? `never` : `T`\[`"Tools"`\]\[keyof `T`\[`"Tools"`\]\]

##### name

> **name**: keyof `T`\[`"Tools"`\] & `string`

***

### UnknownContextTypes

> **UnknownContextTypes** = `object`

#### Properties

##### Prompts

> **Prompts**: `Record`\<`string`, `Record`\<`string`, `unknown`\>\>

##### Tools

> **Tools**: `Record`\<`string`, `Record`\<`string`, `unknown`\>\>
