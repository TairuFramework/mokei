# @mokei/context-rpc

Mokei shared RPC logic for context client and server.

## Installation

```sh
npm install @mokei/context-rpc
```

## Classes

### ContextRPC\<T\>

#### Extends

- `Disposer`

#### Extended by

- [`ContextClient`](../context-client/index.md#contextclientt)
- [`ContextServer`](../context-server/index.md#contextserver)

#### Type Parameters

• **T** *extends* [`RPCTypes`](index.md#rpctypes)

#### Constructors

##### new ContextRPC()

> **new ContextRPC**\<`T`\>(`params`): [`ContextRPC`](index.md#contextrpct)\<`T`\>

###### Parameters

###### params

[`RPCParams`](index.md#rpcparamst)\<`T`\>

###### Returns

[`ContextRPC`](index.md#contextrpct)\<`T`\>

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

***

##### \_handle()

> **\_handle**(): `void`

###### Returns

`void`

***

##### \_handleNotification()

> **\_handleNotification**(`notification`): `void` \| `Promise`\<`void`\>

###### Parameters

###### notification

\{ `[key: string]`: `unknown`;  `jsonrpc`: `"2.0"`; `method`: `"notifications/progress"`; `params`: \{ `[key: string]`: `unknown`;  `_meta`: \{\}; `progress`: `number`; `progressToken`: `string` \| `number`; `total`: `number`; \}; \} | `T`\[`"HandleNotification"`\]

###### Returns

`void` \| `Promise`\<`void`\>

***

##### \_handleRequest()

> **\_handleRequest**(`request`, `signal`): `T`\[`"SendResult"`\] \| `Promise`\<`T`\[`"SendResult"`\]\>

###### Parameters

###### request

`T`\[`"HandleRequest"`\]

###### signal

`AbortSignal`

###### Returns

`T`\[`"SendResult"`\] \| `Promise`\<`T`\[`"SendResult"`\]\>

***

##### \_read()

> **\_read**(): `Promise`\<`ReadableStreamReadResult`\<`T`\[`"MessageIn"`\]\>\>

###### Returns

`Promise`\<`ReadableStreamReadResult`\<`T`\[`"MessageIn"`\]\>\>

***

##### \_write()

> **\_write**(`message`): `Promise`\<`void`\>

###### Parameters

###### message

`T`\[`"MessageOut"`\]

###### Returns

`Promise`\<`void`\>

***

##### notify()

> **notify**\<`Event`\>(`event`, `params`): `Promise`\<`void`\>

###### Type Parameters

• **Event** *extends* `string`

###### Parameters

###### event

`Event`

###### params

`T`\[`"SendNotifications"`\]\[`Event`\]\[`"params"`\]

###### Returns

`Promise`\<`void`\>

***

##### request()

> **request**\<`Method`\>(`method`, `params`): [`SentRequest`](index.md#sentrequestresult)\<`T`\[`"SendRequests"`\]\[`Method`\]\[`"Result"`\]\>

###### Type Parameters

• **Method** *extends* `string` \| `number` \| `symbol`

###### Parameters

###### method

`Method`

###### params

`T`\[`"SendRequests"`\]\[`Method`\]\[`"Params"`\]

###### Returns

[`SentRequest`](index.md#sentrequestresult)\<`T`\[`"SendRequests"`\]\[`Method`\]\[`"Result"`\]\>

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

***

##### fromResponse()

> `static` **fromResponse**(`response`): [`RPCError`](index.md#rpcerror)

###### Parameters

###### response

###### error

\{ `[key: string]`: `unknown`;  `code`: `number`; `data`: \{\}; `message`: `string`; \}

###### error.code

`number`

###### error.data?

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

### RPCParams\<T\>

> **RPCParams**\<`T`\>: `object`

#### Type Parameters

• **T** *extends* [`RPCTypes`](index.md#rpctypes)

#### Type declaration

##### transport

> **transport**: `TransportType`\<`T`\[`"MessageIn"`\], `T`\[`"MessageOut"`\]\>

##### validateMessageIn

> **validateMessageIn**: `Validator`\<`T`\[`"MessageIn"`\]\>

***

### RPCTypes

> **RPCTypes**: `object`

#### Type declaration

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

### SentRequest\<Result\>

> **SentRequest**\<`Result`\>: `Promise`\<`Result`\> & `object`

#### Type declaration

##### cancel()

> **cancel**: () => `void`

###### Returns

`void`

##### id

> **id**: `number`

#### Type Parameters

• **Result**
