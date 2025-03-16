# @mokei/context-client

Mokei MCP client.

## Installation

```sh
npm install @mokei/context-client
```

## Classes

### ContextClient\<T\>

#### Extends

- [`ContextRPC`](../context-rpc/index.md#contextrpc)\<`ClientTypes`\>

#### Type Parameters

##### T

`T` *extends* [`ContextTypes`](#contexttypes) = [`UnknownContextTypes`](#unknowncontexttypes)

#### Constructors

##### new ContextClient()

> **new ContextClient**\<`T`\>(`params`): [`ContextClient`](#contextclient)\<`T`\>

###### Parameters

###### params

[`ClientParams`](#clientparams)

###### Returns

[`ContextClient`](#contextclient)\<`T`\>

###### Overrides

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`constructor`](../context-rpc/index.md#contextrpc#constructor)

#### Accessors

##### events

###### Get Signature

> **get** **events**(): `EventEmitter`\<`T`\[`"Events"`\]\>

###### Returns

`EventEmitter`\<`T`\[`"Events"`\]\>

###### Inherited from

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`events`](../context-rpc/index.md#contextrpc#events)

***

##### notifications

###### Get Signature

> **get** **notifications**(): `ReadableStream`\<\{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/cancelled"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `reason`: `string`; `requestId`: `string` \| `number`; \}; \} \| \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/message"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `data`: `unknown`; `level`: `"alert"` \| `"critical"` \| `"debug"` \| `"emergency"` \| `"error"` \| `"info"` \| `"notice"` \| `"warning"`; `logger`: `string`; \}; \} \| \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/progress"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `progress`: `number`; `progressToken`: `string` \| `number`; `total`: `number`; \}; \} \| \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/resources/updated"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `uri`: `string`; \}; \} \| \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/resources/list_changed"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; \}; \} \| \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/tools/list_changed"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; \}; \} \| \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/prompts/list_changed"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; \}; \}\>

###### Returns

`ReadableStream`\<\{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/cancelled"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `reason`: `string`; `requestId`: `string` \| `number`; \}; \} \| \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/message"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `data`: `unknown`; `level`: `"alert"` \| `"critical"` \| `"debug"` \| `"emergency"` \| `"error"` \| `"info"` \| `"notice"` \| `"warning"`; `logger`: `string`; \}; \} \| \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/progress"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `progress`: `number`; `progressToken`: `string` \| `number`; `total`: `number`; \}; \} \| \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/resources/updated"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `uri`: `string`; \}; \} \| \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/resources/list_changed"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; \}; \} \| \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/tools/list_changed"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; \}; \} \| \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/prompts/list_changed"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; \}; \}\>

#### Methods

##### \_getNextRequestID()

> **\_getNextRequestID**(): `string` \| `number`

###### Returns

`string` \| `number`

###### Inherited from

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`_getNextRequestID`](../context-rpc/index.md#contextrpc#_getnextrequestid)

***

##### \_handle()

> **\_handle**(): `void`

###### Returns

`void`

###### Inherited from

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`_handle`](../context-rpc/index.md#contextrpc#_handle)

***

##### \_handleNotification()

> **\_handleNotification**(`notification`): `void`

###### Parameters

###### notification

`HandleNotification`

###### Returns

`void`

###### Overrides

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`_handleNotification`](../context-rpc/index.md#contextrpc#_handlenotification)

***

##### \_handleRequest()

> **\_handleRequest**(`request`, `signal`): `Promise`\<\{ `[key: string]`: `unknown`;  `_meta`: \{\}; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `content`: \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \}; `model`: `string`; `role`: `"assistant"` \| `"user"`; `stopReason`: `string`; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `roots`: `object`[]; \}\>

###### Parameters

###### request

\{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"ping"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"sampling/createMessage"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `includeContext`: `"allServers"` \| `"none"` \| `"thisServer"`; `maxTokens`: `number`; `messages`: `object`[]; `metadata`: \{\}; `modelPreferences`: \{ `[key: string]`: `unknown`;  `costPriority`: `number`; `hints`: `object`[]; `intelligencePriority`: `number`; `speedPriority`: `number`; \}; `stopSequences`: `string`[]; `systemPrompt`: `string`; `temperature`: `number`; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"roots/list"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; \}; \}

