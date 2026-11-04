# @mokei/context-rpc

Mokei shared RPC logic for context client and server.

## Installation

```sh
npm install @mokei/context-rpc
```

## Classes

### ContextRPC

Message ordering:
- notifications and responses are handled in wire order, synchronously in the read loop;
- requests *start* in wire order and complete out of order;
- a request never delays a notification -- which is what lets `notifications/cancelled`
  reach a handler that is still running.

#### Extends

- `Disposer`

#### Extended by

- [`ContextClient`](../context-client/index.md#contextclient)
- [`ContextServer`](../context-server/index.md#contextserver)

#### Type Parameters

##### T

`T` *extends* [`RPCTypes`](#rpctypes)

#### Indexable

> \[`key`: `number`\]: () => `Promise`\<`void`\>

#### Constructors

##### Constructor

> **new ContextRPC**\<`T`\>(`params`): [`ContextRPC`](#contextrpc)\<`T`\>

###### Parameters

###### params

[`RPCParams`](#rpcparams)\<`T`\>

###### Returns

[`ContextRPC`](#contextrpc)\<`T`\>

###### Overrides

`Disposer.constructor`

#### Accessors

##### events

###### Get Signature

> **get** **events**(): `EventEmitter`\<`T`\[`"Events"`\]\>

###### Returns

`EventEmitter`\<`T`\[`"Events"`\]\>

#### Methods

##### \_getNextRequestID()

> **\_getNextRequestID**(): `string` \| `number`

###### Returns

`string` \| `number`

##### \_handle()

> **\_handle**(): `void`

###### Returns

`void`

##### \_handleMessage()

> **\_handleMessage**(`message`): \{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; \} \| `Promise`\<\{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; \} \| `null`\> \| `null`

###### Parameters

###### message

`T`\[`"MessageIn"`\]

###### Returns

\{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; \} \| `Promise`\<\{\[`key`: `string`\]: `unknown`; `id`: `string` \| `number`; `jsonrpc`: `"2.0"`; \} \| `null`\> \| `null`

##### \_handleNotification()

> **\_handleNotification**(`_notification`): `void` \| `Promise`\<`void`\>

###### Parameters

###### \_notification

\{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/progress"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `message?`: `string`; `progress`: `number`; `progressToken`: `string` \| `number`; `total?`: `number`; \}; \} \| `T`\[`"HandleNotification"`\]

###### Returns

`void` \| `Promise`\<`void`\>

##### \_handleRequest()

> **\_handleRequest**(`_request`, `_signal`): `T`\[`"SendResult"`\] \| `Promise`\<`T`\[`"SendResult"`\]\>

###### Parameters

###### \_request

`T`\[`"HandleRequest"`\]

###### \_signal

`AbortSignal`

###### Returns

`T`\[`"SendResult"`\] \| `Promise`\<`T`\[`"SendResult"`\]\>

##### \_read()

> **\_read**(): `Promise`\<`ReadableStreamReadResult`\<`T`\[`"MessageIn"`\]\>\>

###### Returns

`Promise`\<`ReadableStreamReadResult`\<`T`\[`"MessageIn"`\]\>\>

##### \_write()

> **\_write**(`message`): `Promise`\<`void`\>

###### Parameters

###### message

`T`\[`"MessageOut"`\]

###### Returns

`Promise`\<`void`\>

##### notify()

> **notify**\<`Event`\>(`event`, `params`): `Promise`\<`void`\>

###### Type Parameters

###### Event

`Event` *extends* `string`

###### Parameters

###### event

`Event`

###### params

`T`\[`"SendNotifications"`\]\[`Event`\]\[`"params"`\]

###### Returns

`Promise`\<`void`\>

##### request()

> **request**\<`Method`\>(`method`, `params`, `options?`): `Promise`\<`T`\[`"SendRequests"`\]\[`Method`\]\[`"Result"`\]\>

###### Type Parameters

###### Method

`Method` *extends* `string` \| `number` \| `symbol`

###### Parameters

###### method

`Method`

###### params

`T`\[`"SendRequests"`\]\[`Method`\]\[`"Params"`\]

###### options?

[`RequestOptions`](#requestoptions)

###### Returns

`Promise`\<`T`\[`"SendRequests"`\]\[`Method`\]\[`"Result"`\]\>

***

### RequestTimeoutError

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new RequestTimeoutError**(`params`): [`RequestTimeoutError`](#requesttimeouterror)

###### Parameters

###### params

[`RequestTimeoutErrorParams`](#requesttimeouterrorparams)

###### Returns

[`RequestTimeoutError`](#requesttimeouterror)

###### Overrides

`Error.constructor`

***

### RPCError

#### Extends

- `Error`

#### Extended by

- [`ToolInputValidationError`](../context-server/index.md#toolinputvalidationerror)
- [`ToolOutputValidationError`](../context-server/index.md#tooloutputvalidationerror)

#### Constructors

##### Constructor

> **new RPCError**(`params`): [`RPCError`](#rpcerror)

###### Parameters

###### params

[`RPCErrorParams`](#rpcerrorparams)

###### Returns

[`RPCError`](#rpcerror)

###### Overrides

`Error.constructor`

#### Accessors

##### code

###### Get Signature

> **get** **code**(): `number`

###### Returns

`number`

##### data

###### Get Signature

> **get** **data**(): `unknown`

###### Returns

`unknown`

##### isInternal

###### Get Signature

> **get** **isInternal**(): `boolean`

###### Returns

`boolean`

##### isInvalidParams

###### Get Signature

> **get** **isInvalidParams**(): `boolean`

###### Returns

`boolean`

##### isInvalidRequest

###### Get Signature

> **get** **isInvalidRequest**(): `boolean`

###### Returns

`boolean`

##### isMethodNotFound

###### Get Signature

> **get** **isMethodNotFound**(): `boolean`

###### Returns

`boolean`

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

##### fromResponse()

> `static` **fromResponse**(`response`): [`RPCError`](#rpcerror)

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

[`RPCError`](#rpcerror)

***

### TransportClosedError

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new TransportClosedError**(`params?`): [`TransportClosedError`](#transportclosederror)

###### Parameters

###### params?

[`TransportClosedErrorParams`](#transportclosederrorparams) = `{}`

###### Returns

[`TransportClosedError`](#transportclosederror)

###### Overrides

`Error.constructor`

## Type Aliases

### HeldResponse

> **HeldResponse**\<`Result`\> = `object`

Marker a request handler returns to defer its JSON-RPC response indefinitely (SEP-1391
`subscriptions/listen`): the request is validated, dispatched and slot-scheduled like any
other, but instead of a result body the handler hands back a `terminal` promise. The
request then releases its concurrency slot while keeping its cancellation/duplicate-id
identity, and its response is written only when `terminal` resolves (on graceful teardown).

`beforeTerminal`, if given, runs after `terminal` resolves and before the response is
written -- the hook where a subclass flushes any final stream state.

#### Type Parameters

##### Result

`Result`

#### Properties

##### beforeTerminal?

> `optional` **beforeTerminal?**: () => `Promise`\<`void`\>

###### Returns

`Promise`\<`void`\>

##### kind

> **kind**: `"held"`

##### terminal

> **terminal**: `Promise`\<`Result`\>

***

### RequestOptions

> **RequestOptions** = `object`

#### Properties

##### allowInputRequired?

> `optional` **allowInputRequired?**: `boolean`

Returns a suspended MRTR result to the caller instead of driving the retry rounds
(SEP-2322). Consumed by `@mokei/context-client`; `ContextRPC` itself ignores it. When the
caller drives its own rounds, tracing marks every suspended leg `mokei.mcp.round = 0` and
the final leg carries no round.

##### maxTotalTimeout?

> `optional` **maxTotalTimeout?**: `number`

Bounds a whole MRTR flow, as opposed to `timeout`, which bounds one leg of it. Consumed by
`@mokei/context-client`; `ContextRPC` itself ignores it.

##### onRequestID?

> `optional` **onRequestID?**: (`id`) => `void`

Reports the allocated request ID before the request is written.

###### Parameters

###### id

[`RequestID`](../context-protocol/index.md#requestid)

###### Returns

`void`

##### signal?

> `optional` **signal?**: `AbortSignal`

Aborts the request, rejecting its promise and notifying the peer.

##### timeout?

> `optional` **timeout?**: `number`

Rejects the request with a RequestTimeoutError after this many ms.

##### traceAttributes?

> `optional` **traceAttributes?**: `Record`\<`string`, `string`\>

Attributes added to the request's local trace span (for example the GenAI tool call ID).
Never sent on the wire. Consumed by `@mokei/context-client`; `ContextRPC` itself ignores it.

***

### RequestTimeoutErrorParams

> **RequestTimeoutErrorParams** = `object`

#### Properties

##### cause?

> `optional` **cause?**: `unknown`

##### message

> **message**: `string`

***

### RPCErrorParams

> **RPCErrorParams** = `object`

#### Properties

##### cause?

> `optional` **cause?**: `unknown`

##### code

> **code**: `number`

##### data?

> `optional` **data?**: `unknown`

##### message

> **message**: `string`

***

### RPCParams

> **RPCParams**\<`T`\> = `object`

#### Type Parameters

##### T

`T` *extends* [`RPCTypes`](#rpctypes)

#### Properties

##### defaultRequestTimeout?

> `optional` **defaultRequestTimeout?**: `number`

Timeout applied to a request that passes none of its own. Unset means unbounded, which
is the historical behaviour: a blanket default would cut off a long-running `tools/call`.

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

##### routeStreamNotification?

> `optional` **routeStreamNotification?**: (`notification`) => \{ `frame`: `StreamFrame`; `id`: [`RequestID`](../context-protocol/index.md#requestid); \} \| `null`

Diverts an inbound notification into an existing stream exchange instead of
`_handleNotification` -- used by `subscriptions/listen` (SEP-1391), where server
notifications carry a subscriptionId that maps back to the listen request's stream
exchange. Returning `null` leaves the notification to the normal handling path.

###### Parameters

###### notification

[`ProgressNotification`](../context-protocol/index.md#progressnotification) \| `T`\[`"HandleNotification"`\]

###### Returns

\{ `frame`: `StreamFrame`; `id`: [`RequestID`](../context-protocol/index.md#requestid); \} \| `null`

##### transport

> **transport**: `TransportType`\<`T`\[`"MessageIn"`\], `T`\[`"MessageOut"`\]\> & `Partial`\<`StreamEventsTransport`\>

##### validateMessageIn

> **validateMessageIn**: `Validator`\<`T`\[`"MessageIn"`\]\>

***

### RPCTypes

> **RPCTypes** = `object`

#### Properties

##### Events

> **Events**: `Record`\<`string`, `unknown`\>

##### HandleNotification

> **HandleNotification**: [`Notification`](../context-protocol/index.md#notification)

##### HandleRequest

> **HandleRequest**: [`Request`](../context-protocol/index.md#request)

##### MessageIn

> **MessageIn**: [`AnyMessage`](../context-protocol/index.md#anymessage)

##### MessageOut

> **MessageOut**: [`AnyMessage`](../context-protocol/index.md#anymessage)

##### SendNotifications

> **SendNotifications**: `Record`\<`string`, [`Notification`](../context-protocol/index.md#notification)\>

##### SendRequests

> **SendRequests**: `Record`\<`string`, `RequestDefinition`\>

##### SendResult

> **SendResult**: `unknown`

***

### TransportClosedErrorParams

> **TransportClosedErrorParams** = `object`

#### Properties

##### cause?

> `optional` **cause?**: `unknown`

##### message?

> `optional` **message?**: `string`

***

### WithRequestOptions

> **WithRequestOptions**\<`Params`\> = `Params` & [`RequestOptions`](#requestoptions)

A public request method's parameters: the request's wire params, plus the transport
options that drive the exchange carrying them.

The two are one object at the API surface and must be separated before the params
reach the wire -- see [splitRequestOptions](#splitrequestoptions). No MCP request declares a `signal`,
`timeout`, `allowInputRequired`, `maxTotalTimeout` or `traceAttributes` param, so the merge is unambiguous.

#### Type Parameters

##### Params

`Params`

## Variables

### DEFAULT\_MAX\_CONCURRENT\_REQUESTS

> `const` **DEFAULT\_MAX\_CONCURRENT\_REQUESTS**: `100` = `100`

Request handlers allowed to run at once. An order of magnitude below nothing in
particular -- it matches `DEFAULT_MAX_STATELESS_EXCHANGES` in `@mokei/http-server`, the
only other place mokei bounds concurrent work.

***

### DEFAULT\_MAX\_QUEUED\_REQUESTS

> `const` **DEFAULT\_MAX\_QUEUED\_REQUESTS**: `1000` = `1000`

Requests allowed to wait for a slot before further requests are refused.

## Functions

### isHeldResponse()

> **isHeldResponse**(`value`): `value is HeldResponse<unknown>`

Narrows a handler's return value to a [HeldResponse](#heldresponse).

#### Parameters

##### value

`unknown`

#### Returns

`value is HeldResponse<unknown>`

***

### splitRequestOptions()

> **splitRequestOptions**\<`Params`\>(`params`): \[`Params`, [`RequestOptions`](#requestoptions)\]

Splits a public parameters object into the params sent on the wire and the transport
options kept local to this process.

`ContextRPC.request` passes its `params` straight to the peer, so an `AbortSignal` or
timeout left in that object would be serialised as a request param. Every public
method that accepts [WithRequestOptions](#withrequestoptions) must split here first.

#### Type Parameters

##### Params

`Params`

#### Parameters

##### params

[`WithRequestOptions`](#withrequestoptions)\<`Params`\>

#### Returns

\[`Params`, [`RequestOptions`](#requestoptions)\]
