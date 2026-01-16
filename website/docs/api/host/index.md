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

##### Constructor

> **new ContextHost**(`params?`): [`ContextHost`](#contexthost)

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

> **get** **contexts**(): `Record`\<`string`, [`HostedContext`](#hostedcontext)\>

###### Returns

`Record`\<`string`, [`HostedContext`](#hostedcontext)\>

#### Methods

##### addDirectContext()

> **addDirectContext**\<`T`\>(`params`): [`ContextClient`](../context-client/index.md#contextclient)\<`T`\>

###### Type Parameters

###### T

`T` *extends* [`ContextTypes`](../context-client/index.md#contexttypes) = [`UnknownContextTypes`](../context-client/index.md#unknowncontexttypes)

###### Parameters

###### params

[`AddDirectContextParams`](#adddirectcontextparams)

###### Returns

[`ContextClient`](../context-client/index.md#contextclient)\<`T`\>

##### addLocalContext()

> **addLocalContext**\<`T`\>(`params`): `Promise`\<[`ContextClient`](../context-client/index.md#contextclient)\<`T`\>\>

###### Type Parameters

###### T

`T` *extends* [`ContextTypes`](../context-client/index.md#contexttypes) = [`UnknownContextTypes`](../context-client/index.md#unknowncontexttypes)

###### Parameters

###### params

[`AddLocalContextParams`](#addlocalcontextparams)

###### Returns

`Promise`\<[`ContextClient`](../context-client/index.md#contextclient)\<`T`\>\>

##### callNamespacedTool()

> **callNamespacedTool**(`id`, `args`, `metadata?`): [`SentRequest`](../context-rpc/index.md#sentrequest)\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; `structuredContent?`: \{\[`key`: `string`\]: `unknown`; \}; \}\>

###### Parameters

###### id

`string`

###### args

`Record`\<`string`, `unknown`\> = `{}`

###### metadata?

###### Returns

[`SentRequest`](../context-rpc/index.md#sentrequest)\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; `structuredContent?`: \{\[`key`: `string`\]: `unknown`; \}; \}\>

##### callTool()

> **callTool**\<`T`\>(`key`, `params`): [`SentRequest`](../context-rpc/index.md#sentrequest)\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; `structuredContent?`: \{\[`key`: `string`\]: `unknown`; \}; \}\>

###### Type Parameters

###### T

`T` *extends* [`ContextTypes`](../context-client/index.md#contexttypes) = [`UnknownContextTypes`](../context-client/index.md#unknowncontexttypes)

###### Parameters

###### key

`string`

###### params

[`ToolParams`](../context-client/index.md#toolparams)\<`T`\>

###### Returns

[`SentRequest`](../context-rpc/index.md#sentrequest)\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; `structuredContent?`: \{\[`key`: `string`\]: `unknown`; \}; \}\>

##### createContext()

> **createContext**\<`T`\>(`params`): [`ContextClient`](../context-client/index.md#contextclient)\<`T`\>

###### Type Parameters

###### T

`T` *extends* [`ContextTypes`](../context-client/index.md#contexttypes) = [`UnknownContextTypes`](../context-client/index.md#unknowncontexttypes)

###### Parameters

###### params

[`CreateContextParams`](#createcontextparams)

###### Returns

[`ContextClient`](../context-client/index.md#contextclient)\<`T`\>

##### disableContextTools()

> **disableContextTools**(`key`, `toolNames`): [`ContextTool`](#contexttool)[]

###### Parameters

###### key

`string`

###### toolNames

`string`[]

###### Returns

[`ContextTool`](#contexttool)[]

##### enableContextTools()

> **enableContextTools**(`key`, `toolNames`): [`ContextTool`](#contexttool)[]

###### Parameters

###### key

`string`

###### toolNames

`string`[]

###### Returns

[`ContextTool`](#contexttool)[]

##### getCallableTools()

> **getCallableTools**(): `object`[]

###### Returns

`object`[]

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

##### getContextKeys()

> **getContextKeys**(): `string`[]

###### Returns

`string`[]

##### getEnabledTools()

> **getEnabledTools**(): [`ContextTool`](#contexttool)[]

###### Returns

[`ContextTool`](#contexttool)[]

##### getPrompt()

> **getPrompt**\<`T`\>(`key`, `params`): [`SentRequest`](../context-rpc/index.md#sentrequest)\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `description?`: `string`; `messages`: `object`[]; \}\>

###### Type Parameters

###### T

`T` *extends* [`ContextTypes`](../context-client/index.md#contexttypes) = [`UnknownContextTypes`](../context-client/index.md#unknowncontexttypes)

###### Parameters

###### key

`string`

###### params

[`PromptParams`](../context-client/index.md#promptparams)\<`T`\>

###### Returns

[`SentRequest`](../context-rpc/index.md#sentrequest)\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `description?`: `string`; `messages`: `object`[]; \}\>

##### remove()

> **remove**(`key`): `Promise`\<`void`\>

###### Parameters

###### key

`string`

###### Returns

`Promise`\<`void`\>

##### setContextTools()

> **setContextTools**(`key`, `tools`): `void`

###### Parameters

###### key

`string`

###### tools

[`ContextTool`](#contexttool)[]

###### Returns

`void`

##### setEnabledContextTools()

> **setEnabledContextTools**(`key`, `toolNames`): [`ContextTool`](#contexttool)[]

###### Parameters

###### key

`string`

###### toolNames

`string`[]

###### Returns

[`ContextTool`](#contexttool)[]

##### setup()

> **setup**(`key`, `enableTools`): `Promise`\<[`ContextTool`](#contexttool)[]\>

###### Parameters

###### key

`string`

###### enableTools

[`EnableToolsArg`](#enabletoolsarg) = `true`

###### Returns

`Promise`\<[`ContextTool`](#contexttool)[]\>

***

### ProxyHost

#### Extends

- [`ContextHost`](#contexthost)

#### Constructors

##### Constructor

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

##### contexts

###### Get Signature

> **get** **contexts**(): `Record`\<`string`, [`HostedContext`](#hostedcontext)\>

###### Returns

`Record`\<`string`, [`HostedContext`](#hostedcontext)\>

###### Inherited from

[`ContextHost`](#contexthost).[`contexts`](#contexts)

#### Methods

##### addDirectContext()

> **addDirectContext**\<`T`\>(`params`): [`ContextClient`](../context-client/index.md#contextclient)\<`T`\>

###### Type Parameters

###### T

`T` *extends* [`ContextTypes`](../context-client/index.md#contexttypes) = [`UnknownContextTypes`](../context-client/index.md#unknowncontexttypes)

###### Parameters

###### params

[`AddDirectContextParams`](#adddirectcontextparams)

###### Returns

[`ContextClient`](../context-client/index.md#contextclient)\<`T`\>

###### Inherited from

[`ContextHost`](#contexthost).[`addDirectContext`](#adddirectcontext)

##### addLocalContext()

> **addLocalContext**\<`T`\>(`params`): `Promise`\<[`ContextClient`](../context-client/index.md#contextclient)\<`T`\>\>

###### Type Parameters

###### T

`T` *extends* [`ContextTypes`](../context-client/index.md#contexttypes) = [`UnknownContextTypes`](../context-client/index.md#unknowncontexttypes)

###### Parameters

###### params

[`AddLocalContextParams`](#addlocalcontextparams)

###### Returns

`Promise`\<[`ContextClient`](../context-client/index.md#contextclient)\<`T`\>\>

###### Inherited from

[`ContextHost`](#contexthost).[`addLocalContext`](#addlocalcontext)

##### callNamespacedTool()

> **callNamespacedTool**(`id`, `args`, `metadata?`): [`SentRequest`](../context-rpc/index.md#sentrequest)\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; `structuredContent?`: \{\[`key`: `string`\]: `unknown`; \}; \}\>

###### Parameters

###### id

`string`

###### args

`Record`\<`string`, `unknown`\> = `{}`

###### metadata?

###### Returns

[`SentRequest`](../context-rpc/index.md#sentrequest)\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; `structuredContent?`: \{\[`key`: `string`\]: `unknown`; \}; \}\>

###### Inherited from

[`ContextHost`](#contexthost).[`callNamespacedTool`](#callnamespacedtool)

##### callTool()

> **callTool**\<`T`\>(`key`, `params`): [`SentRequest`](../context-rpc/index.md#sentrequest)\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; `structuredContent?`: \{\[`key`: `string`\]: `unknown`; \}; \}\>

###### Type Parameters

###### T

`T` *extends* [`ContextTypes`](../context-client/index.md#contexttypes) = [`UnknownContextTypes`](../context-client/index.md#unknowncontexttypes)

###### Parameters

###### key

`string`

###### params

[`ToolParams`](../context-client/index.md#toolparams)\<`T`\>

###### Returns

[`SentRequest`](../context-rpc/index.md#sentrequest)\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; `structuredContent?`: \{\[`key`: `string`\]: `unknown`; \}; \}\>

###### Inherited from

[`ContextHost`](#contexthost).[`callTool`](#calltool)

##### createContext()

> **createContext**\<`T`\>(`params`): [`ContextClient`](../context-client/index.md#contextclient)\<`T`\>

###### Type Parameters

###### T

`T` *extends* [`ContextTypes`](../context-client/index.md#contexttypes) = [`UnknownContextTypes`](../context-client/index.md#unknowncontexttypes)

###### Parameters

###### params

[`CreateContextParams`](#createcontextparams)

###### Returns

[`ContextClient`](../context-client/index.md#contextclient)\<`T`\>

###### Inherited from

[`ContextHost`](#contexthost).[`createContext`](#createcontext)

##### disableContextTools()

> **disableContextTools**(`key`, `toolNames`): [`ContextTool`](#contexttool)[]

###### Parameters

###### key

`string`

###### toolNames

`string`[]

###### Returns

[`ContextTool`](#contexttool)[]

###### Inherited from

[`ContextHost`](#contexthost).[`disableContextTools`](#disablecontexttools)

##### enableContextTools()

> **enableContextTools**(`key`, `toolNames`): [`ContextTool`](#contexttool)[]

###### Parameters

###### key

`string`

###### toolNames

`string`[]

###### Returns

[`ContextTool`](#contexttool)[]

###### Inherited from

[`ContextHost`](#contexthost).[`enableContextTools`](#enablecontexttools)

##### getCallableTools()

> **getCallableTools**(): `object`[]

###### Returns

`object`[]

###### Inherited from

[`ContextHost`](#contexthost).[`getCallableTools`](#getcallabletools)

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

##### getContextKeys()

> **getContextKeys**(): `string`[]

###### Returns

`string`[]

###### Inherited from

[`ContextHost`](#contexthost).[`getContextKeys`](#getcontextkeys)

##### getEnabledTools()

> **getEnabledTools**(): [`ContextTool`](#contexttool)[]

###### Returns

[`ContextTool`](#contexttool)[]

###### Inherited from

[`ContextHost`](#contexthost).[`getEnabledTools`](#getenabledtools)

##### getPrompt()

> **getPrompt**\<`T`\>(`key`, `params`): [`SentRequest`](../context-rpc/index.md#sentrequest)\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `description?`: `string`; `messages`: `object`[]; \}\>

###### Type Parameters

###### T

`T` *extends* [`ContextTypes`](../context-client/index.md#contexttypes) = [`UnknownContextTypes`](../context-client/index.md#unknowncontexttypes)

###### Parameters

###### key

`string`

###### params

[`PromptParams`](../context-client/index.md#promptparams)\<`T`\>

###### Returns

[`SentRequest`](../context-rpc/index.md#sentrequest)\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `description?`: `string`; `messages`: `object`[]; \}\>

###### Inherited from

[`ContextHost`](#contexthost).[`getPrompt`](#getprompt)

##### remove()

> **remove**(`key`): `Promise`\<`void`\>

###### Parameters

###### key

`string`

###### Returns

`Promise`\<`void`\>

###### Inherited from

[`ContextHost`](#contexthost).[`remove`](#remove)

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

##### setEnabledContextTools()

> **setEnabledContextTools**(`key`, `toolNames`): [`ContextTool`](#contexttool)[]

###### Parameters

###### key

`string`

###### toolNames

`string`[]

###### Returns

[`ContextTool`](#contexttool)[]

###### Inherited from

[`ContextHost`](#contexthost).[`setEnabledContextTools`](#setenabledcontexttools)

##### setup()

> **setup**(`key`, `enableTools`): `Promise`\<[`ContextTool`](#contexttool)[]\>

###### Parameters

###### key

`string`

###### enableTools

[`EnableToolsArg`](#enabletoolsarg) = `true`

###### Returns

`Promise`\<[`ContextTool`](#contexttool)[]\>

###### Inherited from

[`ContextHost`](#contexthost).[`setup`](#setup)

##### spawn()

> **spawn**\<`T`\>(`params`): `Promise`\<[`ContextClient`](../context-client/index.md#contextclient)\<`T`\>\>

###### Type Parameters

###### T

`T` *extends* [`ContextTypes`](../context-client/index.md#contexttypes) = [`UnknownContextTypes`](../context-client/index.md#unknowncontexttypes)

###### Parameters

###### params

`ProxySpawnParams`

###### Returns

`Promise`\<[`ContextClient`](../context-client/index.md#contextclient)\<`T`\>\>

##### forDaemon()

> `static` **forDaemon**(`options?`): `Promise`\<[`ProxyHost`](#proxyhost)\>

###### Parameters

###### options?

`DaemonOptions`

###### Returns

`Promise`\<[`ProxyHost`](#proxyhost)\>

## Type Aliases

### AddDirectContextParams

> **AddDirectContextParams** = `object`

#### Properties

##### config

> **config**: [`ServerConfig`](../context-server/index.md#serverconfig)

##### key

> **key**: `string`

##### tools?

> `optional` **tools**: [`ContextTool`](#contexttool)[]

***

### AddLocalContextParams

> **AddLocalContextParams** = [`SpawnContextServerParams`](#spawncontextserverparams) & `object`

#### Type Declaration

##### key

> **key**: `string`

***

### AllowToolCalls

> **AllowToolCalls** = `"always"` \| `"ask"` \| `"never"`

***

### ContextTool

> **ContextTool** = `object`

#### Properties

##### allow?

> `optional` **allow**: [`AllowToolCalls`](#allowtoolcalls)

##### enabled

> **enabled**: `boolean`

##### id

> **id**: `string`

##### tool

> **tool**: [`Tool`](../context-protocol/index.md#tool)

***

### CreateContextParams

> **CreateContextParams** = `CreateHostedContextParams` & `object`

#### Type Declaration

##### key

> **key**: `string`

***

### EnableTools

> **EnableTools** = `boolean` \| `string`[]

***

### EnableToolsArg

> **EnableToolsArg** = [`EnableTools`](#enabletools) \| [`EnableToolsFn`](#enabletoolsfn)

***

### EnableToolsFn()

> **EnableToolsFn** = (`tools`) => [`EnableTools`](#enabletools) \| `Promise`\<[`EnableTools`](#enabletools)\>

#### Parameters

##### tools

[`Tool`](../context-protocol/index.md#tool)[]

#### Returns

[`EnableTools`](#enabletools) \| `Promise`\<[`EnableTools`](#enabletools)\>

***

### HostClient

> **HostClient** = `Client`\<[`Protocol`](../host-protocol/index.md#protocol)\>

***

### HostedContext

> **HostedContext**\<`T`\> = `object`

#### Type Parameters

##### T

`T` *extends* [`ContextTypes`](../context-client/index.md#contexttypes) = [`UnknownContextTypes`](../context-client/index.md#unknowncontexttypes)

#### Properties

##### client

> **client**: [`ContextClient`](../context-client/index.md#contextclient)\<`T`\>

##### disposer

> **disposer**: `Disposer`

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

##### socketPath?

> `optional` **socketPath**: `string`

***

### SpawnContextServerParams

> **SpawnContextServerParams** = `object`

#### Properties

##### args?

> `optional` **args**: `string`[]

##### command

> **command**: `string`

##### env?

> `optional` **env**: `Record`\<`string`, `string` \| `null` \| `undefined`\>

##### stderr?

> `optional` **stderr**: [`StderrOption`](#stderroption)

***

### StderrOption

> **StderrOption** = `IOType` \| `number` \| `Writable`

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

> **createHostedContext**\<`T`\>(`params`): [`HostedContext`](#hostedcontext)\<`T`\>

#### Type Parameters

##### T

`T` *extends* [`ContextTypes`](../context-client/index.md#contexttypes) = [`UnknownContextTypes`](../context-client/index.md#unknowncontexttypes)

#### Parameters

##### params

`CreateHostedContextParams`

#### Returns

[`HostedContext`](#hostedcontext)\<`T`\>

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

### spawnHostedContext()

> **spawnHostedContext**\<`T`\>(`params`): `Promise`\<[`HostedContext`](#hostedcontext)\<`T`\>\>

#### Type Parameters

##### T

`T` *extends* [`ContextTypes`](../context-client/index.md#contexttypes) = [`UnknownContextTypes`](../context-client/index.md#unknowncontexttypes)

#### Parameters

##### params

[`SpawnContextServerParams`](#spawncontextserverparams)

#### Returns

`Promise`\<[`HostedContext`](#hostedcontext)\<`T`\>\>

***

### startServer()

> **startServer**(`params`): `Promise`\<`Server`\>

#### Parameters

##### params

[`ServerParams`](#serverparams) = `{}`

#### Returns

`Promise`\<`Server`\>
