# @mokei/context-server

Mokei MCP server.

## Installation

```sh
npm install @mokei/context-server
```

## Classes

### ContextServer

#### Extends

- [`ContextRPC`](../context-rpc/index.md#contextrpct)\<`ServerTypes`\>

#### Constructors

##### new ContextServer()

> **new ContextServer**(`params`): [`ContextServer`](index.md#contextserver)

###### Parameters

###### params

[`ServerParams`](index.md#serverparams)

###### Returns

[`ContextServer`](index.md#contextserver)

###### Overrides

[`ContextRPC`](../context-rpc/index.md#contextrpct).[`constructor`](../context-rpc/index.md#constructors-1)

#### Accessors

##### clientInitialize

###### Get Signature

> **get** **clientInitialize**(): `undefined` \| \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `capabilities`: \{ `[key: string]`: `unknown`;  `experimental`: \{\}; `roots`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; \}; `sampling`: \{\}; \}; `clientInfo`: \{ `[key: string]`: `unknown`;  `name`: `string`; `version`: `string`; \}; `protocolVersion`: `string`; \}

###### Returns

`undefined` \| \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `capabilities`: \{ `[key: string]`: `unknown`;  `experimental`: \{\}; `roots`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; \}; `sampling`: \{\}; \}; `clientInfo`: \{ `[key: string]`: `unknown`;  `name`: `string`; `version`: `string`; \}; `protocolVersion`: `string`; \}

***

##### events

###### Get Signature

> **get** **events**(): `EventEmitter`\<`T`\[`"Events"`\]\>

###### Returns

`EventEmitter`\<`T`\[`"Events"`\]\>

###### Inherited from

[`ContextRPC`](../context-rpc/index.md#contextrpct).[`events`](../context-rpc/index.md#events-2)

#### Methods

##### \_getNextRequestID()

> **\_getNextRequestID**(): `string` \| `number`

###### Returns

`string` \| `number`

###### Inherited from

[`ContextRPC`](../context-rpc/index.md#contextrpct).[`_getNextRequestID`](../context-rpc/index.md#_getnextrequestid-2)

***

##### \_handle()

> **\_handle**(): `void`

###### Returns

`void`

###### Overrides

[`ContextRPC`](../context-rpc/index.md#contextrpct).[`_handle`](../context-rpc/index.md#_handle-2)

***

##### \_handleNotification()

> **\_handleNotification**(`notification`): `void`

###### Parameters

###### notification

`HandleNotification`

###### Returns

`void`

###### Overrides

[`ContextRPC`](../context-rpc/index.md#contextrpct).[`_handleNotification`](../context-rpc/index.md#_handlenotification-2)

***

##### \_handleRequest()

> **\_handleRequest**(`request`, `signal`): `Promise`\<\{ `[key: string]`: `unknown`;  `_meta`: \{\}; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `capabilities`: \{ `[key: string]`: `unknown`;  `experimental`: \{\}; `logging`: \{\}; `prompts`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; \}; `resources`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; `subscribe`: `boolean`; \}; `tools`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; \}; \}; `instructions`: `string`; `protocolVersion`: `string`; `serverInfo`: \{ `[key: string]`: `unknown`;  `name`: `string`; `version`: `string`; \}; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `completion`: \{ `[key: string]`: `unknown`;  `hasMore`: `boolean`; `total`: `number`; `values`: `string`[]; \}; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `description`: `string`; `messages`: `object`[]; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `nextCursor`: `string`; `prompts`: `object`[]; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `nextCursor`: `string`; `resources`: `object`[]; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `nextCursor`: `string`; `resourceTemplates`: `object`[]; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `contents`: (\{ `[key: string]`: `unknown`;  `mimeType`: `string`; `text`: `string`; `uri`: `string`; \} \| \{ `[key: string]`: `unknown`;  `blob`: `string`; `mimeType`: `string`; `uri`: `string`; \})[]; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `content`: (\{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (... \| ...)[]; `priority`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (... \| ...)[]; `priority`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (... \| ...)[]; `priority`: `number`; \}; `resource`: \{ `[key: string]`: `unknown`;  `mimeType`: `string`; `text`: `string`; `uri`: `string`; \} \| \{ `[key: string]`: `unknown`;  `blob`: `string`; `mimeType`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError`: `boolean`; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `nextCursor`: `string`; `tools`: `object`[]; \}\>

###### Parameters

###### request

\{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"ping"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"initialize"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `capabilities`: \{ `[key: string]`: `unknown`;  `experimental`: \{\}; `roots`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; \}; `sampling`: \{\}; \}; `clientInfo`: \{ `[key: string]`: `unknown`;  `name`: `string`; `version`: `string`; \}; `protocolVersion`: `string`; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"completion/complete"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `argument`: \{ `[key: string]`: `unknown`;  `name`: `string`; `value`: `string`; \}; `ref`: \{ `[key: string]`: `unknown`;  `name`: `string`; `type`: `"ref/prompt"`; \} \| \{ `[key: string]`: `unknown`;  `type`: `"ref/resource"`; `uri`: `string`; \}; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"logging/setLevel"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `level`: `"alert"` \| `"critical"` \| `"debug"` \| `"emergency"` \| `"error"` \| `"info"` \| `"notice"` \| `"warning"`; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"prompts/get"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `arguments`: \{\}; `name`: `string`; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"prompts/list"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `cursor`: `string`; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/list"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `cursor`: `string`; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/templates/list"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `cursor`: `string`; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/read"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `uri`: `string`; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/subscribe"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `uri`: `string`; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/unsubscribe"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `uri`: `string`; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"tools/list"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `cursor`: `string`; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"tools/call"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `arguments`: \{\}; `name`: `string`; \}; \}

###### signal

`AbortSignal`

###### Returns

`Promise`\<\{ `[key: string]`: `unknown`;  `_meta`: \{\}; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `capabilities`: \{ `[key: string]`: `unknown`;  `experimental`: \{\}; `logging`: \{\}; `prompts`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; \}; `resources`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; `subscribe`: `boolean`; \}; `tools`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; \}; \}; `instructions`: `string`; `protocolVersion`: `string`; `serverInfo`: \{ `[key: string]`: `unknown`;  `name`: `string`; `version`: `string`; \}; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `completion`: \{ `[key: string]`: `unknown`;  `hasMore`: `boolean`; `total`: `number`; `values`: `string`[]; \}; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `description`: `string`; `messages`: `object`[]; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `nextCursor`: `string`; `prompts`: `object`[]; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `nextCursor`: `string`; `resources`: `object`[]; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `nextCursor`: `string`; `resourceTemplates`: `object`[]; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `contents`: (\{ `[key: string]`: `unknown`;  `mimeType`: `string`; `text`: `string`; `uri`: `string`; \} \| \{ `[key: string]`: `unknown`;  `blob`: `string`; `mimeType`: `string`; `uri`: `string`; \})[]; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `content`: (\{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (... \| ...)[]; `priority`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (... \| ...)[]; `priority`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (... \| ...)[]; `priority`: `number`; \}; `resource`: \{ `[key: string]`: `unknown`;  `mimeType`: `string`; `text`: `string`; `uri`: `string`; \} \| \{ `[key: string]`: `unknown`;  `blob`: `string`; `mimeType`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError`: `boolean`; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `nextCursor`: `string`; `tools`: `object`[]; \}\>

###### Overrides

[`ContextRPC`](../context-rpc/index.md#contextrpct).[`_handleRequest`](../context-rpc/index.md#_handlerequest-2)

***

##### \_read()

> **\_read**(): `Promise`\<`ReadableStreamReadResult`\<\{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"ping"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; \}; \} \| \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"initialize"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `capabilities`: \{ `[key: string]`: `unknown`;  `experimental`: \{\}; `roots`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; \}; `sampling`: \{\}; \}; `clientInfo`: \{ `[key: string]`: `unknown`;  `name`: `string`; `version`: `string`; \}; `protocolVersion`: `string`; \}; \} \| \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"completion/complete"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `argument`: \{ `[key: string]`: `unknown`;  `name`: `string`; `value`: `string`; \}; `ref`: \{ `[key: string]`: `unknown`;  `name`: `string`; `type`: `"ref/prompt"`; \} \| \{ `[key: string]`: `unknown`;  `type`: `"ref/resource"`; `uri`: `string`; \}; \}; \} \| \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"logging/setLevel"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `level`: `"alert"` \| `"critical"` \| `"debug"` \| `"emergency"` \| `"error"` \| `"info"` \| `"notice"` \| `"warning"`; \}; \} \| \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"prompts/get"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `arguments`: \{\}; `name`: `string`; \}; \} \| \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"prompts/list"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `cursor`: `string`; \}; \} \| \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/list"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `cursor`: `string`; \}; \} \| \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/templates/list"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `cursor`: `string`; \}; \} \| \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/read"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `uri`: `string`; \}; \} \| \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/subscribe"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `uri`: `string`; \}; \} \| \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/unsubscribe"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `uri`: `string`; \}; \} \| \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"tools/list"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `cursor`: `string`; \}; \} \| \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"tools/call"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `arguments`: \{\}; `name`: `string`; \}; \} \| \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/cancelled"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `reason`: `string`; `requestId`: `string` \| `number`; \}; \} \| \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/progress"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `progress`: `number`; `progressToken`: `string` \| `number`; `total`: `number`; \}; \} \| \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/initialized"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; \}; \} \| \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/roots/list_changed"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; \}; \} \| \{ `[key: string]`: `unknown`;  `error`: \{ `[key: string]`: `unknown`;  `code`: `number`; `data`: \{\}; `message`: `string`; \}; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; \} \| \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `result`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `content`: \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: ... \| ...; `priority`: ... \| ...; \}; `text`: `string`; `type`: `"text"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: ... \| ...; `priority`: ... \| ...; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \}; `model`: `string`; `role`: `"assistant"` \| `"user"`; `stopReason`: `string`; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `roots`: `object`[]; \}; \}\>\>

