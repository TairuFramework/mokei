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

#### Constructors

##### Constructor

> **new ContextHost**(`params?`): [`ContextHost`](#contexthost)

###### Parameters

###### params?

[`ContextHostParams`](#contexthostparams) = `{}`

###### Returns

[`ContextHost`](#contexthost)

###### Overrides

`Disposer.constructor`

#### Accessors

##### contexts

###### Get Signature

> **get** **contexts**(): `Record`\<`string`, [`HostedContext`](#hostedcontext)\>

###### Returns

`Record`\<`string`, [`HostedContext`](#hostedcontext)\>

##### elicitationEnabled

###### Get Signature

> **get** **elicitationEnabled**(): `boolean`

###### Returns

`boolean`

##### events

###### Get Signature

> **get** **events**(): `EventEmitter`\<`HostEvents`\>

Observe context lifecycle and subscription events.

###### Returns

`EventEmitter`\<`HostEvents`\>

##### localTools

###### Get Signature

> **get** **localTools**(): `Map`\<`string`, [`LocalTool`](#localtool)\>

Get the map of registered local tools.

###### Returns

`Map`\<`string`, [`LocalTool`](#localtool)\>

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

##### addHTTPContext()

> **addHTTPContext**\<`T`\>(`params`): `Promise`\<[`ContextClient`](../context-client/index.md#contextclient)\<`T`\>\>

Add a context that connects to a remote MCP server via HTTP.

This implements the MCP Streamable HTTP transport specification,
supporting session management and both JSON and SSE responses.

###### Type Parameters

###### T

`T` *extends* [`ContextTypes`](../context-client/index.md#contexttypes) = [`UnknownContextTypes`](../context-client/index.md#unknowncontexttypes)

###### Parameters

###### params

[`HTTPContextParams`](#httpcontextparams)

###### Returns

`Promise`\<[`ContextClient`](../context-client/index.md#contextclient)\<`T`\>\>

###### Example

```typescript
// Basic HTTP connection
const client = await host.addHTTPContext({
  key: 'remote-api',
  url: 'https://mcp.example.com/api',
})

// With authentication
const client = await host.addHTTPContext({
  key: 'authenticated-api',
  url: 'https://mcp.example.com/api',
  auth: { type: 'bearer', token: 'your-api-key' },
  timeout: 60000,
})

// Setup tools after connecting
const tools = await host.setup({ key: 'remote-api' })
```

##### addLocalTool()

> **addLocalTool**(`definition`): `void`

Register a local tool that can be called without an MCP server.
Local tools are namespaced as `local:toolName`.

###### Parameters

###### definition

[`LocalToolDefinition`](#localtooldefinition)

###### Returns

`void`

###### Example

```typescript
host.addLocalTool({
  name: 'calculate',
  description: 'Evaluate a math expression',
  inputSchema: {
    type: 'object',
    properties: { expression: { type: 'string' } },
    required: ['expression']
  },
  execute: async ({ arguments: { expression } }) => {
    const result = eval(expression)
    return { content: [{ type: 'text', text: String(result) }] }
  }
})
```

##### addLocalTools()

> **addLocalTools**(`definitions`): `void`

Register multiple local tools at once.

###### Parameters

###### definitions

[`LocalToolDefinition`](#localtooldefinition)[]

###### Returns

`void`

##### callLocalTool()

> **callLocalTool**(`params`): `Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; `structuredContent?`: \{\[`key`: `string`\]: `unknown`; \}; \}\>

Call a local tool by name. Local tools run in-process, so there is no request to time out.

###### Parameters

###### params

`LocalToolParams`

###### Returns

`Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; `structuredContent?`: \{\[`key`: `string`\]: `unknown`; \}; \}\>

##### callNamespacedTool()

> **callNamespacedTool**(`params`): `Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; `structuredContent?`: \{\[`key`: `string`\]: `unknown`; \}; \}\>

###### Parameters

###### params

`NamespacedToolParams`

###### Returns

`Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; `structuredContent?`: \{\[`key`: `string`\]: `unknown`; \}; \}\>

##### callTool()

> **callTool**\<`T`\>(`params`): `Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; `structuredContent?`: \{\[`key`: `string`\]: `unknown`; \}; \}\>

###### Type Parameters

###### T

`T` *extends* [`ContextTypes`](../context-client/index.md#contexttypes) = [`UnknownContextTypes`](../context-client/index.md#unknowncontexttypes)

###### Parameters

###### params

`ContextToolParams`\<`T`\>

###### Returns

`Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `content`: (\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{\[`key`: `string`\]: `unknown`; `audience?`: (`"assistant"` \| `"user"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; `structuredContent?`: \{\[`key`: `string`\]: `unknown`; \}; \}\>

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

##### createElicitHandler()

> `protected` **createElicitHandler**(`params`): [`ElicitHandler`](../context-client/index.md#elicithandler) \| `undefined`

###### Parameters

###### params

###### elicit?

`false`

###### key

`string`

###### Returns

[`ElicitHandler`](../context-client/index.md#elicithandler) \| `undefined`

##### disableContextTools()

> **disableContextTools**(`params`): [`ContextTool`](#contexttool)[]

###### Parameters

###### params

`ContextToolNamesParams`

###### Returns

[`ContextTool`](#contexttool)[]

##### enableContextTools()

> **enableContextTools**(`params`): [`ContextTool`](#contexttool)[]

###### Parameters

###### params

`ContextToolNamesParams`

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

##### getLocalTool()

> **getLocalTool**(`name`): [`LocalTool`](#localtool) \| `undefined`

Get a local tool by name.

###### Parameters

###### name

`string`

###### Returns

[`LocalTool`](#localtool) \| `undefined`

##### getPrompt()

> **getPrompt**\<`T`\>(`params`): `Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `description?`: `string`; `messages`: `object`[]; \}\>

###### Type Parameters

###### T

`T` *extends* [`ContextTypes`](../context-client/index.md#contexttypes) = [`UnknownContextTypes`](../context-client/index.md#unknowncontexttypes)

###### Parameters

###### params

`ContextPromptParams`\<`T`\>

###### Returns

`Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `description?`: `string`; `messages`: `object`[]; \}\>

##### handleElicitation()

> **handleElicitation**(`handler`): () => `void`

###### Parameters

###### handler

[`HostElicitOverride`](#hostelicitoverride)

###### Returns

() => `void`

##### hasContext()

> **hasContext**(`params`): `boolean`

Check whether a context key is already registered.

###### Parameters

###### params

[`HasContextParams`](#hascontextparams)

###### Returns

`boolean`

##### hasLocalTool()

> **hasLocalTool**(`name`): `boolean`

Check if a local tool exists.

###### Parameters

###### name

`string`

###### Returns

`boolean`

##### registerHostedContext()

> **registerHostedContext**(`params`): `void`

Register a hosted context created by a subclass.

###### Parameters

###### params

[`RegisterHostedContextParams`](#registerhostedcontextparams)

###### Returns

`void`

##### remove()

> **remove**(`key`, `reason?`): `Promise`\<`void`\>

###### Parameters

###### key

`string`

###### reason?

[`TerminationReason`](../context-client/index.md#terminationreason) = `'stopped'`

###### Returns

`Promise`\<`void`\>

##### removeLocalTool()

> **removeLocalTool**(`name`): `boolean`

Remove a local tool by name.

###### Parameters

###### name

`string`

###### Returns

`boolean`

##### setContextTools()

> **setContextTools**(`params`): `void`

###### Parameters

###### params

`SetContextToolsParams`

###### Returns

`void`

##### setEnabledContextTools()

> **setEnabledContextTools**(`params`): [`ContextTool`](#contexttool)[]

###### Parameters

###### params

`ContextToolNamesParams`

###### Returns

[`ContextTool`](#contexttool)[]

##### setup()

> **setup**(`params`): `Promise`\<[`ContextTool`](#contexttool)[]\>

###### Parameters

###### params

`SetupParams`

###### Returns

`Promise`\<[`ContextTool`](#contexttool)[]\>

***

### HTTPTransport

MCP Streamable HTTP client transport.

Implements MCP Streamable HTTP with POST exchanges and a GET notification stream.

#### Extends

- `Transport`\<[`ServerMessage`](../context-protocol/index.md#servermessage-1), [`ClientMessage`](../context-protocol/index.md#clientmessage)\>

#### Constructors

##### Constructor

> **new HTTPTransport**(`params`): [`HTTPTransport`](#httptransport)

###### Parameters

###### params

[`HTTPTransportParams`](#httptransportparams)

###### Returns

[`HTTPTransport`](#httptransport)

###### Overrides

`Transport<ServerMessage, ClientMessage>.constructor`

#### Accessors

##### lastEventID

###### Get Signature

> **get** **lastEventID**(): `string` \| `null`

Get the last event ID received from SSE streams.

###### Returns

`string` \| `null`

##### retryMs

###### Get Signature

> **get** **retryMs**(): `number` \| `null`

Get the retry interval in milliseconds, if specified by the server.

###### Returns

`number` \| `null`

##### sessionID

###### Get Signature

> **get** **sessionID**(): `string` \| `null`

Get the current session ID.

###### Returns

`string` \| `null`

##### streamEvents

###### Get Signature

> **get** **streamEvents**(): `EventEmitter`\<\{ `closed`: \{ `error?`: `Error`; `requestID`: `string` \| `number`; \}; \}\>

Per-exchange stream-closed signal (see #streamEvents's field doc).

###### Returns

`EventEmitter`\<\{ `closed`: \{ `error?`: `Error`; `requestID`: `string` \| `number`; \}; \}\>

#### Methods

##### dispose()

> **dispose**(): `Promise`\<`void`\>

Dispose of the transport.

###### Returns

`Promise`\<`void`\>

###### Overrides

`Transport.dispose`

## Type Aliases

### AddDirectContextParams

> **AddDirectContextParams** = `object`

#### Properties

##### config

> **config**: [`ServerConfig`](../context-server/index.md#serverconfig)

##### elicit?

> `optional` **elicit?**: `false`

##### key

> **key**: `string`

##### protocolVersion?

> `optional` **protocolVersion?**: [`ProtocolVersion`](../context-protocol/index.md#protocolversion) \| `"auto"`

Revision the client speaks, or `'auto'` to probe the server. Defaults to `'auto'`:
the probe resolves `'2026-07-28'` when the server serves it and falls back to
`'2025-11-25'` otherwise. Pin a revision to skip the probe's extra round trip.

##### tools?

> `optional` **tools?**: [`ContextTool`](#contexttool)[]

***

### AllowToolCalls

> **AllowToolCalls** = `"always"` \| `"ask"` \| `"never"`

***

### ContextHostParams

> **ContextHostParams** = `object`

#### Properties

##### dispose?

> `optional` **dispose?**: () => `Promise`\<`void`\>

Subclass teardown, run after every context is removed.

###### Returns

`Promise`\<`void`\>

##### elicit?

> `optional` **elicit?**: [`HostElicitHandler`](#hostelicithandler) \| `true`

##### tracing?

> `optional` **tracing?**: `object`

MCP payload capture defaults to 'off'.

###### parentFrom?

> `optional` **parentFrom?**: [`TraceParentFrom`](../context-client/index.md#traceparentfrom)

###### payloads?

> `optional` **payloads?**: [`PayloadCapture`](../context-client/index.md#payloadcapture)

***

### ContextTool

> **ContextTool** = `object`

#### Properties

##### allow?

> `optional` **allow?**: [`AllowToolCalls`](#allowtoolcalls)

##### enabled

> **enabled**: `boolean`

##### id

> **id**: `string`

##### tool

> **tool**: [`Tool`](../context-protocol/index.md#tool)

***

### CreateContextParams

> **CreateContextParams** = `Omit`\<[`CreateHostedContextParams`](#createhostedcontextparams), `"elicit"`\> & `object`

#### Type Declaration

##### elicit?

> `optional` **elicit?**: `false`

##### key

> **key**: `string`

***

### CreateHostedContextParams

> **CreateHostedContextParams** = `object`

#### Properties

##### dispose?

> `optional` **dispose?**: () => `void` \| `Promise`\<`void`\>

###### Returns

`void` \| `Promise`\<`void`\>

##### elicit?

> `optional` **elicit?**: [`ElicitHandler`](../context-client/index.md#elicithandler)

##### protocolVersion?

> `optional` **protocolVersion?**: [`ProtocolVersion`](../context-protocol/index.md#protocolversion) \| `"auto"`

Revision the client speaks, or `'auto'` to probe the server. Defaults to `'auto'`:
the probe resolves `'2026-07-28'` when the server serves it and falls back to
`'2025-11-25'` otherwise. Pin a revision to skip the probe's extra round trip.

##### tools?

> `optional` **tools?**: [`ContextTool`](#contexttool)[]

##### transport

> **transport**: [`ClientTransport`](../context-client/index.md#clienttransport)

***

### CreateHTTPClientParams

> **CreateHTTPClientParams** = [`HTTPTransportParams`](#httptransportparams) & `Omit`\<[`ClientParams`](../context-client/index.md#clientparams), `"transport"` \| `"protocolVersion"`\> & `object`

[createHTTPClient](#createhttpclient) parameters: transport params plus [ClientParams](../context-client/index.md#clientparams),
excluding the constructed transport. `protocolVersion` is redeclared for its
separate contract below; its type is unchanged.

#### Type Declaration

##### protocolVersion

> **protocolVersion**: [`ProtocolVersion`](../context-protocol/index.md#protocolversion) \| `"auto"`

Revision to speak. `'auto'` probes the server, then caches the result.

Distinct from [HTTPTransportParams.protocolVersionHeader](#protocolversionheader), the optional raw seed
for the `MCP-Protocol-Version` header: this field drives `ContextClient` negotiation and
is stripped before the transport is constructed, so it never reaches `HTTPTransport`
itself.

***

### ElicitContentValidator

> **ElicitContentValidator** = (`content`) => `string`[]

#### Parameters

##### content

`unknown`

#### Returns

`string`[]

***

### ElicitFallback

> **ElicitFallback** = (`options?`) => `Promise`\<[`ElicitResult`](../context-protocol/index.md#elicitresult)\>

#### Parameters

##### options?

###### signal?

`AbortSignal`

#### Returns

`Promise`\<[`ElicitResult`](../context-protocol/index.md#elicitresult)\>

***

### ElicitValidator

> **ElicitValidator** = `Validator`\<`unknown`\>

***

### EnableTools

> **EnableTools** = `boolean` \| `string`[]

***

### EnableToolsArg

> **EnableToolsArg** = [`EnableTools`](#enabletools) \| [`EnableToolsFn`](#enabletoolsfn)

***

### EnableToolsFn

> **EnableToolsFn** = (`tools`) => [`EnableTools`](#enabletools) \| `Promise`\<[`EnableTools`](#enabletools)\>

#### Parameters

##### tools

[`Tool`](../context-protocol/index.md#tool)[]

#### Returns

[`EnableTools`](#enabletools) \| `Promise`\<[`EnableTools`](#enabletools)\>

***

### HasContextParams

> **HasContextParams** = `object`

#### Properties

##### key

> **key**: `string`

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

### HostElicitHandler

> **HostElicitHandler** = (`request`) => [`ElicitResult`](../context-protocol/index.md#elicitresult) \| `Promise`\<[`ElicitResult`](../context-protocol/index.md#elicitresult)\>

#### Parameters

##### request

[`HostElicitRequest`](#hostelicitrequest)

#### Returns

[`ElicitResult`](../context-protocol/index.md#elicitresult) \| `Promise`\<[`ElicitResult`](../context-protocol/index.md#elicitresult)\>

***

### HostElicitOverride

> **HostElicitOverride** = (`request`, `fallback`) => [`ElicitResult`](../context-protocol/index.md#elicitresult) \| `Promise`\<[`ElicitResult`](../context-protocol/index.md#elicitresult)\>

#### Parameters

##### request

[`HostElicitRequest`](#hostelicitrequest)

##### fallback

[`ElicitFallback`](#elicitfallback)

#### Returns

[`ElicitResult`](../context-protocol/index.md#elicitresult) \| `Promise`\<[`ElicitResult`](../context-protocol/index.md#elicitresult)\>

***

### HostElicitRequest

> **HostElicitRequest** = `object`

#### Properties

##### key

> **key**: `string`

##### params

> **params**: [`ElicitRequest`](../context-protocol/index.md#elicitrequest)\[`"params"`\]

##### signal

> **signal**: `AbortSignal`

***

### HTTPContextParams

> **HTTPContextParams** = `object`

#### Properties

##### auth?

> `optional` **auth?**: `HTTPAuthOptions`

Optional authentication configuration

##### elicit?

> `optional` **elicit?**: `false`

##### fetchMiddleware?

> `optional` **fetchMiddleware?**: `FetchMiddleware`

Fetch middleware (e.g. OAuth from createOAuthMiddleware) applied to the transport.

##### headers?

> `optional` **headers?**: `Record`\<`string`, `string`\>

Optional custom headers to include in requests

##### key

> **key**: `string`

Unique identifier for this context

##### protocolVersion?

> `optional` **protocolVersion?**: [`ProtocolVersion`](../context-protocol/index.md#protocolversion) \| `"auto"`

Revision the client speaks, or `'auto'` to probe the server. Defaults to `'auto'`:
the probe resolves `'2026-07-28'` when the server serves it and falls back to
`'2025-11-25'` otherwise. Pin a revision to skip the probe's extra round trip.

##### timeout?

> `optional` **timeout?**: `number`

Request timeout in milliseconds (default: 30000)

##### url

> **url**: `string`

URL of the MCP HTTP endpoint

***

### HTTPTransportParams

> **HTTPTransportParams** = `object`

Parameters for creating an MCP HTTP transport.

#### Properties

##### auth?

> `optional` **auth?**: `HTTPAuthOptions`

Optional authentication

##### fetchMiddleware?

> `optional` **fetchMiddleware?**: `FetchMiddleware`

Wraps the transport's fetch (e.g. OAuth). Composed once over globalThis.fetch.

##### headers?

> `optional` **headers?**: `Record`\<`string`, `string`\>

Optional custom headers

##### logger?

> `optional` **logger?**: `Logger`

Optional logger (defaults to the `mokei:http-client` logger)

##### protocolVersionHeader?

> `optional` **protocolVersionHeader?**: `string`

Raw seed for `MCP-Protocol-Version`, including legacy revisions outside
[ProtocolVersion](../context-protocol/index.md#protocolversion). Omit it on `initialize` as the specification requires:
`2025-11-25` learns the version from its result; `2026-07-28` declares it in `_meta`.
Unlike CreateHTTPClientParams.protocolVersion, this does not select the
revision the client speaks.

##### refreshTimeout?

> `optional` **refreshTimeout?**: `number`

Budget for the internal schema-refresh `tools/list` (default: 10000).

##### timeout?

> `optional` **timeout?**: `number`

Request timeout in milliseconds (default: 30000)

##### url

> **url**: `string`

URL of the MCP HTTP endpoint

***

### LocalTool

> **LocalTool** = `object`

Internal representation of a registered local tool.

#### Properties

##### execute

> **execute**: [`LocalToolExecute`](#localtoolexecute-1)

The execute function

##### tool

> **tool**: [`Tool`](../context-protocol/index.md#tool)

The MCP-compatible tool definition

***

### LocalToolContext

> **LocalToolContext**\<`TArgs`\> = `object`

Request handed to a local tool's execute function: validated `input`, caller `meta`, and the
signal that aborts if the caller cancels.

Mirrors the `HandlerRequest` a `createTool` handler receives, so a tool is written the
same way whether it runs locally or behind an MCP server. The wire calls this field
`arguments`; handlers see `input`, which (unlike `arguments`) can be destructured -- the
latter is a reserved binding name in strict mode.

#### Type Parameters

##### TArgs

`TArgs` = `Record`\<`string`, `unknown`\>

#### Properties

##### input

> **input**: `TArgs`

##### meta

> **meta**: `Record`\<`string`, [`JSONValue`](../context-server/index.md#jsonvalue)\>

##### signal?

> `optional` **signal?**: `AbortSignal`

***

### LocalToolDefinition

> **LocalToolDefinition**\<`TArgs`\> = `object`

Definition for a local tool that can be registered directly
without setting up a full MCP server.

#### Example

```typescript
const calculator: LocalToolDefinition = {
  name: 'calculate',
  description: 'Evaluate a math expression',
  inputSchema: {
    type: 'object',
    properties: {
      expression: { type: 'string', description: 'Math expression to evaluate' }
    },
    required: ['expression']
  },
  execute: async ({ input: { expression } }) => {
    const result = eval(expression)
    return { content: [{ type: 'text', text: String(result) }] }
  }
}
```

#### Type Parameters

##### TArgs

`TArgs` = `Record`\<`string`, `unknown`\>

#### Properties

##### annotations?

> `optional` **annotations?**: [`ToolAnnotations`](../context-protocol/index.md#toolannotations)

Optional annotations providing hints about tool behaviour

##### description?

> `optional` **description?**: `string`

Human-readable description of what the tool does

##### execute

> **execute**: [`LocalToolExecute`](#localtoolexecute-1)\<`TArgs`\>

Function to execute when the tool is called

##### inputSchema

> **inputSchema**: [`InputSchema`](../context-protocol/index.md#inputschema)

JSON Schema defining the expected input parameters

##### name

> **name**: `string`

Unique name for the tool

***

### LocalToolExecute

> **LocalToolExecute**\<`TArgs`\> = (`request`) => [`CallToolResult`](../context-protocol/index.md#calltoolresult) \| `Promise`\<[`CallToolResult`](../context-protocol/index.md#calltoolresult)\>

Execute function for a local tool.
Receives the validated input and returns a CallToolResult.

#### Type Parameters

##### TArgs

`TArgs` = `Record`\<`string`, `unknown`\>

#### Parameters

##### request

`LocalToolRequest`\<`TArgs`\>

#### Returns

[`CallToolResult`](../context-protocol/index.md#calltoolresult) \| `Promise`\<[`CallToolResult`](../context-protocol/index.md#calltoolresult)\>

***

### RegisterHostedContextParams

> **RegisterHostedContextParams** = `object`

#### Properties

##### context

> **context**: [`HostedContext`](#hostedcontext)

##### key

> **key**: `string`

##### transport?

> `optional` **transport?**: `ContextTransport`

***

### RequestedSchema

> **RequestedSchema** = `Extract`\<[`ElicitRequest`](../context-protocol/index.md#elicitrequest)\[`"params"`\], \{ `requestedSchema`: `unknown`; \}\>\[`"requestedSchema"`\]

## Variables

### DEFAULT\_HTTP\_TIMEOUT

> `const` **DEFAULT\_HTTP\_TIMEOUT**: `30000` = `30000`

Default HTTP request timeout in milliseconds.

***

### LOCAL\_TOOL\_NAMESPACE

> `const` **LOCAL\_TOOL\_NAMESPACE**: `"local"` = `'local'`

The namespace prefix used for local tools.
Local tools are identified as `local:toolName`.

## Functions

### createElicitContentValidator()

> **createElicitContentValidator**(`schema`): [`ElicitContentValidator`](#elicitcontentvalidator)

Compiles a validator for elicitation content, returning issues as `name: problem` (empty
means valid). A schema that cannot be compiled gives a validator reporting that as its one
issue, so it is caught when the validator is created, not when an answer arrives.

#### Parameters

##### schema

###### properties

\{\[`key`: `string`\]: \{\[`key`: `string`\]: `unknown`; `default?`: `string`; `description?`: `string`; `format?`: `"date-time"` \| `"uri"` \| `"date"` \| `"email"`; `maxLength?`: `number`; `minLength?`: `number`; `pattern?`: `string`; `title?`: `string`; `type`: `"string"`; \} \| \{\[`key`: `string`\]: `unknown`; `default?`: `number`; `description?`: `string`; `maximum?`: `number`; `minimum?`: `number`; `title?`: `string`; `type`: `"number"` \| `"integer"`; \} \| \{\[`key`: `string`\]: `unknown`; `default?`: `boolean`; `description?`: `string`; `title?`: `string`; `type`: `"boolean"`; \} \| \{\[`key`: `string`\]: `unknown`; `default?`: `string`; `description?`: `string`; `enum?`: `string`[]; `enumNames?`: `string`[]; `oneOf?`: `object`[]; `title?`: `string`; `type`: `"string"`; \} \| \{\[`key`: `string`\]: `unknown`; `default?`: `string`[]; `description?`: `string`; `items`: \{\[`key`: `string`\]: `unknown`; `enum`: `string`[]; `enumNames?`: `string`[]; `type`: `"string"`; \} \| \{\[`key`: `string`\]: `unknown`; `anyOf`: `object`[]; \}; `title?`: `string`; `type`: `"array"`; \}; \}

###### required?

`string`[]

###### type

`"object"`

#### Returns

[`ElicitContentValidator`](#elicitcontentvalidator)

***

### createHostedContext()

> **createHostedContext**\<`T`\>(`params`): [`HostedContext`](#hostedcontext)\<`T`\>

#### Type Parameters

##### T

`T` *extends* [`ContextTypes`](../context-client/index.md#contexttypes) = [`UnknownContextTypes`](../context-client/index.md#unknowncontexttypes)

#### Parameters

##### params

[`CreateHostedContextParams`](#createhostedcontextparams)

#### Returns

[`HostedContext`](#hostedcontext)\<`T`\>

***

### createHTTPClient()

> **createHTTPClient**\<`T`\>(`params`): [`ContextClient`](../context-client/index.md#contextclient)\<`T`\>

Create an MCP HTTP client with a single call.

Pass transport fields to [HTTPTransport](#httptransport) and every other
[ClientParams](../context-client/index.md#clientparams) field to [ContextClient](../context-client/index.md#contextclient), including MRTR handlers
(SEP-2322). Enumerating client fields here once dropped new options silently;
HTTP\_TRANSPORT\_PARAM\_KEYS is compile-checked instead.

#### Type Parameters

##### T

`T` *extends* [`ContextTypes`](../context-client/index.md#contexttypes) = [`UnknownContextTypes`](../context-client/index.md#unknowncontexttypes)

#### Parameters

##### params

[`CreateHTTPClientParams`](#createhttpclientparams)

#### Returns

[`ContextClient`](../context-client/index.md#contextclient)\<`T`\>

***

### createLocalToolID()

> **createLocalToolID**(`name`): `string`

Create a local tool ID from a tool name.

#### Parameters

##### name

`string`

#### Returns

`string`

***

### createToolFromDefinition()

> **createToolFromDefinition**(`definition`): `object`

Create a Tool definition from a LocalToolDefinition.

#### Parameters

##### definition

[`LocalToolDefinition`](#localtooldefinition)

#### Returns

`object`

##### \_meta?

> `optional` **\_meta?**: `object`

###### Index Signature

\[`key`: `string`\]: `unknown`

##### annotations?

> `optional` **annotations?**: `object`

###### Index Signature

\[`key`: `string`\]: `unknown`

###### annotations.destructiveHint?

> `optional` **destructiveHint?**: `boolean`

###### annotations.idempotentHint?

> `optional` **idempotentHint?**: `boolean`

###### annotations.openWorldHint?

> `optional` **openWorldHint?**: `boolean`

###### annotations.readOnlyHint?

> `optional` **readOnlyHint?**: `boolean`

###### annotations.title?

> `optional` **title?**: `string`

##### description?

> `optional` **description?**: `string`

##### icons?

> `optional` **icons?**: `object`[]

###### Index Signature

\[`key`: `string`\]: `unknown`

##### inputSchema

> **inputSchema**: `object`

###### Index Signature

\[`key`: `string`\]: `unknown`

###### inputSchema.properties?

> `optional` **properties?**: `object`

###### Index Signature

\[`key`: `string`\]: `object`

###### inputSchema.type

> **type**: `"object"`

##### name

> **name**: `string`

##### outputSchema?

> `optional` **outputSchema?**: `object`

###### Index Signature

\[`key`: `string`\]: `unknown`

###### outputSchema.properties?

> `optional` **properties?**: `object`

###### Index Signature

\[`key`: `string`\]: `object`

###### outputSchema.required?

> `optional` **required?**: `string`[]

###### outputSchema.type

> **type**: `"object"`

##### title?

> `optional` **title?**: `string`

***

### elicitCompile()

> **elicitCompile**(`schema`): [`ElicitValidator`](#elicitvalidator)

#### Parameters

##### schema

`false` \| `SchemaObject`

#### Returns

[`ElicitValidator`](#elicitvalidator)

***

### elicitDescribeIssue()

> **elicitDescribeIssue**(`issue`): `string`

A message a person can act on, for one AJV issue about a property value.

#### Parameters

##### issue

`ValidationErrorObject`

#### Returns

`string`

***

### elicitIssuesOf()

> **elicitIssuesOf**(`validator`, `value`): readonly `ValidationErrorObject`[]

#### Parameters

##### validator

`Validator`\<`unknown`\>

##### value

`unknown`

#### Returns

readonly `ValidationErrorObject`[]

***

### elicitMessageOf()

> **elicitMessageOf**(`error`): `string`

Converts a thrown validation error into a readable message.

#### Parameters

##### error

`unknown`

#### Returns

`string`

***

### elicitPropertyValidationSchema()

> **elicitPropertyValidationSchema**(`schema`): `false` \| `SchemaObject`

The part of a server property schema that validation compiles: only the keywords MCP
elicitation primitives allow, each with a value of the right type. Everything else (`$ref`,
`not`, `allOf`, unknown formats, a `minLength` that is not a count...) is dropped, as the
dialogs ignore it. `false` (nothing is valid) for a kind no primitive has.

#### Parameters

##### schema

`unknown`

#### Returns

`false` \| `SchemaObject`

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

### getLocalToolName()

> **getLocalToolName**(`id`): `string`

Get the tool name from a local tool ID.

#### Parameters

##### id

`string`

#### Returns

`string`

#### Throws

If the ID is not a local tool ID

***

### isLocalToolID()

> **isLocalToolID**(`id`): `boolean`

Check if a namespaced tool ID refers to a local tool.

#### Parameters

##### id

`string`

#### Returns

`boolean`

***

### toolsToLocalTools()

> **toolsToLocalTools**(`tools`): [`LocalToolDefinition`](#localtooldefinition)\<`Record`\<`string`, `unknown`\>\>[]

Convert a record of server tool definitions to an array of LocalToolDefinitions.

This allows an entire server config's tools to be used as local tools.

#### Parameters

##### tools

[`ToolDefinitions`](../context-server/index.md#tooldefinitions)

#### Returns

[`LocalToolDefinition`](#localtooldefinition)\<`Record`\<`string`, `unknown`\>\>[]

#### Example

```typescript
import { config } from '@mokei/mcp-sqlite'
import { toolsToLocalTools } from '@mokei/host'
import { Session } from '@mokei/session'

const session = new Session({
  providers: { openai },
  localTools: toolsToLocalTools(config.tools)
})
```

***

### toolToLocalTool()

> **toolToLocalTool**(`params`): [`LocalToolDefinition`](#localtooldefinition)

Convert a server tool definition (created with `createTool()`) to a LocalToolDefinition.

This allows tools defined for MCP servers to be used directly as local tools
without needing to run a separate server process.

Note: Tools that use `client` methods (createMessage, elicit, listRoots) will
throw an error when those methods are called, as they require an MCP server context.

#### Parameters

##### params

`ToolToLocalToolParams`

#### Returns

[`LocalToolDefinition`](#localtooldefinition)

#### Example

```typescript
import { createTool } from '@mokei/context-server'
import { toolToLocalTool } from '@mokei/host'

const serverTool = createTool({
  description: 'Calculate math expression',
  inputSchema: { type: 'object', properties: { expr: { type: 'string' } } } as const,
  handler: (req) => ({ content: [{ type: 'text', text: String(eval(req.input.expr)) }] }),
})

const localTool = toolToLocalTool({ name: 'calculate', definition: serverTool })
```
