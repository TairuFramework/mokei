# @mokei/context-client

Mokei MCP client.

## Installation

```sh
npm install @mokei/context-client
```

## Classes

### CapabilityNotDeclaredError

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new CapabilityNotDeclaredError**(`params`): [`CapabilityNotDeclaredError`](#capabilitynotdeclarederror)

###### Parameters

###### params

[`CapabilityNotDeclaredErrorParams`](#capabilitynotdeclarederrorparams)

###### Returns

[`CapabilityNotDeclaredError`](#capabilitynotdeclarederror)

###### Overrides

`Error.constructor`

***

### ContextClient

Message ordering:
- notifications and responses are handled in wire order, synchronously in the read loop;
- requests *start* in wire order and complete out of order;
- a request never delays a notification -- which is what lets `notifications/cancelled`
  reach a handler that is still running.

#### Extends

- [`ContextRPC`](../context-rpc/index.md#contextrpc)\<`ClientTypes`\>

#### Type Parameters

##### T

`T` *extends* [`ContextTypes`](#contexttypes) = [`UnknownContextTypes`](#unknowncontexttypes)

#### Indexable

> \[`key`: `number`\]: () => `Promise`\<`void`\>

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

##### initializationResult

###### Get Signature

> **get** **initializationResult**(): \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `capabilities`: \{\[`key`: `string`\]: `unknown`; `completions?`: \{\[`key`: `string`\]: `unknown`; \}; `experimental?`: \{\[`key`: `string`\]: `object`; \}; `extensions?`: \{\[`key`: `string`\]: `object`; \}; `logging?`: \{\[`key`: `string`\]: `unknown`; \}; `prompts?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; \}; `resources?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; `subscribe?`: `boolean`; \}; `tools?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; \}; \}; `instructions?`: `string`; `protocolVersion`: `string`; `serverInfo`: \{\[`key`: `string`\]: `unknown`; `description?`: `string`; `icons?`: `object`[]; `name`: `string`; `title?`: `string`; `version`: `string`; `websiteUrl?`: `string`; \}; \} \| `undefined`

The completed handshake result, without starting initialization.

###### Returns

\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `capabilities`: \{\[`key`: `string`\]: `unknown`; `completions?`: \{\[`key`: `string`\]: `unknown`; \}; `experimental?`: \{\[`key`: `string`\]: `object`; \}; `extensions?`: \{\[`key`: `string`\]: `object`; \}; `logging?`: \{\[`key`: `string`\]: `unknown`; \}; `prompts?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; \}; `resources?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; `subscribe?`: `boolean`; \}; `tools?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; \}; \}; `instructions?`: `string`; `protocolVersion`: `string`; `serverInfo`: \{\[`key`: `string`\]: `unknown`; `description?`: `string`; `icons?`: `object`[]; `name`: `string`; `title?`: `string`; `version`: `string`; `websiteUrl?`: `string`; \}; \} \| `undefined`

##### notifications

###### Get Signature

> **get** **notifications**(): `ReadableStream`\<[`ServerNotification`](../context-protocol/index.md#servernotification)\>

###### Returns

`ReadableStream`\<[`ServerNotification`](../context-protocol/index.md#servernotification)\>

##### protocolVersion

###### Get Signature

> **get** **protocolVersion**(): [`ProtocolVersion`](../context-protocol/index.md#protocolversion)

The resolved protocol revision. Throws while an `'auto'` probe is still pending.

###### Returns

[`ProtocolVersion`](../context-protocol/index.md#protocolversion)

##### subscriptionFilter

###### Get Signature

> **get** **subscriptionFilter**(): \{\[`key`: `string`\]: `unknown`; `promptsListChanged?`: `boolean`; `resourcesListChanged?`: `boolean`; `resourceSubscriptions?`: `string`[]; `taskIds?`: `string`[]; `toolsListChanged?`: `boolean`; \} \| `null`

The notification filter the server acknowledged on the current listen, or `null`.

###### Returns

\{\[`key`: `string`\]: `unknown`; `promptsListChanged?`: `boolean`; `resourcesListChanged?`: `boolean`; `resourceSubscriptions?`: `string`[]; `taskIds?`: `string`[]; `toolsListChanged?`: `boolean`; \} \| `null`

##### tasks

###### Get Signature

> **get** **tasks**(): [`ClientTasks`](#clienttasks)

###### Returns

[`ClientTasks`](#clienttasks)

#### Methods

##### \_beforeTransportClose()

> **\_beforeTransportClose**(`_reason`): `void`

Runs on an explicit `dispose()` before the transport closes: tears down the subscription
driver (and any in-flight listen exchange) so no reconnect is scheduled as the outbound listen
exchange is ended by the close that follows. Idempotent with the `_onTransportClosed` teardown
that also covers a peer EOF.

###### Parameters

###### \_reason

`Error`

###### Returns

`void`

###### Overrides

`ContextRPC._beforeTransportClose`

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

[`ServerMessage`](../context-protocol/index.md#servermessage-1)

###### Returns

\{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; \} \| `Promise`\<\{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; \} \| `null`\> \| `null`

###### Overrides

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

> **\_handleRequest**(`request`, `signal`): `Promise`\<\{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \}; `model`: `string`; `role`: `"assistant"` \| `"user"`; `stopReason?`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `roots`: `object`[]; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `action`: `"accept"` \| `"cancel"` \| `"decline"`; `content?`: \{\[`key`: `string`\]: `string` \| `number` \| `boolean` \| `string`[]; \}; \}\>

###### Parameters

###### request

\{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"ping"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; \}; \} \| \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"sampling/createMessage"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `includeContext?`: `"allServers"` \| `"none"` \| `"thisServer"`; `maxTokens`: `number`; `messages`: `object`[]; `metadata?`: \{\[`key`: `string`\]: `unknown`; \}; `modelPreferences?`: \{\[`key`: `string`\]: `unknown`; `costPriority?`: `number`; `hints?`: `object`[]; `intelligencePriority?`: `number`; `speedPriority?`: `number`; \}; `stopSequences?`: `string`[]; `systemPrompt?`: `string`; `temperature?`: `number`; `toolChoice?`: \{\[`key`: `string`\]: `unknown`; `mode`: `"required"` \| `"none"` \| `"auto"`; \}; `tools?`: `object`[]; \}; \} \| \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"roots/list"`; `params?`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; \}; \} \| \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; `method`: `"elicitation/create"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `message`: `string`; `mode?`: `"form"`; `requestedSchema`: \{\[`key`: `string`\]: `unknown`; `properties`: \{\[`key`: `string`\]: \{\[`key`: `string`\]: `unknown`; `default?`: `string`; `description?`: `string`; `format?`: `"uri"` \| `"date-time"` \| `"date"` \| `"email"`; `maxLength?`: `number`; `minLength?`: `number`; `pattern?`: `string`; `title?`: `string`; `type`: `"string"`; \} \| \{\[`key`: `string`\]: `unknown`; `default?`: `number`; `description?`: `string`; `maximum?`: `number`; `minimum?`: `number`; `title?`: `string`; `type`: `"number"` \| `"integer"`; \} \| \{\[`key`: `string`\]: `unknown`; `default?`: `boolean`; `description?`: `string`; `title?`: `string`; `type`: `"boolean"`; \} \| \{\[`key`: `string`\]: `unknown`; `default?`: `string`; `description?`: `string`; `enum?`: `string`[]; `enumNames?`: `string`[]; `oneOf?`: `object`[]; `title?`: `string`; `type`: `"string"`; \} \| \{\[`key`: `string`\]: `unknown`; `default?`: `string`[]; `description?`: `string`; `items`: \{\[`key`: `string`\]: `unknown`; `enum`: ...[]; `enumNames?`: ... \| ...; `type`: `"string"`; \} \| \{\[`key`: `string`\]: `unknown`; `anyOf`: ...[]; \}; `title?`: `string`; `type`: `"array"`; \}; \}; `required?`: `string`[]; `type`: `"object"`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `elicitationId`: `string`; `message`: `string`; `mode`: `"url"`; `url`: `string`; \}; \}

###### signal

`AbortSignal`

###### Returns

`Promise`\<\{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \}; `model`: `string`; `role`: `"assistant"` \| `"user"`; `stopReason?`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `roots`: `object`[]; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `action`: `"accept"` \| `"cancel"` \| `"decline"`; `content?`: \{\[`key`: `string`\]: `string` \| `number` \| `boolean` \| `string`[]; \}; \}\>

###### Overrides

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`_handleRequest`](../context-rpc/index.md#_handlerequest)

##### \_read()

> **\_read**(): `Promise`\<`ReadableStreamReadResult`\<[`ServerMessage`](../context-protocol/index.md#servermessage-1)\>\>

Serves `#setupBuffer`'s leftovers before touching the transport. `ContextRPC`'s read loop
(`#readLoop` in `rpc.ts`) calls `this._read()` in an unconditional loop once
`#startReadLoop()` starts it, with no knowledge of `#setupBuffer`'s existence -- this
override is what makes that safe. Anything left in `#setupBuffer` once setup finishes (a
notification or server request that arrived during the probe/handshake window and matched
no setup-phase waiter's predicate) is drained here as the read loop's first reads, in
arrival order, before it ever reaches `super._read()` for genuinely new data. This is the
single place `#setupBuffer` is drained for that purpose --
`setup-reader.ts`'s `#readMatching()`
deliberately does not call this override for its own reads (see its comment for why doing so
would deadlock).

###### Returns

`Promise`\<`ReadableStreamReadResult`\<[`ServerMessage`](../context-protocol/index.md#servermessage-1)\>\>

###### Overrides

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`_read`](../context-rpc/index.md#_read)

##### \_write()

> **\_write**(`message`): `Promise`\<`void`\>

###### Parameters

###### message

[`ClientMessage`](../context-protocol/index.md#clientmessage)

###### Returns

`Promise`\<`void`\>

###### Overrides

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`_write`](../context-rpc/index.md#_write)

##### callTool()

###### Call Signature

> **callTool**(`params`): `Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; `structuredContent?`: \{\[`key`: `string`\]: `unknown`; \}; \}\>

###### Parameters

###### params

[`ToolParams`](#toolparams)\<`T`\> & [`RequestOptions`](../context-rpc/index.md#requestoptions) & `object`

###### Returns

`Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; `structuredContent?`: \{\[`key`: `string`\]: `unknown`; \}; \}\>

###### Call Signature

> **callTool**(`params`): `Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; `structuredContent?`: \{\[`key`: `string`\]: `unknown`; \}; \} \| [`InputRequiredResult`](#inputrequiredresult)\>

###### Parameters

###### params

[`ToolParams`](#toolparams)\<`T`\> & [`RequestOptions`](../context-rpc/index.md#requestoptions) & `object`

###### Returns

`Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; `structuredContent?`: \{\[`key`: `string`\]: `unknown`; \}; \} \| [`InputRequiredResult`](#inputrequiredresult)\>

###### Call Signature

> **callTool**(`params`): `Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; `structuredContent?`: \{\[`key`: `string`\]: `unknown`; \}; \} \| [`InputRequiredResult`](#inputrequiredresult)\>

###### Parameters

###### params

[`ToolParams`](#toolparams)\<`T`\> & [`RequestOptions`](../context-rpc/index.md#requestoptions) & `object`

###### Returns

`Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; `structuredContent?`: \{\[`key`: `string`\]: `unknown`; \}; \} \| [`InputRequiredResult`](#inputrequiredresult)\>

###### Call Signature

> **callTool**(`params`): `Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; `structuredContent?`: \{\[`key`: `string`\]: `unknown`; \}; \} \| [`CreateTaskResult`](../context-protocol/index.md#createtaskresult)\>

###### Parameters

###### params

[`ToolParams`](#toolparams)\<`T`\> & [`RequestOptions`](../context-rpc/index.md#requestoptions) & `object`

###### Returns

`Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; `structuredContent?`: \{\[`key`: `string`\]: `unknown`; \}; \} \| [`CreateTaskResult`](../context-protocol/index.md#createtaskresult)\>

###### Call Signature

> **callTool**(`params`): `Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; `structuredContent?`: \{\[`key`: `string`\]: `unknown`; \}; \} \| [`InputRequiredResult`](#inputrequiredresult) \| [`CreateTaskResult`](../context-protocol/index.md#createtaskresult)\>

###### Parameters

###### params

[`ToolParams`](#toolparams)\<`T`\> & [`RequestOptions`](../context-rpc/index.md#requestoptions) & `object`

###### Returns

`Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; `structuredContent?`: \{\[`key`: `string`\]: `unknown`; \}; \} \| [`InputRequiredResult`](#inputrequiredresult) \| [`CreateTaskResult`](../context-protocol/index.md#createtaskresult)\>

###### Call Signature

> **callTool**(`params`): `Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; `structuredContent?`: \{\[`key`: `string`\]: `unknown`; \}; \} \| [`InputRequiredResult`](#inputrequiredresult) \| [`CreateTaskResult`](../context-protocol/index.md#createtaskresult)\>

###### Parameters

###### params

[`ToolParams`](#toolparams)\<`T`\> & [`RequestOptions`](../context-rpc/index.md#requestoptions) & `object`

###### Returns

`Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; `structuredContent?`: \{\[`key`: `string`\]: `unknown`; \}; \} \| [`InputRequiredResult`](#inputrequiredresult) \| [`CreateTaskResult`](../context-protocol/index.md#createtaskresult)\>

##### complete()

> **complete**(`params`): `Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `completion`: \{\[`key`: `string`\]: `unknown`; `hasMore?`: `boolean`; `total?`: `number`; `values`: `string`[]; \}; \}\>

###### Parameters

###### params

[`WithRequestOptions`](../context-rpc/index.md#withrequestoptions)\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `argument`: \{\[`key`: `string`\]: `unknown`; `name`: `string`; `value`: `string`; \}; `context?`: \{\[`key`: `string`\]: `unknown`; `arguments?`: \{\[`key`: `string`\]: `string`; \}; \}; `ref`: \{\[`key`: `string`\]: `unknown`; `name`: `string`; `title?`: `string`; `type`: `"ref/prompt"`; \} \| \{\[`key`: `string`\]: `unknown`; `type`: `"ref/resource"`; `uri`: `string`; \}; \}\>

###### Returns

`Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `completion`: \{\[`key`: `string`\]: `unknown`; `hasMore?`: `boolean`; `total?`: `number`; `values`: `string`[]; \}; \}\>

##### discover()

> **discover**(`options?`): `Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `cacheScope?`: `"public"` \| `"private"`; `capabilities`: \{\[`key`: `string`\]: `unknown`; `completions?`: \{\[`key`: `string`\]: `unknown`; \}; `experimental?`: \{\[`key`: `string`\]: `object`; \}; `extensions?`: \{\[`key`: `string`\]: `object`; \}; `logging?`: \{\[`key`: `string`\]: `unknown`; \}; `prompts?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; \}; `resources?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; `subscribe?`: `boolean`; \}; `tools?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; \}; \}; `instructions?`: `string`; `resultType`: `"complete"`; `supportedVersions`: `string`[]; `ttlMs?`: `number`; \}\>