###### Returns

`Promise`\<`ReadableStreamReadResult`\<\{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"ping"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; \}; \} \| \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"initialize"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `capabilities`: \{ `[key: string]`: `unknown`;  `experimental`: \{\}; `roots`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; \}; `sampling`: \{\}; \}; `clientInfo`: \{ `[key: string]`: `unknown`;  `name`: `string`; `version`: `string`; \}; `protocolVersion`: `string`; \}; \} \| \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"completion/complete"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `argument`: \{ `[key: string]`: `unknown`;  `name`: `string`; `value`: `string`; \}; `ref`: \{ `[key: string]`: `unknown`;  `name`: `string`; `type`: `"ref/prompt"`; \} \| \{ `[key: string]`: `unknown`;  `type`: `"ref/resource"`; `uri`: `string`; \}; \}; \} \| \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"logging/setLevel"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `level`: `"alert"` \| `"critical"` \| `"debug"` \| `"emergency"` \| `"error"` \| `"info"` \| `"notice"` \| `"warning"`; \}; \} \| \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"prompts/get"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `arguments`: \{\}; `name`: `string`; \}; \} \| \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"prompts/list"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `cursor`: `string`; \}; \} \| \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/list"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `cursor`: `string`; \}; \} \| \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/templates/list"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `cursor`: `string`; \}; \} \| \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/read"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `uri`: `string`; \}; \} \| \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/subscribe"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `uri`: `string`; \}; \} \| \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/unsubscribe"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `uri`: `string`; \}; \} \| \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"tools/list"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `cursor`: `string`; \}; \} \| \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"tools/call"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `arguments`: \{\}; `name`: `string`; \}; \} \| \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/cancelled"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `reason`: `string`; `requestId`: `string` \| `number`; \}; \} \| \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/progress"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `progress`: `number`; `progressToken`: `string` \| `number`; `total`: `number`; \}; \} \| \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/initialized"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; \}; \} \| \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/roots/list_changed"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; \}; \} \| \{ `[key: string]`: `unknown`;  `error`: \{ `[key: string]`: `unknown`;  `code`: `number`; `data`: \{\}; `message`: `string`; \}; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; \} \| \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `result`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `content`: \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: ... \| ...; `priority`: ... \| ...; \}; `text`: `string`; `type`: `"text"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: ... \| ...; `priority`: ... \| ...; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \}; `model`: `string`; `role`: `"assistant"` \| `"user"`; `stopReason`: `string`; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `roots`: `object`[]; \}; \}\>\>