###### signal

`AbortSignal`

###### Returns

`Promise`\<\{ `[key: string]`: `unknown`;  `_meta`: \{\}; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `content`: \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \}; `model`: `string`; `role`: `"assistant"` \| `"user"`; `stopReason`: `string`; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `roots`: `object`[]; \}\>

###### Overrides

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`_handleRequest`](../context-rpc/index.md#contextrpc#_handlerequest)

***

##### \_read()

> **\_read**(): `Promise`\<`ReadableStreamReadResult`\<\{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"ping"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; \}; \} \| \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"sampling/createMessage"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `includeContext`: `"allServers"` \| `"none"` \| `"thisServer"`; `maxTokens`: `number`; `messages`: `object`[]; `metadata`: \{\}; `modelPreferences`: \{ `[key: string]`: `unknown`;  `costPriority`: `number`; `hints`: `object`[]; `intelligencePriority`: `number`; `speedPriority`: `number`; \}; `stopSequences`: `string`[]; `systemPrompt`: `string`; `temperature`: `number`; \}; \} \| \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"roots/list"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; \}; \} \| \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/cancelled"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `reason`: `string`; `requestId`: `string` \| `number`; \}; \} \| \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/message"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `data`: `unknown`; `level`: `"alert"` \| `"critical"` \| `"debug"` \| `"emergency"` \| `"error"` \| `"info"` \| `"notice"` \| `"warning"`; `logger`: `string`; \}; \} \| \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/progress"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `progress`: `number`; `progressToken`: `string` \| `number`; `total`: `number`; \}; \} \| \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/resources/updated"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `uri`: `string`; \}; \} \| \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/resources/list_changed"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; \}; \} \| \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/tools/list_changed"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; \}; \} \| \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/prompts/list_changed"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; \}; \} \| \{ `[key: string]`: `unknown`;  `error`: \{ `[key: string]`: `unknown`;  `code`: `number`; `data`: \{\}; `message`: `string`; \}; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; \} \| \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `result`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `capabilities`: \{ `[key: string]`: `unknown`;  `experimental`: \{\}; `logging`: \{\}; `prompts`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; \}; `resources`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; `subscribe`: `boolean`; \}; `tools`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; \}; \}; `instructions`: `string`; `protocolVersion`: `string`; `serverInfo`: \{ `[key: string]`: `unknown`;  `name`: `string`; `version`: `string`; \}; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `completion`: \{ `[key: string]`: `unknown`;  `hasMore`: `boolean`; `total`: `number`; `values`: `string`[]; \}; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `description`: `string`; `messages`: `object`[]; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `nextCursor`: `string`; `prompts`: `object`[]; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `nextCursor`: `string`; `resources`: `object`[]; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `nextCursor`: `string`; `resourceTemplates`: `object`[]; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `contents`: (\{ `[key: string]`: `unknown`;  `mimeType`: `string`; `text`: `string`; `uri`: `string`; \} \| \{ `[key: string]`: `unknown`;  `blob`: `string`; `mimeType`: `string`; `uri`: `string`; \})[]; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `content`: (\{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: ...]`: ...;  `audience`: ...; `priority`: ...; \}; `text`: `string`; `type`: `"text"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: ...]`: ...;  `audience`: ...; `priority`: ...; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: ...]`: ...;  `audience`: ...; `priority`: ...; \}; `resource`: \{ `[key: ...]`: ...;  `mimeType`: ...; `text`: ...; `uri`: ...; \} \| \{ `[key: ...]`: ...;  `blob`: ...; `mimeType`: ...; `uri`: ...; \}; `type`: `"resource"`; \})[]; `isError`: `boolean`; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `nextCursor`: `string`; `tools`: `object`[]; \}; \}\>\>

###### Returns