Queries a server's supported protocol versions, capabilities and identity -- the
`2026-07-28` replacement for the `initialize` handshake. Result is cached per the
server's own `ttlMs`; concurrent callers while a request is in flight collapse onto it.
`cacheScope` is read implicitly, not explicitly: this cache lives on one client instance,
so it is inherently private, and `'private'` is honoured by construction regardless of what
the server sends.

Awaits `#ready` like every other public method here (`setLoggingLevel`, `complete`,
`listTools`, `#listPaged`), so a first call under `protocolVersion: 'auto'` probes rather
than throwing "not resolved yet".

This is the `ttlMs`-governed cache for direct callers. `#requireServerCapabilityAsync`
does not use it for gating -- see `#serverCapabilitySnapshot`.

###### Parameters

###### options?

[`RequestOptions`](../context-rpc/index.md#requestoptions)

###### Returns

`Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `cacheScope?`: `"public"` \| `"private"`; `capabilities`: \{\[`key`: `string`\]: `unknown`; `completions?`: \{\[`key`: `string`\]: `unknown`; \}; `experimental?`: \{\[`key`: `string`\]: `object`; \}; `extensions?`: \{\[`key`: `string`\]: `object`; \}; `logging?`: \{\[`key`: `string`\]: `unknown`; \}; `prompts?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; \}; `resources?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; `subscribe?`: `boolean`; \}; `tools?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; \}; \}; `instructions?`: `string`; `resultType`: `"complete"`; `supportedVersions`: `string`[]; `ttlMs?`: `number`; \}\>

##### endTracing()

> **endTracing**(`reason`): `void`

###### Parameters

###### reason

[`TerminationReason`](#terminationreason)

###### Returns

`void`

##### getPrompt()

###### Call Signature

> **getPrompt**(`params`): `Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `description?`: `string`; `messages`: `object`[]; \}\>

###### Parameters

###### params

[`PromptParams`](#promptparams)\<`T`\> & [`RequestOptions`](../context-rpc/index.md#requestoptions) & `object`

###### Returns

`Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `description?`: `string`; `messages`: `object`[]; \}\>

###### Call Signature

> **getPrompt**(`params`): `Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `description?`: `string`; `messages`: `object`[]; \} \| [`InputRequiredResult`](#inputrequiredresult)\>

###### Parameters

###### params

[`PromptParams`](#promptparams)\<`T`\> & [`RequestOptions`](../context-rpc/index.md#requestoptions) & `object`

###### Returns

`Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `description?`: `string`; `messages`: `object`[]; \} \| [`InputRequiredResult`](#inputrequiredresult)\>

###### Call Signature

> **getPrompt**(`params`): `Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `description?`: `string`; `messages`: `object`[]; \} \| [`InputRequiredResult`](#inputrequiredresult)\>

###### Parameters

###### params

[`PromptParams`](#promptparams)\<`T`\> & [`RequestOptions`](../context-rpc/index.md#requestoptions) & `object`

###### Returns

`Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `description?`: `string`; `messages`: `object`[]; \} \| [`InputRequiredResult`](#inputrequiredresult)\>

##### initialize()

> **initialize**(): `Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `capabilities`: \{\[`key`: `string`\]: `unknown`; `completions?`: \{\[`key`: `string`\]: `unknown`; \}; `experimental?`: \{\[`key`: `string`\]: `object`; \}; `extensions?`: \{\[`key`: `string`\]: `object`; \}; `logging?`: \{\[`key`: `string`\]: `unknown`; \}; `prompts?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; \}; `resources?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; `subscribe?`: `boolean`; \}; `tools?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; \}; \}; `instructions?`: `string`; `protocolVersion`: `string`; `serverInfo`: \{\[`key`: `string`\]: `unknown`; `description?`: `string`; `icons?`: `object`[]; `name`: `string`; `title?`: `string`; `version`: `string`; `websiteUrl?`: `string`; \}; \}\>

