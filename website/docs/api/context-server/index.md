# @mokei/context-server

Mokei MCP server.

## Installation

```sh
npm install @mokei/context-server
```

## Classes

### ContextServer

Message ordering:
- notifications and responses are handled in wire order, synchronously in the read loop;
- requests *start* in wire order and complete out of order;
- a request never delays a notification -- which is what lets `notifications/cancelled`
  reach a handler that is still running.

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

> **get** **clientInitialize**(): \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `capabilities`: \{\[`key`: `string`\]: `unknown`; `elicitation?`: \{\[`key`: `string`\]: `unknown`; \}; `experimental?`: \{\[`key`: `string`\]: `object`; \}; `extensions?`: \{\[`key`: `string`\]: `object`; \}; `roots?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; \}; `sampling?`: \{\[`key`: `string`\]: `unknown`; `tools?`: \{\[`key`: `string`\]: `unknown`; \}; \}; \}; `clientInfo`: \{\[`key`: `string`\]: `unknown`; `description?`: `string`; `icons?`: `object`[]; `name`: `string`; `title?`: `string`; `version`: `string`; `websiteUrl?`: `string`; \}; `protocolVersion`: `string`; \} \| `undefined`

###### Returns

\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `capabilities`: \{\[`key`: `string`\]: `unknown`; `elicitation?`: \{\[`key`: `string`\]: `unknown`; \}; `experimental?`: \{\[`key`: `string`\]: `object`; \}; `extensions?`: \{\[`key`: `string`\]: `object`; \}; `roots?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; \}; `sampling?`: \{\[`key`: `string`\]: `unknown`; `tools?`: \{\[`key`: `string`\]: `unknown`; \}; \}; \}; `clientInfo`: \{\[`key`: `string`\]: `unknown`; `description?`: `string`; `icons?`: `object`[]; `name`: `string`; `title?`: `string`; `version`: `string`; `websiteUrl?`: `string`; \}; `protocolVersion`: `string`; \} \| `undefined`

##### events

###### Get Signature

> **get** **events**(): `EventEmitter`\<`T`\[`"Events"`\]\>

###### Returns

`EventEmitter`\<`T`\[`"Events"`\]\>