###### Inherited from

[`ContextRPC`](../context-rpc/index.md#contextrpct).[`_read`](../context-rpc/index.md#_read-2)

***

##### \_write()

> **\_write**(`message`): `Promise`\<`void`\>

###### Parameters

###### message

\{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"ping"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"sampling/createMessage"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `includeContext`: `"allServers"` \| `"none"` \| `"thisServer"`; `maxTokens`: `number`; `messages`: `object`[]; `metadata`: \{\}; `modelPreferences`: \{ `[key: string]`: `unknown`;  `costPriority`: `number`; `hints`: `object`[]; `intelligencePriority`: `number`; `speedPriority`: `number`; \}; `stopSequences`: `string`[]; `systemPrompt`: `string`; `temperature`: `number`; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"roots/list"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; \}; \} | \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/cancelled"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `reason`: `string`; `requestId`: `string` \| `number`; \}; \} | \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/message"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `data`: `unknown`; `level`: `"alert"` \| `"critical"` \| `"debug"` \| `"emergency"` \| `"error"` \| `"info"` \| `"notice"` \| `"warning"`; `logger`: `string`; \}; \} | \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/progress"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `progress`: `number`; `progressToken`: `string` \| `number`; `total`: `number`; \}; \} | \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/resources/updated"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `uri`: `string`; \}; \} | \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/resources/list_changed"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; \}; \} | \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/tools/list_changed"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; \}; \} | \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/prompts/list_changed"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; \}; \} | \{ `[key: string]`: `unknown`;  `error`: \{ `[key: string]`: `unknown`;  `code`: `number`; `data`: \{\}; `message`: `string`; \}; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `result`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `capabilities`: \{ `[key: string]`: `unknown`;  `experimental`: \{\}; `logging`: \{\}; `prompts`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; \}; `resources`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; `subscribe`: `boolean`; \}; `tools`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; \}; \}; `instructions`: `string`; `protocolVersion`: `string`; `serverInfo`: \{ `[key: string]`: `unknown`;  `name`: `string`; `version`: `string`; \}; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `completion`: \{ `[key: string]`: `unknown`;  `hasMore`: `boolean`; `total`: `number`; `values`: `string`[]; \}; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `description`: `string`; `messages`: `object`[]; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `nextCursor`: `string`; `prompts`: `object`[]; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `nextCursor`: `string`; `resources`: `object`[]; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `nextCursor`: `string`; `resourceTemplates`: `object`[]; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `contents`: (\{ `[key: string]`: `unknown`;  `mimeType`: `string`; `text`: `string`; `uri`: `string`; \} \| \{ `[key: string]`: `unknown`;  `blob`: `string`; `mimeType`: `string`; `uri`: `string`; \})[]; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `content`: (\{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: ...[]; `priority`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: ...[]; `priority`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: ...[]; `priority`: `number`; \}; `resource`: \{ `[key: string]`: `unknown`;  `mimeType`: `string`; `text`: `string`; `uri`: `string`; \} \| \{ `[key: string]`: `unknown`;  `blob`: `string`; `mimeType`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError`: `boolean`; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `nextCursor`: `string`; `tools`: `object`[]; \}; \}