The `2025-11-25` handshake result -- server capabilities and identity.

Awaits `#ready` like every other public method here: under `'auto'` the revision stays
unresolved until `#setup()` runs the probe, so without it `#requireProtocol()` threw "not
resolved yet" on every first call. No deadlock -- `#initialize()` writes and reads the
transport directly rather than through `request()`.

Two accepted costs: on a handshake-less revision setup runs before the throw below, and a
failed handshake now disposes the transport.

###### Returns

`Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `capabilities`: \{\[`key`: `string`\]: `unknown`; `completions?`: \{\[`key`: `string`\]: `unknown`; \}; `experimental?`: \{\[`key`: `string`\]: `object`; \}; `extensions?`: \{\[`key`: `string`\]: `object`; \}; `logging?`: \{\[`key`: `string`\]: `unknown`; \}; `prompts?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; \}; `resources?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; `subscribe?`: `boolean`; \}; `tools?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; \}; \}; `instructions?`: `string`; `protocolVersion`: `string`; `serverInfo`: \{\[`key`: `string`\]: `unknown`; `description?`: `string`; `icons?`: `object`[]; `name`: `string`; `title?`: `string`; `version`: `string`; `websiteUrl?`: `string`; \}; \}\>

##### listPrompts()

> **listPrompts**(`params?`): `Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `cacheScope?`: `"public"` \| `"private"`; `nextCursor?`: `string`; `prompts`: `object`[]; `ttlMs?`: `number`; \}\>

###### Parameters

###### params?

`object` & [`RequestOptions`](../context-rpc/index.md#requestoptions) & `object` = `{}`

###### Returns

`Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `cacheScope?`: `"public"` \| `"private"`; `nextCursor?`: `string`; `prompts`: `object`[]; `ttlMs?`: `number`; \}\>

##### listResources()

> **listResources**(`params?`): `Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `cacheScope?`: `"public"` \| `"private"`; `nextCursor?`: `string`; `resources`: `object`[]; `ttlMs?`: `number`; \}\>

###### Parameters

###### params?

`object` & [`RequestOptions`](../context-rpc/index.md#requestoptions) & `object` = `{}`

###### Returns

`Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `cacheScope?`: `"public"` \| `"private"`; `nextCursor?`: `string`; `resources`: `object`[]; `ttlMs?`: `number`; \}\>

##### listResourceTemplates()

> **listResourceTemplates**(`params?`): `Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `cacheScope?`: `"public"` \| `"private"`; `nextCursor?`: `string`; `resourceTemplates`: `object`[]; `ttlMs?`: `number`; \}\>

###### Parameters

###### params?

`object` & [`RequestOptions`](../context-rpc/index.md#requestoptions) & `object` = `{}`

###### Returns

`Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `cacheScope?`: `"public"` \| `"private"`; `nextCursor?`: `string`; `resourceTemplates`: `object`[]; `ttlMs?`: `number`; \}\>

##### listTools()

> **listTools**(`params?`): `Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `cacheScope?`: `"public"` \| `"private"`; `nextCursor?`: `string`; `tools`: `object`[]; `ttlMs?`: `number`; \}\>

###### Parameters

###### params?

`object` & [`RequestOptions`](../context-rpc/index.md#requestoptions) & `object` = `{}`

###### Returns

`Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `cacheScope?`: `"public"` \| `"private"`; `nextCursor?`: `string`; `tools`: `object`[]; `ttlMs?`: `number`; \}\>

##### notify()

> **notify**\<`Event`\>(`event`, `params`): `Promise`\<`void`\>

Stamp outgoing notifications with the resolved revision; `ContextRPC.notify()`
bypasses request decoration. An unstamped `notifications/cancelled` on a
handshake-free revision can leave the peer's handler running.
`decorateNotification` is identity on `2025-11-25`. Awaiting `#ready` is safe:
setup sends `notifications/initialized` through `super._write`.

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

###### Overrides

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`notify`](../context-rpc/index.md#notify)

##### onResourceUpdated()

> **onResourceUpdated**(`uri`, `listener`): () => `void`

Register a per-URI `resources/updated` listener. Returns an unsubscribe function. Independent
of [ContextClient.subscribeResource](#subscriberesource), which opens the server-side subscription: a
listener only receives updates once its URI is actually subscribed (and the update arrives).
Every delivered update also lands on the `notifications` stream.

###### Parameters

###### uri

`string`

###### listener

(`notification`) => `void`

###### Returns

() => `void`

##### readResource()

###### Call Signature

> **readResource**(`params`): `Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `cacheScope?`: `"public"` \| `"private"`; `contents`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \})[]; `ttlMs?`: `number`; \}\>

###### Parameters

###### params

`object` & [`RequestOptions`](../context-rpc/index.md#requestoptions) & `object`

###### Returns

`Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `cacheScope?`: `"public"` \| `"private"`; `contents`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \})[]; `ttlMs?`: `number`; \}\>

###### Call Signature

