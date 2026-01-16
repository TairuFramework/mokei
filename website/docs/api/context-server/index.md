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

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`constructor`](../context-rpc/index.md#constructor)

#### Accessors

##### clientInitialize

###### Get Signature

> **get** **clientInitialize**(): \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `capabilities`: \{\[`key`: `string`\]: `unknown`; `elicitation?`: \{\[`key`: `string`\]: `unknown`; \}; `experimental?`: \{\[`key`: `string`\]: `object`; \}; `roots?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; \}; `sampling?`: \{\[`key`: `string`\]: `unknown`; `tools?`: \{\[`key`: `string`\]: `unknown`; \}; \}; \}; `clientInfo`: \{\[`key`: `string`\]: `unknown`; `description?`: `string`; `icons?`: `object`[]; `name`: `string`; `title?`: `string`; `version`: `string`; `websiteUrl?`: `string`; \}; `protocolVersion`: `string`; \} \| `undefined`

###### Returns

\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `capabilities`: \{\[`key`: `string`\]: `unknown`; `elicitation?`: \{\[`key`: `string`\]: `unknown`; \}; `experimental?`: \{\[`key`: `string`\]: `object`; \}; `roots?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; \}; `sampling?`: \{\[`key`: `string`\]: `unknown`; `tools?`: \{\[`key`: `string`\]: `unknown`; \}; \}; \}; `clientInfo`: \{\[`key`: `string`\]: `unknown`; `description?`: `string`; `icons?`: `object`[]; `name`: `string`; `title?`: `string`; `version`: `string`; `websiteUrl?`: `string`; \}; `protocolVersion`: `string`; \} \| `undefined`

##### events

###### Get Signature

> **get** **events**(): `EventEmitter`\<`T`\[`"Events"`\]\>

###### Returns

`EventEmitter`\<`T`\[`"Events"`\]\>

###### Inherited from

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`events`](../context-rpc/index.md#events)

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

###### Overrides

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`_handle`](../context-rpc/index.md#_handle)

##### \_handleMessage()

> **\_handleMessage**(`message`): \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; \} \| `Promise`\<\{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; \} \| `null`\> \| `null`

###### Parameters

###### message