###### Inherited from

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`events`](../context-rpc/index.md#events)

#### Methods

##### \_beforeTransportClose()

> **\_beforeTransportClose**(`_reason`): `Promise`\<`void`\>

On an explicit `dispose()`, before the transport closes: if this server owns its subscription
hub, resolve every held `subscriptions/listen` terminal (their writes are then awaited by the
RPC layer's held-response flush) and release the hub. A borrower does neither -- the hub's
owner drives graceful teardown.

###### Parameters

###### \_reason

`Error`

###### Returns

`Promise`\<`void`\>

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

[`ClientMessage`](../context-protocol/index.md#clientmessage)

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

> **\_handleRequest**(`request`, `signal`): `Promise`\<[`ServerResult`](../context-protocol/index.md#serverresult) \| [`HeldResponse`](../context-rpc/index.md#heldresponse)\<[`ServerResult`](../context-protocol/index.md#serverresult)\>\>

###### Parameters

###### request

[`ClientRequest`](../context-protocol/index.md#clientrequest)

###### signal

`AbortSignal`

###### Returns

`Promise`\<[`ServerResult`](../context-protocol/index.md#serverresult) \| [`HeldResponse`](../context-rpc/index.md#heldresponse)\<[`ServerResult`](../context-protocol/index.md#serverresult)\>\>

###### Overrides

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`_handleRequest`](../context-rpc/index.md#_handlerequest)

##### \_read()

> **\_read**(): `Promise`\<`ReadableStreamReadResult`\<[`ClientMessage`](../context-protocol/index.md#clientmessage)\>\>

###### Returns

`Promise`\<`ReadableStreamReadResult`\<[`ClientMessage`](../context-protocol/index.md#clientmessage)\>\>

###### Inherited from

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`_read`](../context-rpc/index.md#_read)

##### \_write()

> **\_write**(`message`): `Promise`\<`void`\>

###### Parameters

###### message

[`ServerMessage`](../context-protocol/index.md#servermessage-1)

###### Returns

`Promise`\<`void`\>

###### Inherited from

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`_write`](../context-rpc/index.md#_write)

##### createMessage()

> **createMessage**(`params`): `Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \}; `model`: `string`; `role`: `"assistant"` \| `"user"`; `stopReason?`: `string`; \}\>

###### Parameters

###### params

[`WithRequestOptions`](../context-rpc/index.md#withrequestoptions)\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `includeContext?`: `"allServers"` \| `"none"` \| `"thisServer"`; `maxTokens`: `number`; `messages`: `object`[]; `metadata?`: \{\[`key`: `string`\]: `unknown`; \}; `modelPreferences?`: \{\[`key`: `string`\]: `unknown`; `costPriority?`: `number`; `hints?`: `object`[]; `intelligencePriority?`: `number`; `speedPriority?`: `number`; \}; `stopSequences?`: `string`[]; `systemPrompt?`: `string`; `temperature?`: `number`; `toolChoice?`: \{\[`key`: `string`\]: `unknown`; `mode`: `"required"` \| `"none"` \| `"auto"`; \}; `tools?`: `object`[]; \}\>

###### Returns

`Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \}; `model`: `string`; `role`: `"assistant"` \| `"user"`; `stopReason?`: `string`; \}\>

##### elicit()

> **elicit**(`params`): `Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `action`: `"accept"` \| `"cancel"` \| `"decline"`; `content?`: \{\[`key`: `string`\]: `string` \| `number` \| `boolean` \| `string`[]; \}; \}\>

###### Parameters

###### params

[`WithRequestOptions`](../context-rpc/index.md#withrequestoptions)\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `message`: `string`; `mode?`: `"form"`; `requestedSchema`: \{\[`key`: `string`\]: `unknown`; `properties`: \{\[`key`: `string`\]: \{\[`key`: `string`\]: `unknown`; `default?`: `string`; `description?`: `string`; `format?`: `"uri"` \| `"date-time"` \| `"date"` \| `"email"`; `maxLength?`: `number`; `minLength?`: `number`; `pattern?`: `string`; `title?`: `string`; `type`: `"string"`; \} \| \{\[`key`: `string`\]: `unknown`; `default?`: `number`; `description?`: `string`; `maximum?`: `number`; `minimum?`: `number`; `title?`: `string`; `type`: `"number"` \| `"integer"`; \} \| \{\[`key`: `string`\]: `unknown`; `default?`: `boolean`; `description?`: `string`; `title?`: `string`; `type`: `"boolean"`; \} \| \{\[`key`: `string`\]: `unknown`; `default?`: `string`; `description?`: `string`; `enum?`: `string`[]; `enumNames?`: `string`[]; `oneOf?`: `object`[]; `title?`: `string`; `type`: `"string"`; \} \| \{\[`key`: `string`\]: `unknown`; `default?`: `string`[]; `description?`: `string`; `items`: \{\[`key`: `string`\]: `unknown`; `enum`: `string`[]; `enumNames?`: ...[]; `type`: `"string"`; \} \| \{\[`key`: `string`\]: `unknown`; `anyOf`: `object`[]; \}; `title?`: `string`; `type`: `"array"`; \}; \}; `required?`: `string`[]; `type`: `"object"`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `progressToken?`: `string` \| `number`; \}; `elicitationId`: `string`; `message`: `string`; `mode`: `"url"`; `url`: `string`; \}\>

###### Returns

`Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `action`: `"accept"` \| `"cancel"` \| `"decline"`; `content?`: \{\[`key`: `string`\]: `string` \| `number` \| `boolean` \| `string`[]; \}; \}\>

##### listRoots()

> **listRoots**(`params?`): `Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `roots`: `object`[]; \}\>

###### Parameters

###### params?

`object` & [`RequestOptions`](../context-rpc/index.md#requestoptions) = `{}`

###### Returns

`Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `roots`: `object`[]; \}\>

##### log()

> **log**(`params`): `void`

Session-scoped log: delivered when the client opted in through `logging/setLevel`
(`2025-11-25`). Also the `log` a handler gets on any revision where `isPerRequestLogLevel`
is `false`.

###### Parameters

###### params

[`LogParams`](#logparams)

###### Returns

`void`

##### notify()

> **notify**\<`Event`\>(`event`, `params`): `Promise`\<`void`\>

###### Type Parameters

###### Event

`Event` *extends* `"progress"` \| `"tasks"` \| `"prompts/list_changed"` \| `"resources/list_changed"` \| `"tools/list_changed"`

###### Parameters

###### event

`Event`

###### params

[`ServerNotifications`](../context-protocol/index.md#servernotifications) & `Pick`\<[`CommonNotifications`](../context-protocol/index.md#commonnotifications), `"progress"`\>\[`Event`\]\[`"params"`\]

###### Returns

`Promise`\<`void`\>

###### Inherited from

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`notify`](../context-rpc/index.md#notify)

##### request()

> **request**\<`Method`\>(`method`, `params`, `options?`): `Promise`\<[`ServerRequests`](../context-protocol/index.md#serverrequests)\[`Method`\]\[`"Result"`\]\>

###### Type Parameters

###### Method

`Method` *extends* keyof [`ServerRequests`](../context-protocol/index.md#serverrequests)

###### Parameters

###### method

`Method`

###### params

[`ServerRequests`](../context-protocol/index.md#serverrequests)\[`Method`\]\[`"Params"`\]

###### options?

[`RequestOptions`](../context-rpc/index.md#requestoptions)

###### Returns

`Promise`\<[`ServerRequests`](../context-protocol/index.md#serverrequests)\[`Method`\]\[`"Result"`\]\>

###### Inherited from

[`ContextRPC`](../context-rpc/index.md#contextrpc).[`request`](../context-rpc/index.md#request)

***

### InputRequestWithdrawnError

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new InputRequestWithdrawnError**(`params`): [`InputRequestWithdrawnError`](#inputrequestwithdrawnerror)

###### Parameters

###### params

###### id

`number`

###### taskID

`string`

###### Returns

[`InputRequestWithdrawnError`](#inputrequestwithdrawnerror)

###### Overrides

`Error.constructor`

#### Accessors

##### id

###### Get Signature

> **get** **id**(): `number`

###### Returns

`number`

##### taskID

###### Get Signature

> **get** **taskID**(): `string`

###### Returns

`string`

***

### MissingRequiredClientCapabilityError

Thrown when a handler suspends on an input request whose capability the client never declared.
Answered on the wire as `-32021`, carrying the missing capabilities in `data`.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new MissingRequiredClientCapabilityError**(`params`): [`MissingRequiredClientCapabilityError`](#missingrequiredclientcapabilityerror)

###### Parameters

###### params

[`MissingRequiredClientCapabilityErrorParams`](#missingrequiredclientcapabilityerrorparams)

###### Returns

[`MissingRequiredClientCapabilityError`](#missingrequiredclientcapabilityerror)

###### Overrides

`Error.constructor`

#### Accessors

##### requiredCapabilities

###### Get Signature

> **get** **requiredCapabilities**(): `Record`\<`string`, `Record`\<`string`, `never`\>\>

###### Returns

`Record`\<`string`, `Record`\<`string`, `never`\>\>

***

### MRTRNotSupportedError

Thrown when a handler reaches for a client capability that this revision routes through MRTR.

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

### SubscriptionBackpressureError

Thrown -- and handed to `onFailure`/`sink.close()` -- when a `SubscriptionWriter`'s queue would
grow past `maxPendingFrames`: the subscriber isn't draining notifications fast enough to keep
up with the stream.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new SubscriptionBackpressureError**(`params`): [`SubscriptionBackpressureError`](#subscriptionbackpressureerror)

###### Parameters

###### params

[`SubscriptionBackpressureErrorParams`](#subscriptionbackpressureerrorparams)

###### Returns

[`SubscriptionBackpressureError`](#subscriptionbackpressureerror)

###### Overrides

`Error.constructor`

***

### SubscriptionWriter

Serializes notification delivery to one `SubscriptionSink`.

Frames handed to `enqueue()` are written one at a time, strictly in the order they were
enqueued, and never concurrently -- the next `writeNotification()` call is only made once the
previous one has settled. Each `enqueue()` call's returned promise settles when *that specific*
frame's `writeNotification()` settles, not when some later frame is written.

Delivery is bounded by `maxPendingFrames`: a queue deeper than that means the subscriber isn't
draining fast enough, so the writer stops accepting further frames, reports a
`SubscriptionBackpressureError` through `onFailure`, and closes the sink.

A real `writeNotification()` rejection is fatal too: the sink itself is broken, so the writer
stops draining, reports the rejection through `onFailure`, and closes the sink -- the same
path as backpressure, rather than silently looping forever against a dead sink.

#### Constructors

##### Constructor

> **new SubscriptionWriter**(`params`): [`SubscriptionWriter`](#subscriptionwriter)

###### Parameters

###### params

[`SubscriptionWriterParams`](#subscriptionwriterparams)

###### Returns

[`SubscriptionWriter`](#subscriptionwriter)

#### Methods

##### abort()

> **abort**(`reason`): `void`

Stops the writer: no further frame is accepted, and any frame still waiting in the queue
(not yet handed to the sink) rejects with `reason`. A frame already in flight finishes its
`writeNotification()` call undisturbed -- it cannot be un-sent.

Unlike backpressure, an explicit `abort()` does not call `onFailure` or `sink.close()`: the
caller already knows why it stopped the writer and owns the sink's lifecycle.

###### Parameters

###### reason

`Error`

###### Returns

`void`

##### enqueue()

> **enqueue**(`notification`): `Promise`\<`void`\>

Queues `notification` for delivery. Resolves once *this* frame's `writeNotification()` call
resolves, rejects if it rejects -- never settles early because a later frame was written.

Rejects immediately, without touching the sink, once the writer has failed (backpressure or
`abort()`): callers stop being able to enqueue past that point.

###### Parameters

###### notification

[`ServerNotification`](../context-protocol/index.md#servernotification)

###### Returns

`Promise`\<`void`\>

##### flush()

> **flush**(): `Promise`\<`void`\>

Resolves once every frame accepted so far has settled -- the queue is fully drained.

###### Returns

`Promise`\<`void`\>

***

### TaskInputKeyReusedError

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new TaskInputKeyReusedError**(`key`): [`TaskInputKeyReusedError`](#taskinputkeyreusederror)

###### Parameters

###### key

`string`

###### Returns

[`TaskInputKeyReusedError`](#taskinputkeyreusederror)

###### Overrides

`Error.constructor`

***

### TaskManagerDisposedError

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new TaskManagerDisposedError**(): [`TaskManagerDisposedError`](#taskmanagerdisposederror)

###### Returns

[`TaskManagerDisposedError`](#taskmanagerdisposederror)

###### Overrides

`Error.constructor`

***

### TaskStoreConflictError

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new TaskStoreConflictError**(): [`TaskStoreConflictError`](#taskstoreconflicterror)

###### Returns

[`TaskStoreConflictError`](#taskstoreconflicterror)

###### Overrides

`Error.constructor`

***

### ToolInputValidationError

#### Extends

- [`RPCError`](../context-rpc/index.md#rpcerror)

#### Constructors

##### Constructor

> **new ToolInputValidationError**(`data`): [`ToolInputValidationError`](#toolinputvalidationerror)

###### Parameters

###### data

`unknown`

###### Returns

[`ToolInputValidationError`](#toolinputvalidationerror)

###### Overrides

[`RPCError`](../context-rpc/index.md#rpcerror).[`constructor`](../context-rpc/index.md#constructor-2)

#### Accessors

##### code

###### Get Signature

> **get** **code**(): `number`

###### Returns

`number`

###### Inherited from

[`RPCError`](../context-rpc/index.md#rpcerror).[`code`](../context-rpc/index.md#code)

##### data

###### Get Signature

> **get** **data**(): `unknown`

###### Returns

`unknown`

###### Inherited from

[`RPCError`](../context-rpc/index.md#rpcerror).[`data`](../context-rpc/index.md#data)

##### isInternal

###### Get Signature

> **get** **isInternal**(): `boolean`

###### Returns

`boolean`

###### Inherited from

[`RPCError`](../context-rpc/index.md#rpcerror).[`isInternal`](../context-rpc/index.md#isinternal)

##### isInvalidParams

###### Get Signature

> **get** **isInvalidParams**(): `boolean`

###### Returns

`boolean`

###### Inherited from

[`RPCError`](../context-rpc/index.md#rpcerror).[`isInvalidParams`](../context-rpc/index.md#isinvalidparams)

##### isInvalidRequest

###### Get Signature

> **get** **isInvalidRequest**(): `boolean`

###### Returns

`boolean`

###### Inherited from

[`RPCError`](../context-rpc/index.md#rpcerror).[`isInvalidRequest`](../context-rpc/index.md#isinvalidrequest)

##### isMethodNotFound

###### Get Signature

> **get** **isMethodNotFound**(): `boolean`

###### Returns

`boolean`

###### Inherited from

[`RPCError`](../context-rpc/index.md#rpcerror).[`isMethodNotFound`](../context-rpc/index.md#ismethodnotfound)

#### Methods

##### toResponse()

> **toResponse**(`id`): `object`

###### Parameters

###### id

`string` \| `number`

###### Returns

`object`

###### error

> **error**: `object`

###### Index Signature

\[`key`: `string`\]: `unknown`

###### error.code

> **code**: `number`

###### error.data?

> `optional` **data?**: `unknown`

###### error.message

> **message**: `string`

###### id

> **id**: `string` \| `number`

###### jsonrpc

> **jsonrpc**: `"2.0"`

###### Inherited from

[`RPCError`](../context-rpc/index.md#rpcerror).[`toResponse`](../context-rpc/index.md#toresponse)

##### fromResponse()

> `static` **fromResponse**(`response`): [`RPCError`](../context-rpc/index.md#rpcerror)

###### Parameters

###### response

###### error

\{\[`key`: `string`\]: `unknown`; `code`: `number`; `data?`: `unknown`; `message`: `string`; \}

###### error.code

`number`

###### error.data?

`unknown`

###### error.message

`string`

###### id

`string` \| `number`

###### jsonrpc

`"2.0"`

###### Returns

[`RPCError`](../context-rpc/index.md#rpcerror)

###### Inherited from

[`RPCError`](../context-rpc/index.md#rpcerror).[`fromResponse`](../context-rpc/index.md#fromresponse)

***

### ToolOutputValidationError

A tool handler's `structuredContent` violated (or was absent against) its
declared `outputSchema`. This is the server author's own contract breach, not
a tool telling the model it failed, so `ContextServer` lets it cross the wire
as a JSON-RPC error rather than converting it to an `isError` result.

#### Extends

- [`RPCError`](../context-rpc/index.md#rpcerror)

#### Constructors

##### Constructor

> **new ToolOutputValidationError**(`params`): [`ToolOutputValidationError`](#tooloutputvalidationerror)

###### Parameters

###### params

[`RPCErrorParams`](../context-rpc/index.md#rpcerrorparams)

###### Returns

[`ToolOutputValidationError`](#tooloutputvalidationerror)

###### Inherited from

[`RPCError`](../context-rpc/index.md#rpcerror).[`constructor`](../context-rpc/index.md#constructor-2)

#### Accessors

##### code

###### Get Signature

> **get** **code**(): `number`

###### Returns

`number`

###### Inherited from

[`RPCError`](../context-rpc/index.md#rpcerror).[`code`](../context-rpc/index.md#code)

##### data

###### Get Signature

> **get** **data**(): `unknown`

###### Returns

`unknown`

###### Inherited from

[`RPCError`](../context-rpc/index.md#rpcerror).[`data`](../context-rpc/index.md#data)

##### isInternal

###### Get Signature

> **get** **isInternal**(): `boolean`

###### Returns

`boolean`

###### Inherited from

[`RPCError`](../context-rpc/index.md#rpcerror).[`isInternal`](../context-rpc/index.md#isinternal)

##### isInvalidParams

###### Get Signature

> **get** **isInvalidParams**(): `boolean`

###### Returns

`boolean`

###### Inherited from

[`RPCError`](../context-rpc/index.md#rpcerror).[`isInvalidParams`](../context-rpc/index.md#isinvalidparams)

##### isInvalidRequest

###### Get Signature

> **get** **isInvalidRequest**(): `boolean`

###### Returns

`boolean`

###### Inherited from

[`RPCError`](../context-rpc/index.md#rpcerror).[`isInvalidRequest`](../context-rpc/index.md#isinvalidrequest)

##### isMethodNotFound

###### Get Signature

> **get** **isMethodNotFound**(): `boolean`

###### Returns

`boolean`

###### Inherited from

[`RPCError`](../context-rpc/index.md#rpcerror).[`isMethodNotFound`](../context-rpc/index.md#ismethodnotfound)

#### Methods

##### toResponse()

> **toResponse**(`id`): `object`

###### Parameters

###### id

`string` \| `number`

###### Returns

`object`

###### error

> **error**: `object`

###### Index Signature

\[`key`: `string`\]: `unknown`

###### error.code

> **code**: `number`

###### error.data?

> `optional` **data?**: `unknown`

###### error.message

> **message**: `string`

###### id

> **id**: `string` \| `number`

###### jsonrpc

> **jsonrpc**: `"2.0"`

###### Inherited from

[`RPCError`](../context-rpc/index.md#rpcerror).[`toResponse`](../context-rpc/index.md#toresponse)

##### fromResponse()

> `static` **fromResponse**(`response`): [`RPCError`](../context-rpc/index.md#rpcerror)

###### Parameters

###### response

###### error

\{\[`key`: `string`\]: `unknown`; `code`: `number`; `data?`: `unknown`; `message`: `string`; \}

###### error.code

`number`

###### error.data?

`unknown`

###### error.message

`string`

###### id

`string` \| `number`

###### jsonrpc

`"2.0"`

###### Returns

[`RPCError`](../context-rpc/index.md#rpcerror)

###### Inherited from

[`RPCError`](../context-rpc/index.md#rpcerror).[`fromResponse`](../context-rpc/index.md#fromresponse)

## Type Aliases

### ClientInitialize

> **ClientInitialize** = [`InitializeRequest`](../context-protocol/index.md#initializerequest)\[`"params"`\]

***

### CompleteHandler

> **CompleteHandler** = (`request`) => [`CompleteResult`](../context-protocol/index.md#completeresult) \| `Promise`\<[`CompleteResult`](../context-protocol/index.md#completeresult)\>

#### Parameters

##### request

[`HandlerRequest`](#handlerrequest)\<\{ `params`: [`CompleteRequest`](../context-protocol/index.md#completerequest)\[`"params"`\]; \}\>

#### Returns

[`CompleteResult`](../context-protocol/index.md#completeresult) \| `Promise`\<[`CompleteResult`](../context-protocol/index.md#completeresult)\>

***

### CreatePromptParams

> **CreatePromptParams**\<`ArgumentsSchema`, `Arguments`\> = `object`

#### Type Parameters

##### ArgumentsSchema

`ArgumentsSchema` *extends* `Schema`

##### Arguments

`Arguments` = `FromSchema`\<`ArgumentsSchema`\>

#### Properties

##### argumentsSchema?

> `optional` **argumentsSchema?**: `ArgumentsSchema`

##### description

> **description**: `string`

##### handler

> **handler**: [`TypedPromptHandler`](#typedprompthandler)\<`Arguments`\>

***

### CreateSubscriptionHubParams

> **CreateSubscriptionHubParams** = `object`

#### Properties

##### events

> **events**: `EventsSource`\<[`ServerEvents`](#serverevents)\>

##### tasks?

> `optional` **tasks?**: [`TaskManager`](#taskmanager)

***

### CreateToolParams

> **CreateToolParams**\<`InputSchema`, `OutputSchema`, `Arguments`, `Output`\> = `object`

#### Type Parameters

##### InputSchema

`InputSchema` *extends* `Schema`

##### OutputSchema

`OutputSchema` *extends* `Schema` \| `undefined` = `undefined`

##### Arguments

`Arguments` = `FromSchema`\<`InputSchema`\>

##### Output

`Output` = `OutputSchema` *extends* `Schema` ? `FromSchema`\<`OutputSchema`\> : `unknown`

#### Properties

##### description

> **description**: `string`

##### handler

> **handler**: [`TypedToolHandler`](#typedtoolhandler)\<`Arguments`, `Output`\>

##### inputSchema

> **inputSchema**: `InputSchema`

##### outputSchema?

> `optional` **outputSchema?**: `OutputSchema`

***

### ExtractPromptTypes

> **ExtractPromptTypes**\<`T`\> = `{ [K in keyof T]: ExtractArguments<T[K]> }`

Extract TypeScript types from prompt definitions for type-safe client usage.

#### Type Parameters

##### T

`T` *extends* [`PromptDefinitions`](#promptdefinitions)

#### Example

```typescript
const prompts = {
  myPrompt: createPrompt({
    description: 'Description',
    argumentsSchema: { type: 'object', properties: { name: { type: 'string' } } } as const,
    handler,
  })
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
const client = new ContextClient<MyServerTypes>({ protocolVersion: '2025-11-25', transport })
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

> **ExtractToolTypes**\<`T`\> = `{ [K in keyof T]: ExtractArguments<T[K]> }`

Extract TypeScript types from tool definitions for type-safe client usage.

#### Type Parameters

##### T

`T` *extends* [`ToolDefinitions`](#tooldefinitions)

#### Example

```typescript
const tools = {
  myTool: createTool({
    description: 'Description',
    inputSchema: { type: 'object', properties: { foo: { type: 'string' } } } as const,
    handler,
  })
} satisfies ToolDefinitions

type MyTools = ExtractToolTypes<typeof tools>
// Result: { myTool: { foo: string } }
```

***

### GenericPromptDefinition

> **GenericPromptDefinition** = `object`

#### Properties

##### argumentsSchema?

> `optional` **argumentsSchema?**: `Schema`

##### description

> **description**: `string`

##### handler

> **handler**: [`GenericPromptHandler`](#genericprompthandler)

***

### GenericPromptHandler

> **GenericPromptHandler** = (`request`) => [`PromptHandlerReturn`](#prompthandlerreturn)

#### Parameters

##### request

[`HandlerRequest`](#handlerrequest)\<\{ `input`: `unknown`; \}\>

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

##### outputSchema?

> `optional` **outputSchema?**: [`OutputSchema`](../context-protocol/index.md#outputschema)

***

### GenericToolHandler

> **GenericToolHandler** = (`request`) => [`ToolHandlerReturn`](#toolhandlerreturn)

#### Parameters

##### request

[`HandlerRequest`](#handlerrequest)\<\{ `input`: `Record`\<`string`, `unknown`\>; \}\>

#### Returns

[`ToolHandlerReturn`](#toolhandlerreturn)

***

### HandlerRequest

> **HandlerRequest**\<`C`\> = `C` & `object`

#### Type Parameters

##### C

`C` *extends* `Record`\<`string`, `unknown`\> = `Record`\<`string`, `never`\>

#### Type Declaration

##### auth?

> `optional` **auth?**: [`TaskOwner`](#taskowner)

##### client

> **client**: [`ServerClient`](#serverclient)

##### inputResponses?

> `optional` **inputResponses?**: `Record`\<`string`, [`InputResponse`](../context-protocol/index.md#inputresponse)\>

Results for the input requests this handler asked for on a previous round (MRTR, SEP-2322),
keyed as the handler keyed its own `inputRequests`. Absent on the first round and on
`2025-11-25`, which has no MRTR.

##### meta

> **meta**: `Record`\<`string`, [`JSONValue`](#jsonvalue)\>

##### mintRequestState

> **mintRequestState**: (`payload`) => `string`

Encodes a payload into the opaque `requestState` string to send with an `inputRequired()`.

###### Parameters

###### payload

`unknown`

###### Returns

`string`

##### progress?

> `optional` **progress?**: [`ProgressEmitter`](#progressemitter)

##### requestState?

> `optional` **requestState?**: `unknown`

The state this handler minted on a previous round, echoed back by the client.

The decoded payload when the server is configured with a `requestState.verify` hook; the raw
string otherwise, in which case it is UNTRUSTED -- it round-tripped through the client and any
caller can forge it. Configure the hook before letting it influence authorisation.

##### signal

> **signal**: `AbortSignal`

##### task?

> `optional` **task?**: [`TaskContext`](#taskcontext)

***

### InputRecord

> **InputRecord** = `object`

One input request a task made, kept for the task's lifetime.

#### Properties

##### id

> **id**: `number`

Increments per request on this task, starting at 1.

##### outcome?

> `optional` **outcome?**: `"answered"` \| `"withdrawn"`

Absent while the request is open. A settled entry never changes again.

##### requests

> **requests**: `Record`\<`string`, [`InputRequest`](../context-protocol/index.md#inputrequest)\>

##### responses

> **responses**: `Record`\<`string`, [`InputResponse`](../context-protocol/index.md#inputresponse)\>

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

### JSONValue

> **JSONValue** = `null` \| `boolean` \| `number` \| `string` \| [`JSONValue`](#jsonvalue)[] \| \{\[`key`: `string`\]: [`JSONValue`](#jsonvalue); \}

***

### ListResourcesHandler

> **ListResourcesHandler** = (`request`) => [`ListResourcesResult`](../context-protocol/index.md#listresourcesresult) \| `Promise`\<[`ListResourcesResult`](../context-protocol/index.md#listresourcesresult)\>

#### Parameters

##### request

[`HandlerRequest`](#handlerrequest)\<\{ `params`: [`ListResourcesRequest`](../context-protocol/index.md#listresourcesrequest)\[`"params"`\]; \}\>

#### Returns

[`ListResourcesResult`](../context-protocol/index.md#listresourcesresult) \| `Promise`\<[`ListResourcesResult`](../context-protocol/index.md#listresourcesresult)\>

***

### ListResourceTemplatesHandler

> **ListResourceTemplatesHandler** = (`request`) => [`ListResourceTemplatesResult`](../context-protocol/index.md#listresourcetemplatesresult) \| `Promise`\<[`ListResourceTemplatesResult`](../context-protocol/index.md#listresourcetemplatesresult)\>

#### Parameters

##### request

[`HandlerRequest`](#handlerrequest)\<\{ `params`: [`ListResourceTemplatesRequest`](../context-protocol/index.md#listresourcetemplatesrequest)\[`"params"`\]; \}\>

#### Returns

[`ListResourceTemplatesResult`](../context-protocol/index.md#listresourcetemplatesresult) \| `Promise`\<[`ListResourceTemplatesResult`](../context-protocol/index.md#listresourcetemplatesresult)\>

***

### LogFunction

> **LogFunction** = (`params`) => `void`

#### Parameters

##### params

[`LogParams`](#logparams)

#### Returns

`void`

***

### LogParams

> **LogParams** = `object`

#### Properties

##### data

> **data**: `unknown`

##### level

> **level**: [`LoggingLevel`](../context-protocol/index.md#logginglevel)

##### logger?

> `optional` **logger?**: `string`

***

### MissingRequiredClientCapabilityErrorParams

> **MissingRequiredClientCapabilityErrorParams** = `object`

#### Properties

##### cause?

> `optional` **cause?**: `unknown`

##### key

> **key**: `string`

##### method

> **method**: `string`

##### requiredCapabilities

> **requiredCapabilities**: `Record`\<`string`, `Record`\<`string`, `never`\>\>

***

### MRTRNotSupportedErrorParams

> **MRTRNotSupportedErrorParams** = `object`

#### Properties

##### cause?

> `optional` **cause?**: `unknown`

##### method

> **method**: `string`

##### version

> **version**: [`ProtocolVersion`](../context-protocol/index.md#protocolversion)

***

### ProgressEmitter

> **ProgressEmitter** = (`params`) => `void`

#### Parameters

##### params

###### message?

`string`

###### progress

`number`

###### total?

`number`

#### Returns

`void`

***

### PromptDefinition

> **PromptDefinition**\<`Arguments`\> = [`GenericPromptDefinition`](#genericpromptdefinition) & `object`

What `createPrompt` returns: a runtime `GenericPromptDefinition` carrying a phantom witness
of the argument type its `argumentsSchema` describes. See [ToolDefinition](#tooldefinition).

#### Type Parameters

##### Arguments

`Arguments` = `Record`\<`string`, `unknown`\>

***

### PromptDefinitions

> **PromptDefinitions** = `Record`\<`string`, [`GenericPromptDefinition`](#genericpromptdefinition)\>

***

### PromptHandlerReturn

> **PromptHandlerReturn** = [`GetPromptResult`](../context-protocol/index.md#getpromptresult) \| [`InputRequiredResult`](#inputrequiredresult) \| `Promise`\<[`GetPromptResult`](../context-protocol/index.md#getpromptresult) \| [`InputRequiredResult`](#inputrequiredresult)\>

***

### ReadResourceHandler

> **ReadResourceHandler** = (`request`) => [`ReadResourceResult`](../context-protocol/index.md#readresourceresult) \| [`InputRequiredResult`](#inputrequiredresult) \| `Promise`\<[`ReadResourceResult`](../context-protocol/index.md#readresourceresult) \| [`InputRequiredResult`](#inputrequiredresult)\>

#### Parameters

##### request

[`HandlerRequest`](#handlerrequest)\<\{ `params`: [`ReadResourceRequest`](../context-protocol/index.md#readresourcerequest)\[`"params"`\]; \}\>

#### Returns

[`ReadResourceResult`](../context-protocol/index.md#readresourceresult) \| [`InputRequiredResult`](#inputrequiredresult) \| `Promise`\<[`ReadResourceResult`](../context-protocol/index.md#readresourceresult) \| [`InputRequiredResult`](#inputrequiredresult)\>

***

### RequestStateHooks

> **RequestStateHooks** = `object`

Hooks protecting the integrity of `requestState`.

`requestState` round-trips through the client and re-enters the server as attacker-controlled
input. SEP-2322 requires a server that lets it influence authorisation, resource access or
business logic to protect its integrity and to reject state that fails verification. mokei ships
no crypto and imposes no key management: with no `verify`, the raw string reaches the handler and
is untrusted; with one, the seam refuses state the hook rejects before the handler runs.

`mint` alone is legitimate (a custom encoding with no verification -- the handler gets back
exactly what it minted, still untrusted). `verify` alone is not: without a matching `mint`, a
handler mints with the default `JSON.stringify`, and a custom `verify` written for a different
encoding rejects that on every retry. `ContextServer`'s constructor throws for that combination
rather than let it fail silently on the wire.

#### Properties

##### mint?

> `optional` **mint?**: (`payload`) => `string`

Encodes a handler's payload into the opaque string sent to the client.

###### Parameters

###### payload

`unknown`

###### Returns

`string`

##### verify?

> `optional` **verify?**: (`raw`) => `unknown`

Decodes and authenticates a returning string. Throwing rejects the request.

###### Parameters

###### raw

`string`

###### Returns

`unknown`

***

### ResourceDefinitions

> **ResourceDefinitions** = `object`

#### Properties

##### list?

> `optional` **list?**: [`ListResourcesHandler`](#listresourceshandler) \| [`Resource`](../context-protocol/index.md#resource)[]

##### listTemplates?

> `optional` **listTemplates?**: [`ListResourceTemplatesHandler`](#listresourcetemplateshandler) \| [`ResourceTemplate`](../context-protocol/index.md#resourcetemplate)[]

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

##### createMessage

> **createMessage**: (`params`) => `Promise`\<[`CreateMessageResult`](../context-protocol/index.md#createmessageresult)\>

###### Parameters

###### params

[`WithRequestOptions`](../context-rpc/index.md#withrequestoptions)\<[`CreateMessageRequest`](../context-protocol/index.md#createmessagerequest)\[`"params"`\]\>

###### Returns

`Promise`\<[`CreateMessageResult`](../context-protocol/index.md#createmessageresult)\>

##### elicit

> **elicit**: (`params`) => `Promise`\<[`ElicitResult`](../context-protocol/index.md#elicitresult)\>

###### Parameters

###### params

[`WithRequestOptions`](../context-rpc/index.md#withrequestoptions)\<[`ElicitRequest`](../context-protocol/index.md#elicitrequest)\[`"params"`\]\>

###### Returns

`Promise`\<[`ElicitResult`](../context-protocol/index.md#elicitresult)\>

##### listRoots

> **listRoots**: (`params?`) => `Promise`\<[`ListRootsResult`](../context-protocol/index.md#listrootsresult)\>

###### Parameters

###### params?

[`WithRequestOptions`](../context-rpc/index.md#withrequestoptions)\<[`ListRootsRequest`](../context-protocol/index.md#listrootsrequest)\[`"params"`\]\>

###### Returns

`Promise`\<[`ListRootsResult`](../context-protocol/index.md#listrootsresult)\>

##### log

> **log**: [`LogFunction`](#logfunction)

***

### ServerConfig

> **ServerConfig** = `object`

#### Properties

##### cache?

> `optional` **cache?**: `CacheHints`

##### complete?

> `optional` **complete?**: [`CompleteHandler`](#completehandler)

##### name

> **name**: `string`

##### prompts?

> `optional` **prompts?**: [`PromptDefinitions`](#promptdefinitions)

##### protocolVersions

> **protocolVersions**: [`ProtocolVersion`](../context-protocol/index.md#protocolversion)[]

Revisions this server serves. Listing both makes it serve both.

##### requestState?

> `optional` **requestState?**: [`RequestStateHooks`](#requeststatehooks)

Integrity hooks for the MRTR `requestState` (SEP-2322). See [RequestStateHooks](#requeststatehooks).

##### resources?

> `optional` **resources?**: [`ResourceDefinitions`](#resourcedefinitions)

##### subscriptions?

> `optional` **subscriptions?**: `boolean`

Owns resource subscriptions (SEP-1391 `subscriptions/listen`): creates and owns a
[SubscriptionHub](#subscriptionhub) bound to this server's own `events`, disposing it on teardown.
Mutually exclusive with `subscriptionHub` -- pass one or the other, never both.

##### tasks?

> `optional` **tasks?**: [`TaskManager`](#taskmanager)

##### tools?

> `optional` **tools?**: [`ToolDefinitions`](#tooldefinitions)

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

##### promptsListChanged

> **promptsListChanged**: `undefined`

Signals that the prompts list changed. Consumed by the subscription hub.

##### resourcesListChanged

> **resourcesListChanged**: `undefined`

Signals that the resources list changed. Consumed by the subscription hub.

##### resourceUpdated

> **resourceUpdated**: `object`

Signals that a subscribed resource's content changed. Consumed by the subscription hub.

###### uri

> **uri**: `string`

##### toolsListChanged

> **toolsListChanged**: `undefined`

Signals that the tools list changed. Consumed by the subscription hub.

***

### ServerParams

> **ServerParams** = [`ServerConfig`](#serverconfig) & `object`

#### Type Declaration

##### auth?

> `optional` **auth?**: [`TaskOwner`](#taskowner) & `object`

###### Type Declaration

###### expiresAt?

> `optional` **expiresAt?**: `number`

##### connectionID?

> `optional` **connectionID?**: `string`

Identifies this server's connection inside a shared hub, keeping subscriptions from two
connections that reuse the same JSON-RPC id distinct. Defaults to a process-unique value;
the HTTP per-POST server injects its own.

##### maxConcurrentRequests?

> `optional` **maxConcurrentRequests?**: `number`

Request handlers allowed to run at once (default 100).

##### maxQueuedRequests?

> `optional` **maxQueuedRequests?**: `number`

Requests allowed to wait for a slot before further requests are refused (default 1000).

##### onError?

> `optional` **onError?**: (`error`) => `void`

Called for an inbound frame that could neither be validated nor routed to anything --
an invalid notification, or a malformed frame naming an id nobody is waiting on -- and
for request handlers that failed. Without it such frames vanish silently.

###### Parameters

###### error

`Error`

###### Returns

`void`

##### subscriptionHub?

> `optional` **subscriptionHub?**: [`SubscriptionHub`](#subscriptionhub)

Borrows an externally-owned [SubscriptionHub](#subscriptionhub) for stateless HTTP: the
server serves `subscriptions/listen` against it but neither re-subscribes its producers nor
disposes it. Affects capability advertising the same way `subscriptions: true` does.

##### transport

> **transport**: [`ServerTransport`](#servertransport)

***

### ServerTransport

> **ServerTransport** = `TransportType`\<[`ClientMessage`](../context-protocol/index.md#clientmessage), [`ServerMessage`](../context-protocol/index.md#servermessage-1)\>

***

### SettledToolOutcome

> **SettledToolOutcome** = \{ `result`: [`CallToolResult`](../context-protocol/index.md#calltoolresult); \} \| \{ `error`: \{ `code`: `number`; `data?`: `unknown`; `message`: `string`; \}; \}

***

### StructuredToolHandlerReturn

> **StructuredToolHandlerReturn**\<`Output`\> = `Omit`\<[`CallToolResult`](../context-protocol/index.md#calltoolresult), `"content"`\> & `object`

#### Type Parameters

##### Output

`Output`

#### Type Declaration

##### content?

> `optional` **content?**: [`CallToolResult`](../context-protocol/index.md#calltoolresult)\[`"content"`\]

##### structuredContent

> **structuredContent**: `Output`

***

### SubscriptionBackpressureErrorParams

> **SubscriptionBackpressureErrorParams** = `object`

#### Properties

##### cause?

> `optional` **cause?**: `unknown`

##### maxPendingFrames

> **maxPendingFrames**: `number`

***

### SubscriptionEntry

> **SubscriptionEntry** = `object`

What a served `subscriptions/listen` stream registers with the hub. Built by the serving
server: `deliver`/`complete` route through *its own* notify/held-request machinery, not the
hub's -- the hub only decides *whether* and *what* to send, never *how*.

#### Properties

##### acceptedTaskIDs?

> `optional` **acceptedTaskIDs?**: `string`[]

##### auth?

> `optional` **auth?**: [`TaskOwner`](#taskowner)

##### complete

> **complete**: () => `Promise`\<`void`\>

Graceful teardown for *this* subscription: resolve the held terminal, await its write.

###### Returns

`Promise`\<`void`\>

##### connectionID

> **connectionID**: `string`

##### deliver

> **deliver**: (`notification`) => `Promise`\<`void`\>

Routes the notification through the serving server's own notify path.

###### Parameters

###### notification

[`ServerNotification`](../context-protocol/index.md#servernotification)

###### Returns

`Promise`\<`void`\>

##### expire?

> `optional` **expire?**: () => `void`

###### Returns

`void`

##### expiresAt?

> `optional` **expiresAt?**: `number`

##### filter

> **filter**: [`SubscriptionFilter`](../context-protocol/index.md#subscriptionfilter)

##### subscriptionID

> **subscriptionID**: [`RequestID`](../context-protocol/index.md#requestid)

***

### SubscriptionHandle

> **SubscriptionHandle** = `object`

Returned by `hub.register()`. `complete()` (graceful) and `close()` (abrupt) are the two
mutually-exclusive terminal paths for one subscription -- whichever is called first wins, the
other becomes a no-op. Both are idempotent and both remove the entry from the hub.

#### Properties

##### acknowledged

> **acknowledged**: `Promise`\<`void`\>

Resolves once this subscription is safe to target for delivery. Callers are expected to
write (and await) the `notifications/subscriptions/acknowledged` frame *before* calling
`register()` -- so by the time a handle exists, the ack has already succeeded and this is
already resolved. It's exposed on the handle purely so callers have one place to await
subscription-readiness, without having to remember that invariant themselves.

#### Methods

##### close()

> **close**(`reason?`): `void`

Abrupt cancellation: no terminal write. Idempotent.

###### Parameters

###### reason?

`Error`

###### Returns

`void`

##### complete()

> **complete**(): `Promise`\<`void`\>

Graceful teardown: calls `entry.complete()`, resolves once it does. Idempotent.

###### Returns

`Promise`\<`void`\>

***

### SubscriptionHub

> **SubscriptionHub** = `object`

#### Methods

##### acceptTaskIDs()

> **acceptTaskIDs**(`taskIDs`, `auth?`): `Promise`\<`string`[]\>

###### Parameters

###### taskIDs

`string`[]

###### auth?

[`TaskOwner`](#taskowner)

###### Returns

`Promise`\<`string`[]\>

##### dispose()

> **dispose**(): `Promise`\<`void`\>

Unsubscribes from the producer events and drops every registered entry.

###### Returns

`Promise`\<`void`\>

##### endAllGracefully()

> **endAllGracefully**(): `Promise`\<`void`\>

Awaits `handle.complete()` for every currently-registered entry.

###### Returns

`Promise`\<`void`\>

##### register()

> **register**(`entry`): [`SubscriptionHandle`](#subscriptionhandle)

Registers `entry` and starts routing matching producer events to it.

###### Parameters

###### entry

[`SubscriptionEntry`](#subscriptionentry)

###### Returns

[`SubscriptionHandle`](#subscriptionhandle)

***

### SubscriptionSink

> **SubscriptionSink** = `object`

Where a `SubscriptionWriter` delivers notifications. Deliberately has no `writeTerminalResult`:
the terminal result of the long-running request this subscription rides on flows through the
serving server's own RPC write path, not through this sink.

#### Methods

##### close()

> **close**(`reason?`): `void`

###### Parameters

###### reason?

`Error`

###### Returns

`void`

##### writeNotification()

> **writeNotification**(`notification`): `Promise`\<`void`\>

###### Parameters

###### notification

[`ServerNotification`](../context-protocol/index.md#servernotification)

###### Returns

`Promise`\<`void`\>

***

### SubscriptionWriterParams

> **SubscriptionWriterParams** = `object`

#### Properties

##### maxPendingFrames?

> `optional` **maxPendingFrames?**: `number`

###### Default

```ts
DEFAULT_MAX_PENDING_FRAMES
```

##### onFailure

> **onFailure**: (`error`) => `void`

Called at most once, when the writer stops itself: on backpressure, or when a write to
the sink itself rejects.

###### Parameters

###### error

`Error`

###### Returns

`void`

##### sink

> **sink**: [`SubscriptionSink`](#subscriptionsink)

***

### TaskContext

> **TaskContext** = `object`

#### Methods

##### run()

> **run**(`work`, `options?`): `Promise`\<[`CreateTaskResult`](../context-protocol/index.md#createtaskresult)\>

###### Parameters

###### work

[`TaskWork`](#taskwork)

###### options?

###### resumeData?

[`JSONValue`](#jsonvalue)

###### Returns

`Promise`\<[`CreateTaskResult`](../context-protocol/index.md#createtaskresult)\>

***

### TaskHandle

> **TaskHandle** = `object`

#### Properties

##### requestMeta

> **requestMeta**: `Record`\<`string`, [`JSONValue`](#jsonvalue)\>

##### signal

> **signal**: `AbortSignal`

##### taskID

> **taskID**: `string`

#### Methods

##### awaitInput()

> **awaitInput**(`options?`): `Promise`\<`Record`\<`string`, \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: ...[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: ...[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: ...[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \}; `model`: `string`; `role`: `"assistant"` \| `"user"`; `stopReason?`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `action`: `"accept"` \| `"cancel"` \| `"decline"`; `content?`: \{\[`key`: `string`\]: `string` \| `number` \| `boolean` \| `string`[]; \}; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `roots`: `object`[]; \}\>\>

Waits on the task's open input request, as `requestInput` with that request's contents: it
resolves with the answer, and aborting `options.signal` withdraws the request and rejects with
`InputRequestWithdrawnError`. Throws when no input is outstanding.

###### Parameters

###### options?

###### signal?

`AbortSignal`

###### Returns

`Promise`\<`Record`\<`string`, \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: ...[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: ...[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: ...[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \}; `model`: `string`; `role`: `"assistant"` \| `"user"`; `stopReason?`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `action`: `"accept"` \| `"cancel"` \| `"decline"`; `content?`: \{\[`key`: `string`\]: `string` \| `number` \| `boolean` \| `string`[]; \}; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `roots`: `object`[]; \}\>\>

##### cancel()

> **cancel**(`reason?`): `Promise`\<`boolean`\>

###### Parameters

###### reason?

`string`

###### Returns

`Promise`\<`boolean`\>

##### checkpoint()

> **checkpoint**(`resumeData`): `Promise`\<`void`\>

###### Parameters

###### resumeData

[`JSONValue`](#jsonvalue)

###### Returns

`Promise`\<`void`\>

##### requestInput()

> **requestInput**(`requests`, `options?`): `Promise`\<`Record`\<`string`, \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: ...[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: ...[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: ...[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \}; `model`: `string`; `role`: `"assistant"` \| `"user"`; `stopReason?`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `action`: `"accept"` \| `"cancel"` \| `"decline"`; `content?`: \{\[`key`: `string`\]: `string` \| `number` \| `boolean` \| `string`[]; \}; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `roots`: `object`[]; \}\>\>

Asks the client for input and resolves with its responses. Keys are unique per task: an
identical request (same keys, deep-equal contents) under already issued keys re-attaches to
the open request or replays its settled outcome, the stored answer or an
`InputRequestWithdrawnError` for a withdrawal. A changed request under an issued key throws
`TaskInputKeyReusedError`. Aborting `options.signal` withdraws the open request and rejects
with `InputRequestWithdrawnError`.

###### Parameters

###### requests

`Record`\<`string`, [`InputRequest`](../context-protocol/index.md#inputrequest)\>

###### options?

###### signal?

`AbortSignal`

###### Returns

`Promise`\<`Record`\<`string`, \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: ...[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: ...[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: ...[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \}; `model`: `string`; `role`: `"assistant"` \| `"user"`; `stopReason?`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `action`: `"accept"` \| `"cancel"` \| `"decline"`; `content?`: \{\[`key`: `string`\]: `string` \| `number` \| `boolean` \| `string`[]; \}; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `roots`: `object`[]; \}\>\>

##### setStatus()

> **setStatus**(`message`): `Promise`\<`void`\>

###### Parameters

###### message

`string`

###### Returns

`Promise`\<`void`\>

***

### TaskManager

> **TaskManager** = `object`

#### Properties

##### events

> **events**: `EventsSource`\<\{ `taskError`: \{ `error`: `unknown`; `taskID?`: `string`; \}; `taskStatus`: [`DetailedTask`](../context-protocol/index.md#detailedtask); \}\>

#### Methods

##### canAccess()

> **canAccess**(`taskID`, `owner?`): `Promise`\<`boolean`\>

###### Parameters

###### taskID

`string`

###### owner?

[`TaskOwner`](#taskowner)

###### Returns

`Promise`\<`boolean`\>

##### cancel()

> **cancel**(`taskID`, `owner?`): `Promise`\<`void`\>

###### Parameters

###### taskID

`string`

###### owner?

[`TaskOwner`](#taskowner)

###### Returns

`Promise`\<`void`\>

##### create()

> **create**(`params`): `Promise`\<[`CreateTaskResult`](../context-protocol/index.md#createtaskresult)\>

###### Parameters

###### params

###### clientCapabilities

[`ClientCapabilities`](../context-protocol/index.md#clientcapabilities)

###### owner?

[`TaskOwner`](#taskowner)

###### requestMeta?

`Record`\<`string`, [`JSONValue`](#jsonvalue)\>

###### resumeData?

[`JSONValue`](#jsonvalue)

###### tool

[`GenericToolDefinition`](#generictooldefinition)

###### toolName

`string`

###### work

[`TaskWork`](#taskwork)

###### Returns

`Promise`\<[`CreateTaskResult`](../context-protocol/index.md#createtaskresult)\>

##### dispose()

> **dispose**(): `Promise`\<`void`\>

###### Returns

`Promise`\<`void`\>

##### get()

> **get**(`taskID`, `owner?`): `Promise`\<[`DetailedTask`](../context-protocol/index.md#detailedtask)\>

###### Parameters

###### taskID

`string`

###### owner?

[`TaskOwner`](#taskowner)

###### Returns

`Promise`\<[`DetailedTask`](../context-protocol/index.md#detailedtask)\>

##### recover()

> **recover**(`tools`): `Promise`\<`void`\>

###### Parameters

###### tools

[`ToolDefinitions`](#tooldefinitions)

###### Returns

`Promise`\<`void`\>

##### update()

> **update**(`taskID`, `responses`, `owner?`): `Promise`\<`void`\>

###### Parameters

###### taskID

`string`

###### responses

`Record`\<`string`, [`InputResponse`](../context-protocol/index.md#inputresponse)\>

###### owner?

[`TaskOwner`](#taskowner)

###### Returns

`Promise`\<`void`\>

***

### TaskManagerParams

> **TaskManagerParams** = `object`

#### Properties

##### now?

> `optional` **now?**: () => `number`

###### Returns

`number`

##### pollIntervalMs?

> `optional` **pollIntervalMs?**: `number`

Suggested client poll interval in milliseconds. Defaults to 1,000.

##### recover?

> `optional` **recover?**: (`record`, `resume`) => `Promise`\<`void`\> \| `void`

###### Parameters

###### record

[`TaskRecord`](#taskrecord)

###### resume

[`TaskResume`](#taskresume)

###### Returns

`Promise`\<`void`\> \| `void`

##### store?

> `optional` **store?**: [`TaskStore`](#taskstore)

##### ttlMs?

> `optional` **ttlMs?**: `number` \| `null`

Task lifetime in milliseconds; null disables expiry. Defaults to 3,600,000.

***

### TaskOwner

> **TaskOwner** = `object`

#### Properties

##### issuer?

> `optional` **issuer?**: `string`

##### scopes

> **scopes**: `string`[]

##### subject

> **subject**: `string`

***

### TaskRecord

> **TaskRecord** = `object`

#### Properties

##### clientCapabilities

> **clientCapabilities**: [`ClientCapabilities`](../context-protocol/index.md#clientcapabilities)

##### createdAt

> **createdAt**: `string`

##### error?

> `optional` **error?**: `object`

###### code

> **code**: `number`

###### data?

> `optional` **data?**: [`JSONValue`](#jsonvalue)

###### message

> **message**: `string`

##### inputs

> **inputs**: [`InputRecord`](#inputrecord)[]

Every input request the task has made, in id order. The last entry is the latest.

##### lastUpdatedAt

> **lastUpdatedAt**: `string`

##### owner?

> `optional` **owner?**: [`TaskOwner`](#taskowner)

##### pollIntervalMs?

> `optional` **pollIntervalMs?**: `number`

##### requestMeta?

> `optional` **requestMeta?**: `Record`\<`string`, [`JSONValue`](#jsonvalue)\>

##### result?

> `optional` **result?**: [`CallToolResult`](../context-protocol/index.md#calltoolresult) & `object`

###### Type Declaration

###### resultType

> **resultType**: `"complete"`

##### resumeData?

> `optional` **resumeData?**: [`JSONValue`](#jsonvalue)

##### revision

> **revision**: `number`

##### status

> **status**: [`TaskStatus`](../context-protocol/index.md#taskstatus)

##### statusMessage?

> `optional` **statusMessage?**: `string`

##### taskID

> **taskID**: `string`

##### toolName

> **toolName**: `string`

##### ttlMs

> **ttlMs**: `number` \| `null`

***

### TaskResume

> **TaskResume** = (`work`) => `Promise`\<`void`\>

#### Parameters

##### work

[`TaskWork`](#taskwork)

#### Returns

`Promise`\<`void`\>

***

### TaskStore

> **TaskStore** = `object`

#### Methods

##### create()

> **create**(`record`): `Promise`\<`void`\>

###### Parameters

###### record

[`TaskRecord`](#taskrecord)

###### Returns

`Promise`\<`void`\>

##### delete()

> **delete**(`taskID`): `Promise`\<`void`\>

###### Parameters

###### taskID

`string`

###### Returns

`Promise`\<`void`\>

##### get()

> **get**(`taskID`): `Promise`\<[`TaskRecord`](#taskrecord) \| `undefined`\>

###### Parameters

###### taskID

`string`

###### Returns

`Promise`\<[`TaskRecord`](#taskrecord) \| `undefined`\>

##### list()

> **list**(`filter`): `Promise`\<[`TaskRecord`](#taskrecord)[]\>

###### Parameters

###### filter

###### status

[`TaskStatus`](../context-protocol/index.md#taskstatus)[]

###### Returns

`Promise`\<[`TaskRecord`](#taskrecord)[]\>

##### update()

> **update**(`taskID`, `patch`, `expected`): `Promise`\<[`TaskRecord`](#taskrecord)\>

###### Parameters

###### taskID

`string`

###### patch

`Partial`\<[`TaskRecord`](#taskrecord)\>

###### expected

###### revision

`number`

###### Returns

`Promise`\<[`TaskRecord`](#taskrecord)\>

***

### TaskWork

> **TaskWork** = (`handle`) => [`CallToolResult`](../context-protocol/index.md#calltoolresult) \| `Promise`\<[`CallToolResult`](../context-protocol/index.md#calltoolresult)\>

#### Parameters

##### handle

[`TaskHandle`](#taskhandle)

#### Returns

[`CallToolResult`](../context-protocol/index.md#calltoolresult) \| `Promise`\<[`CallToolResult`](../context-protocol/index.md#calltoolresult)\>

***

### ToolDefinition

> **ToolDefinition**\<`Arguments`\> = [`GenericToolDefinition`](#generictooldefinition) & `object`

What `createTool` returns: a runtime `GenericToolDefinition` carrying a phantom witness of
the argument type its `inputSchema` describes.

The witness is type-level only -- never present at runtime. It exists so
[ExtractToolTypes](#extracttooltypes) can recover a tool's argument type by reading one optional
property. The alternative -- structurally matching the whole definition against a typed
one -- forces TypeScript to compare `handler` types, which carry the large `CallToolResult`
union, and that exceeds the instantiation depth (TS2589/TS2590).

#### Type Parameters

##### Arguments

`Arguments` = `Record`\<`string`, `unknown`\>

***

### ToolDefinitions

> **ToolDefinitions** = `Record`\<`string`, [`GenericToolDefinition`](#generictooldefinition)\>

***

### ToolHandlerReturn

> **ToolHandlerReturn** = [`CallToolResult`](../context-protocol/index.md#calltoolresult) \| [`InputRequiredResult`](#inputrequiredresult) \| [`CreateTaskResult`](../context-protocol/index.md#createtaskresult) \| `Promise`\<[`CallToolResult`](../context-protocol/index.md#calltoolresult) \| [`InputRequiredResult`](#inputrequiredresult) \| [`CreateTaskResult`](../context-protocol/index.md#createtaskresult)\>

***

### ToolOutcome

> **ToolOutcome** = \{ `result`: [`CallToolResult`](../context-protocol/index.md#calltoolresult); \} \| \{ `error`: `unknown`; \}

***

### ToolOutputValidationErrorParams

> **ToolOutputValidationErrorParams** = [`RPCErrorParams`](../context-rpc/index.md#rpcerrorparams)

***

### TypedPromptHandler

> **TypedPromptHandler**\<`Arguments`\> = (`request`) => [`PromptHandlerReturn`](#prompthandlerreturn)

#### Type Parameters

##### Arguments

`Arguments`

#### Parameters

##### request

[`HandlerRequest`](#handlerrequest)\<\{ `input`: `Arguments`; \}\>

#### Returns

[`PromptHandlerReturn`](#prompthandlerreturn)

***

### TypedToolHandler

> **TypedToolHandler**\<`Arguments`, `Output`\> = (`request`) => \[`unknown`\] *extends* \[`Output`\] ? [`ToolHandlerReturn`](#toolhandlerreturn) : [`StructuredToolHandlerReturn`](#structuredtoolhandlerreturn)\<`Output`\> \| [`InputRequiredResult`](#inputrequiredresult) \| [`CreateTaskResult`](../context-protocol/index.md#createtaskresult) \| `Promise`\<[`StructuredToolHandlerReturn`](#structuredtoolhandlerreturn)\<`Output`\> \| [`InputRequiredResult`](#inputrequiredresult) \| [`CreateTaskResult`](../context-protocol/index.md#createtaskresult)\>

#### Type Parameters

##### Arguments

`Arguments`

##### Output

`Output` = `unknown`

#### Parameters

##### request

[`HandlerRequest`](#handlerrequest)\<\{ `input`: `Arguments`; \}\>

#### Returns

\[`unknown`\] *extends* \[`Output`\] ? [`ToolHandlerReturn`](#toolhandlerreturn) : [`StructuredToolHandlerReturn`](#structuredtoolhandlerreturn)\<`Output`\> \| [`InputRequiredResult`](#inputrequiredresult) \| [`CreateTaskResult`](../context-protocol/index.md#createtaskresult) \| `Promise`\<[`StructuredToolHandlerReturn`](#structuredtoolhandlerreturn)\<`Output`\> \| [`InputRequiredResult`](#inputrequiredresult) \| [`CreateTaskResult`](../context-protocol/index.md#createtaskresult)\>

## Variables

### MOKEI\_VERSION

> `const` **MOKEI\_VERSION**: `"0.15.0"` = `"0.15.0"`

Version of the mokei packages, which release in lockstep. Reported as MCP client and server
implementation versions and as instrumentation scope versions. `test/version.test.ts` fails
when it drifts from `package.json`: update it after `pnpm version -r`.

***

### MRTR\_METHODS

> `const` **MRTR\_METHODS**: `ReadonlySet`\<`string`\>

The methods SEP-2322 allows to suspend. Everything else must answer terminally.

## Functions

### createMemoryTaskStore()

> **createMemoryTaskStore**(): [`TaskStore`](#taskstore)

#### Returns

[`TaskStore`](#taskstore)

***

### createPrompt()

> **createPrompt**\<`ArgumentsSchema`, `Arguments`\>(`params`): [`PromptDefinition`](#promptdefinition)\<`Arguments`\>

#### Type Parameters

##### ArgumentsSchema

`ArgumentsSchema` *extends* `Readonly`\<\{ \}\>

##### Arguments

`Arguments` = `FromSchema`\<`ArgumentsSchema`\>

#### Parameters

##### params

[`CreatePromptParams`](#createpromptparams)\<`ArgumentsSchema`, `Arguments`\>

#### Returns

[`PromptDefinition`](#promptdefinition)\<`Arguments`\>

***

### createSubscriptionHub()

> **createSubscriptionHub**(`params`): [`SubscriptionHub`](#subscriptionhub)

Shared cross-connection registry + producer fan-out. Nothing more: it decides *whether* a
given entry should see a given event and builds the base wire notification, then hands off to
`entry.deliver()` -- decoration (`subscriptionId`, `_meta`) and actual transport writes are the
serving server's job, not the hub's.

Keyed `connectionID` then `subscriptionID`: two different connections can reuse the same
JSON-RPC id (e.g. both `0`) without colliding.

#### Parameters

##### params

[`CreateSubscriptionHubParams`](#createsubscriptionhubparams)

#### Returns

[`SubscriptionHub`](#subscriptionhub)

***

### createTaskManager()

> **createTaskManager**(`params?`): [`TaskManager`](#taskmanager)

#### Parameters

##### params?

[`TaskManagerParams`](#taskmanagerparams) = `{}`

#### Returns

[`TaskManager`](#taskmanager)

***

### createTool()

> **createTool**\<`InputSchema`, `OutputSchema`, `Arguments`, `Output`\>(`params`): [`ToolDefinition`](#tooldefinition)\<`Arguments`\>

#### Type Parameters

##### InputSchema

`InputSchema` *extends* `Readonly`\<\{ \}\>

##### OutputSchema

`OutputSchema` *extends* `Readonly`\<\{ \}\> \| `undefined` = `undefined`

##### Arguments

`Arguments` = `FromSchema`\<`InputSchema`\>

##### Output

`Output` = `OutputSchema` *extends* `Readonly`\<\{ \}\> ? `FromSchema`\<`OutputSchema`\> : `unknown`

#### Parameters

##### params

[`CreateToolParams`](#createtoolparams)\<`InputSchema`, `OutputSchema`, `Arguments`, `Output`\>

#### Returns

[`ToolDefinition`](#tooldefinition)\<`Arguments`\>

***

### defaultMintRequestState()

> **defaultMintRequestState**(`payload`): `string`

The `mintRequestState` a handler gets when no custom `mint` hook is configured: a plain JSON
encoding, matched by the default `verify`-less passthrough on the way back. Shared by
`ContextServer` and `@mokei/host`'s local-tool runner so both fall back to the same encoder.

#### Parameters

##### payload

`unknown`

#### Returns

`string`

***

### finalizeToolResult()

> **finalizeToolResult**(`tool`, `result`): `object`

#### Parameters

##### tool

[`GenericToolDefinition`](#generictooldefinition)

##### result

###### _meta?

\{\[`key`: `string`\]: `unknown`; \}

###### content

(\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]

###### isError?

`boolean`

###### structuredContent?

\{\[`key`: `string`\]: `unknown`; \}

#### Returns

`object`

##### \_meta?

> `optional` **\_meta?**: `object`

###### Index Signature

\[`key`: `string`\]: `unknown`

##### content

> **content**: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]

##### isError?

> `optional` **isError?**: `boolean`

##### structuredContent?

> `optional` **structuredContent?**: `object`

###### Index Signature

\[`key`: `string`\]: `unknown`

***

### inputRequired()

> **inputRequired**(`params`): [`InputRequiredResult`](#inputrequiredresult)

Builds the suspended result a handler returns to ask the client for input (MRTR, SEP-2322).

Enforces SEP-2322's at-least-one rule here rather than letting the wire validator catch it: a
suspension that asks for nothing and carries no state tells the client neither what to do nor
what to echo, and failing at the call site names the handler that built it.

#### Parameters

##### params

###### inputRequests?

`Record`\<`string`, \{ `method`: `"sampling/createMessage"`; `params`: \{\[`key`: `string`\]: `unknown`; `includeContext?`: `"allServers"` \| `"none"` \| `"thisServer"`; `maxTokens`: `number`; `messages`: `object`[]; `metadata?`: \{\[`key`: `string`\]: `unknown`; \}; `modelPreferences?`: \{\[`key`: `string`\]: `unknown`; `costPriority?`: `number`; `hints?`: `object`[]; `intelligencePriority?`: `number`; `speedPriority?`: `number`; \}; `stopSequences?`: `string`[]; `systemPrompt?`: `string`; `temperature?`: `number`; `toolChoice?`: \{\[`key`: `string`\]: `unknown`; `mode`: `"required"` \| `"none"` \| `"auto"`; \}; `tools?`: `object`[]; \}; \} \| \{ `method`: `"elicitation/create"`; `params`: \{\[`key`: `string`\]: `unknown`; `message`: `string`; `mode?`: `"form"`; `requestedSchema`: \{\[`key`: `string`\]: `unknown`; `properties`: \{\[`key`: `string`\]: \{\[`key`: ...\]: ...; `default?`: ...; `description?`: ...; `format?`: ...; `maxLength?`: ...; `minLength?`: ...; `pattern?`: ...; `title?`: ...; `type`: ...; \} \| \{\[`key`: ...\]: ...; `default?`: ...; `description?`: ...; `maximum?`: ...; `minimum?`: ...; `title?`: ...; `type`: ...; \} \| \{\[`key`: ...\]: ...; `default?`: ...; `description?`: ...; `title?`: ...; `type`: ...; \} \| \{\[`key`: ...\]: ...; `default?`: ...; `description?`: ...; `enum?`: ...; `enumNames?`: ...; `oneOf?`: ...; `title?`: ...; `type`: ...; \} \| \{\[`key`: ...\]: ...; `default?`: ...; `description?`: ...; `items`: ...; `title?`: ...; `type`: ...; \}; \}; `required?`: `string`[]; `type`: `"object"`; \}; \} \| \{\[`key`: `string`\]: `unknown`; `elicitationId`: `string`; `message`: `string`; `mode`: `"url"`; `url`: `string`; \}; \} \| \{ `method`: `"roots/list"`; `params?`: \{\[`key`: `string`\]: `unknown`; \}; \}\>

###### requestState?

`string`

#### Returns

[`InputRequiredResult`](#inputrequiredresult)

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

### settleToolOutcome()

> **settleToolOutcome**(`tool`, `outcome`): [`SettledToolOutcome`](#settledtooloutcome)

#### Parameters

##### tool

[`GenericToolDefinition`](#generictooldefinition)

##### outcome

[`ToolOutcome`](#tooloutcome)

#### Returns

[`SettledToolOutcome`](#settledtooloutcome)