> **readResource**(`params`): `Promise`\<[`InputRequiredResult`](#inputrequiredresult) \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `cacheScope?`: `"public"` \| `"private"`; `contents`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \})[]; `ttlMs?`: `number`; \}\>

###### Parameters

###### params

`object` & [`RequestOptions`](../context-rpc/index.md#requestoptions) & `object`

###### Returns

`Promise`\<[`InputRequiredResult`](#inputrequiredresult) \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `cacheScope?`: `"public"` \| `"private"`; `contents`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \})[]; `ttlMs?`: `number`; \}\>

###### Call Signature

> **readResource**(`params`): `Promise`\<[`InputRequiredResult`](#inputrequiredresult) \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `cacheScope?`: `"public"` \| `"private"`; `contents`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \})[]; `ttlMs?`: `number`; \}\>

###### Parameters

###### params

`object` & [`RequestOptions`](../context-rpc/index.md#requestoptions) & `object`

###### Returns

`Promise`\<[`InputRequiredResult`](#inputrequiredresult) \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `cacheScope?`: `"public"` \| `"private"`; `contents`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \})[]; `ttlMs?`: `number`; \}\>

##### request()

> **request**\<`Method`\>(`method`, `params`, `options?`): `Promise`\<[`ClientRequests`](../context-protocol/index.md#clientrequests)\[`Method`\]\[`"Result"`\]\>

###### Type Parameters

###### Method

`Method` *extends* keyof [`ClientRequests`](../context-protocol/index.md#clientrequests)

###### Parameters

###### method

`Method`

###### params

[`ClientRequests`](../context-protocol/index.md#clientrequests)\[`Method`\]\[`"Params"`\]

###### options?

[`RequestOptions`](../context-rpc/index.md#requestoptions)

###### Returns

`Promise`\<[`ClientRequests`](../context-protocol/index.md#clientrequests)\[`Method`\]\[`"Result"`\]\>

###### Overrides

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`request`](../context-rpc/index.md#request)

##### setLoggingLevel()

> **setLoggingLevel**(`params`): `Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; \}\>

###### Parameters

###### params

[`WithRequestOptions`](../context-rpc/index.md#withrequestoptions)\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `level`: `"alert"` \| `"critical"` \| `"debug"` \| `"emergency"` \| `"error"` \| `"info"` \| `"notice"` \| `"warning"`; \}\>

###### Returns

`Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; \}\>

##### setTracing()

> **setTracing**(`binding`): `void`

###### Parameters

###### binding

[`ClientTracing`](#clienttracing)

###### Returns

`void`

##### subscribeResource()

> **subscribeResource**(`params`): `Promise`\<`void`\>

Subscribe to `resources/updated` for a URI over the `subscriptions/listen` stream. Resolves
once the server acknowledges the updated filter. Delegates to the driver, which opens a new
candidate carrying the URI, awaits its ack, and only then retires the previous stream.

###### Parameters

###### params

[`ResourceSubscriptionParams`](#resourcesubscriptionparams)

###### Returns

`Promise`\<`void`\>

##### unsubscribeResource()

> **unsubscribeResource**(`params`): `Promise`\<`void`\>

Unsubscribe from `resources/updated` for a URI. Resolves once the updated filter is acked.

###### Parameters

###### params

[`ResourceSubscriptionParams`](#resourcesubscriptionparams)

###### Returns

`Promise`\<`void`\>

##### waitForTask()

> **waitForTask**(`params`): `Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; `structuredContent?`: \{\[`key`: `string`\]: `unknown`; \}; \}\>

###### Parameters

###### params

[`WaitForTaskParams`](#waitfortaskparams)

###### Returns

`Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; `structuredContent?`: \{\[`key`: `string`\]: `unknown`; \}; \}\>

***

### InputRequiredNotSupportedError

Thrown when a server returns an `input_required` result the client will not fulfil: either
auto-fulfilment is off and the call did not pass `allowInputRequired`, or no handler is
configured for one of the embedded methods.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new InputRequiredNotSupportedError**(`params`): [`InputRequiredNotSupportedError`](#inputrequirednotsupportederror)

###### Parameters

###### params

[`InputRequiredNotSupportedErrorParams`](#inputrequirednotsupportederrorparams)

###### Returns

[`InputRequiredNotSupportedError`](#inputrequirednotsupportederror)

###### Overrides

`Error.constructor`

***

### InputRequiredRoundsExceededError

Thrown when a single call still needs input after its round cap is spent.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new InputRequiredRoundsExceededError**(`params`): [`InputRequiredRoundsExceededError`](#inputrequiredroundsexceedederror)

###### Parameters

###### params

[`InputRequiredRoundsExceededErrorParams`](#inputrequiredroundsexceedederrorparams)

###### Returns

[`InputRequiredRoundsExceededError`](#inputrequiredroundsexceedederror)

###### Overrides

`Error.constructor`

#### Accessors

##### lastResult

###### Get Signature

> **get** **lastResult**(): [`InputRequiredResult`](#inputrequiredresult)

###### Returns

[`InputRequiredResult`](#inputrequiredresult)

##### method

###### Get Signature

> **get** **method**(): `string`

###### Returns

`string`

##### rounds

###### Get Signature

> **get** **rounds**(): `number`

###### Returns

`number`

***

### InputRequiredTotalTimeoutError

Thrown when `maxTotalTimeout` is spent before the flow reaches a complete result.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new InputRequiredTotalTimeoutError**(`params`): [`InputRequiredTotalTimeoutError`](#inputrequiredtotaltimeouterror)

###### Parameters

###### params

[`InputRequiredTotalTimeoutErrorParams`](#inputrequiredtotaltimeouterrorparams)

###### Returns

[`InputRequiredTotalTimeoutError`](#inputrequiredtotaltimeouterror)

###### Overrides

`Error.constructor`

***

### ListMaxPagesError

Thrown when a paginated list walk fetches more pages than its cap allows.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new ListMaxPagesError**(`params`): [`ListMaxPagesError`](#listmaxpageserror)

###### Parameters

###### params

[`ListMaxPagesErrorParams`](#listmaxpageserrorparams)

###### Returns

[`ListMaxPagesError`](#listmaxpageserror)

###### Overrides

`Error.constructor`

#### Accessors

##### cursor

###### Get Signature

> **get** **cursor**(): `string`

###### Returns

`string`

##### method

###### Get Signature

> **get** **method**(): `string`

###### Returns

`string`

##### pages

###### Get Signature

> **get** **pages**(): `number`

###### Returns

`number`

##### results

###### Get Signature

> **get** **results**(): `unknown`[]

###### Returns

`unknown`[]

***

### MethodNotInRevisionError

Thrown when a method is absent from a protocol revision's `clientMethods` -- derived from that
table, not a version literal, so this fires exactly when the method itself is gone (as
opposed to, say, a rejected parameter value).

`request()` throws it for any method at all, which is what covers a caller reaching past the
typed wrappers. `setLoggingLevel()` throws it earlier, before its capability check, and passes
`hint` to say where the log level went on `2026-07-28`.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new MethodNotInRevisionError**(`params`): [`MethodNotInRevisionError`](#methodnotinrevisionerror)

###### Parameters

###### params

[`MethodNotInRevisionErrorParams`](#methodnotinrevisionerrorparams)

###### Returns

[`MethodNotInRevisionError`](#methodnotinrevisionerror)

###### Overrides

`Error.constructor`

***

### MRTRNotSupportedError

Thrown when a client is configured with a `createMessage`/`elicit`/`listRoots` handler on a
protocol revision that can invoke it neither as a server-initiated request nor as an MRTR input
request -- the client-side mirror of `@mokei/context-server`'s `MRTRNotSupportedError`.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new MRTRNotSupportedError**(`params`): [`MRTRNotSupportedError`](#mrtrnotsupportederror)

###### Parameters

###### params

[`MRTRNotSupportedErrorParams`](#mrtrnotsupportederrorparams)

###### Returns

[`MRTRNotSupportedError`](#mrtrnotsupportederror)

###### Overrides

`Error.constructor`

***

### StructuredContentValidationError

Thrown when a tool result's structuredContent violates the tool's advertised outputSchema.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new StructuredContentValidationError**(`params`): [`StructuredContentValidationError`](#structuredcontentvalidationerror)

###### Parameters

###### params

[`StructuredContentValidationErrorParams`](#structuredcontentvalidationerrorparams)

###### Returns

[`StructuredContentValidationError`](#structuredcontentvalidationerror)

###### Overrides

`Error.constructor`

#### Accessors

##### issues

###### Get Signature

> **get** **issues**(): [`ValidationIssue`](#validationissue)[]

###### Returns

[`ValidationIssue`](#validationissue)[]

##### toolName

###### Get Signature

> **get** **toolName**(): `string`

###### Returns

`string`

***

### SubscriptionDriver

Client-side resource-subscription state machine (SEP-2575, 2026-07-28).

Models the desired subscription filter as a single long-lived `subscriptions/listen`
stream that is re-opened (a new **generation**) whenever the filter changes or the stream
drops. Invariants:

- **Open-before-retire.** A mutation opens a new candidate carrying the updated filter and
  only aborts the previous exchange once the candidate's `acknowledged` frame arrives --
  never a window with no active listen.
- **Generation gating.** Each generation closes over its number; a frame from a superseded
  (retired) generation is dropped.
- **Ack-first contract.** A candidate's first frame MUST be `acknowledged`; any other first
  frame is a protocol error routed via the error sink, not a silent drop.
- **Single queue.** Mutations (subscribe/unsubscribe) and reconnects serialise on one queue,
  so each settles on its own generation's ack and a reconnect never overtakes an
  unacknowledged candidate.
- **Capped backoff.** Reconnects back off from 1s, doubling, capped at 30s.

#### Constructors

##### Constructor

> **new SubscriptionDriver**(`params`): [`SubscriptionDriver`](#subscriptiondriver)

###### Parameters

###### params

[`SubscriptionDriverParams`](#subscriptiondriverparams)

###### Returns

[`SubscriptionDriver`](#subscriptiondriver)

#### Methods

##### dispose()

> **dispose**(): `void`

Stop the driver: tear down the in-flight candidate and the active stream, and suppress
further reconnects.

Failing the pending candidate (if any) is what keeps disposal from hanging: its
`#openAndPromote` is awaiting an ack that a silent server may never send, and rejecting that
ack both aborts the candidate's exchange and unblocks the single mutation queue, so every
queued mutation behind it runs its own disposed-check and rejects rather than waiting forever.

###### Returns

`void`

##### onNotification()

> **onNotification**(`callback`): () => `void`

Add a notification listener; returns an unsubscribe function.

###### Parameters

###### callback

(`notification`) => `void`

###### Returns

() => `void`

##### open()

> **open**(`options?`): `Promise`\<`void`\>

Open the base listen stream (the current desired filter with no change to the resource set),
resolving once it is acknowledged. Used by the consumer's auto-open after setup to establish
the listChanged stream before any resource subscription. Serializes on the same queue as the
mutations, so an auto-open never races an in-flight subscribe.

###### Parameters

###### options?

###### signal?

`AbortSignal`

###### timeout?

`number`

###### Returns

`Promise`\<`void`\>

##### subscribeResource()

> **subscribeResource**(`params`): `Promise`\<`void`\>

Subscribe to a resource URI. Resolves once the new filter is acknowledged.

###### Parameters

###### params

[`MutationOptions`](#mutationoptions)

###### Returns

`Promise`\<`void`\>

##### unsubscribeResource()

> **unsubscribeResource**(`params`): `Promise`\<`void`\>

Unsubscribe from a resource URI. Resolves once the new filter is acknowledged.

###### Parameters

###### params

[`MutationOptions`](#mutationoptions)

###### Returns

`Promise`\<`void`\>

***

### SubscriptionProtocolError

Protocol-level failure on a listen stream (never retried).

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new SubscriptionProtocolError**(`params`): [`SubscriptionProtocolError`](#subscriptionprotocolerror)

###### Parameters

###### params

[`SubscriptionProtocolErrorParams`](#subscriptionprotocolerrorparams)

###### Returns

[`SubscriptionProtocolError`](#subscriptionprotocolerror)

###### Overrides

`Error.constructor`

***

### SubscriptionStreamError

A listen stream settled abnormally. `retryable` gates auto-reconnect.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new SubscriptionStreamError**(`params`): [`SubscriptionStreamError`](#subscriptionstreamerror)

###### Parameters

###### params

[`SubscriptionStreamErrorParams`](#subscriptionstreamerrorparams)

###### Returns

[`SubscriptionStreamError`](#subscriptionstreamerror)

###### Overrides

`Error.constructor`

#### Accessors

##### retryable

###### Get Signature

> **get** **retryable**(): `boolean`

###### Returns

`boolean`

***

### TaskCancelledError

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new TaskCancelledError**(`params`): [`TaskCancelledError`](#taskcancellederror)

###### Parameters

###### params

###### cause?

`unknown`

###### taskID

`string`

###### Returns

[`TaskCancelledError`](#taskcancellederror)

###### Overrides

`Error.constructor`

#### Accessors

##### taskID

###### Get Signature

> **get** **taskID**(): `string`

###### Returns

`string`

***

### TaskExpiredError

Thrown when a task is gone from the server once its TTL has elapsed.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new TaskExpiredError**(`params`): [`TaskExpiredError`](#taskexpirederror)

###### Parameters

###### params

###### cause?

`unknown`

###### taskID

`string`

###### Returns

[`TaskExpiredError`](#taskexpirederror)

###### Overrides

`Error.constructor`

#### Accessors

##### taskID

###### Get Signature

> **get** **taskID**(): `string`

###### Returns

`string`

***

### TaskInputUnavailableError

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new TaskInputUnavailableError**(`params`): [`TaskInputUnavailableError`](#taskinputunavailableerror)

###### Parameters

###### params

###### cause?

`unknown`

###### key

`string`

###### taskID

`string`

###### Returns

[`TaskInputUnavailableError`](#taskinputunavailableerror)

###### Overrides

`Error.constructor`

#### Accessors

##### key

###### Get Signature

> **get** **key**(): `string`

###### Returns

`string`

##### taskID

###### Get Signature

> **get** **taskID**(): `string`

###### Returns

`string`

***

### TaskInputWithdrawnError

Thrown into a task input handler's signal when the server withdraws the request it serves.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new TaskInputWithdrawnError**(`params`): [`TaskInputWithdrawnError`](#taskinputwithdrawnerror)

###### Parameters

###### params

###### cause?

`unknown`

###### key

`string`

###### taskID

`string`

###### Returns

[`TaskInputWithdrawnError`](#taskinputwithdrawnerror)

###### Overrides

`Error.constructor`

#### Accessors

##### key

###### Get Signature

> **get** **key**(): `string`

###### Returns

`string`

##### taskID

###### Get Signature

> **get** **taskID**(): `string`

###### Returns

`string`

***

### UnsupportedProtocolVersionError

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new UnsupportedProtocolVersionError**(`params`): [`UnsupportedProtocolVersionError`](#unsupportedprotocolversionerror)

`expected` is only known when this is raised against a server's handshake response (the
negotiated version has to match the one the client asked for). A rejected config-time pin
(`ClientParams.protocolVersion`) has no single "expected" value to name, so it's omitted
there and the message drops the clause instead of naming an arbitrary revision.

###### Parameters

###### params

[`UnsupportedProtocolVersionErrorParams`](#unsupportedprotocolversionerrorparams)

###### Returns

[`UnsupportedProtocolVersionError`](#unsupportedprotocolversionerror)

###### Overrides

`Error.constructor`

## Type Aliases

### CapabilityNotDeclaredErrorParams

> **CapabilityNotDeclaredErrorParams** = `object`

#### Properties

##### capability

> **capability**: `string`

##### cause?

> `optional` **cause?**: `unknown`

***

### ClientEvents

> **ClientEvents** = `object`

#### Properties

##### closed

> **closed**: `object`

###### error?

> `optional` **error?**: `Error`

##### elicitationComplete

> **elicitationComplete**: `object`

Emitted when a `2025-11-25` server sends `notifications/elicitation/complete` for a URL-mode
elicitation, carrying its `elicitationId`.

###### elicitationId

> **elicitationId**: `string`

##### initialized

> **initialized**: [`InitializeResult`](../context-protocol/index.md#initializeresult)

##### log

> **log**: [`Log`](../context-protocol/index.md#log)

##### promptsListChanged

> **promptsListChanged**: `undefined`

Emitted when the server signals its prompts list changed over the `subscriptions/listen`
stream (SEP-1391), alongside the existing internal `_resetDiscovery()` routing. Dataless.

##### resourcesListChanged

> **resourcesListChanged**: `undefined`

Emitted when the server signals its resources list changed over the `subscriptions/listen`
stream (SEP-1391), alongside the existing internal `_resetDiscovery()` routing. Dataless.

##### resourceUpdated

> **resourceUpdated**: `object`

Emitted when the server signals a subscribed resource's content changed over the
`subscriptions/listen` stream (SEP-1391), carrying the changed resource's URI. Emitted in
addition to the per-URI `onResourceUpdated` listeners and the `notifications` buffer push.

###### uri

> **uri**: `string`

##### subscriptionRetry

> **subscriptionRetry**: [`SubscriptionRetry`](#subscriptionretry-1)

Emitted before each `subscriptions/listen` reconnect attempt (SEP-1391).

##### toolsListChanged

> **toolsListChanged**: `undefined`

Emitted when the server signals its tools list changed over the `subscriptions/listen`
stream (SEP-1391), alongside the existing internal `_resetDiscovery()` routing. Dataless.

***

### ClientHandlerRequest

> **ClientHandlerRequest**\<`Params`\> = `object`

A server-initiated request handed to a client handler: the request's params, plus the
signal that aborts if the server cancels it.

Mirrors `HandlerRequest` on the server side, so a handler is one object either way.

#### Type Parameters

##### Params

`Params` = `Record`\<`string`, `never`\>

#### Properties

##### params

> **params**: `Params`

##### signal

> **signal**: `AbortSignal`

***

### ClientParams

> **ClientParams** = `object`

#### Properties

##### clientInfo?

> `optional` **clientInfo?**: [`Implementation`](../context-protocol/index.md#implementation)

##### createMessage?

> `optional` **createMessage?**: [`CreateMessageHandler`](#createmessagehandler)

##### elicit?

> `optional` **elicit?**: [`ElicitHandler`](#elicithandler)

##### inputRequired?

> `optional` **inputRequired?**: `object`

Multi round-trip request behaviour (MRTR, SEP-2322). `autoFulfill` (default `true`) dispatches
a server's embedded input requests to this client's own `createMessage`/`elicit`/`listRoots`
handlers and retries, so callers of `callTool`/`getPrompt`/`readResource` receive the same
result type they do on `2025-11-25`. `maxRounds` (default 10) caps a single call's rounds.

###### autoFulfill?

> `optional` **autoFulfill?**: `boolean`

###### maxRounds?

> `optional` **maxRounds?**: `number`

##### listMaxPages?

> `optional` **listMaxPages?**: `number`

##### listRoots?

> `optional` **listRoots?**: [`Root`](../context-protocol/index.md#root)[] \| [`ListRootsHandler`](#listrootshandler)

##### logLevel?

> `optional` **logLevel?**: [`LoggingLevel`](../context-protocol/index.md#logginglevel)

##### maxConcurrentRequests?

> `optional` **maxConcurrentRequests?**: `number`

Server-initiated request handlers (`sampling/createMessage`, `elicitation/create`,
`roots/list` on `2025-11-25`) allowed to run at once (default 100). Symmetric with
`@mokei/context-server`'s `ServerParams.maxConcurrentRequests`.

##### maxQueuedRequests?

> `optional` **maxQueuedRequests?**: `number`

Server-initiated requests allowed to wait for a slot before further ones are refused (default 1000).

##### onError?

> `optional` **onError?**: (`error`) => `void`

Called for an inbound frame that could neither be validated nor routed to anything --
an invalid notification, or a malformed frame naming an id nobody is waiting on -- and
for server-initiated request handlers that failed. Without it such frames vanish silently.

###### Parameters

###### error

`Error`

###### Returns

`void`

##### protocolVersion

> **protocolVersion**: [`ProtocolVersion`](../context-protocol/index.md#protocolversion) \| `"auto"`

Revision to speak. `'auto'` probes the server, then caches the result.

##### requestTimeout?

> `optional` **requestTimeout?**: `number`

Default timeout for every request after setup. Unset means unbounded -- `tools/call` can
legitimately run for minutes, and `@mokei/session` already bounds tool calls itself.
`setupTimeout` covers connection setup regardless of this value.

##### setupTimeout?

> `optional` **setupTimeout?**: `number`

Bounds every setup-time round trip: the `2025-11-25` handshake, the `'auto'` probe, and the
`server/discover` a revision without a handshake sends in their place. It is the only thing
that fails a connection to a server that is spawned but never answers.

##### tracing?

> `optional` **tracing?**: [`ClientTracing`](#clienttracing)

##### transport

> **transport**: [`ClientTransport`](#clienttransport)

***

### ClientTasks

> **ClientTasks** = `object`

#### Methods

##### cancel()

> **cancel**(`taskID`): `Promise`\<\{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `resultType`: `"complete"`; \}\>

###### Parameters

###### taskID

`string`

###### Returns

`Promise`\<\{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `resultType`: `"complete"`; \}\>

##### get()

> **get**(`taskID`): `Promise`\<[`TasksGetResult`](../context-protocol/index.md#tasksgetresult)\>

###### Parameters

###### taskID

`string`

###### Returns

`Promise`\<[`TasksGetResult`](../context-protocol/index.md#tasksgetresult)\>

##### update()

> **update**(`taskID`, `inputResponses`): `Promise`\<\{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `resultType`: `"complete"`; \}\>

###### Parameters

###### taskID

`string`

###### inputResponses

`Record`\<`string`, [`InputResponse`](../context-protocol/index.md#inputresponse)\>

###### Returns

`Promise`\<\{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `resultType`: `"complete"`; \}\>

##### wait()

> **wait**(`taskID`, `options?`): `Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; `structuredContent?`: \{\[`key`: `string`\]: `unknown`; \}; \}\>

###### Parameters

###### taskID

`string`

###### options?

###### onStatus?

(`status`) => `void`

###### signal?

`AbortSignal`

###### toolName?

`string`

###### Returns

`Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; `structuredContent?`: \{\[`key`: `string`\]: `unknown`; \}; \}\>

***

### ClientTracing

> **ClientTracing** = `object`

#### Properties

##### contextID

> **contextID**: `string`

##### contextSpan?

> `optional` **contextSpan?**: `Span`

##### getProtocolVersion?

> `optional` **getProtocolVersion?**: () => `string` \| `undefined`

Read the negotiated protocol revision at request start.

###### Returns

`string` \| `undefined`

##### getSessionID?

> `optional` **getSessionID?**: () => `string` \| `undefined`

Read the current negotiated session at request start.

###### Returns

`string` \| `undefined`

##### network?

> `optional` **network?**: [`NetworkInfo`](#networkinfo)

##### parentFrom?

> `optional` **parentFrom?**: [`TraceParentFrom`](#traceparentfrom)

Where incoming request spans take their parent from. Defaults to the bound context.

##### payloads?

> `optional` **payloads?**: [`PayloadCapture`](#payloadcapture)

Payload capture is opt-in. Defaults to 'off'.

***

### ClientTransport

> **ClientTransport** = `TransportType`\<[`ServerMessage`](../context-protocol/index.md#servermessage-1), [`ClientMessage`](../context-protocol/index.md#clientmessage)\>

***

### ContextTypes

> **ContextTypes** = `object`

#### Properties

##### Prompts?

> `optional` **Prompts?**: `Record`\<`string`, `Record`\<`string`, `unknown`\> \| `never`\>

##### Tools?

> `optional` **Tools?**: `Record`\<`string`, `Record`\<`string`, `unknown`\>\>

***

### CreateMessageHandler

> **CreateMessageHandler** = (`request`) => [`CreateMessageResult`](../context-protocol/index.md#createmessageresult) \| `Promise`\<[`CreateMessageResult`](../context-protocol/index.md#createmessageresult)\>

#### Parameters

##### request

[`ClientHandlerRequest`](#clienthandlerrequest)\<[`CreateMessageRequest`](../context-protocol/index.md#createmessagerequest)\[`"params"`\]\>

#### Returns

[`CreateMessageResult`](../context-protocol/index.md#createmessageresult) \| `Promise`\<[`CreateMessageResult`](../context-protocol/index.md#createmessageresult)\>

***

### ElicitHandler

> **ElicitHandler** = (`request`) => [`ElicitResult`](../context-protocol/index.md#elicitresult) \| `Promise`\<[`ElicitResult`](../context-protocol/index.md#elicitresult)\>

#### Parameters

##### request

[`ClientHandlerRequest`](#clienthandlerrequest)\<[`ElicitRequest`](../context-protocol/index.md#elicitrequest)\[`"params"`\]\>

#### Returns

[`ElicitResult`](../context-protocol/index.md#elicitresult) \| `Promise`\<[`ElicitResult`](../context-protocol/index.md#elicitresult)\>

***

### ExchangeSpan

> **ExchangeSpan** = `object`

#### Properties

##### context

> **context**: `Context`

##### span

> **span**: `Span`

#### Methods

##### fail()

> **fail**(`errorType`, `message?`): `void`

###### Parameters

###### errorType

`string`

###### message?

`string`

###### Returns

`void`

##### failRPC()

> **failRPC**(`error`): `void`

Settle from a JSON-RPC error response; classification depends on the exchange direction.

###### Parameters

###### error

###### code

`number`

###### message?

`string`

###### Returns

`void`

##### setID()

> **setID**(`id`): `void`

###### Parameters

###### id

`string` \| `number`

###### Returns

`void`

##### succeed()

> **succeed**(`result`): `void`

###### Parameters

###### result

`unknown`

###### Returns

`void`

***

### InputRequiredNotSupportedErrorParams

> **InputRequiredNotSupportedErrorParams** = `object`

#### Properties

##### cause?

> `optional` **cause?**: `unknown`

##### reason

> **reason**: `string`

***

### InputRequiredResult

> **InputRequiredResult** = `DistributiveOmit`\<`FromSchema`\<*typeof* `inputRequiredResult`\>, `"_meta"`\>

Derived from `inputRequiredResult` rather than hand-written, so the schema's `anyOf`
(at-least-one-of `inputRequests`/`requestState`) is enforced at compile time, not only at
runtime and on the wire. `_meta` is excluded: no handler constructs one, and admitting it here
would only widen what a consumer may assume is present.

The two places that construct this type directly -- `@mokei/context-server`'s `inputRequired()`
and `@mokei/context-client`'s `InputRequiredRoundsExceededError` construction in `mrtr.ts` --
assemble the object through conditional spreads or an already-validated rest object, which
TypeScript cannot narrow to a specific union member. Both assert `as InputRequiredResult`, and
the invariant is enforced before each: `inputRequired()` throws on the empty case in the
statement directly above its assertion, while the client's value arrives from the wire, where
the RPC read loop has already validated it against this schema -- `anyOf` included -- and failed
the exchange rather than resolving it if it did not hold.

***

### InputRequiredRetryParams

> **InputRequiredRetryParams** = `object`

The two fields a retry adds to the original request's params.

#### Properties

##### inputResponses?

> `optional` **inputResponses?**: `Record`\<`string`, [`InputResponse`](../context-protocol/index.md#inputresponse)\>

##### requestState?

> `optional` **requestState?**: `string`

***

### InputRequiredRoundsExceededErrorParams

> **InputRequiredRoundsExceededErrorParams** = `object`

#### Properties

##### cause?

> `optional` **cause?**: `unknown`

##### lastResult

> **lastResult**: [`InputRequiredResult`](#inputrequiredresult)

##### method

> **method**: `string`

##### rounds

> **rounds**: `number`

***

### InputRequiredTotalTimeoutErrorParams

> **InputRequiredTotalTimeoutErrorParams** = `object`

#### Properties

##### cause?

> `optional` **cause?**: `unknown`

##### elapsed

> **elapsed**: `number`

##### maxTotalTimeout

> **maxTotalTimeout**: `number`

***

### ListenHandle

> **ListenHandle** = `object`

Handle returned by [OpenListen](#openlisten).

#### Properties

##### abort

> **abort**: (`reason?`) => `void`

Abort the exchange (open-before-retire, timeout, cancellation). Idempotent.

###### Parameters

###### reason?

`Error`

###### Returns

`void`

##### exchange

> **exchange**: `Promise`\<`unknown`\>

Terminal promise for the exchange (settles/rejects on teardown).

***

### ListenHandlers

> **ListenHandlers** = `object`

Sink the driver feeds while a listen stream is live.

#### Properties

##### onNotification

> **onNotification**: (`notification`) => `void`

###### Parameters

###### notification

[`SubscriptionNotification`](#subscriptionnotification)

###### Returns

`void`

##### onSettle

> **onSettle**: (`settle`) => `void`

###### Parameters

###### settle

[`ListenSettle`](#listensettle)

###### Returns

`void`

***

### ListenSettle

> **ListenSettle** = `object`

#### Properties

##### error?

> `optional` **error?**: `Error`

##### reason

> **reason**: [`ListenSettleReason`](#listensettlereason-1)

***

### ListenSettleReason

> **ListenSettleReason** = `"result"` \| `"error"` \| `"cancel"` \| `"closed"`

How a listen stream settled. Mirrors `context-rpc`'s `StreamSettle` so the driver stays
decoupled from the transport: `ContextClient`'s `openListen` maps one to the other verbatim.
- `result`: a terminal `subscriptions/listen` result arrived (graceful teardown).
- `error`: a terminal error, or a protocol/schema failure.
- `cancel`: the exchange was aborted locally.
- `closed`: the transport dropped and the exchange was ended.

***

### ListMaxPagesErrorParams

> **ListMaxPagesErrorParams** = `object`

#### Properties

##### cause?

> `optional` **cause?**: `unknown`

##### cursor

> **cursor**: `string`

##### method

> **method**: `string`

##### pages

> **pages**: `number`

##### results

> **results**: `unknown`[]

***

### ListOptions

> **ListOptions** = [`RequestOptions`](../context-rpc/index.md#requestoptions) & `object`

Pagination and transport options accepted by the paginated list methods, alongside the
request's own params.

`signal` aborts the walk, cancelling the request in flight; `timeout` applies to each
page request, not to the walk as a whole.

#### Type Declaration

##### maxPages?

> `optional` **maxPages?**: `number`

Overrides `ClientParams.listMaxPages` for this call.

***

### ListParams

> **ListParams**\<`Params`\> = `Params` & [`ListOptions`](#listoptions)

Params of a paginated list method: its wire params plus [ListOptions](#listoptions).

#### Type Parameters

##### Params

`Params`

***

### ListRootsHandler

> **ListRootsHandler** = (`request`) => [`Root`](../context-protocol/index.md#root)[] \| `Promise`\<[`Root`](../context-protocol/index.md#root)[]\>

#### Parameters

##### request

`Omit`\<[`ClientHandlerRequest`](#clienthandlerrequest), `"params"`\>

#### Returns

[`Root`](../context-protocol/index.md#root)[] \| `Promise`\<[`Root`](../context-protocol/index.md#root)[]\>

***

### MessageDirection

> **MessageDirection** = `"client"` \| `"server"`

***

### MethodNotInRevisionErrorParams

> **MethodNotInRevisionErrorParams** = `object`

#### Properties

##### cause?

> `optional` **cause?**: `unknown`

##### hint?

> `optional` **hint?**: `string`

##### method

> **method**: `string`

##### version

> **version**: [`ProtocolVersion`](../context-protocol/index.md#protocolversion)

***

### MRTRNotSupportedErrorParams

> **MRTRNotSupportedErrorParams** = `object`

#### Properties

##### cause?

> `optional` **cause?**: `unknown`

##### handler

> **handler**: `string`

##### version

> **version**: [`ProtocolVersion`](../context-protocol/index.md#protocolversion)

***

### MutationOptions

> **MutationOptions** = `object`

#### Properties

##### signal?

> `optional` **signal?**: `AbortSignal`

##### timeout?

> `optional` **timeout?**: `number`

##### uri

> **uri**: `string`

***

### NetworkInfo

> **NetworkInfo** = `object`

#### Properties

##### protocolName?

> `optional` **protocolName?**: `"http"`

##### serverAddress?

> `optional` **serverAddress?**: `string`

##### serverPort?

> `optional` **serverPort?**: `number`

##### transport

> **transport**: `"pipe"` \| `"tcp"`

***

### OpenListen

> **OpenListen** = (`filter`, `handlers`) => [`ListenHandle`](#listenhandle)

Injected seam that opens one `subscriptions/listen` exchange carrying `filter`, routing
frames to `handlers`. `ContextClient` backs it with `_registerStreamExchange`; tests supply a fake.

#### Parameters

##### filter

[`SubscriptionFilter`](../context-protocol/index.md#subscriptionfilter)

##### handlers

[`ListenHandlers`](#listenhandlers)

#### Returns

[`ListenHandle`](#listenhandle)

***

### PayloadCapture

> **PayloadCapture** = `"on"` \| `"off"` \| `number`

***

### PromptParams

> **PromptParams**\<`T`\> = `NamedParams`\<`T`\[`"Prompts"`\]\>

#### Type Parameters

##### T

`T` *extends* [`ContextTypes`](#contexttypes)

***

### ResourceSubscriptionParams

> **ResourceSubscriptionParams** = `object`

Parameters of [ContextClient.subscribeResource](#subscriberesource)/`unsubscribeResource`.

#### Properties

##### signal?

> `optional` **signal?**: `AbortSignal`

Aborts the mutation before its listen filter is acknowledged.

##### timeout?

> `optional` **timeout?**: `number`

Bounds the wait for the new filter's acknowledgement (ms).

##### uri

> **uri**: `string`

The resource URI to subscribe to / unsubscribe from.

***

### StructuredContentValidationErrorParams

> **StructuredContentValidationErrorParams** = `object`

#### Properties

##### cause?

> `optional` **cause?**: `unknown`

##### issues

> **issues**: [`ValidationIssue`](#validationissue)[]

##### toolName

> **toolName**: `string`

***

### SubscriptionDriverParams

> **SubscriptionDriverParams** = `object`

#### Properties

##### ackTimeoutMs?

> `optional` **ackTimeoutMs?**: `number`

Bounds how long a candidate open (a mutation or a reconnect) waits for its `acknowledged`
frame before failing, applied whenever a mutation passes no `timeout` of its own. Without it
a silent server that opens the stream but never acks wedges the single mutation queue
forever -- a reconnect candidate especially, since no caller supplies its timeout. Unset means
unbounded (the pre-hardening behaviour); the configured default is wired at the `ContextClient`
layer.

##### backoffBaseMs?

> `optional` **backoffBaseMs?**: `number`

Backoff base delay (ms). Defaults to DEFAULT\_BACKOFF\_BASE\_MS.

##### backoffCapMs?

> `optional` **backoffCapMs?**: `number`

Backoff cap delay (ms). Defaults to DEFAULT\_BACKOFF\_CAP\_MS.

##### delay?

> `optional` **delay?**: (`ms`) => `Promise`\<`void`\>

Clock seam for backoff; injected in tests. Defaults to a real timer.

###### Parameters

###### ms

`number`

###### Returns

`Promise`\<`void`\>

##### filter?

> `optional` **filter?**: [`SubscriptionFilter`](../context-protocol/index.md#subscriptionfilter)

Base filter (listChanged opt-ins); `resourceSubscriptions` is managed by the driver.

##### onError?

> `optional` **onError?**: (`error`) => `void`

Error sink for protocol errors and non-retryable reconnect failures.

###### Parameters

###### error

`Error`

###### Returns

`void`

##### onNotification?

> `optional` **onNotification?**: (`notification`) => `void`

Notification sink for delivered (non-`acknowledged`) frames.

###### Parameters

###### notification

[`SubscriptionNotification`](#subscriptionnotification)

###### Returns

`void`

##### onRetry?

> `optional` **onRetry?**: (`retry`) => `void`

Called before each reconnect attempt.

###### Parameters

###### retry

[`SubscriptionRetry`](#subscriptionretry-1)

###### Returns

`void`

##### openListen

> **openListen**: [`OpenListen`](#openlisten)

***

### SubscriptionNotification

> **SubscriptionNotification** = [`ServerNotification`](../context-protocol/index.md#servernotification)

Notification frame carried on a `subscriptions/listen` stream.

***

### SubscriptionProtocolErrorParams

> **SubscriptionProtocolErrorParams** = `object`

#### Properties

##### cause?

> `optional` **cause?**: `unknown`

##### message

> **message**: `string`

***

### SubscriptionRetry

> **SubscriptionRetry** = `object`

Emitted before each reconnect attempt.

#### Properties

##### attempt

> **attempt**: `number`

##### error

> **error**: `Error`

##### retryInMs

> **retryInMs**: `number`

***

### SubscriptionStreamErrorParams

> **SubscriptionStreamErrorParams** = `object`

#### Properties

##### cause?

> `optional` **cause?**: `unknown`

##### message

> **message**: `string`

##### retryable

> **retryable**: `boolean`

***

### TerminationReason

> **TerminationReason** = `"stopped"` \| `"lost"`

***

### ToolParams

> **ToolParams**\<`T`\> = `NamedParams`\<`T`\[`"Tools"`\]\>

#### Type Parameters

##### T

`T` *extends* [`ContextTypes`](#contexttypes)

***

### TraceMeta

> **TraceMeta** = `object`

W3C trace-context keys carried in MCP request `_meta` (SEP-414).

#### Properties

##### baggage?

> `optional` **baggage?**: `string`

##### traceparent?

> `optional` **traceparent?**: `string`

##### tracestate?

> `optional` **tracestate?**: `string`

***

### TraceParentFrom

> **TraceParentFrom** = `"context"` \| `"meta"`

Where incoming request spans take their parent from: the bound context span, or `_meta.traceparent`.

***

### UnknownContextTypes

> **UnknownContextTypes** = `object`

#### Properties

##### Prompts

> **Prompts**: `Record`\<`string`, `Record`\<`string`, `unknown`\>\>

##### Tools

> **Tools**: `Record`\<`string`, `Record`\<`string`, `unknown`\>\>

***

### UnsupportedProtocolVersionErrorParams

> **UnsupportedProtocolVersionErrorParams** = `object`

#### Properties

##### cause?

> `optional` **cause?**: `unknown`

##### expected?

> `optional` **expected?**: [`ProtocolVersion`](../context-protocol/index.md#protocolversion)

##### received

> **received**: `string`

***

### ValidationIssue

> **ValidationIssue** = `object`

A validation issue, matching the shape `createTool` produces for input errors.

#### Properties

##### message

> **message**: `string`

##### path?

> `optional` **path?**: `ReadonlyArray`\<`PropertyKey`\>

***

### WaitForTaskParams

> **WaitForTaskParams** = `object`

#### Properties

##### cancelOnAbort?

> `optional` **cancelOnAbort?**: `boolean`

##### onStatus?

> `optional` **onStatus?**: (`status`) => `void`

###### Parameters

###### status

[`DetailedTask`](../context-protocol/index.md#detailedtask)

###### Returns

`void`

##### signal?

> `optional` **signal?**: `AbortSignal`

##### taskID

> **taskID**: `string`

##### toolName?

> `optional` **toolName?**: `string`

## Variables

### AGENT\_COUNT\_BUCKETS

> `const` **AGENT\_COUNT\_BUCKETS**: `ReadonlyArray`\<`number`\>

***

### AGENT\_DURATION\_BUCKETS

> `const` **AGENT\_DURATION\_BUCKETS**: `ReadonlyArray`\<`number`\>

***

### DEFAULT\_LIST\_MAX\_PAGES

> `const` **DEFAULT\_LIST\_MAX\_PAGES**: `100` = `100`

Default cap on pages fetched by a single list walk.

***

### DEFAULT\_MAX\_ROUNDS

> `const` **DEFAULT\_MAX\_ROUNDS**: `10` = `10`

Default rounds a single call may take before the flow fails. Matches SDK v2's own default.

***

### DEFAULT\_PAYLOAD\_CAP

> `const` **DEFAULT\_PAYLOAD\_CAP**: `65536` = `65536`

***

### GEN\_AI\_DURATION\_BUCKETS

> `const` **GEN\_AI\_DURATION\_BUCKETS**: `ReadonlyArray`\<`number`\>

***

### MCP\_DURATION\_BUCKETS

> `const` **MCP\_DURATION\_BUCKETS**: `ReadonlyArray`\<`number`\>

***

### REQUEST\_STATE\_ONLY\_PACING\_MS

> `const` **REQUEST\_STATE\_ONLY\_PACING\_MS**: `250` = `250`

Pacing applied before retrying a `requestState`-only leg: one carrying no embedded requests, so
no handler work slows the loop down naturally. A server sends these to shed load or to report
that it is still working, and without the delay the client would spin against it.

***

### SEMCONV\_SCHEMA\_URL

> `const` **SEMCONV\_SCHEMA\_URL**: `"https://opentelemetry.io/schemas/gen-ai-dev/1.42.0-dev"` = `'https://opentelemetry.io/schemas/gen-ai-dev/1.42.0-dev'`

***

### TOKEN\_BUCKETS

> `const` **TOKEN\_BUCKETS**: `ReadonlyArray`\<`number`\>

***

### WORKFLOW\_DURATION\_BUCKETS

> `const` **WORKFLOW\_DURATION\_BUCKETS**: `ReadonlyArray`\<`number`\>

## Functions

### capturePayload()

> **capturePayload**(`value`, `capture`, `options?`): \{ `payload`: `string`; `truncated`: `boolean`; \} \| `undefined`

#### Parameters

##### value

`unknown`

##### capture

[`PayloadCapture`](#payloadcapture) \| `undefined`

##### options?

###### redact?

`boolean`

#### Returns

\{ `payload`: `string`; `truncated`: `boolean`; \} \| `undefined`

***

### createExchangeTracer()

> **createExchangeTracer**(`getBinding`): `object`

#### Parameters

##### getBinding

() => [`ClientTracing`](#clienttracing) \| `undefined`

#### Returns

##### recordLocalFailure()

> **recordLocalFailure**(`params`): `void`

A call that fails locally after a round settled as `input_required` (embedded request
failure, round cap, total timeout, abort) sent no final wire round: record the failed
`execute_tool` so failed logical calls stay visible to span-based counts.

###### Parameters

###### params

###### error

`unknown`

###### errorType?

`string`

Overrides the `errorTypeOf` classification, e.g. `cancelled` for a caller abort reason.

###### links

`Link`[]

###### method

`string`

###### params

`unknown`

###### round

`number`

###### traceAttributes?

`Record`\<`string`, `string`\>

###### Returns

`void`

##### settleAll()

> **settleAll**(`reason`): `void`

###### Parameters

###### reason

[`TerminationReason`](#terminationreason)

###### Returns

`void`

##### startIncoming()

> **startIncoming**(`method`, `params`, `id`, `meta?`): [`ExchangeSpan`](#exchangespan)

###### Parameters

###### method

`string`

###### params

`unknown`

###### id

`string` \| `number`

###### meta?

`Record`\<`string`, `unknown`\>

###### Returns

[`ExchangeSpan`](#exchangespan)

##### startOutgoing()

> **startOutgoing**(`method`, `params`, `options?`): [`ExchangeSpan`](#exchangespan)

###### Parameters

###### method

`string`

###### params

`unknown`

###### options?

###### links?

`Link`[]

###### round?

`number`

###### traceAttributes?

`Record`\<`string`, `string`\>

###### Returns

[`ExchangeSpan`](#exchangespan)

***

### currentTraceMeta()

> **currentTraceMeta**(): [`TraceMeta`](#tracemeta)

Read the currently-active OpenTelemetry trace context + baggage and serialise them into
SEP-414 `_meta` keys. No-op (empty object) when no OTel SDK is registered, so callers
pay nothing when tracing is off.

#### Returns

[`TraceMeta`](#tracemeta)

***

### endSpanError()

> **endSpanError**(`span`, `errorType`, `message?`): `void`

#### Parameters

##### span

`Span`

##### errorType

`string`

##### message?

`string`

#### Returns

`void`

***

### errorTypeOf()

> **errorTypeOf**(`error`): `string`

`error.type` of a thrown value: aborts are `cancelled`, errors with a specific name keep it,
everything else is `_OTHER`.

#### Parameters

##### error

`unknown`

#### Returns

`string`

***

### getMokeiMeter()

> **getMokeiMeter**(`scope`): `Meter`

#### Parameters

##### scope

`string`

#### Returns

`Meter`

***

### getMokeiTracer()

> **getMokeiTracer**(`scope`): `Tracer`

#### Parameters

##### scope

`string`

#### Returns

`Tracer`

***

### isInputRequiredResult()

> **isInputRequiredResult**(`value`): `value is InputRequiredResult`

A discriminator check, not a validator: the wire schema has already enforced the shape by the
time a result reaches here, and re-validating would duplicate that in a second place.

#### Parameters

##### value

`unknown`

#### Returns

`value is InputRequiredResult`

***

### mcpMetricsEnabled()

> **mcpMetricsEnabled**(): `boolean`

False while no MeterProvider is registered; callers skip building attributes then.

#### Returns

`boolean`

***

### metricAttributes()

> **metricAttributes**(`spanAttributes`): `Attributes`

Keep only low-cardinality attributes; ids, URIs and `mokei.*` keys never reach metrics.

#### Parameters

##### spanAttributes

`Attributes`

#### Returns

`Attributes`

***

### recordMCPOperation()

> **recordMCPOperation**(`params`): `void`

#### Parameters

##### params

###### attributes

`Attributes`

###### durationS

`number`

###### side

`"client"` \| `"server"`

#### Returns

`void`

***

### recordMCPSession()

> **recordMCPSession**(`params`): `void`

#### Parameters

##### params

###### attributes

`Attributes`

###### durationS

`number`

#### Returns

`void`

***

### redactCommandArgs()

> **redactCommandArgs**(`args`): `string`[]

#### Parameters

##### args

`string`[]

#### Returns

`string`[]

***

### redactPayload()

> **redactPayload**(`value`): `unknown`

#### Parameters

##### value

`unknown`

#### Returns

`unknown`

***

### requestAttributes()

> **requestAttributes**(`params`): `Attributes`

#### Parameters

##### params

###### capture?

[`PayloadCapture`](#payloadcapture)

###### contextID?

`string`

###### deferOperationName?

`boolean`

Leave `gen_ai.operation.name` to `settleAttributes`: a suspended round is not a tool execution.

###### direction

[`MessageDirection`](#messagedirection)

###### id?

`string` \| `number`

###### method

`string`

###### network?

[`NetworkInfo`](#networkinfo)

###### params?

`unknown`

###### protocolVersion?

`string`

###### sessionID?

`string`

###### traceAttributes?

`Attributes`

#### Returns

`Attributes`

***

### requestSpanName()

> **requestSpanName**(`method`, `params?`): `string`

#### Parameters

##### method

`string`

##### params?

`unknown`

#### Returns

`string`

***

### resolveContentCapture()

> **resolveContentCapture**(`payloads`): [`PayloadCapture`](#payloadcapture)

Env opt-in only applies when `payloads` is unset or `'off'`; Node-free env access.

#### Parameters

##### payloads

[`PayloadCapture`](#payloadcapture) \| `undefined`

#### Returns

[`PayloadCapture`](#payloadcapture)

***

### resolvePayloadCap()

> **resolvePayloadCap**(`capture`): `number` \| `null`

#### Parameters

##### capture

[`PayloadCapture`](#payloadcapture) \| `undefined`

#### Returns

`number` \| `null`

***

### responseAttributes()

> **responseAttributes**(`method`, `result`, `capture`): `Attributes`

#### Parameters

##### method

`string`

##### result

`unknown`

##### capture

[`PayloadCapture`](#payloadcapture) \| `undefined`

#### Returns

`Attributes`

***

### responseOutcome()

> **responseOutcome**(`message`, `side`): \{ `error`: `false`; `statusCode?`: `string`; \} \| \{ `error`: `true`; `errorType`: `string`; `message?`: `string`; `statusCode?`: `string`; \}

#### Parameters

##### message

###### error?

\{ `code`: `number`; `message?`: `string`; \}

###### error.code

`number`

###### error.message?

`string`

###### result?

`unknown`

##### side

[`MessageDirection`](#messagedirection)

#### Returns

\{ `error`: `false`; `statusCode?`: `string`; \} \| \{ `error`: `true`; `errorType`: `string`; `message?`: `string`; `statusCode?`: `string`; \}

***

### sanitizeMessage()

> **sanitizeMessage**(`message`, `capture`): `unknown`

#### Parameters

##### message

`unknown`

##### capture

[`PayloadCapture`](#payloadcapture) \| `undefined`

#### Returns

`unknown`

***

### settleAttributes()

> **settleAttributes**(`params`): `Attributes`

Attributes set when an exchange settles: only a `tools/call` that does not suspend is an
`execute_tool`, and MRTR rounds carry their 0-based index.

#### Parameters

##### params

###### inputRequired

`boolean`

###### method

`string`

###### round?

`number`

#### Returns

`Attributes`

***

### splitListOptions()

> **splitListOptions**\<`Params`\>(`params`): \[`Params`, [`RequestOptions`](../context-rpc/index.md#requestoptions) & `object`\]

Splits a list method's parameters into the params sent on the wire and the options kept
local to this process.

The counterpart to `splitRequestOptions` for the paginated methods, which carry one
local-only option it does not know about: `maxPages`. Any paginated method must split
here rather than there, or the cap is serialised into the request sent to the peer.

#### Type Parameters

##### Params

`Params`

#### Parameters

##### params

[`ListParams`](#listparams)\<`Params`\>

#### Returns

\[`Params`, [`RequestOptions`](../context-rpc/index.md#requestoptions) & `object`\]

***

### traceMetaFromContext()

> **traceMetaFromContext**(`context`, `tracestate?`): [`TraceMeta`](#tracemeta)

Build the SEP-414 trace `_meta` keys from a trace context and optional serialised
tracestate. Pure: no global reads, so it is fully unit-testable. Returns an empty
object when there is no context to propagate.

#### Parameters

##### context

`TraceContext` \| `undefined`

##### tracestate?

`string`

#### Returns

[`TraceMeta`](#tracemeta)