\{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"ping"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; \}; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"initialize"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `capabilities`: \{\[`key`: `string`\]: `unknown`; `elicitation?`: \{\[`key`: `string`\]: `unknown`; \}; `experimental?`: \{\[`key`: `string`\]: `object`; \}; `roots?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; \}; `sampling?`: \{\[`key`: `string`\]: `unknown`; `tools?`: \{\[`key`: `string`\]: `unknown`; \}; \}; \}; `clientInfo`: \{\[`key`: `string`\]: `unknown`; `description?`: `string`; `icons?`: `object`[]; `name`: `string`; `title?`: `string`; `version`: `string`; `websiteUrl?`: `string`; \}; `protocolVersion`: `string`; \}; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"completion/complete"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `argument`: \{\[`key`: `string`\]: `unknown`; `name`: `string`; `value`: `string`; \}; `context?`: \{\[`key`: `string`\]: `unknown`; `arguments?`: \{\[`key`: `string`\]: `string`; \}; \}; `ref`: \{\[`key`: `string`\]: `unknown`; `name`: `string`; `title?`: `string`; `type`: `"ref/prompt"`; \} \| \{\[`key`: `string`\]: `unknown`; `type`: `"ref/resource"`; `uri`: `string`; \}; \}; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"logging/setLevel"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `level`: `"error"` \| `"alert"` \| `"critical"` \| `"debug"` \| `"emergency"` \| `"info"` \| `"notice"` \| `"warning"`; \}; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"prompts/get"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `arguments?`: \{\[`key`: `string`\]: `string`; \}; `name`: `string`; \}; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"prompts/list"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `cursor?`: `string`; \}; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/list"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `cursor?`: `string`; \}; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/templates/list"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `cursor?`: `string`; \}; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/read"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `uri`: `string`; \}; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/subscribe"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `uri`: `string`; \}; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/unsubscribe"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `uri`: `string`; \}; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"tools/list"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `cursor?`: `string`; \}; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"tools/call"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `arguments?`: \{\[`key`: `string`\]: `unknown`; \}; `name`: `string`; \}; \} | \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/cancelled"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `reason?`: `string`; `requestId`: `string` \| `number`; \}; \} | \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/progress"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `message?`: `string`; `progress`: `number`; `progressToken`: `string` \| `number`; `total?`: `number`; \}; \} | \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/initialized"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; \}; \} | \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/roots/list_changed"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; \}; \} | \{\[`key`: `string`\]: `unknown`; `error`: \{\[`key`: `string`\]: `unknown`; `code`: `number`; `data?`: \{\[`key`: `string`\]: `unknown`; \}; `message`: `string`; \}; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `result`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \}; `model`: `string`; `role`: `"assistant"` \| `"user"`; `stopReason?`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `roots`: `object`[]; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `action`: `"accept"` \| `"cancel"` \| `"decline"`; `content?`: \{\[`key`: `string`\]: `string` \| `number` \| `boolean`; \}; \}; \}

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

> **\_handleRequest**(`request`, `signal`): `Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `capabilities`: \{\[`key`: `string`\]: `unknown`; `completions?`: \{\[`key`: `string`\]: `unknown`; \}; `experimental?`: \{\[`key`: `string`\]: `object`; \}; `logging?`: \{\[`key`: `string`\]: `unknown`; \}; `prompts?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; \}; `resources?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; `subscribe?`: `boolean`; \}; `tools?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; \}; \}; `instructions?`: `string`; `protocolVersion`: `string`; `serverInfo`: \{\[`key`: `string`\]: `unknown`; `description?`: `string`; `icons?`: `object`[]; `name`: `string`; `title?`: `string`; `version`: `string`; `websiteUrl?`: `string`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `completion`: \{\[`key`: `string`\]: `unknown`; `hasMore?`: `boolean`; `total?`: `number`; `values`: `string`[]; \}; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `description?`: `string`; `messages`: `object`[]; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `nextCursor?`: `string`; `prompts`: `object`[]; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `nextCursor?`: `string`; `resources`: `object`[]; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `nextCursor?`: `string`; `resourceTemplates`: `object`[]; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `contents`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \})[]; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; `structuredContent?`: \{\[`key`: `string`\]: `unknown`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `nextCursor?`: `string`; `tools`: `object`[]; \}\>

###### Parameters

###### request

\{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"ping"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; \}; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"initialize"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `capabilities`: \{\[`key`: `string`\]: `unknown`; `elicitation?`: \{\[`key`: `string`\]: `unknown`; \}; `experimental?`: \{\[`key`: `string`\]: `object`; \}; `roots?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; \}; `sampling?`: \{\[`key`: `string`\]: `unknown`; `tools?`: \{\[`key`: `string`\]: `unknown`; \}; \}; \}; `clientInfo`: \{\[`key`: `string`\]: `unknown`; `description?`: `string`; `icons?`: `object`[]; `name`: `string`; `title?`: `string`; `version`: `string`; `websiteUrl?`: `string`; \}; `protocolVersion`: `string`; \}; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"completion/complete"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `argument`: \{\[`key`: `string`\]: `unknown`; `name`: `string`; `value`: `string`; \}; `context?`: \{\[`key`: `string`\]: `unknown`; `arguments?`: \{\[`key`: `string`\]: `string`; \}; \}; `ref`: \{\[`key`: `string`\]: `unknown`; `name`: `string`; `title?`: `string`; `type`: `"ref/prompt"`; \} \| \{\[`key`: `string`\]: `unknown`; `type`: `"ref/resource"`; `uri`: `string`; \}; \}; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"logging/setLevel"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `level`: `"error"` \| `"alert"` \| `"critical"` \| `"debug"` \| `"emergency"` \| `"info"` \| `"notice"` \| `"warning"`; \}; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"prompts/get"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `arguments?`: \{\[`key`: `string`\]: `string`; \}; `name`: `string`; \}; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"prompts/list"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `cursor?`: `string`; \}; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/list"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `cursor?`: `string`; \}; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/templates/list"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `cursor?`: `string`; \}; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/read"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `uri`: `string`; \}; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/subscribe"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `uri`: `string`; \}; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/unsubscribe"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `uri`: `string`; \}; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"tools/list"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `cursor?`: `string`; \}; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"tools/call"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `arguments?`: \{\[`key`: `string`\]: `unknown`; \}; `name`: `string`; \}; \}

###### signal

`AbortSignal`

###### Returns

`Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `capabilities`: \{\[`key`: `string`\]: `unknown`; `completions?`: \{\[`key`: `string`\]: `unknown`; \}; `experimental?`: \{\[`key`: `string`\]: `object`; \}; `logging?`: \{\[`key`: `string`\]: `unknown`; \}; `prompts?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; \}; `resources?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; `subscribe?`: `boolean`; \}; `tools?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; \}; \}; `instructions?`: `string`; `protocolVersion`: `string`; `serverInfo`: \{\[`key`: `string`\]: `unknown`; `description?`: `string`; `icons?`: `object`[]; `name`: `string`; `title?`: `string`; `version`: `string`; `websiteUrl?`: `string`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `completion`: \{\[`key`: `string`\]: `unknown`; `hasMore?`: `boolean`; `total?`: `number`; `values`: `string`[]; \}; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `description?`: `string`; `messages`: `object`[]; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `nextCursor?`: `string`; `prompts`: `object`[]; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `nextCursor?`: `string`; `resources`: `object`[]; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `nextCursor?`: `string`; `resourceTemplates`: `object`[]; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `contents`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \})[]; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; `structuredContent?`: \{\[`key`: `string`\]: `unknown`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `nextCursor?`: `string`; `tools`: `object`[]; \}\>

