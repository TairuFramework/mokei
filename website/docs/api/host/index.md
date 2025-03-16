# @mokei/host

Mokei Context host.

## Installation

```sh
npm install @mokei/host
```

## Classes

### ContextHost

#### Extends

- `Disposer`

#### Extended by

- [`ProxyHost`](#proxyhost)

#### Constructors

##### new ContextHost()

> **new ContextHost**(`params`?): [`ContextHost`](#contexthost)

###### Parameters

###### params?

`DisposerParams`

###### Returns

[`ContextHost`](#contexthost)

###### Inherited from

`Disposer.constructor`

#### Accessors

##### contexts

###### Get Signature

> **get** **contexts**(): `Record`\<`string`, [`HostedContext`](#hostedcontext)\<[`UnknownContextTypes`](../context-client/index.md#unknowncontexttypes)\>\>

###### Returns

`Record`\<`string`, [`HostedContext`](#hostedcontext)\<[`UnknownContextTypes`](../context-client/index.md#unknowncontexttypes)\>\>

#### Methods

##### callTool()

> **callTool**(`key`, `name`, `args`): [`SentRequest`](../context-rpc/index.md#sentrequest)\<\{ `[key: string]`: `unknown`;  `_meta`: \{\}; `content`: (\{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `resource`: \{ `[key: string]`: `unknown`;  `mimeType`: `string`; `text`: `string`; `uri`: `string`; \} \| \{ `[key: string]`: `unknown`;  `blob`: `string`; `mimeType`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError`: `boolean`; \}\>

###### Parameters

###### key

`string`

###### name

`string`

###### args

`Record`\<`string`, `unknown`\>

###### Returns

[`SentRequest`](../context-rpc/index.md#sentrequest)\<\{ `[key: string]`: `unknown`;  `_meta`: \{\}; `content`: (\{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `resource`: \{ `[key: string]`: `unknown`;  `mimeType`: `string`; `text`: `string`; `uri`: `string`; \} \| \{ `[key: string]`: `unknown`;  `blob`: `string`; `mimeType`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError`: `boolean`; \}\>

***

##### getContext()

> **getContext**\<`T`\>(`key`): [`HostedContext`](#hostedcontext)\<`T`\>

###### Type Parameters

###### T

`T` *extends* [`ContextTypes`](../context-client/index.md#contexttypes) = [`UnknownContextTypes`](../context-client/index.md#unknowncontexttypes)

###### Parameters

###### key

`string`

###### Returns

[`HostedContext`](#hostedcontext)\<`T`\>

***

##### getContextKeys()

> **getContextKeys**(): `string`[]

###### Returns

`string`[]

***

##### getEnabledTools()

> **getEnabledTools**(): [`ContextTool`](#contexttool)[]

###### Returns

[`ContextTool`](#contexttool)[]

***

##### getPrompt()

> **getPrompt**(`key`, `name`, `args`): [`SentRequest`](../context-rpc/index.md#sentrequest)\<\{ `[key: string]`: `unknown`;  `_meta`: \{\}; `description`: `string`; `messages`: `object`[]; \}\>

###### Parameters

###### key

`string`

###### name

`string`

###### args

`Record`\<`string`, `unknown`\> = `{}`

###### Returns

[`SentRequest`](../context-rpc/index.md#sentrequest)\<\{ `[key: string]`: `unknown`;  `_meta`: \{\}; `description`: `string`; `messages`: `object`[]; \}\>

***

##### remove()

> **remove**(`key`): `Promise`\<`void`\>

###### Parameters

###### key

`string`

###### Returns

`Promise`\<`void`\>

***

##### setContextTools()

> **setContextTools**(`key`, `tools`): `void`

###### Parameters

###### key

`string`

###### tools

[`ContextTool`](#contexttool)[]

###### Returns

`void`

***

##### setup()

> **setup**(`key`): `Promise`\<[`ContextTool`](#contexttool)[]\>

###### Parameters

###### key

`string`

###### Returns

`Promise`\<[`ContextTool`](#contexttool)[]\>

***

##### spawn()

> **spawn**(`key`, `command`, `args`): `Promise`\<[`ContextClient`](../context-client/index.md#contextclient)\<[`UnknownContextTypes`](../context-client/index.md#unknowncontexttypes)\>\>

###### Parameters

###### key

`string`

###### command

`string`

###### args

`string`[] = `[]`

###### Returns

`Promise`\<[`ContextClient`](../context-client/index.md#contextclient)\<[`UnknownContextTypes`](../context-client/index.md#unknowncontexttypes)\>\>

***

### ProxyHost

#### Extends

- [`ContextHost`](#contexthost)

#### Constructors

##### new ProxyHost()

> **new ProxyHost**(`client`): [`ProxyHost`](#proxyhost)

###### Parameters

###### client

[`HostClient`](#hostclient)

###### Returns

[`ProxyHost`](#proxyhost)

###### Overrides

[`ContextHost`](#contexthost).[`constructor`](#constructor)

#### Accessors

##### client

###### Get Signature

> **get** **client**(): [`HostClient`](#hostclient)

###### Returns

[`HostClient`](#hostclient)

***

##### contexts

###### Get Signature

> **get** **contexts**(): `Record`\<`string`, [`HostedContext`](#hostedcontext)\<[`UnknownContextTypes`](../context-client/index.md#unknowncontexttypes)\>\>

###### Returns

`Record`\<`string`, [`HostedContext`](#hostedcontext)\<[`UnknownContextTypes`](../context-client/index.md#unknowncontexttypes)\>\>

###### Inherited from

[`ContextHost`](#contexthost).[`contexts`](#contexts)

#### Methods

##### callTool()

> **callTool**(`key`, `name`, `args`): [`SentRequest`](../context-rpc/index.md#sentrequest)\<\{ `[key: string]`: `unknown`;  `_meta`: \{\}; `content`: (\{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `resource`: \{ `[key: string]`: `unknown`;  `mimeType`: `string`; `text`: `string`; `uri`: `string`; \} \| \{ `[key: string]`: `unknown`;  `blob`: `string`; `mimeType`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError`: `boolean`; \}\>

###### Parameters

###### key

`string`

###### name

`string`

###### args

`Record`\<`string`, `unknown`\>

###### Returns

[`SentRequest`](../context-rpc/index.md#sentrequest)\<\{ `[key: string]`: `unknown`;  `_meta`: \{\}; `content`: (\{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `resource`: \{ `[key: string]`: `unknown`;  `mimeType`: `string`; `text`: `string`; `uri`: `string`; \} \| \{ `[key: string]`: `unknown`;  `blob`: `string`; `mimeType`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError`: `boolean`; \}\>

###### Inherited from

[`ContextHost`](#contexthost).[`callTool`](#calltool)

***

##### getContext()

> **getContext**\<`T`\>(`key`): [`HostedContext`](#hostedcontext)\<`T`\>

###### Type Parameters

###### T

`T` *extends* [`ContextTypes`](../context-client/index.md#contexttypes) = [`UnknownContextTypes`](../context-client/index.md#unknowncontexttypes)

###### Parameters

###### key

`string`

###### Returns

[`HostedContext`](#hostedcontext)\<`T`\>

###### Inherited from

[`ContextHost`](#contexthost).[`getContext`](#getcontext)

***

##### getContextKeys()

> **getContextKeys**(): `string`[]

###### Returns

`string`[]

###### Inherited from

[`ContextHost`](#contexthost).[`getContextKeys`](#getcontextkeys)

***

##### getEnabledTools()

> **getEnabledTools**(): [`ContextTool`](#contexttool)[]

###### Returns

[`ContextTool`](#contexttool)[]

###### Inherited from

[`ContextHost`](#contexthost).[`getEnabledTools`](#getenabledtools)

***

##### getPrompt()

> **getPrompt**(`key`, `name`, `args`): [`SentRequest`](../context-rpc/index.md#sentrequest)\<\{ `[key: string]`: `unknown`;  `_meta`: \{\}; `description`: `string`; `messages`: `object`[]; \}\>

###### Parameters

###### key

`string`

###### name

`string`

###### args

`Record`\<`string`, `unknown`\> = `{}`

###### Returns

[`SentRequest`](../context-rpc/index.md#sentrequest)\<\{ `[key: string]`: `unknown`;  `_meta`: \{\}; `description`: `string`; `messages`: `object`[]; \}\>

###### Inherited from

[`ContextHost`](#contexthost).[`getPrompt`](#getprompt)

***

##### remove()

> **remove**(`key`): `Promise`\<`void`\>

###### Parameters

###### key

`string`

###### Returns

`Promise`\<`void`\>

###### Inherited from

[`ContextHost`](#contexthost).[`remove`](#remove)

***

##### setContextTools()

> **setContextTools**(`key`, `tools`): `void`

###### Parameters

###### key

`string`

###### tools

[`ContextTool`](#contexttool)[]

###### Returns

`void`

###### Inherited from

[`ContextHost`](#contexthost).[`setContextTools`](#setcontexttools)

***

##### setup()

> **setup**(`key`): `Promise`\<[`ContextTool`](#contexttool)[]\>

###### Parameters

###### key

`string`

###### Returns

`Promise`\<[`ContextTool`](#contexttool)[]\>

###### Inherited from

[`ContextHost`](#contexthost).[`setup`](#setup)

***

##### spawn()

> **spawn**(`key`, `command`, `args`): `Promise`\<[`ContextClient`](../context-client/index.md#contextclient)\<[`UnknownContextTypes`](../context-client/index.md#unknowncontexttypes)\>\>

###### Parameters

###### key

`string`

###### command

`string`

###### args

`string`[] = `[]`

###### Returns

`Promise`\<[`ContextClient`](../context-client/index.md#contextclient)\<[`UnknownContextTypes`](../context-client/index.md#unknowncontexttypes)\>\>

###### Overrides

[`ContextHost`](#contexthost).[`spawn`](#spawn)

***

##### forDaemon()

> `static` **forDaemon**(`options`?): `Promise`\<[`ProxyHost`](#proxyhost)\>

###### Parameters

###### options?

`DaemonOptions`

###### Returns

`Promise`\<[`ProxyHost`](#proxyhost)\>

## Type Aliases

### AllowToolCalls

> **AllowToolCalls** = `"always"` \| `"ask"` \| `"never"`

***

### ContextTool

> **ContextTool** = `object`

#### Properties

##### allow?

> `optional` **allow**: [`AllowToolCalls`](#allowtoolcalls)

***

##### enabled

> **enabled**: `boolean`

***

##### id

> **id**: `string`

***

##### tool

> **tool**: [`Tool`](../context-protocol/index.md#tool)

***

### HostClient

> **HostClient** = `Client`\<[`Protocol`](../host-protocol/index.md#protocol)\>

***

### HostedContext\<T\>

> **HostedContext**\<`T`\> = `object`

#### Type Parameters

##### T

`T` *extends* [`ContextTypes`](../context-client/index.md#contexttypes) = [`UnknownContextTypes`](../context-client/index.md#unknowncontexttypes)

#### Properties

##### client

> **client**: [`ContextClient`](../context-client/index.md#contextclient)\<`T`\>

***

##### disposer

> **disposer**: `Disposer`

***

##### tools

> **tools**: [`ContextTool`](#contexttool)[]

***

### ServerParams

> **ServerParams** = `object`

#### Properties

##### shutdown()?

> `optional` **shutdown**: () => `void` \| `Promise`\<`void`\>

###### Returns

`void` \| `Promise`\<`void`\>

***

##### socketPath?

> `optional` **socketPath**: `string`

## Functions

### createClient()

> **createClient**(`socketPath`): `Promise`\<[`HostClient`](#hostclient)\>

#### Parameters

##### socketPath

`string` = `DEFAULT_SOCKET_PATH`

#### Returns

`Promise`\<[`HostClient`](#hostclient)\>

***

### createHostedContext()

> **createHostedContext**\<`T`\>(`command`, `args`): `Promise`\<[`HostedContext`](#hostedcontext)\<`T`\>\>

#### Type Parameters

##### T

`T` *extends* [`ContextTypes`](../context-client/index.md#contexttypes) = [`UnknownContextTypes`](../context-client/index.md#unknowncontexttypes)

#### Parameters

##### command

`string`

##### args

`string`[] = `[]`

#### Returns

`Promise`\<[`HostedContext`](#hostedcontext)\<`T`\>\>

***

### getContextToolID()

> **getContextToolID**(`contextKey`, `toolName`): `string`

#### Parameters

##### contextKey

`string`

##### toolName

`string`

#### Returns

`string`

***

### getContextToolInfo()

> **getContextToolInfo**(`id`): \[`string`, `string`\]

#### Parameters

##### id

`string`

#### Returns

\[`string`, `string`\]

***

### runDaemon()

> **runDaemon**(`options`): `Promise`\<[`HostClient`](#hostclient)\>

#### Parameters

##### options

`DaemonOptions` = `{}`

#### Returns

`Promise`\<[`HostClient`](#hostclient)\>

***

### startServer()

> **startServer**(`params`): `Promise`\<`Server`\>

#### Parameters

##### params

[`ServerParams`](#serverparams) = `{}`

#### Returns

`Promise`\<`Server`\>
