# @mokei/context-client

Mokei MCP client.

## Installation

```sh
npm install @mokei/context-client
```

## Classes

### ContextClient\<Tools\>

#### Type Parameters

• **Tools** *extends* `Record`\<`string`, `Record`\<`string`, `unknown`\>\> = `Record`\<`string`, `Record`\<`string`, `unknown`\>\>

#### Constructors

##### new ContextClient()

> **new ContextClient**\<`Tools`\>(`params`): [`ContextClient`](index.md#contextclienttools)\<`Tools`\>

###### Parameters

###### params

[`ClientParams`](index.md#clientparams)

###### Returns

[`ContextClient`](index.md#contextclienttools)\<`Tools`\>

#### Accessors

##### notifications

###### Get Signature

> **get** **notifications**(): `ReadableStream`\<\{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/cancelled"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `reason`: `string`; `requestId`: `string` \| `number`; \}; \} \| \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/message"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `data`: `unknown`; `level`: `"alert"` \| `"critical"` \| `"debug"` \| `"emergency"` \| `"error"` \| `"info"` \| `"notice"` \| `"warning"`; `logger`: `string`; \}; \} \| \{ `[key: string]`: `unknown`;  `method`: `"notifications/progress"`; `params`: \{ `[key: string]`: `unknown`;  `progress`: `number`; `progressToken`: `string` \| `number`; `total`: `number`; \}; \} \| \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/resources/updated"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `uri`: `string`; \}; \} \| \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/resources/list_changed"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; \}; \} \| \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/tools/list_changed"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; \}; \} \| \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/prompts/list_changed"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; \}; \}\>

###### Returns

`ReadableStream`\<\{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/cancelled"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `reason`: `string`; `requestId`: `string` \| `number`; \}; \} \| \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/message"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `data`: `unknown`; `level`: `"alert"` \| `"critical"` \| `"debug"` \| `"emergency"` \| `"error"` \| `"info"` \| `"notice"` \| `"warning"`; `logger`: `string`; \}; \} \| \{ `[key: string]`: `unknown`;  `method`: `"notifications/progress"`; `params`: \{ `[key: string]`: `unknown`;  `progress`: `number`; `progressToken`: `string` \| `number`; `total`: `number`; \}; \} \| \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/resources/updated"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `uri`: `string`; \}; \} \| \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/resources/list_changed"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; \}; \} \| \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/tools/list_changed"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; \}; \} \| \{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/prompts/list_changed"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; \}; \}\>

#### Methods

##### callTool()

> **callTool**\<`Name`\>(`name`, `args`): `Promise`\<\{ `[key: string]`: `unknown`;  `_meta`: \{\}; `content`: (\{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `resource`: \{ `[key: string]`: `unknown`;  `mimeType`: `string`; `text`: `string`; `uri`: `string`; \} \| \{ `[key: string]`: `unknown`;  `blob`: `string`; `mimeType`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError`: `boolean`; \}\>

###### Type Parameters

• **Name** *extends* `string`

###### Parameters

###### name

`Name`

###### args

`Tools`\[`Name`\]

###### Returns

`Promise`\<\{ `[key: string]`: `unknown`;  `_meta`: \{\}; `content`: (\{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `resource`: \{ `[key: string]`: `unknown`;  `mimeType`: `string`; `text`: `string`; `uri`: `string`; \} \| \{ `[key: string]`: `unknown`;  `blob`: `string`; `mimeType`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError`: `boolean`; \}\>

***

##### initialize()

> **initialize**(): `Promise`\<\{ `[key: string]`: `unknown`;  `_meta`: \{\}; `capabilities`: \{ `[key: string]`: `unknown`;  `experimental`: \{\}; `logging`: \{\}; `prompts`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; \}; `resources`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; `subscribe`: `boolean`; \}; `tools`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; \}; \}; `instructions`: `string`; `protocolVersion`: `string`; `serverInfo`: \{ `[key: string]`: `unknown`;  `name`: `string`; `version`: `string`; \}; \}\>

###### Returns

`Promise`\<\{ `[key: string]`: `unknown`;  `_meta`: \{\}; `capabilities`: \{ `[key: string]`: `unknown`;  `experimental`: \{\}; `logging`: \{\}; `prompts`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; \}; `resources`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; `subscribe`: `boolean`; \}; `tools`: \{ `[key: string]`: `unknown`;  `listChanged`: `boolean`; \}; \}; `instructions`: `string`; `protocolVersion`: `string`; `serverInfo`: \{ `[key: string]`: `unknown`;  `name`: `string`; `version`: `string`; \}; \}\>

***

##### listTools()

> **listTools**(): `Promise`\<`object`[]\>

###### Returns

`Promise`\<`object`[]\>

***

##### notify()

> **notify**\<`Event`\>(`event`, `params`): `Promise`\<`void`\>

###### Type Parameters

• **Event** *extends* keyof [`ClientNotifications`](../context-protocol/index.md#clientnotifications)

###### Parameters

###### event

`Event`

###### params

[`ClientNotifications`](../context-protocol/index.md#clientnotifications)\[`Event`\]\[`"params"`\]

###### Returns

`Promise`\<`void`\>

***

##### request()

> **request**\<`Method`\>(`method`, `params`): `ClientRequest`\<[`ClientRequests`](../context-protocol/index.md#clientrequests)\[`Method`\]\[`"Result"`\]\>

###### Type Parameters

• **Method** *extends* keyof [`ClientRequests`](../context-protocol/index.md#clientrequests)

###### Parameters

###### method

`Method`

###### params

[`ClientRequests`](../context-protocol/index.md#clientrequests)\[`Method`\]\[`"Params"`\]

###### Returns

`ClientRequest`\<[`ClientRequests`](../context-protocol/index.md#clientrequests)\[`Method`\]\[`"Result"`\]\>

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

#### Accessors

##### code

###### Get Signature

> **get** **code**(): `number`

###### Returns

`number`

***

##### data

###### Get Signature

> **get** **data**(): `undefined` \| `Record`\<`string`, `unknown`\>

###### Returns

`undefined` \| `Record`\<`string`, `unknown`\>

***

##### isInternal

###### Get Signature

> **get** **isInternal**(): `boolean`

###### Returns

`boolean`

***

##### isInvalidParams

###### Get Signature

> **get** **isInvalidParams**(): `boolean`

###### Returns

`boolean`

***

##### isInvalidRequest

###### Get Signature

> **get** **isInvalidRequest**(): `boolean`

###### Returns

`boolean`

***

##### isMethodNotFound

###### Get Signature

> **get** **isMethodNotFound**(): `boolean`

###### Returns

`boolean`

#### Methods

##### fromResponse()

> `static` **fromResponse**(`response`): [`RPCError`](index.md#rpcerror)

###### Parameters

###### response

###### error

\{ `[key: string]`: `unknown`;  `code`: `number`; `data`: \{\}; `message`: `string`; \}

###### error.code

`number`

###### error.data

\{\}

###### error.message

`string`

###### id

`string` \| `number`

###### jsonrpc

`"2.0"`

###### Returns

[`RPCError`](index.md#rpcerror)

## Type Aliases

### ClientParams

> **ClientParams**: `object`

#### Type declaration

##### transport

> **transport**: [`ClientTransport`](index.md#clienttransport)

***

### ClientTransport

> **ClientTransport**: `TransportType`\<[`ServerMessage`](../context-protocol/index.md#servermessage), [`ClientMessage`](../context-protocol/index.md#clientmessage)\>