###### Overrides

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`_handleRequest`](../context-rpc/index.md#_handlerequest)

##### \_read()

> **\_read**(): `Promise`\<`ReadableStreamReadResult`\<\{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"ping"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; \}; \} \| \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"initialize"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `capabilities`: \{\[`key`: `string`\]: `unknown`; `elicitation?`: \{\[`key`: `string`\]: `unknown`; \}; `experimental?`: \{\[`key`: `string`\]: `object`; \}; `roots?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; \}; `sampling?`: \{\[`key`: `string`\]: `unknown`; `tools?`: \{\[`key`: `string`\]: `unknown`; \}; \}; \}; `clientInfo`: \{\[`key`: `string`\]: `unknown`; `description?`: `string`; `icons?`: `object`[]; `name`: `string`; `title?`: `string`; `version`: `string`; `websiteUrl?`: `string`; \}; `protocolVersion`: `string`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"completion/complete"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `argument`: \{\[`key`: `string`\]: `unknown`; `name`: `string`; `value`: `string`; \}; `context?`: \{\[`key`: `string`\]: `unknown`; `arguments?`: \{\[`key`: `string`\]: `string`; \}; \}; `ref`: \{\[`key`: `string`\]: `unknown`; `name`: `string`; `title?`: `string`; `type`: `"ref/prompt"`; \} \| \{\[`key`: `string`\]: `unknown`; `type`: `"ref/resource"`; `uri`: `string`; \}; \}; \} \| \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"logging/setLevel"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `level`: `"error"` \| `"alert"` \| `"critical"` \| `"debug"` \| `"emergency"` \| `"info"` \| `"notice"` \| `"warning"`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"prompts/get"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `arguments?`: \{\[`key`: `string`\]: `string`; \}; `name`: `string`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"prompts/list"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `cursor?`: `string`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/list"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `cursor?`: `string`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/templates/list"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `cursor?`: `string`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/read"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `uri`: `string`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/subscribe"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `uri`: `string`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/unsubscribe"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `uri`: `string`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"tools/list"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `cursor?`: `string`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"tools/call"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `arguments?`: \{\[`key`: `string`\]: `unknown`; \}; `name`: `string`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/cancelled"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `reason?`: `string`; `requestId`: `string` \| `number`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/progress"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `message?`: `string`; `progress`: `number`; `progressToken`: `string` \| `number`; `total?`: `number`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/initialized"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; \}; \} \| \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/roots/list_changed"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; \}; \} \| \{\[`key`: `string`\]: `unknown`; `error`: \{\[`key`: `string`\]: `unknown`; `code`: `number`; `data?`: \{\[`key`: `string`\]: `unknown`; \}; `message`: `string`; \}; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; \} \| \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `result`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: ... \| ...; `lastModified?`: ... \| ...; `priority?`: ... \| ...; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: ... \| ...; `lastModified?`: ... \| ...; `priority?`: ... \| ...; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: ... \| ...; `lastModified?`: ... \| ...; `priority?`: ... \| ...; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \}; `model`: `string`; `role`: `"assistant"` \| `"user"`; `stopReason?`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `roots`: `object`[]; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `action`: `"accept"` \| `"cancel"` \| `"decline"`; `content?`: \{\[`key`: `string`\]: `string` \| `number` \| `boolean`; \}; \}; \}\>\>

###### Returns

`Promise`\<`ReadableStreamReadResult`\<\{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"ping"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; \}; \} \| \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"initialize"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `capabilities`: \{\[`key`: `string`\]: `unknown`; `elicitation?`: \{\[`key`: `string`\]: `unknown`; \}; `experimental?`: \{\[`key`: `string`\]: `object`; \}; `roots?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; \}; `sampling?`: \{\[`key`: `string`\]: `unknown`; `tools?`: \{\[`key`: `string`\]: `unknown`; \}; \}; \}; `clientInfo`: \{\[`key`: `string`\]: `unknown`; `description?`: `string`; `icons?`: `object`[]; `name`: `string`; `title?`: `string`; `version`: `string`; `websiteUrl?`: `string`; \}; `protocolVersion`: `string`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"completion/complete"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `argument`: \{\[`key`: `string`\]: `unknown`; `name`: `string`; `value`: `string`; \}; `context?`: \{\[`key`: `string`\]: `unknown`; `arguments?`: \{\[`key`: `string`\]: `string`; \}; \}; `ref`: \{\[`key`: `string`\]: `unknown`; `name`: `string`; `title?`: `string`; `type`: `"ref/prompt"`; \} \| \{\[`key`: `string`\]: `unknown`; `type`: `"ref/resource"`; `uri`: `string`; \}; \}; \} \| \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"logging/setLevel"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `level`: `"error"` \| `"alert"` \| `"critical"` \| `"debug"` \| `"emergency"` \| `"info"` \| `"notice"` \| `"warning"`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"prompts/get"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `arguments?`: \{\[`key`: `string`\]: `string`; \}; `name`: `string`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"prompts/list"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `cursor?`: `string`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/list"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `cursor?`: `string`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/templates/list"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `cursor?`: `string`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/read"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `uri`: `string`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/subscribe"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `uri`: `string`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/unsubscribe"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `uri`: `string`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"tools/list"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `cursor?`: `string`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"tools/call"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `arguments?`: \{\[`key`: `string`\]: `unknown`; \}; `name`: `string`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/cancelled"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `reason?`: `string`; `requestId`: `string` \| `number`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/progress"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `message?`: `string`; `progress`: `number`; `progressToken`: `string` \| `number`; `total?`: `number`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/initialized"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; \}; \} \| \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/roots/list_changed"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; \}; \} \| \{\[`key`: `string`\]: `unknown`; `error`: \{\[`key`: `string`\]: `unknown`; `code`: `number`; `data?`: \{\[`key`: `string`\]: `unknown`; \}; `message`: `string`; \}; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; \} \| \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `result`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: ... \| ...; `lastModified?`: ... \| ...; `priority?`: ... \| ...; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: ... \| ...; `lastModified?`: ... \| ...; `priority?`: ... \| ...; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: ... \| ...; `lastModified?`: ... \| ...; `priority?`: ... \| ...; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \}; `model`: `string`; `role`: `"assistant"` \| `"user"`; `stopReason?`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `roots`: `object`[]; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `action`: `"accept"` \| `"cancel"` \| `"decline"`; `content?`: \{\[`key`: `string`\]: `string` \| `number` \| `boolean`; \}; \}; \}\>\>

