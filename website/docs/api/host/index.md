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

- [`ProxyHost`](index.md#proxyhost)

#### Constructors

##### new ContextHost()

> **new ContextHost**(`params`?): [`ContextHost`](index.md#contexthost)

###### Parameters

###### params?

`DisposerParams`

###### Returns

[`ContextHost`](index.md#contexthost)

###### Inherited from

`Disposer.constructor`

#### Accessors

##### contexts

###### Get Signature

> **get** **contexts**(): `Record`\<`string`, [`HostedContext`](index.md#hostedcontextt)\<[`UnknownContextTypes`](../context-client/index.md#unknowncontexttypes)\>\>

###### Returns

`Record`\<`string`, [`HostedContext`](index.md#hostedcontextt)\<[`UnknownContextTypes`](../context-client/index.md#unknowncontexttypes)\>\>

#### Methods

##### callTool()

> **callTool**(`key`, `name`, `args`): [`ClientRequest`](../context-client/index.md#clientrequestresult)\<\{ `[key: string]`: `unknown`;  `_meta`: \{\}; `content`: (\{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `resource`: \{ `[key: string]`: `unknown`;  `mimeType`: `string`; `text`: `string`; `uri`: `string`; \} \| \{ `[key: string]`: `unknown`;  `blob`: `string`; `mimeType`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError`: `boolean`; \}\>

###### Parameters

###### key

`string`

###### name

`string`

###### args

`Record`\<`string`, `unknown`\>

###### Returns

[`ClientRequest`](../context-client/index.md#clientrequestresult)\<\{ `[key: string]`: `unknown`;  `_meta`: \{\}; `content`: (\{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `resource`: \{ `[key: string]`: `unknown`;  `mimeType`: `string`; `text`: `string`; `uri`: `string`; \} \| \{ `[key: string]`: `unknown`;  `blob`: `string`; `mimeType`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError`: `boolean`; \}\>

***

##### getContext()

> **getContext**\<`T`\>(`key`): [`HostedContext`](index.md#hostedcontextt)\<`T`\>

###### Type Parameters

• **T** *extends* [`ContextTypes`](../context-client/index.md#contexttypes) = [`UnknownContextTypes`](../context-client/index.md#unknowncontexttypes)

###### Parameters

###### key

`string`

###### Returns

[`HostedContext`](index.md#hostedcontextt)\<`T`\>

***

##### getContextKeys()

> **getContextKeys**(): `string`[]

###### Returns

`string`[]

***

##### getEnabledTools()

> **getEnabledTools**(): [`ContextTool`](index.md#contexttool)[]

###### Returns

[`ContextTool`](index.md#contexttool)[]

***

##### getPrompt()

> **getPrompt**(`key`, `name`, `args`): [`ClientRequest`](../context-client/index.md#clientrequestresult)\<\{ `[key: string]`: `unknown`;  `_meta`: \{\}; `description`: `string`; `messages`: `object`[]; \}\>

###### Parameters

###### key

`string`

###### name

`string`

###### args

`Record`\<`string`, `unknown`\> = `{}`

###### Returns

[`ClientRequest`](../context-client/index.md#clientrequestresult)\<\{ `[key: string]`: `unknown`;  `_meta`: \{\}; `description`: `string`; `messages`: `object`[]; \}\>

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

[`ContextTool`](index.md#contexttool)[]

###### Returns

`void`

***

##### setup()

> **setup**(`key`): `Promise`\<[`ContextTool`](index.md#contexttool)[]\>

###### Parameters

###### key

`string`

###### Returns

`Promise`\<[`ContextTool`](index.md#contexttool)[]\>

***

##### spawn()

> **spawn**(`key`, `command`, `args`): `Promise`\<[`ContextClient`](../context-client/index.md#contextclientt)\<[`UnknownContextTypes`](../context-client/index.md#unknowncontexttypes)\>\>

###### Parameters

###### key

`string`

###### command

`string`

###### args

`string`[] = `[]`

###### Returns

`Promise`\<[`ContextClient`](../context-client/index.md#contextclientt)\<[`UnknownContextTypes`](../context-client/index.md#unknowncontexttypes)\>\>

***

### ProxyHost

#### Extends

- [`ContextHost`](index.md#contexthost)

#### Constructors

##### new ProxyHost()

> **new ProxyHost**(`client`): [`ProxyHost`](index.md#proxyhost)

###### Parameters

###### client

[`HostClient`](index.md#hostclient)

###### Returns

[`ProxyHost`](index.md#proxyhost)

###### Overrides

[`ContextHost`](index.md#contexthost).[`constructor`](index.md#constructors-1)

#### Accessors

##### client

###### Get Signature

> **get** **client**(): [`HostClient`](index.md#hostclient)

###### Returns

[`HostClient`](index.md#hostclient)

***

##### contexts

###### Get Signature

> **get** **contexts**(): `Record`\<`string`, [`HostedContext`](index.md#hostedcontextt)\<[`UnknownContextTypes`](../context-client/index.md#unknowncontexttypes)\>\>

###### Returns

`Record`\<`string`, [`HostedContext`](index.md#hostedcontextt)\<[`UnknownContextTypes`](../context-client/index.md#unknowncontexttypes)\>\>

###### Inherited from

[`ContextHost`](index.md#contexthost).[`contexts`](index.md#contexts-2)

#### Methods

##### callTool()

> **callTool**(`key`, `name`, `args`): [`ClientRequest`](../context-client/index.md#clientrequestresult)\<\{ `[key: string]`: `unknown`;  `_meta`: \{\}; `content`: (\{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `resource`: \{ `[key: string]`: `unknown`;  `mimeType`: `string`; `text`: `string`; `uri`: `string`; \} \| \{ `[key: string]`: `unknown`;  `blob`: `string`; `mimeType`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError`: `boolean`; \}\>

###### Parameters

###### key

`string`

###### name

`string`

###### args

`Record`\<`string`, `unknown`\>

###### Returns

[`ClientRequest`](../context-client/index.md#clientrequestresult)\<\{ `[key: string]`: `unknown`;  `_meta`: \{\}; `content`: (\{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `[key: string]`: `unknown`;  `annotations`: \{ `[key: string]`: `unknown`;  `audience`: (`"assistant"` \| `"user"`)[]; `priority`: `number`; \}; `resource`: \{ `[key: string]`: `unknown`;  `mimeType`: `string`; `text`: `string`; `uri`: `string`; \} \| \{ `[key: string]`: `unknown`;  `blob`: `string`; `mimeType`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError`: `boolean`; \}\>

###### Inherited from

[`ContextHost`](index.md#contexthost).[`callTool`](index.md#calltool-2)

***

##### getContext()

> **getContext**\<`T`\>(`key`): [`HostedContext`](index.md#hostedcontextt)\<`T`\>

###### Type Parameters

• **T** *extends* [`ContextTypes`](../context-client/index.md#contexttypes) = [`UnknownContextTypes`](../context-client/index.md#unknowncontexttypes)

###### Parameters

###### key

`string`

###### Returns

[`HostedContext`](index.md#hostedcontextt)\<`T`\>

###### Inherited from

[`ContextHost`](index.md#contexthost).[`getContext`](index.md#getcontext-1)

***

##### getContextKeys()

> **getContextKeys**(): `string`[]

###### Returns

`string`[]

###### Inherited from

[`ContextHost`](index.md#contexthost).[`getContextKeys`](index.md#getcontextkeys-2)

***

##### getEnabledTools()

> **getEnabledTools**(): [`ContextTool`](index.md#contexttool)[]

###### Returns

[`ContextTool`](index.md#contexttool)[]

###### Inherited from

[`ContextHost`](index.md#contexthost).[`getEnabledTools`](index.md#getenabledtools-2)

***

##### getPrompt()

> **getPrompt**(`key`, `name`, `args`): [`ClientRequest`](../context-client/index.md#clientrequestresult)\<\{ `[key: string]`: `unknown`;  `_meta`: \{\}; `description`: `string`; `messages`: `object`[]; \}\>

###### Parameters

###### key

`string`

###### name

`string`

###### args

`Record`\<`string`, `unknown`\> = `{}`

###### Returns

[`ClientRequest`](../context-client/index.md#clientrequestresult)\<\{ `[key: string]`: `unknown`;  `_meta`: \{\}; `description`: `string`; `messages`: `object`[]; \}\>

###### Inherited from

[`ContextHost`](index.md#contexthost).[`getPrompt`](index.md#getprompt-2)

***

##### remove()

> **remove**(`key`): `Promise`\<`void`\>

###### Parameters

###### key

`string`

###### Returns

`Promise`\<`void`\>

###### Inherited from

[`ContextHost`](index.md#contexthost).[`remove`](index.md#remove-2)

***

##### setContextTools()

> **setContextTools**(`key`, `tools`): `void`

###### Parameters

###### key

`string`

###### tools

[`ContextTool`](index.md#contexttool)[]

###### Returns

`void`

###### Inherited from

[`ContextHost`](index.md#contexthost).[`setContextTools`](index.md#setcontexttools-2)

***

##### setup()

> **setup**(`key`): `Promise`\<[`ContextTool`](index.md#contexttool)[]\>

###### Parameters

###### key

`string`

###### Returns

`Promise`\<[`ContextTool`](index.md#contexttool)[]\>

###### Inherited from

[`ContextHost`](index.md#contexthost).[`setup`](index.md#setup-2)

***

##### spawn()

> **spawn**(`key`, `command`, `args`): `Promise`\<[`ContextClient`](../context-client/index.md#contextclientt)\<[`UnknownContextTypes`](../context-client/index.md#unknowncontexttypes)\>\>

###### Parameters

###### key

`string`

###### command

`string`

###### args

`string`[] = `[]`

###### Returns

`Promise`\<[`ContextClient`](../context-client/index.md#contextclientt)\<[`UnknownContextTypes`](../context-client/index.md#unknowncontexttypes)\>\>

###### Overrides

[`ContextHost`](index.md#contexthost).[`spawn`](index.md#spawn-2)

***

##### forDaemon()

> `static` **forDaemon**(`options`?): `Promise`\<[`ProxyHost`](index.md#proxyhost)\>

###### Parameters

###### options?

`DaemonOptions`

###### Returns

`Promise`\<[`ProxyHost`](index.md#proxyhost)\>

## Type Aliases

### AllowToolCalls

> **AllowToolCalls**: `"always"` \| `"ask"` \| `"never"`

***

### ContextTool

> **ContextTool**: `object`

#### Type declaration

##### allow?

> `optional` **allow**: [`AllowToolCalls`](index.md#allowtoolcalls)

##### enabled

> **enabled**: `boolean`

##### id

> **id**: `string`

##### tool

> **tool**: [`Tool`](../context-protocol/index.md#tool)

***

### HostClient

> **HostClient**: `Client`\<[`Protocol`](../host-protocol/index.md#protocol)\>

***

### HostedContext\<T\>

> **HostedContext**\<`T`\>: `object`

#### Type Parameters

• **T** *extends* [`ContextTypes`](../context-client/index.md#contexttypes) = [`UnknownContextTypes`](../context-client/index.md#unknowncontexttypes)

#### Type declaration

##### client

> **client**: [`ContextClient`](../context-client/index.md#contextclientt)\<`T`\>

##### disposer

> **disposer**: `Disposer`

##### tools

> **tools**: [`ContextTool`](index.md#contexttool)[]

***

### ServerParams

> **ServerParams**: `object`

#### Type declaration

##### shutdown()?

> `optional` **shutdown**: () => `void` \| `Promise`\<`void`\>

###### Returns

`void` \| `Promise`\<`void`\>

##### socketPath?

> `optional` **socketPath**: `string`

## Functions

### createClient()

> **createClient**(`socketPath`): `Promise`\<[`HostClient`](index.md#hostclient)\>

#### Parameters

##### socketPath

`string` = `DEFAULT_SOCKET_PATH`

#### Returns

`Promise`\<[`HostClient`](index.md#hostclient)\>

***

### createHostedContext()

> **createHostedContext**\<`T`\>(`command`, `args`): `Promise`\<[`HostedContext`](index.md#hostedcontextt)\<`T`\>\>

#### Type Parameters

• **T** *extends* [`ContextTypes`](../context-client/index.md#contexttypes) = [`UnknownContextTypes`](../context-client/index.md#unknowncontexttypes)

#### Parameters

##### command

`string`

##### args

`string`[] = `[]`

#### Returns

`Promise`\<[`HostedContext`](index.md#hostedcontextt)\<`T`\>\>

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

> **runDaemon**(`options`): `Promise`\<[`HostClient`](index.md#hostclient)\>

#### Parameters

##### options

`DaemonOptions` = `{}`

#### Returns

`Promise`\<[`HostClient`](index.md#hostclient)\>

***

### startServer()

> **startServer**(`params`): `Promise`\<`Server`\>

#### Parameters

##### params

[`ServerParams`](index.md#serverparams) = `{}`

#### Returns

`Promise`\<`Server`\>