`Promise`\<`ReadableStreamReadResult`\<\{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"ping"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; \}; \} \| \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"sampling/createMessage"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `includeContext`: `"allServers"` \| `"none"` \| `"thisServer"`; `maxTokens`: `number`; `messages`: `object`[]; `metadata`: \{\}; `modelPreferences`: \{ `[key: string]`: `unknown`;  `costPriority`: `number`; `hints`: `object`[]; `intelligencePriority`: `number`; `speedPriority`: `number`; \}; `stopSequences`: `string`[]; `systemPrompt`: `string`; `temperature`: `number`; \}; \} \| \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"roots/list"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; \}; \} \| \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/cancelled"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `reason`: `string`; `requestId`: `string` \| `number`; \}; \} \| \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/message"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `data`: `unknown`; `level`: `"alert"` \| `"critical"` \| `"debug"` \| `"emergency"` \| `"error"` \| `"info"` \| `"notice"` \| `"warning"`; `logger`: `string`; \}; \} \| \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/progress"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `progress`: `number`; `progressToken`: `string` \| `number`; `total`: `number`; \}; \} \| \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/resources/updated"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `uri`: `string`; \}; \} \| \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/resources/list_changed"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; \}; \} \| \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/tools/list_changed"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; \}; \} \| \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/prompts/list_changed"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; \}; \} \| \{ `[key: string]`: `unknown`;  `error`: \{ `[key: string]`: `unknown`;  `code`: `number`; `data`: \{\}; `message`: `string`; \}; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; \} \| \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `result`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `capabilities`: \{ `[key: string]`: `unknown`;  `experimental`: \{\}; `logging`: \{\}; `prompts`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; \}; `resources`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; `subscribe`: `boolean`; \}; `tools`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; \}; \}; `instructions`: `string`; `protocolVersion`: `string`; `serverInfo`: \{ `[key: string]`: `unknown`;  `name`: `string`; `version`: `string`; \}; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `completion`: \{ `[key: string]`: `unknown`;  `hasMore`: `boolean`; `total`: `number`; `values`: `string`[]; \}; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `description`: `string`; `messages`: `object`[]; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `nextCursor`: `string`; `prompts`: `object`[]; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `nextCursor`: `string`; `resources`: `object`[]; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `nextCursor`: `string`; `resourceTemplates`: `object`[]; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `contents`: (\{ `[key: string]`: `unknown`;  `mimeType`: `string`; `text`: `string`; `uri`: `string`; \} \| \{ `[key: string]`: `unknown`;  `blob`: `string`; `mimeType`: `string`; `uri`: `string`; \})[]; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `content`: (\{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: ...]`: ...;  `audience`: ...; `priority`: ...; \}; `text`: `string`; `type`: `"text"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: ...]`: ...;  `audience`: ...; `priority`: ...; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: ...]`: ...;  `audience`: ...; `priority`: ...; \}; `resource`: \{ `[key: ...]`: ...;  `mimeType`: ...; `text`: ...; `uri`: ...; \} \| \{ `[key: ...]`: ...;  `blob`: ...; `mimeType`: ...; `uri`: ...; \}; `type`: `"resource"`; \})[]; `isError`: `boolean`; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `nextCursor`: `string`; `tools`: `object`[]; \}; \}\>\>

###### Inherited from

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`_read`](../context-rpc/index.md#contextrpc#_read)

***

##### \_write()

> **\_write**(`message`): `Promise`\<`void`\>

###### Parameters

###### message

\{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"ping"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"initialize"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `capabilities`: \{ `[key: string]`: `unknown`;  `experimental`: \{\}; `roots`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; \}; `sampling`: \{\}; \}; `clientInfo`: \{ `[key: string]`: `unknown`;  `name`: `string`; `version`: `string`; \}; `protocolVersion`: `string`; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"completion/complete"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `argument`: \{ `[key: string]`: `unknown`;  `name`: `string`; `value`: `string`; \}; `ref`: \{ `[key: string]`: `unknown`;  `name`: `string`; `type`: `"ref/prompt"`; \} \| \{ `[key: string]`: `unknown`;  `type`: `"ref/resource"`; `uri`: `string`; \}; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"logging/setLevel"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `level`: `"alert"` \| `"critical"` \| `"debug"` \| `"emergency"` \| `"error"` \| `"info"` \| `"notice"` \| `"warning"`; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"prompts/get"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `arguments`: \{\}; `name`: `string`; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"prompts/list"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `cursor`: `string`; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/list"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `cursor`: `string`; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/templates/list"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `cursor`: `string`; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/read"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `uri`: `string`; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/subscribe"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `uri`: `string`; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/unsubscribe"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `uri`: `string`; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"tools/list"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `cursor`: `string`; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"tools/call"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `arguments`: \{\}; `name`: `string`; \}; \} | \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/cancelled"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `reason`: `string`; `requestId`: `string` \| `number`; \}; \} | \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/progress"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `progress`: `number`; `progressToken`: `string` \| `number`; `total`: `number`; \}; \} | \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/initialized"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; \}; \} | \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/roots/list_changed"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; \}; \} | \{ `[key: string]`: `unknown`;  `error`: \{ `[key: string]`: `unknown`;  `code`: `number`; `data`: \{\}; `message`: `string`; \}; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `result`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `content`: \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (... \| ...)[]; `priority`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (... \| ...)[]; `priority`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \}; `model`: `string`; `role`: `"assistant"` \| `"user"`; `stopReason`: `string`; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `roots`: `object`[]; \}; \}