###### Returns

`Promise`\<`void`\>

###### Inherited from

[`ContextRPC`](../context-rpc/index.md#contextrpct).[`_write`](../context-rpc/index.md#_write-2)

***

##### createMessage()

> **createMessage**(`params`): [`SentRequest`](../context-rpc/index.md#sentrequestresult)\<\{ `[key: string]`: `unknown`;  `_meta`: \{\}; `content`: \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \}; `model`: `string`; `role`: `"assistant"` \| `"user"`; `stopReason`: `string`; \}\>

###### Parameters

###### params

###### _meta?

\{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}

###### _meta.progressToken?

`string` \| `number`

###### includeContext?

`"allServers"` \| `"none"` \| `"thisServer"`

###### maxTokens

`number`

###### messages

`object`[]

###### metadata?

\{\}

###### modelPreferences?

\{ `[key: string]`: `unknown`;  `costPriority`: `number`; `hints`: `object`[]; `intelligencePriority`: `number`; `speedPriority`: `number`; \}

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

[`SentRequest`](../context-rpc/index.md#sentrequestresult)\<\{ `[key: string]`: `unknown`;  `_meta`: \{\}; `content`: \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \}; `model`: `string`; `role`: `"assistant"` \| `"user"`; `stopReason`: `string`; \}\>

***

##### listRoots()

> **listRoots**(): [`SentRequest`](../context-rpc/index.md#sentrequestresult)\<`object`[]\>

###### Returns

[`SentRequest`](../context-rpc/index.md#sentrequestresult)\<`object`[]\>

***

##### log()

> **log**(`level`, `data`, `logger`?): `void`

###### Parameters

###### level

`"alert"` | `"critical"` | `"debug"` | `"emergency"` | `"error"` | `"info"` | `"notice"` | `"warning"`

###### data

`unknown`

###### logger?

`string`

###### Returns

`void`

***

##### notify()

> **notify**\<`Event`\>(`event`, `params`): `Promise`\<`void`\>

###### Type Parameters

• **Event** *extends* `"prompts/list_changed"` \| `"resources/list_changed"` \| `"tools/list_changed"`

###### Parameters

###### event

`Event`

###### params

[`ServerNotifications`](../context-protocol/index.md#servernotifications)\[`Event`\]\[`"params"`\]

###### Returns

`Promise`\<`void`\>

###### Inherited from

[`ContextRPC`](../context-rpc/index.md#contextrpct).[`notify`](../context-rpc/index.md#notify-1)

***

##### request()

> **request**\<`Method`\>(`method`, `params`): [`SentRequest`](../context-rpc/index.md#sentrequestresult)\<[`ServerRequests`](../context-protocol/index.md#serverrequests)\[`Method`\]\[`"Result"`\]\>

###### Type Parameters

• **Method** *extends* keyof [`ServerRequests`](../context-protocol/index.md#serverrequests)

###### Parameters

###### method

`Method`

###### params

[`ServerRequests`](../context-protocol/index.md#serverrequests)\[`Method`\]\[`"Params"`\]

###### Returns

[`SentRequest`](../context-rpc/index.md#sentrequestresult)\<[`ServerRequests`](../context-protocol/index.md#serverrequests)\[`Method`\]\[`"Result"`\]\>

###### Inherited from

[`ContextRPC`](../context-rpc/index.md#contextrpct).[`request`](../context-rpc/index.md#request-3)

***

##### requestValue()

> **requestValue**\<`Method`, `Value`\>(`method`, `params`, `getValue`): [`SentRequest`](../context-rpc/index.md#sentrequestresult)\<`Value`\>

###### Type Parameters

• **Method** *extends* keyof [`ServerRequests`](../context-protocol/index.md#serverrequests)

• **Value**

###### Parameters

###### method

`Method`

###### params

[`ServerRequests`](../context-protocol/index.md#serverrequests)\[`Method`\]\[`"Params"`\]

###### getValue

(`result`) => `Value`

###### Returns

[`SentRequest`](../context-rpc/index.md#sentrequestresult)\<`Value`\>

###### Inherited from

[`ContextRPC`](../context-rpc/index.md#contextrpct).[`requestValue`](../context-rpc/index.md#requestvalue-1)

## Type Aliases

### ClientInitialize

> **ClientInitialize**: [`InitializeRequest`](../context-protocol/index.md#initializerequest)\[`"params"`\]

***

### ServeProcessParams

> **ServeProcessParams**: `Omit`\<[`ServerParams`](index.md#serverparams), `"transport"`\>

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

##### transport

> **transport**: [`ServerTransport`](index.md#servertransport)

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

### serveProcess()

> **serveProcess**(`params`): [`ContextServer`](index.md#contextserver)

#### Parameters

##### params

[`ServeProcessParams`](index.md#serveprocessparams)

#### Returns

[`ContextServer`](index.md#contextserver)
