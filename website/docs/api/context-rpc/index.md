# @mokei/context-rpc

Mokei shared RPC logic for context client and server.

## Installation

```sh
npm install @mokei/context-rpc
```

## Classes

### ContextRPC

#### Extends

- `Disposer`

#### Extended by

- [`ContextClient`](../context-client/index.md#contextclient)
- [`ContextServer`](../context-server/index.md#contextserver)

#### Type Parameters

##### T

`T` *extends* [`RPCTypes`](#rpctypes)

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

\{\[`key`: `string`\]: `unknown`; `jsonrpc`: `"2.0"`; `method`: `"notifications/progress"`; `params`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `message?`: `string`; `progress`: `number`; `progressToken`: `string` \| `number`; `total?`: `number`; \}; \} | `T`\[`"HandleNotification"`\]

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

> **request**\<`Method`\>(`method`, `params`): [`SentRequest`](#sentrequest)\<`T`\[`"SendRequests"`\]\[`Method`\]\[`"Result"`\]\>

###### Type Parameters

###### Method

`Method` *extends* `string` \| `number` \| `symbol`

###### Parameters

###### method

`Method`

###### params

`T`\[`"SendRequests"`\]\[`Method`\]\[`"Params"`\]

###### Returns

[`SentRequest`](#sentrequest)\<`T`\[`"SendRequests"`\]\[`Method`\]\[`"Result"`\]\>

##### requestValue()

> **requestValue**\<`Method`, `Value`\>(`method`, `params`, `getValue`): [`SentRequest`](#sentrequest)\<`Value`\>

###### Type Parameters

###### Method

`Method` *extends* `string` \| `number` \| `symbol`

###### Value

`Value`

###### Parameters

###### method

`Method`

###### params

`T`\[`"SendRequests"`\]\[`Method`\]\[`"Params"`\]

###### getValue

(`result`) => `Value`

###### Returns

[`SentRequest`](#sentrequest)\<`Value`\>

***

### RPCError

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new RPCError**(`code`, `message`, `data?`): [`RPCError`](#rpcerror)

###### Parameters

###### code

`number`

###### message

`string`

###### data?

`Record`\<`string`, `unknown`\>

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

> **get** **data**(): `Record`\<`string`, `unknown`\> \| `undefined`

###### Returns

`Record`\<`string`, `unknown`\> \| `undefined`

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

`string` | `number`

###### Returns

`object`

###### error

> **error**: `object`

###### Index Signature

\[`key`: `string`\]: `unknown`

###### error.code

> **code**: `number`

###### error.data?

> `optional` **data**: `object`

###### Index Signature

\[`key`: `string`\]: `unknown`

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

\{\[`key`: `string`\]: `unknown`; `code`: `number`; `data?`: \{\[`key`: `string`\]: `unknown`; \}; `message`: `string`; \}

###### error.code

`number`

###### error.data?

\{\[`key`: `string`\]: `unknown`; \}

###### error.message

`string`

###### id

`string` \| `number`

###### jsonrpc

`"2.0"`

###### Returns

[`RPCError`](#rpcerror)

## Type Aliases

### RPCParams

> **RPCParams**\<`T`\> = `object`

#### Type Parameters

##### T

`T` *extends* [`RPCTypes`](#rpctypes)

#### Properties

##### transport

> **transport**: `TransportType`\<`T`\[`"MessageIn"`\], `T`\[`"MessageOut"`\]\>

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

### SentRequest

> **SentRequest**\<`Result`\> = `Promise`\<`Result`\> & `object`

#### Type Declaration

##### cancel()

> **cancel**: () => `void`

###### Returns

`void`

##### id

> **id**: `number`

#### Type Parameters

##### Result

`Result`