###### Returns

`Promise`\<`void`\>

###### Overrides

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`_write`](../context-rpc/index.md#contextrpc#_write)

***

##### callTool()

> **callTool**\<`Name`\>(`name`, `args`): [`SentRequest`](../context-rpc/index.md#sentrequest)\<\{ `[key: string]`: `unknown`;  `_meta`: \{\}; `content`: (\{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `resource`: \{ `[key: string]`: `unknown`;  `mimeType`: `string`; `text`: `string`; `uri`: `string`; \} \| \{ `[key: string]`: `unknown`;  `blob`: `string`; `mimeType`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError`: `boolean`; \}\>

###### Type Parameters

###### Name

`Name` *extends* `string`

###### Parameters

###### name

`Name`

###### args

`T`\[`"Tools"`\]\[`Name`\]

###### Returns

[`SentRequest`](../context-rpc/index.md#sentrequest)\<\{ `[key: string]`: `unknown`;  `_meta`: \{\}; `content`: (\{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `resource`: \{ `[key: string]`: `unknown`;  `mimeType`: `string`; `text`: `string`; `uri`: `string`; \} \| \{ `[key: string]`: `unknown`;  `blob`: `string`; `mimeType`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError`: `boolean`; \}\>

***

##### complete()

> **complete**(`params`): [`SentRequest`](../context-rpc/index.md#sentrequest)\<\{ `[key: string]`: `unknown`;  `hasMore`: `boolean`; `total`: `number`; `values`: `string`[]; \}\>

###### Parameters

###### params

###### _meta?

\{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}

###### _meta.progressToken?

`string` \| `number`

###### argument

\{ `[key: string]`: `unknown`;  `name`: `string`; `value`: `string`; \}

###### argument.name

`string`

###### argument.value

`string`

###### ref

\{ `[key: string]`: `unknown`;  `name`: `string`; `type`: `"ref/prompt"`; \} \| \{ `[key: string]`: `unknown`;  `type`: `"ref/resource"`; `uri`: `string`; \}

###### Returns

[`SentRequest`](../context-rpc/index.md#sentrequest)\<\{ `[key: string]`: `unknown`;  `hasMore`: `boolean`; `total`: `number`; `values`: `string`[]; \}\>

***

##### getPrompt()

> **getPrompt**\<`Name`\>(`name`, `args`): [`SentRequest`](../context-rpc/index.md#sentrequest)\<\{ `[key: string]`: `unknown`;  `_meta`: \{\}; `description`: `string`; `messages`: `object`[]; \}\>

###### Type Parameters

###### Name

`Name` *extends* `string`

###### Parameters

###### name

`Name`

###### args

`T`\[`"Prompts"`\]\[`Name`\] *extends* `undefined` ? `never` : `T`\[`"Prompts"`\]\[`Name`\]

###### Returns

[`SentRequest`](../context-rpc/index.md#sentrequest)\<\{ `[key: string]`: `unknown`;  `_meta`: \{\}; `description`: `string`; `messages`: `object`[]; \}\>

***

##### initialize()

> **initialize**(): `Promise`\<\{ `[key: string]`: `unknown`;  `_meta`: \{\}; `capabilities`: \{ `[key: string]`: `unknown`;  `experimental`: \{\}; `logging`: \{\}; `prompts`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; \}; `resources`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; `subscribe`: `boolean`; \}; `tools`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; \}; \}; `instructions`: `string`; `protocolVersion`: `string`; `serverInfo`: \{ `[key: string]`: `unknown`;  `name`: `string`; `version`: `string`; \}; \}\>

###### Returns

`Promise`\<\{ `[key: string]`: `unknown`;  `_meta`: \{\}; `capabilities`: \{ `[key: string]`: `unknown`;  `experimental`: \{\}; `logging`: \{\}; `prompts`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; \}; `resources`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; `subscribe`: `boolean`; \}; `tools`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; \}; \}; `instructions`: `string`; `protocolVersion`: `string`; `serverInfo`: \{ `[key: string]`: `unknown`;  `name`: `string`; `version`: `string`; \}; \}\>

***

##### listPrompts()

> **listPrompts**(): [`SentRequest`](../context-rpc/index.md#sentrequest)\<`object`[]\>

###### Returns

[`SentRequest`](../context-rpc/index.md#sentrequest)\<`object`[]\>

***

##### listResources()

> **listResources**(): [`SentRequest`](../context-rpc/index.md#sentrequest)\<`object`[]\>

###### Returns

[`SentRequest`](../context-rpc/index.md#sentrequest)\<`object`[]\>

***

##### listResourceTemplates()

> **listResourceTemplates**(): [`SentRequest`](../context-rpc/index.md#sentrequest)\<`object`[]\>

###### Returns

[`SentRequest`](../context-rpc/index.md#sentrequest)\<`object`[]\>

***

##### listTools()

> **listTools**(): [`SentRequest`](../context-rpc/index.md#sentrequest)\<`object`[]\>

###### Returns

[`SentRequest`](../context-rpc/index.md#sentrequest)\<`object`[]\>

***

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

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`notify`](../context-rpc/index.md#contextrpc#notify)

***

##### readResource()

> **readResource**(`params`): [`SentRequest`](../context-rpc/index.md#sentrequest)\<\{ `[key: string]`: `unknown`;  `_meta`: \{\}; `contents`: (\{ `[key: string]`: `unknown`;  `mimeType`: `string`; `text`: `string`; `uri`: `string`; \} \| \{ `[key: string]`: `unknown`;  `blob`: `string`; `mimeType`: `string`; `uri`: `string`; \})[]; \}\>

###### Parameters

###### params

###### _meta?

\{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}

###### _meta.progressToken?

`string` \| `number`

###### uri

`string`

###### Returns

[`SentRequest`](../context-rpc/index.md#sentrequest)\<\{ `[key: string]`: `unknown`;  `_meta`: \{\}; `contents`: (\{ `[key: string]`: `unknown`;  `mimeType`: `string`; `text`: `string`; `uri`: `string`; \} \| \{ `[key: string]`: `unknown`;  `blob`: `string`; `mimeType`: `string`; `uri`: `string`; \})[]; \}\>

***

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

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`request`](../context-rpc/index.md#contextrpc#request)

***

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

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`requestValue`](../context-rpc/index.md#contextrpc#requestvalue)

***

##### setLoggingLevel()

> **setLoggingLevel**(`level`): [`SentRequest`](../context-rpc/index.md#sentrequest)\<`void`\>

###### Parameters

###### level

`"alert"` | `"critical"` | `"debug"` | `"emergency"` | `"error"` | `"info"` | `"notice"` | `"warning"`

###### Returns

[`SentRequest`](../context-rpc/index.md#sentrequest)\<`void`\>

## Type Aliases

### ClientParams

> **ClientParams** = `object`

#### Properties

##### createMessage?

> `optional` **createMessage**: `CreateMessageHandler`

***

##### listRoots?

> `optional` **listRoots**: [`Root`](../context-protocol/index.md#root)[] \| `ListRootsHandler`

***

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

***

##### Tools?

> `optional` **Tools**: `Record`\<`string`, `Record`\<`string`, `unknown`\>\>

***

### UnknownContextTypes

> **UnknownContextTypes** = `object`

#### Properties

##### Prompts

> **Prompts**: `Record`\<`string`, `Record`\<`string`, `unknown`\>\>

***

##### Tools

> **Tools**: `Record`\<`string`, `Record`\<`string`, `unknown`\>\>