###### Inherited from

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`_read`](../context-rpc/index.md#_read)

##### \_write()

> **\_write**(`message`): `Promise`\<`void`\>

###### Parameters

###### message

\{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"ping"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; \}; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"sampling/createMessage"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `includeContext?`: `"allServers"` \| `"none"` \| `"thisServer"`; `maxTokens`: `number`; `messages`: `object`[]; `metadata?`: \{\[`key`: `string`\]: `unknown`; \}; `modelPreferences?`: \{\[`key`: `string`\]: `unknown`; `costPriority?`: `number`; `hints?`: `object`[]; `intelligencePriority?`: `number`; `speedPriority?`: `number`; \}; `stopSequences?`: `string`[]; `systemPrompt?`: `string`; `temperature?`: `number`; `toolChoice?`: \{\[`key`: `string`\]: `unknown`; `type`: `"auto"`; \} \| \{\[`key`: `string`\]: `unknown`; `type`: `"required"`; \} \| \{\[`key`: `string`\]: `unknown`; `toolName`: `string`; `type`: `"tool"`; \}; `tools?`: `object`[]; \}; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"roots/list"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; \}; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"elicitation/create"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `message`: `string`; `mode?`: `"form"`; `requestedSchema`: \{\[`key`: `string`\]: `unknown`; `properties`: \{\[`key`: `string`\]: \{\[`key`: `string`\]: `unknown`; `default?`: `string`; `description?`: `string`; `format?`: `"uri"` \| `"date-time"` \| `"date"` \| `"email"`; `maxLength?`: `number`; `minLength?`: `number`; `title?`: `string`; `type`: `"string"`; \} \| \{\[`key`: `string`\]: `unknown`; `default?`: `number`; `description?`: `string`; `maximum?`: `number`; `minimum?`: `number`; `title?`: `string`; `type`: `"number"` \| `"integer"`; \} \| \{\[`key`: `string`\]: `unknown`; `default?`: `boolean`; `description?`: `string`; `title?`: `string`; `type`: `"boolean"`; \} \| \{\[`key`: `string`\]: `unknown`; `default?`: `string`; `description?`: `string`; `enum`: `string`[]; `enumNames?`: `string`[]; `title?`: `string`; `type`: `"string"`; \} \| \{\[`key`: `string`\]: `unknown`; `default?`: `string`[]; `description?`: `string`; `items`: \{\[`key`: `string`\]: `unknown`; `enum`: `string`[]; `enumNames?`: ...[]; `type`: `"string"`; \}; `title?`: `string`; `type`: `"array"`; \}; \}; `required?`: `string`[]; `type`: `"object"`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `elicitationId`: `string`; `message`: `string`; `mode`: `"url"`; `url`: `string`; \}; \} | \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/cancelled"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `reason?`: `string`; `requestId`: `string` \| `number`; \}; \} | \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/message"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `data`: `unknown`; `level`: `"error"` \| `"alert"` \| `"critical"` \| `"debug"` \| `"emergency"` \| `"info"` \| `"notice"` \| `"warning"`; `logger?`: `string`; \}; \} | \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/progress"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `message?`: `string`; `progress`: `number`; `progressToken`: `string` \| `number`; `total?`: `number`; \}; \} | \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/resources/updated"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `uri`: `string`; \}; \} | \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/resources/list_changed"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; \}; \} | \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/tools/list_changed"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; \}; \} | \{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/prompts/list_changed"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; \}; \} | \{\[`key`: `string`\]: `unknown`; `error`: \{\[`key`: `string`\]: `unknown`; `code`: `number`; `data?`: \{\[`key`: `string`\]: `unknown`; \}; `message`: `string`; \}; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; \} | \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `result`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `capabilities`: \{\[`key`: `string`\]: `unknown`; `completions?`: \{\[`key`: `string`\]: `unknown`; \}; `experimental?`: \{\[`key`: `string`\]: `object`; \}; `logging?`: \{\[`key`: `string`\]: `unknown`; \}; `prompts?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; \}; `resources?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; `subscribe?`: `boolean`; \}; `tools?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; \}; \}; `instructions?`: `string`; `protocolVersion`: `string`; `serverInfo`: \{\[`key`: `string`\]: `unknown`; `description?`: `string`; `icons?`: `object`[]; `name`: `string`; `title?`: `string`; `version`: `string`; `websiteUrl?`: `string`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `completion`: \{\[`key`: `string`\]: `unknown`; `hasMore?`: `boolean`; `total?`: `number`; `values`: `string`[]; \}; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `description?`: `string`; `messages`: `object`[]; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `nextCursor?`: `string`; `prompts`: `object`[]; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `nextCursor?`: `string`; `resources`: `object`[]; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `nextCursor?`: `string`; `resourceTemplates`: `object`[]; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `contents`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \})[]; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: ...[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: ...[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: ...[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: ...[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: ...[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: ...\]: ...; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: ...\]: ...; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; `structuredContent?`: \{\[`key`: `string`\]: `unknown`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `nextCursor?`: `string`; `tools`: `object`[]; \}; \}

###### Returns

`Promise`\<`void`\>

###### Inherited from

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`_write`](../context-rpc/index.md#_write)

##### createMessage()

> **createMessage**(`params`): [`SentRequest`](../context-rpc/index.md#sentrequest)\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \}; `model`: `string`; `role`: `"assistant"` \| `"user"`; `stopReason?`: `string`; \}\>

###### Parameters

###### params

###### _meta?

\{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}

###### _meta.progressToken?

`string` \| `number`

###### includeContext?

`"allServers"` \| `"none"` \| `"thisServer"`

###### maxTokens

`number`

###### messages

`object`[]

###### metadata?

\{\[`key`: `string`\]: `unknown`; \}

###### modelPreferences?

\{\[`key`: `string`\]: `unknown`; `costPriority?`: `number`; `hints?`: `object`[]; `intelligencePriority?`: `number`; `speedPriority?`: `number`; \}

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

###### toolChoice?

\{\[`key`: `string`\]: `unknown`; `type`: `"auto"`; \} \| \{\[`key`: `string`\]: `unknown`; `type`: `"required"`; \} \| \{\[`key`: `string`\]: `unknown`; `toolName`: `string`; `type`: `"tool"`; \}

###### tools?

`object`[]

###### Returns

[`SentRequest`](../context-rpc/index.md#sentrequest)\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \}; `model`: `string`; `role`: `"assistant"` \| `"user"`; `stopReason?`: `string`; \}\>

##### elicit()

> **elicit**(`params`): [`SentRequest`](../context-rpc/index.md#sentrequest)\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `action`: `"accept"` \| `"cancel"` \| `"decline"`; `content?`: \{\[`key`: `string`\]: `string` \| `number` \| `boolean`; \}; \}\>

###### Parameters

###### params

\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `message`: `string`; `mode?`: `"form"`; `requestedSchema`: \{\[`key`: `string`\]: `unknown`; `properties`: \{\[`key`: `string`\]: \{\[`key`: `string`\]: `unknown`; `default?`: `string`; `description?`: `string`; `format?`: `"uri"` \| `"date-time"` \| `"date"` \| `"email"`; `maxLength?`: `number`; `minLength?`: `number`; `title?`: `string`; `type`: `"string"`; \} \| \{\[`key`: `string`\]: `unknown`; `default?`: `number`; `description?`: `string`; `maximum?`: `number`; `minimum?`: `number`; `title?`: `string`; `type`: `"number"` \| `"integer"`; \} \| \{\[`key`: `string`\]: `unknown`; `default?`: `boolean`; `description?`: `string`; `title?`: `string`; `type`: `"boolean"`; \} \| \{\[`key`: `string`\]: `unknown`; `default?`: `string`; `description?`: `string`; `enum`: `string`[]; `enumNames?`: `string`[]; `title?`: `string`; `type`: `"string"`; \} \| \{\[`key`: `string`\]: `unknown`; `default?`: `string`[]; `description?`: `string`; `items`: \{\[`key`: `string`\]: `unknown`; `enum`: `string`[]; `enumNames?`: `string`[]; `type`: `"string"`; \}; `title?`: `string`; `type`: `"array"`; \}; \}; `required?`: `string`[]; `type`: `"object"`; \}; \} | \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `elicitationId`: `string`; `message`: `string`; `mode`: `"url"`; `url`: `string`; \}

###### Returns

[`SentRequest`](../context-rpc/index.md#sentrequest)\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `action`: `"accept"` \| `"cancel"` \| `"decline"`; `content?`: \{\[`key`: `string`\]: `string` \| `number` \| `boolean`; \}; \}\>

##### listRoots()

> **listRoots**(`params`): [`SentRequest`](../context-rpc/index.md#sentrequest)\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `roots`: `object`[]; \}\>

###### Parameters

###### params

\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; \} | `undefined`

###### Returns

[`SentRequest`](../context-rpc/index.md#sentrequest)\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `roots`: `object`[]; \}\>

##### log()

> **log**(`level`, `data`, `logger?`): `void`

###### Parameters

###### level

`"error"` | `"alert"` | `"critical"` | `"debug"` | `"emergency"` | `"info"` | `"notice"` | `"warning"`

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

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`notify`](../context-rpc/index.md#notify)

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

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`request`](../context-rpc/index.md#request)

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

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`requestValue`](../context-rpc/index.md#requestvalue)

## Type Aliases

### ClientInitialize

> **ClientInitialize** = [`InitializeRequest`](../context-protocol/index.md#initializerequest)\[`"params"`\]

***

### CompleteHandler()

> **CompleteHandler** = (`request`) => [`CompleteResult`](../context-protocol/index.md#completeresult) \| `Promise`\<[`CompleteResult`](../context-protocol/index.md#completeresult)\>

#### Parameters

##### request

[`HandlerRequest`](#handlerrequest)\<\{ `params`: [`CompleteRequest`](../context-protocol/index.md#completerequest)\[`"params"`\]; \}\>

#### Returns

[`CompleteResult`](../context-protocol/index.md#completeresult) \| `Promise`\<[`CompleteResult`](../context-protocol/index.md#completeresult)\>

***

### ExtractPromptTypes

> **ExtractPromptTypes**\<`T`\> = `{ [K in keyof T]: T[K] extends TypedPromptDefinition<infer S> ? FromSchema<S> : T[K] extends GenericPromptDefinition ? Record<string, unknown> : never }`

Extract TypeScript types from prompt definitions for type-safe client usage.

#### Type Parameters

##### T

`T` *extends* [`PromptDefinitions`](#promptdefinitions)

#### Example

```typescript
const prompts = {
  myPrompt: createPrompt('Description', { type: 'object', properties: { name: { type: 'string' } } } as const, handler)
} satisfies PromptDefinitions

type MyPrompts = ExtractPromptTypes<typeof prompts>
// Result: { myPrompt: { name: string } }
```

***

### ExtractServerTypes

> **ExtractServerTypes**\<`T`\> = `object`

Extract complete context types from a server configuration for type-safe client usage.

#### Example

```typescript
const config = {
  name: 'my-server',
  version: '1.0.0',
  tools: { ... },
  prompts: { ... }
} satisfies ServerConfig

type MyServerTypes = ExtractServerTypes<typeof config>
const client = new ContextClient<MyServerTypes>({ transport })
```

#### Type Parameters

##### T

`T` *extends* `object`

#### Properties

##### Prompts

> **Prompts**: `T`\[`"prompts"`\] *extends* [`PromptDefinitions`](#promptdefinitions) ? [`ExtractPromptTypes`](#extractprompttypes)\<`T`\[`"prompts"`\]\> : `Record`\<`string`, `never`\>

##### Tools

> **Tools**: `T`\[`"tools"`\] *extends* [`ToolDefinitions`](#tooldefinitions) ? [`ExtractToolTypes`](#extracttooltypes)\<`T`\[`"tools"`\]\> : `Record`\<`string`, `never`\>

***

### ExtractToolTypes

> **ExtractToolTypes**\<`T`\> = `{ [K in keyof T]: T[K] extends TypedToolDefinition<infer S> ? FromSchema<S> : T[K] extends GenericToolDefinition ? Record<string, unknown> : never }`

Extract TypeScript types from tool definitions for type-safe client usage.

#### Type Parameters

##### T

`T` *extends* [`ToolDefinitions`](#tooldefinitions)

#### Example

```typescript
const tools = {
  myTool: createTool('Description', { type: 'object', properties: { foo: { type: 'string' } } } as const, handler)
} satisfies ToolDefinitions

type MyTools = ExtractToolTypes<typeof tools>
// Result: { myTool: { foo: string } }
```

***

### GenericPromptDefinition

> **GenericPromptDefinition** = `object`

#### Properties

##### argumentsSchema?

> `optional` **argumentsSchema**: `Schema`

##### description

> **description**: `string`

##### handler

> **handler**: [`GenericPromptHandler`](#genericprompthandler)

***

### GenericPromptHandler()

> **GenericPromptHandler** = (`request`) => [`PromptHandlerReturn`](#prompthandlerreturn)

#### Parameters

##### request

[`HandlerRequest`](#handlerrequest)\<\{ `arguments`: `unknown`; \}\>

#### Returns

[`PromptHandlerReturn`](#prompthandlerreturn)

***

### GenericToolDefinition

> **GenericToolDefinition** = `object`

#### Properties

##### description

> **description**: `string`

##### handler

> **handler**: [`GenericToolHandler`](#generictoolhandler)

##### inputSchema

> **inputSchema**: [`InputSchema`](../context-protocol/index.md#inputschema)

***

### GenericToolHandler()

> **GenericToolHandler** = (`request`) => [`ToolHandlerReturn`](#toolhandlerreturn)

#### Parameters

##### request

[`HandlerRequest`](#handlerrequest)\<\{ `arguments`: `Record`\<`string`, `unknown`\>; \}\>

#### Returns

[`ToolHandlerReturn`](#toolhandlerreturn)

***

### HandlerRequest

> **HandlerRequest**\<`C`\> = `C` & `object`

#### Type Declaration

##### client

> **client**: [`ServerClient`](#serverclient)

##### signal

> **signal**: `AbortSignal`

#### Type Parameters

##### C

`C` *extends* `Record`\<`string`, `unknown`\> = `Record`\<`string`, `never`\>

***

### ListResourcesHandler()

> **ListResourcesHandler** = (`request`) => [`ListResourcesResult`](../context-protocol/index.md#listresourcesresult) \| `Promise`\<[`ListResourcesResult`](../context-protocol/index.md#listresourcesresult)\>

#### Parameters

##### request

[`HandlerRequest`](#handlerrequest)\<\{ `params`: [`ListResourcesRequest`](../context-protocol/index.md#listresourcesrequest)\[`"params"`\]; \}\>

#### Returns

[`ListResourcesResult`](../context-protocol/index.md#listresourcesresult) \| `Promise`\<[`ListResourcesResult`](../context-protocol/index.md#listresourcesresult)\>

***

### ListResourceTemplatesHandler()

> **ListResourceTemplatesHandler** = (`request`) => [`ListResourceTemplatesResult`](../context-protocol/index.md#listresourcetemplatesresult) \| `Promise`\<[`ListResourceTemplatesResult`](../context-protocol/index.md#listresourcetemplatesresult)\>

#### Parameters

##### request

[`HandlerRequest`](#handlerrequest)\<\{ `params`: [`ListResourceTemplatesRequest`](../context-protocol/index.md#listresourcetemplatesrequest)\[`"params"`\]; \}\>

#### Returns

[`ListResourceTemplatesResult`](../context-protocol/index.md#listresourcetemplatesresult) \| `Promise`\<[`ListResourceTemplatesResult`](../context-protocol/index.md#listresourcetemplatesresult)\>

***

### LogFunction()

> **LogFunction** = (`level`, `data`, `logger?`) => `void`

#### Parameters

##### level

[`LoggingLevel`](../context-protocol/index.md#logginglevel)

##### data

`unknown`

##### logger?

`string`

#### Returns

`void`

***

### PromptDefinitions

> **PromptDefinitions** = `Record`\<`string`, [`GenericPromptDefinition`](#genericpromptdefinition)\>

***

### PromptHandlerReturn

> **PromptHandlerReturn** = [`GetPromptResult`](../context-protocol/index.md#getpromptresult) \| `Promise`\<[`GetPromptResult`](../context-protocol/index.md#getpromptresult)\>

***

### ReadResourceHandler()

> **ReadResourceHandler** = (`request`) => [`ReadResourceResult`](../context-protocol/index.md#readresourceresult) \| `Promise`\<[`ReadResourceResult`](../context-protocol/index.md#readresourceresult)\>

#### Parameters

##### request

[`HandlerRequest`](#handlerrequest)\<\{ `params`: [`ReadResourceRequest`](../context-protocol/index.md#readresourcerequest)\[`"params"`\]; \}\>

#### Returns

[`ReadResourceResult`](../context-protocol/index.md#readresourceresult) \| `Promise`\<[`ReadResourceResult`](../context-protocol/index.md#readresourceresult)\>

***

### ResourceDefinitions

> **ResourceDefinitions** = `object`

#### Properties

##### list?

> `optional` **list**: [`ListResourcesHandler`](#listresourceshandler) \| [`Resource`](../context-protocol/index.md#resource)[]

##### listTemplates?

> `optional` **listTemplates**: [`ListResourceTemplatesHandler`](#listresourcetemplateshandler) \| [`ResourceTemplate`](../context-protocol/index.md#resourcetemplate)[]

##### read

> **read**: [`ReadResourceHandler`](#readresourcehandler)

***

### ResourceHandlers

> **ResourceHandlers** = `object`

#### Properties

##### list

> **list**: [`ListResourcesHandler`](#listresourceshandler)

##### listTemplates

> **listTemplates**: [`ListResourceTemplatesHandler`](#listresourcetemplateshandler)

##### read

> **read**: [`ReadResourceHandler`](#readresourcehandler)

***

### ServerClient

> **ServerClient** = `object`

#### Properties

##### createMessage()

> **createMessage**: (`params`) => [`SentRequest`](../context-rpc/index.md#sentrequest)\<[`CreateMessageResult`](../context-protocol/index.md#createmessageresult)\>

###### Parameters

###### params

[`CreateMessageRequest`](../context-protocol/index.md#createmessagerequest)\[`"params"`\]

###### Returns

[`SentRequest`](../context-rpc/index.md#sentrequest)\<[`CreateMessageResult`](../context-protocol/index.md#createmessageresult)\>

##### elicit()

> **elicit**: (`params`) => [`SentRequest`](../context-rpc/index.md#sentrequest)\<[`ElicitResult`](../context-protocol/index.md#elicitresult)\>

###### Parameters

###### params

[`ElicitRequest`](../context-protocol/index.md#elicitrequest)\[`"params"`\]

###### Returns

[`SentRequest`](../context-rpc/index.md#sentrequest)\<[`ElicitResult`](../context-protocol/index.md#elicitresult)\>

##### listRoots()

> **listRoots**: (`params?`) => [`SentRequest`](../context-rpc/index.md#sentrequest)\<[`ListRootsResult`](../context-protocol/index.md#listrootsresult)\>

###### Parameters

###### params?

[`ListRootsRequest`](../context-protocol/index.md#listrootsrequest)\[`"params"`\]

###### Returns

[`SentRequest`](../context-rpc/index.md#sentrequest)\<[`ListRootsResult`](../context-protocol/index.md#listrootsresult)\>

##### log

> **log**: [`LogFunction`](#logfunction)

***

### ServerConfig

> **ServerConfig** = `object`

#### Properties

##### complete?

> `optional` **complete**: [`CompleteHandler`](#completehandler)

##### name

> **name**: `string`

##### prompts?

> `optional` **prompts**: [`PromptDefinitions`](#promptdefinitions)

##### resources?

> `optional` **resources**: [`ResourceDefinitions`](#resourcedefinitions)

##### tools?

> `optional` **tools**: [`ToolDefinitions`](#tooldefinitions)

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

#### Type Declaration

##### transport

> **transport**: [`ServerTransport`](#servertransport)

***

### ServerTransport

> **ServerTransport** = `TransportType`\<[`ClientMessage`](../context-protocol/index.md#clientmessage), [`ServerMessage`](../context-protocol/index.md#servermessage)\>

***

### ToolDefinitions

> **ToolDefinitions** = `Record`\<`string`, [`GenericToolDefinition`](#generictooldefinition)\>

***

### ToolHandlerReturn

> **ToolHandlerReturn** = [`CallToolResult`](../context-protocol/index.md#calltoolresult) \| `Promise`\<[`CallToolResult`](../context-protocol/index.md#calltoolresult)\>

***

### TypedPromptDefinition

> **TypedPromptDefinition**\<`ArgumentsSchema`\> = `object`

#### Type Parameters

##### ArgumentsSchema

`ArgumentsSchema` *extends* `Schema`

#### Properties

##### argumentsSchema

> **argumentsSchema**: `Schema`

##### description

> **description**: `string`

##### handler

> **handler**: [`TypedPromptHandler`](#typedprompthandler)\<`FromSchema`\<`ArgumentsSchema`\>\>

***

### TypedPromptHandler()

> **TypedPromptHandler**\<`Arguments`\> = (`request`) => [`PromptHandlerReturn`](#prompthandlerreturn)

#### Type Parameters

##### Arguments

`Arguments`

#### Parameters

##### request

[`HandlerRequest`](#handlerrequest)\<\{ `arguments`: `Arguments`; \}\>

#### Returns

[`PromptHandlerReturn`](#prompthandlerreturn)

***

### TypedToolDefinition

> **TypedToolDefinition**\<`InputSchema`\> = `object`

#### Type Parameters

##### InputSchema

`InputSchema` *extends* `Schema` & [`InputSchema`](../context-protocol/index.md#inputschema)

#### Properties

##### description

> **description**: `string`

##### handler

> **handler**: [`TypedToolHandler`](#typedtoolhandler)\<`FromSchema`\<`InputSchema`\>\>

##### inputSchema

> **inputSchema**: `InputSchema`

***

### TypedToolHandler()

> **TypedToolHandler**\<`Arguments`\> = (`request`) => [`ToolHandlerReturn`](#toolhandlerreturn)

#### Type Parameters

##### Arguments

`Arguments`

#### Parameters

##### request

[`HandlerRequest`](#handlerrequest)\<\{ `arguments`: `Arguments`; \}\>

#### Returns

[`ToolHandlerReturn`](#toolhandlerreturn)

## Functions

### createPrompt()

> **createPrompt**\<`ArgumentsSchema`, `Arguments`\>(`description`, `argumentsSchema`, `handler`): [`GenericPromptDefinition`](#genericpromptdefinition)

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

[`TypedPromptHandler`](#typedprompthandler)\<`Arguments`\>

#### Returns

[`GenericPromptDefinition`](#genericpromptdefinition)

***

### createTool()

> **createTool**\<`InputSchema`, `Input`\>(`description`, `inputSchema`, `handler`): [`GenericToolDefinition`](#generictooldefinition)

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

[`TypedToolHandler`](#typedtoolhandler)\<`Input`\>

#### Returns

[`GenericToolDefinition`](#generictooldefinition)

***

### serveProcess()

> **serveProcess**(`config`): [`ContextServer`](#contextserver)

#### Parameters

##### config

[`ServerConfig`](#serverconfig)

#### Returns

[`ContextServer`](#contextserver)
