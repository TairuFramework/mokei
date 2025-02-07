# @mokei/context-server

Mokei MCP server.

## Installation

```sh
npm install @mokei/context-server
```

## Classes

### ContextServer\<Spec\>

#### Type Parameters

• **Spec** *extends* `SpecificationDefinition`

#### Constructors

##### new ContextServer()

> **new ContextServer**\<`Spec`\>(`params`): [`ContextServer`](index.md#contextserverspec)\<`Spec`\>

###### Parameters

###### params

[`ServerParams`](index.md#serverparamsspec)\<`Spec`\>

###### Returns

[`ContextServer`](index.md#contextserverspec)\<`Spec`\>

#### Methods

##### callTool()

> **callTool**(`request`, `signal`): `Promise`\<\{ `[key: string]`: `unknown`;  `_meta`: \{\}; `content`: (\{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `resource`: \{ `[key: string]`: `unknown`;  `mimeType`: `string`; `text`: `string`; `uri`: `string`; \} \| \{ `[key: string]`: `unknown`;  `blob`: `string`; `mimeType`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError`: `boolean`; \}\>

###### Parameters

###### request

###### id

`string` \| `number`

###### jsonrpc

`"2.0"`

###### method

`"tools/call"`

###### params

\{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `arguments`: \{\}; `name`: `string`; \}

###### params._meta

\{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}

###### params._meta.progressToken

`string` \| `number`

###### params.arguments

\{\}

###### params.name

`string`

###### signal

`AbortSignal`

###### Returns

`Promise`\<\{ `[key: string]`: `unknown`;  `_meta`: \{\}; `content`: (\{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `resource`: \{ `[key: string]`: `unknown`;  `mimeType`: `string`; `text`: `string`; `uri`: `string`; \} \| \{ `[key: string]`: `unknown`;  `blob`: `string`; `mimeType`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError`: `boolean`; \}\>

***

##### handle()

> **handle**(`transport`): `void`

###### Parameters

###### transport

[`ServerTransport`](index.md#servertransport)

###### Returns

`void`

***

##### handleMessage()

> **handleMessage**(`message`, `inflight`): `Promise`\<`null` \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `capabilities`: \{ `[key: string]`: `unknown`;  `experimental`: \{\}; `logging`: \{\}; `prompts`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; \}; `resources`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; `subscribe`: `boolean`; \}; `tools`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; \}; \}; `instructions`: `string`; `protocolVersion`: `string`; `serverInfo`: \{ `[key: string]`: `unknown`;  `name`: `string`; `version`: `string`; \}; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `completion`: \{ `[key: string]`: `unknown`;  `hasMore`: `boolean`; `total`: `number`; `values`: `string`[]; \}; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `description`: `string`; `messages`: `object`[]; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `nextCursor`: `string`; `prompts`: `object`[]; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `nextCursor`: `string`; `resources`: `object`[]; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `nextCursor`: `string`; `resourceTemplates`: `object`[]; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `contents`: (\{ `[key: string]`: `unknown`;  `mimeType`: `string`; `text`: `string`; `uri`: `string`; \} \| \{ `[key: string]`: `unknown`;  `blob`: `string`; `mimeType`: `string`; `uri`: `string`; \})[]; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `content`: (\{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (... \| ...)[]; `priority`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (... \| ...)[]; `priority`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (... \| ...)[]; `priority`: `number`; \}; `resource`: \{ `[key: string]`: `unknown`;  `mimeType`: `string`; `text`: `string`; `uri`: `string`; \} \| \{ `[key: string]`: `unknown`;  `blob`: `string`; `mimeType`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError`: `boolean`; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `nextCursor`: `string`; `tools`: `object`[]; \}\>

###### Parameters

###### message

\{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"ping"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"initialize"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `capabilities`: \{ `[key: string]`: `unknown`;  `experimental`: \{\}; `roots`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; \}; `sampling`: \{\}; \}; `clientInfo`: \{ `[key: string]`: `unknown`;  `name`: `string`; `version`: `string`; \}; `protocolVersion`: `string`; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"completion/complete"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `argument`: \{ `[key: string]`: `unknown`;  `name`: `string`; `value`: `string`; \}; `ref`: \{ `[key: string]`: `unknown`;  `name`: `string`; `type`: `"ref/prompt"`; \} \| \{ `[key: string]`: `unknown`;  `type`: `"ref/resource"`; `uri`: `string`; \}; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"logging/setLevel"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `level`: `"error"` \| `"alert"` \| `"critical"` \| `"debug"` \| `"emergency"` \| `"info"` \| `"notice"` \| `"warning"`; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"prompts/get"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `arguments`: \{\}; `name`: `string`; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"prompts/list"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `cursor`: `string`; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/list"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `cursor`: `string`; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/templates/list"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `cursor`: `string`; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/read"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `uri`: `string`; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/subscribe"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `uri`: `string`; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/unsubscribe"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `uri`: `string`; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"tools/list"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `cursor`: `string`; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"tools/call"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `arguments`: \{\}; `name`: `string`; \}; \} | \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/cancelled"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `reason`: `string`; `requestId`: `string` \| `number`; \}; \} | \{ `[key: string]`: `unknown`;  `method`: `"notifications/progress"`; `params`: \{ `[key: string]`: `unknown`;  `progress`: `number`; `progressToken`: `string` \| `number`; `total`: `number`; \}; \} | \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/initialized"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; \}; \} | \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/roots/list_changed"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; \}; \} | \{ `[key: string]`: `unknown`;  `error`: \{ `[key: string]`: `unknown`;  `code`: `number`; `data`: \{\}; `message`: `string`; \}; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `result`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `content`: \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (... \| ...)[]; `priority`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (... \| ...)[]; `priority`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \}; `model`: `string`; `role`: `"assistant"` \| `"user"`; `stopReason`: `string`; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `roots`: `object`[]; \}; \}

###### inflight

`Record`\<`string`, `AbortController`\>

###### Returns

`Promise`\<`null` \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `capabilities`: \{ `[key: string]`: `unknown`;  `experimental`: \{\}; `logging`: \{\}; `prompts`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; \}; `resources`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; `subscribe`: `boolean`; \}; `tools`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; \}; \}; `instructions`: `string`; `protocolVersion`: `string`; `serverInfo`: \{ `[key: string]`: `unknown`;  `name`: `string`; `version`: `string`; \}; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `completion`: \{ `[key: string]`: `unknown`;  `hasMore`: `boolean`; `total`: `number`; `values`: `string`[]; \}; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `description`: `string`; `messages`: `object`[]; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `nextCursor`: `string`; `prompts`: `object`[]; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `nextCursor`: `string`; `resources`: `object`[]; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `nextCursor`: `string`; `resourceTemplates`: `object`[]; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `contents`: (\{ `[key: string]`: `unknown`;  `mimeType`: `string`; `text`: `string`; `uri`: `string`; \} \| \{ `[key: string]`: `unknown`;  `blob`: `string`; `mimeType`: `string`; `uri`: `string`; \})[]; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `content`: (\{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (... \| ...)[]; `priority`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (... \| ...)[]; `priority`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (... \| ...)[]; `priority`: `number`; \}; `resource`: \{ `[key: string]`: `unknown`;  `mimeType`: `string`; `text`: `string`; `uri`: `string`; \} \| \{ `[key: string]`: `unknown`;  `blob`: `string`; `mimeType`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError`: `boolean`; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `nextCursor`: `string`; `tools`: `object`[]; \}\>

***

##### handleRequest()

> **handleRequest**(`request`, `signal`): `Promise`\<\{ `[key: string]`: `unknown`;  `_meta`: \{\}; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `capabilities`: \{ `[key: string]`: `unknown`;  `experimental`: \{\}; `logging`: \{\}; `prompts`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; \}; `resources`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; `subscribe`: `boolean`; \}; `tools`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; \}; \}; `instructions`: `string`; `protocolVersion`: `string`; `serverInfo`: \{ `[key: string]`: `unknown`;  `name`: `string`; `version`: `string`; \}; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `completion`: \{ `[key: string]`: `unknown`;  `hasMore`: `boolean`; `total`: `number`; `values`: `string`[]; \}; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `description`: `string`; `messages`: `object`[]; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `nextCursor`: `string`; `prompts`: `object`[]; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `nextCursor`: `string`; `resources`: `object`[]; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `nextCursor`: `string`; `resourceTemplates`: `object`[]; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `contents`: (\{ `[key: string]`: `unknown`;  `mimeType`: `string`; `text`: `string`; `uri`: `string`; \} \| \{ `[key: string]`: `unknown`;  `blob`: `string`; `mimeType`: `string`; `uri`: `string`; \})[]; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `content`: (\{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (... \| ...)[]; `priority`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (... \| ...)[]; `priority`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (... \| ...)[]; `priority`: `number`; \}; `resource`: \{ `[key: string]`: `unknown`;  `mimeType`: `string`; `text`: `string`; `uri`: `string`; \} \| \{ `[key: string]`: `unknown`;  `blob`: `string`; `mimeType`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError`: `boolean`; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `nextCursor`: `string`; `tools`: `object`[]; \}\>

###### Parameters

###### request

\{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"ping"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"initialize"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `capabilities`: \{ `[key: string]`: `unknown`;  `experimental`: \{\}; `roots`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; \}; `sampling`: \{\}; \}; `clientInfo`: \{ `[key: string]`: `unknown`;  `name`: `string`; `version`: `string`; \}; `protocolVersion`: `string`; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"completion/complete"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `argument`: \{ `[key: string]`: `unknown`;  `name`: `string`; `value`: `string`; \}; `ref`: \{ `[key: string]`: `unknown`;  `name`: `string`; `type`: `"ref/prompt"`; \} \| \{ `[key: string]`: `unknown`;  `type`: `"ref/resource"`; `uri`: `string`; \}; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"logging/setLevel"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `level`: `"error"` \| `"alert"` \| `"critical"` \| `"debug"` \| `"emergency"` \| `"info"` \| `"notice"` \| `"warning"`; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"prompts/get"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `arguments`: \{\}; `name`: `string`; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"prompts/list"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `cursor`: `string`; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/list"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `cursor`: `string`; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/templates/list"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `cursor`: `string`; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/read"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `uri`: `string`; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/subscribe"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `uri`: `string`; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"resources/unsubscribe"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `uri`: `string`; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"tools/list"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `cursor`: `string`; \}; \} | \{ `[key: string]`: `unknown`;  `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"tools/call"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{ `[key: string]`: `unknown`;  `progressToken`: `string` \| `number`; \}; `arguments`: \{\}; `name`: `string`; \}; \}

###### signal

`AbortSignal`

###### Returns

`Promise`\<\{ `[key: string]`: `unknown`;  `_meta`: \{\}; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `capabilities`: \{ `[key: string]`: `unknown`;  `experimental`: \{\}; `logging`: \{\}; `prompts`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; \}; `resources`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; `subscribe`: `boolean`; \}; `tools`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; \}; \}; `instructions`: `string`; `protocolVersion`: `string`; `serverInfo`: \{ `[key: string]`: `unknown`;  `name`: `string`; `version`: `string`; \}; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `completion`: \{ `[key: string]`: `unknown`;  `hasMore`: `boolean`; `total`: `number`; `values`: `string`[]; \}; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `description`: `string`; `messages`: `object`[]; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `nextCursor`: `string`; `prompts`: `object`[]; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `nextCursor`: `string`; `resources`: `object`[]; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `nextCursor`: `string`; `resourceTemplates`: `object`[]; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `contents`: (\{ `[key: string]`: `unknown`;  `mimeType`: `string`; `text`: `string`; `uri`: `string`; \} \| \{ `[key: string]`: `unknown`;  `blob`: `string`; `mimeType`: `string`; `uri`: `string`; \})[]; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `content`: (\{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (... \| ...)[]; `priority`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (... \| ...)[]; `priority`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (... \| ...)[]; `priority`: `number`; \}; `resource`: \{ `[key: string]`: `unknown`;  `mimeType`: `string`; `text`: `string`; `uri`: `string`; \} \| \{ `[key: string]`: `unknown`;  `blob`: `string`; `mimeType`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError`: `boolean`; \} \| \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `nextCursor`: `string`; `tools`: `object`[]; \}\>

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

### ServerParams\<Spec\>

> **ServerParams**\<`Spec`\>: `object` & `Spec`\[`"prompts"`\] *extends* `Record`\<`string`, `unknown`\> ? `object` : `object` & `Spec`\[`"tools"`\] *extends* `Record`\<`string`, `unknown`\> ? `object` : `object`

#### Type declaration

##### name

> **name**: `string`

##### resources?

> `optional` **resources**: `ResourceHandlers`

##### specification

> **specification**: `Spec`

##### transport?

> `optional` **transport**: [`ServerTransport`](index.md#servertransport)

##### version

> **version**: `string`

#### Type Parameters

• **Spec** *extends* `SpecificationDefinition`

***

### ServerTransport

> **ServerTransport**: `TransportType`\<[`ClientMessage`](../context-protocol/index.md#clientmessage), [`ServerMessage`](../context-protocol/index.md#servermessage)\>

## Functions

### serve()

> **serve**\<`Spec`\>(`params`): [`ContextServer`](index.md#contextserverspec)\<`Spec`\>

#### Type Parameters

• **Spec** *extends* `object`

#### Parameters

##### params

[`ServerParams`](index.md#serverparamsspec)\<`Spec`\>

#### Returns

[`ContextServer`](index.md#contextserverspec)\<`Spec`\>
