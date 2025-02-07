# @mokei/context-protocol

Mokei MCP constants, schemas and types.

## Installation

```sh
npm install @mokei/context-protocol
```

## Type Aliases

### CallToolRequest

> **CallToolRequest**: `FromSchema`\<*typeof* `callToolRequest`\>

***

### CallToolResult

> **CallToolResult**: `FromSchema`\<*typeof* `callToolResult`\>

***

### ClientMessage

> **ClientMessage**: `FromSchema`\<*typeof* [`clientMessage`](index.md#clientmessage-1)\>

***

### ClientNotification

> **ClientNotification**: `FromSchema`\<*typeof* `clientNotification`\>

***

### ClientNotifications

> **ClientNotifications**: `object`

#### Type declaration

##### cancelled

> **cancelled**: `CancelledNotification`

##### initialized

> **initialized**: `InitializedNotification`

##### progress

> **progress**: `ProgressNotification`

***

### ClientRequest

> **ClientRequest**: `FromSchema`\<*typeof* `clientRequest`\>

***

### ClientRequests

> **ClientRequests**: `object`

#### Type declaration

##### completion/complete

> **completion/complete**: `object`

###### completion/complete.Method

> **completion/complete.Method**: `CompleteRequest`\[`"method"`\]

###### completion/complete.Params

> **completion/complete.Params**: `CompleteRequest`\[`"params"`\]

###### completion/complete.Result

> **completion/complete.Result**: `CompleteResult`

##### initialize

> **initialize**: `object`

###### initialize.Method

> **initialize.Method**: `InitializeRequest`\[`"method"`\]

###### initialize.Params

> **initialize.Params**: `InitializeRequest`\[`"params"`\]

###### initialize.Result

> **initialize.Result**: [`InitializeResult`](index.md#initializeresult)

##### logging/setLevel

> **logging/setLevel**: `object`

###### logging/setLevel.Method

> **logging/setLevel.Method**: `SetLevelRequest`\[`"method"`\]

###### logging/setLevel.Params

> **logging/setLevel.Params**: `SetLevelRequest`\[`"params"`\]

###### logging/setLevel.Result

> **logging/setLevel.Result**: `undefined`

##### ping

> **ping**: `object`

###### ping.Method

> **ping.Method**: `PingRequest`\[`"method"`\]

###### ping.Params

> **ping.Params**: `PingRequest`\[`"params"`\]

###### ping.Result

> **ping.Result**: `undefined`

##### prompts/get

> **prompts/get**: `object`

###### prompts/get.Method

> **prompts/get.Method**: `GetPromptRequest`\[`"method"`\]

###### prompts/get.Params

> **prompts/get.Params**: `GetPromptRequest`\[`"params"`\]

###### prompts/get.Result

> **prompts/get.Result**: [`GetPromptResult`](index.md#getpromptresult)

##### prompts/list

> **prompts/list**: `object`

###### prompts/list.Method

> **prompts/list.Method**: `ListPromptsRequest`\[`"method"`\]

###### prompts/list.Params

> **prompts/list.Params**: `ListPromptsRequest`\[`"params"`\]

###### prompts/list.Result

> **prompts/list.Result**: `ListPromptsResult`

##### resources/list

> **resources/list**: `object`

###### resources/list.Method

> **resources/list.Method**: [`ListResourcesRequest`](index.md#listresourcesrequest)\[`"method"`\]

###### resources/list.Params

> **resources/list.Params**: [`ListResourcesRequest`](index.md#listresourcesrequest)\[`"params"`\]

###### resources/list.Result

> **resources/list.Result**: [`ListResourcesResult`](index.md#listresourcesresult)

##### resources/templates/list

> **resources/templates/list**: `object`

###### resources/templates/list.Method

> **resources/templates/list.Method**: [`ListResourceTemplatesRequest`](index.md#listresourcetemplatesrequest)\[`"method"`\]

###### resources/templates/list.Params

> **resources/templates/list.Params**: [`ListResourceTemplatesRequest`](index.md#listresourcetemplatesrequest)\[`"params"`\]

###### resources/templates/list.Result

> **resources/templates/list.Result**: [`ListResourceTemplatesResult`](index.md#listresourcetemplatesresult)

##### tools/call

> **tools/call**: `object`

###### tools/call.Method

> **tools/call.Method**: [`CallToolRequest`](index.md#calltoolrequest)\[`"method"`\]

###### tools/call.Params

> **tools/call.Params**: [`CallToolRequest`](index.md#calltoolrequest)\[`"params"`\]

###### tools/call.Result

> **tools/call.Result**: [`CallToolResult`](index.md#calltoolresult)

##### tools/list

> **tools/list**: `object`

###### tools/list.Method

> **tools/list.Method**: `ListToolsRequest`\[`"method"`\]

###### tools/list.Params

> **tools/list.Params**: `ListToolsRequest`\[`"params"`\]

###### tools/list.Result

> **tools/list.Result**: `ListToolsResult`

***

### ClientResponse

> **ClientResponse**: `FromSchema`\<*typeof* `clientResponse`\>

***

### ErrorResponse

> **ErrorResponse**: `FromSchema`\<*typeof* `errorResponse`\>

***

### GetPromptResult

> **GetPromptResult**: `FromSchema`\<*typeof* `getPromptResult`\>

***

### Implementation

> **Implementation**: `FromSchema`\<*typeof* `implementation`\>

***

### InitializeResult

> **InitializeResult**: `FromSchema`\<*typeof* `initializeResult`\>

***

### ListResourcesRequest

> **ListResourcesRequest**: `FromSchema`\<*typeof* `listResourcesRequest`\>

***

### ListResourcesResult

> **ListResourcesResult**: `FromSchema`\<*typeof* `listResourcesResult`\>

***

### ListResourceTemplatesRequest

> **ListResourceTemplatesRequest**: `FromSchema`\<*typeof* `listResourceTemplatesRequest`\>

***

### ListResourceTemplatesResult

> **ListResourceTemplatesResult**: `FromSchema`\<*typeof* `listResourceTemplatesResult`\>

***

### ReadResourceRequest

> **ReadResourceRequest**: `FromSchema`\<*typeof* `readResourceRequest`\>

***

### ReadResourceResult

> **ReadResourceResult**: `FromSchema`\<*typeof* `readResourceResult`\>

***

### RequestID

> **RequestID**: `FromSchema`\<*typeof* `requestId`\>

***

### ServerMessage

> **ServerMessage**: `FromSchema`\<*typeof* [`serverMessage`](index.md#servermessage-1)\>

***

### ServerNotification

> **ServerNotification**: `FromSchema`\<*typeof* `serverNotification`\>

***

### ServerNotifications

> **ServerNotifications**: `object`

#### Type declaration

##### prompts/list\_changed

> **prompts/list\_changed**: `PromptListChangedNotification`

##### resources/list\_changed

> **resources/list\_changed**: `ResourceListChangedNotification`

##### tools/list\_changed

> **tools/list\_changed**: `ToolListChangedNotification`

***

### ServerRequest

> **ServerRequest**: `FromSchema`\<*typeof* `serverRequest`\>

***

### ServerResult

> **ServerResult**: `FromSchema`\<*typeof* `serverResult`\>

***

### Tool

> **Tool**: `FromSchema`\<*typeof* `tool`\>

## Variables

### clientMessage

> `const` **clientMessage**: `object`

Any MCP client message.

#### Type declaration

##### anyOf

> `readonly` **anyOf**: readonly \[\{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: `"string"`; \}, \{ `type`: `"integer"`; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{\}; `properties`: \{ `_meta`: \{ `properties`: \{ `progressToken`: \{ `anyOf`: ...; `description`: ...; \}; \}; `type`: `"object"`; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `description`: `"A ping, issued by either the server or the client, to check that the other party is still alive. The receiver must promptly respond, or else may be disconnected."`; `properties`: \{ `method`: \{ `const`: `"ping"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"method"`\]; `type`: `"object"`; \}\]; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: `"string"`; \}, \{ `type`: `"integer"`; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{\}; `properties`: \{ `_meta`: \{ `properties`: \{ `progressToken`: \{ `anyOf`: ...; `description`: ...; \}; \}; `type`: `"object"`; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"initialize"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `capabilities`: \{ `description`: `"Capabilities a client may support. Known capabilities are defined here, in this schema, but this is not a closed set: any client can define its own, additional capabilities."`; `properties`: \{ `experimental`: \{ `additionalProperties`: ...; `description`: ...; `type`: ...; \}; `roots`: \{ `description`: ...; `properties`: ...; `type`: ...; \}; `sampling`: \{ `additionalProperties`: ...; `description`: ...; `properties`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; `clientInfo`: \{ `description`: `"Describes the name and version of an MCP implementation."`; `properties`: \{ `name`: \{ `type`: ...; \}; `version`: \{ `type`: ...; \}; \}; `required`: readonly \[`"name"`, `"version"`\]; `type`: `"object"`; \}; `protocolVersion`: \{ `description`: `"The latest version of the Model Context Protocol that the client supports. The client MAY decide to support older versions as well."`; `type`: `"string"`; \}; \}; `required`: readonly \[`"capabilities"`, `"clientInfo"`, `"protocolVersion"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]; `description`: `"This request is sent from the client to the server when it first connects, asking it to begin initialization."`; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: `"string"`; \}, \{ `type`: `"integer"`; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{\}; `properties`: \{ `_meta`: \{ `properties`: \{ `progressToken`: \{ `anyOf`: ...; `description`: ...; \}; \}; `type`: `"object"`; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"completion/complete"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `argument`: \{ `description`: `"The argument's information"`; `properties`: \{ `name`: \{ `description`: ...; `type`: ...; \}; `value`: \{ `description`: ...; `type`: ...; \}; \}; `required`: readonly \[`"name"`, `"value"`\]; `type`: `"object"`; \}; `ref`: \{ `anyOf`: readonly \[\{ `description`: ...; `properties`: ...; `required`: ...; `type`: ...; \}, \{ `description`: ...; `properties`: ...; `required`: ...; `type`: ...; \}\]; \}; \}; `required`: readonly \[`"argument"`, `"ref"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]; `description`: `"A request from the client to the server, to ask for completion options."`; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: `"string"`; \}, \{ `type`: `"integer"`; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{\}; `properties`: \{ `_meta`: \{ `properties`: \{ `progressToken`: \{ `anyOf`: ...; `description`: ...; \}; \}; `type`: `"object"`; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"logging/setLevel"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `level`: \{ `description`: "The severity of a log message.\n    \n    These map to syslog message severities, as specified in RFC-5424:\n    https://datatracker.ietf.org/doc/html/rfc5424#section-6.2.1"; `enum`: readonly \[`"alert"`, `"critical"`, `"debug"`, `"emergency"`, `"error"`, `"info"`, `"notice"`, `"warning"`\]; `type`: `"string"`; \}; \}; `required`: readonly \[`"level"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]; `description`: `"A request from the client to the server, to enable or adjust logging."`; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: `"string"`; \}, \{ `type`: `"integer"`; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{\}; `properties`: \{ `_meta`: \{ `properties`: \{ `progressToken`: \{ `anyOf`: ...; `description`: ...; \}; \}; `type`: `"object"`; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"prompts/get"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `arguments`: \{ `additionalProperties`: \{ `type`: `"string"`; \}; `description`: `"Arguments to use for templating the prompt."`; `type`: `"object"`; \}; `name`: \{ `description`: `"The name of the prompt or prompt template."`; `type`: `"string"`; \}; \}; `required`: readonly \[`"name"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]; `description`: `"Used by the client to get a prompt provided by the server."`; \}, \{ `allOf`: readonly \[\{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: ...; \}, \{ `type`: ...; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{\}; `properties`: \{ `_meta`: \{ `properties`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `params`: \{ `properties`: \{ `cursor`: \{ `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `type`: `"object"`; \}\]; \}, \{ `properties`: \{ `method`: \{ `const`: `"prompts/list"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"method"`\]; `type`: `"object"`; \}\]; `description`: `"Sent from the client to request a list of prompts and prompt templates the server has."`; \}, \{ `allOf`: readonly \[\{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: ...; \}, \{ `type`: ...; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{\}; `properties`: \{ `_meta`: \{ `properties`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `params`: \{ `properties`: \{ `cursor`: \{ `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `type`: `"object"`; \}\]; \}, \{ `properties`: \{ `method`: \{ `const`: `"resources/list"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"method"`\]; `type`: `"object"`; \}\]; `description`: `"Sent from the client to request a list of resources the server has."`; \}, \{ `allOf`: readonly \[\{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: ...; \}, \{ `type`: ...; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{\}; `properties`: \{ `_meta`: \{ `properties`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `params`: \{ `properties`: \{ `cursor`: \{ `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `type`: `"object"`; \}\]; \}, \{ `properties`: \{ `method`: \{ `const`: `"resources/templates/list"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"method"`\]; `type`: `"object"`; \}\]; `description`: `"Sent from the client to request a list of resource templates the server has."`; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: `"string"`; \}, \{ `type`: `"integer"`; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{\}; `properties`: \{ `_meta`: \{ `properties`: \{ `progressToken`: \{ `anyOf`: ...; `description`: ...; \}; \}; `type`: `"object"`; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"resources/read"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `uri`: \{ `description`: `"The URI of the resource to read. The URI can use any protocol; it is up to the server how to interpret it."`; `format`: `"uri"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"uri"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]; `description`: `"Sent from the client to the server, to read a specific resource URI."`; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: `"string"`; \}, \{ `type`: `"integer"`; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{\}; `properties`: \{ `_meta`: \{ `properties`: \{ `progressToken`: \{ `anyOf`: ...; `description`: ...; \}; \}; `type`: `"object"`; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"resources/subscribe"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `uri`: \{ `description`: `"The URI of the resource to subscribe to. The URI can use any protocol; it is up to the server how to interpret it."`; `format`: `"uri"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"uri"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]; `description`: `"Sent from the client to request resources/updated notifications from the server whenever a particular resource changes."`; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: `"string"`; \}, \{ `type`: `"integer"`; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{\}; `properties`: \{ `_meta`: \{ `properties`: \{ `progressToken`: \{ `anyOf`: ...; `description`: ...; \}; \}; `type`: `"object"`; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"resources/unsubscribe"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `uri`: \{ `description`: `"The URI of the resource to unsubscribe from."`; `format`: `"uri"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"uri"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]; `description`: `"Sent from the client to request cancellation of resources/updated notifications from the server. This should follow a previous resources/subscribe request."`; \}, \{ `allOf`: readonly \[\{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: ...; \}, \{ `type`: ...; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{\}; `properties`: \{ `_meta`: \{ `properties`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `params`: \{ `properties`: \{ `cursor`: \{ `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `type`: `"object"`; \}\]; \}, \{ `properties`: \{ `method`: \{ `const`: `"tools/list"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"method"`\]; `type`: `"object"`; \}\]; `description`: `"Sent from the client to request a list of tools the server has."`; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: `"string"`; \}, \{ `type`: `"integer"`; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{\}; `properties`: \{ `_meta`: \{ `properties`: \{ `progressToken`: \{ `anyOf`: ...; `description`: ...; \}; \}; `type`: `"object"`; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"tools/call"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `arguments`: \{ `additionalProperties`: \{\}; `type`: `"object"`; \}; `name`: \{ `type`: `"string"`; \}; \}; `required`: readonly \[`"name"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]; `description`: `"Used by the client to invoke a tool provided by the server."`; \}, \{ `anyOf`: readonly \[\{ `allOf`: readonly \[\{ `properties`: \{ `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{\}; `properties`: \{ `_meta`: \{ `additionalProperties`: ...; `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"notifications/cancelled"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `reason`: \{ `type`: ...; \}; `requestId`: \{ `anyOf`: ...; `description`: ...; \}; \}; `required`: readonly \[`"requestId"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]; \}, \{ `description`: `"An out-of-band notification used to inform the receiver of a progress update for a long-running request."`; `properties`: \{ `method`: \{ `const`: `"notifications/progress"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `progress`: \{ `description`: `"The progress thus far. This should increase every time progress is made, even if the total is unknown."`; `type`: `"number"`; \}; `progressToken`: \{ `anyOf`: readonly \[\{ `type`: ...; \}, \{ `type`: ...; \}\]; `description`: `"A progress token, used to associate progress notifications with the original request."`; \}; `total`: \{ `description`: `"Total number of items to process (or total progress required), if known."`; `type`: `"number"`; \}; \}; `required`: readonly \[`"progress"`, `"progressToken"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{\}; `properties`: \{ `_meta`: \{ `additionalProperties`: ...; `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"notifications/initialized"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"method"`\]; `type`: `"object"`; \}\]; `description`: `"This notification is sent from the client to the server after initialization has finished."`; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{\}; `properties`: \{ `_meta`: \{ `additionalProperties`: ...; `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"notifications/roots/list_changed"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"method"`\]; `type`: `"object"`; \}\]; `description`: "A notification from the client to the server, informing it that the list of roots has changed.\n    This notification should be sent whenever the client adds, removes, or modifies any root.\n    The server should then request an updated list of roots using the ListRootsRequest."; \}\]; \}, \{ `anyOf`: readonly \[\{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: ...; \}, \{ `type`: ...; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `error`: \{ `properties`: \{ `code`: \{ `type`: ...; \}; `data`: \{ `additionalProperties`: ...; `type`: ...; \}; `message`: \{ `type`: ...; \}; \}; `required`: readonly \[`"code"`, `"message"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"error"`\]; `type`: `"object"`; \}\]; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: ...; \}, \{ `type`: ...; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `result`: \{ `anyOf`: readonly \[\{ `additionalProperties`: ...; `properties`: ...; `type`: ...; \}, \{ `allOf`: ...; `description`: ...; \}, \{ `allOf`: ...; `description`: ...; \}\]; \}; \}; `required`: readonly \[`"result"`\]; `type`: `"object"`; \}\]; \}\]; \}\]

***

### inputSchema

> `const` **inputSchema**: `object`

#### Type declaration

##### description

> `readonly` **description**: `"A JSON Schema object defining the expected parameters for the tool."` = `'A JSON Schema object defining the expected parameters for the tool.'`

##### properties

> `readonly` **properties**: `object`

###### properties.properties

> `readonly` **properties.properties**: `object`

###### properties.properties.additionalProperties

> `readonly` **properties.properties.additionalProperties**: `object`

###### properties.properties.additionalProperties.additionalProperties

> `readonly` **properties.properties.additionalProperties.additionalProperties**: `true` = `true`

###### properties.properties.additionalProperties.properties

> `readonly` **properties.properties.additionalProperties.properties**: `object` = `{}`

###### properties.properties.additionalProperties.type

> `readonly` **properties.properties.additionalProperties.type**: `"object"` = `'object'`

###### properties.properties.type

> `readonly` **properties.properties.type**: `"object"` = `'object'`

###### properties.type

> `readonly` **properties.type**: `object`

###### properties.type.const

> `readonly` **properties.type.const**: `"object"` = `'object'`

###### properties.type.type

> `readonly` **properties.type.type**: `"string"` = `'string'`

##### required

> `readonly` **required**: readonly \[`"type"`\]

##### type

> `readonly` **type**: `"object"` = `'object'`

***

### INTERNAL\_ERROR

> `const` **INTERNAL\_ERROR**: `-32603` = `-32603`

***

### INVALID\_PARAMS

> `const` **INVALID\_PARAMS**: `-32602` = `-32602`

***

### INVALID\_REQUEST

> `const` **INVALID\_REQUEST**: `-32600` = `-32600`

***

### LATEST\_PROTOCOL\_VERSION

> `const` **LATEST\_PROTOCOL\_VERSION**: `"2024-11-05"` = `'2024-11-05'`

***

### METHOD\_NOT\_FOUND

> `const` **METHOD\_NOT\_FOUND**: `-32601` = `-32601`

***

### PARSE\_ERROR

> `const` **PARSE\_ERROR**: `-32700` = `-32700`

***

### serverMessage

> `const` **serverMessage**: `object`

Any MCP server message.

#### Type declaration

##### anyOf

> `readonly` **anyOf**: readonly \[\{ `anyOf`: readonly \[\{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: ...; \}, \{ `type`: ...; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{\}; `properties`: \{ `_meta`: \{ `properties`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `description`: `"A ping, issued by either the server or the client, to check that the other party is still alive. The receiver must promptly respond, or else may be disconnected."`; `properties`: \{ `method`: \{ `const`: `"ping"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"method"`\]; `type`: `"object"`; \}\]; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: ...; \}, \{ `type`: ...; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{\}; `properties`: \{ `_meta`: \{ `properties`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"sampling/createMessage"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `includeContext`: \{ `description`: ...; `enum`: ...; `type`: ...; \}; `maxTokens`: \{ `description`: ...; `type`: ...; \}; `messages`: \{ `items`: ...; `type`: ...; \}; `metadata`: \{ `additionalProperties`: ...; `description`: ...; `properties`: ...; `type`: ...; \}; `modelPreferences`: \{ `description`: ...; `properties`: ...; `type`: ...; \}; `stopSequences`: \{ `items`: ...; `type`: ...; \}; `systemPrompt`: \{ `description`: ...; `type`: ...; \}; `temperature`: \{ `type`: ...; \}; \}; `required`: readonly \[`"maxTokens"`, `"messages"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]; `description`: `"A request from the server to sample an LLM via the client. The client has full discretion over which model to select. The client should also inform the user before beginning sampling, to allow them to inspect the request (human in the loop) and decide whether to approve it."`; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: ...; \}, \{ `type`: ...; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{\}; `properties`: \{ `_meta`: \{ `properties`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"roots/list"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"method"`\]; `type`: `"object"`; \}\]; `description`: "Sent from the server to request a list of root URIs from the client. Roots allow servers to ask for specific directories or files to operate on. A common example for roots is providing a set of repositories or directories a server should operate on.\n    \n  This request is typically used when the server needs to understand the file system structure or access specific locations that the client has permission to read from."; \}\]; \}, \{ `anyOf`: readonly \[\{ `allOf`: readonly \[\{ `properties`: \{ `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{\}; `properties`: \{ `_meta`: \{ `additionalProperties`: ...; `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"notifications/cancelled"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `reason`: \{ `type`: ...; \}; `requestId`: \{ `anyOf`: ...; `description`: ...; \}; \}; `required`: readonly \[`"requestId"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{\}; `properties`: \{ `_meta`: \{ `additionalProperties`: ...; `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"notifications/message"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `data`: \{ `description`: ...; \}; `level`: \{ `description`: ...; `enum`: ...; `type`: ...; \}; `logger`: \{ `description`: ...; `type`: ...; \}; \}; `required`: readonly \[`"data"`, `"level"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]; `description`: `"Notification of a log message passed from server to client. If no logging/setLevel request has been sent from the client, the server MAY decide which messages to send automatically."`; \}, \{ `description`: `"An out-of-band notification used to inform the receiver of a progress update for a long-running request."`; `properties`: \{ `method`: \{ `const`: `"notifications/progress"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `progress`: \{ `description`: `"The progress thus far. This should increase every time progress is made, even if the total is unknown."`; `type`: `"number"`; \}; `progressToken`: \{ `anyOf`: readonly \[\{ `type`: ...; \}, \{ `type`: ...; \}\]; `description`: `"A progress token, used to associate progress notifications with the original request."`; \}; `total`: \{ `description`: `"Total number of items to process (or total progress required), if known."`; `type`: `"number"`; \}; \}; `required`: readonly \[`"progress"`, `"progressToken"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{\}; `properties`: \{ `_meta`: \{ `additionalProperties`: ...; `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"notifications/resources/updated"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `uri`: \{ `description`: ...; `format`: ...; `type`: ...; \}; \}; `required`: readonly \[`"uri"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]; `description`: `"A notification from the server to the client, informing it that a resource has changed and may need to be read again. This should only be sent if the client previously sent a resources/subscribe request."`; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{\}; `properties`: \{ `_meta`: \{ `additionalProperties`: ...; `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"notifications/resources/list_changed"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"method"`\]; `type`: `"object"`; \}\]; `description`: `"An optional notification from the server to the client, informing it that the list of resources it can read from has changed. This may be issued by servers without any previous subscription from the client."`; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{\}; `properties`: \{ `_meta`: \{ `additionalProperties`: ...; `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"notifications/tools/list_changed"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"method"`\]; `type`: `"object"`; \}\]; `description`: `"An optional notification from the server to the client, informing it that the list of tools it offers has changed. This may be issued by servers without any previous subscription from the client."`; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{\}; `properties`: \{ `_meta`: \{ `additionalProperties`: ...; `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"notifications/prompts/list_changed"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"method"`\]; `type`: `"object"`; \}\]; `description`: `"An optional notification from the server to the client, informing it that the list of prompts it offers has changed. This may be issued by servers without any previous subscription from the client."`; \}\]; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: `"string"`; \}, \{ `type`: `"integer"`; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `error`: \{ `properties`: \{ `code`: \{ `type`: `"number"`; \}; `data`: \{ `additionalProperties`: \{\}; `type`: `"object"`; \}; `message`: \{ `type`: `"string"`; \}; \}; `required`: readonly \[`"code"`, `"message"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"error"`\]; `type`: `"object"`; \}\]; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: `"string"`; \}, \{ `type`: `"integer"`; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `result`: \{ `anyOf`: readonly \[\{ `additionalProperties`: \{\}; `properties`: \{ `_meta`: \{ `additionalProperties`: ...; `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}, \{ `allOf`: readonly \[\{ `additionalProperties`: ...; `properties`: ...; `type`: ...; \}, \{ `properties`: ...; `required`: ...; `type`: ...; \}\]; `description`: `"After receiving an initialize request from the client, the server sends this response."`; \}, \{ `allOf`: readonly \[\{ `additionalProperties`: ...; `properties`: ...; `type`: ...; \}, \{ `properties`: ...; `required`: ...; `type`: ...; \}\]; `description`: `"The server's response to a completion/complete request"`; \}, \{ `allOf`: readonly \[\{ `additionalProperties`: ...; `properties`: ...; `type`: ...; \}, \{ `properties`: ...; `required`: ...; `type`: ...; \}\]; `description`: `"The server's response to a prompts/get request from the client."`; \}, \{ `allOf`: readonly \[\{ `properties`: ...; `type`: ...; \}, \{ `properties`: ...; `required`: ...; `type`: ...; \}\]; `description`: `"The server's response to a prompts/list request from the client."`; \}, \{ `allOf`: readonly \[\{ `properties`: ...; `type`: ...; \}, \{ `properties`: ...; `required`: ...; `type`: ...; \}\]; `description`: `"The server's response to a resources/list request from the client."`; \}, \{ `allOf`: readonly \[\{ `properties`: ...; `type`: ...; \}, \{ `properties`: ...; `required`: ...; `type`: ...; \}\]; `description`: `"The server's response to a resources/templates/list request from the client."`; \}, \{ `allOf`: readonly \[\{ `additionalProperties`: ...; `properties`: ...; `type`: ...; \}, \{ `properties`: ...; `required`: ...; `type`: ...; \}\]; `description`: `"The server's response to a resources/read request from the client."`; \}, \{ `allOf`: readonly \[\{ `additionalProperties`: ...; `properties`: ...; `type`: ...; \}, \{ `properties`: ...; `required`: ...; `type`: ...; \}\]; `description`: "The server's response to a tool call.\n    \n    Any errors that originate from the tool SHOULD be reported inside the result object, with \"isError\" set to true, \_not\_ as an MCP protocol-level error response. Otherwise, the LLM would not be able to see that an error occurred and self-correct.\n    \n    However, any errors in \_finding\_ the tool, an error indicating that the server does not support tool calls, or any other exceptional conditions, should be reported as an MCP error response."; \}, \{ `allOf`: readonly \[\{ `properties`: ...; `type`: ...; \}, \{ `properties`: ...; `required`: ...; `type`: ...; \}\]; `description`: `"The server's response to a tools/list request from the client."`; \}\]; \}; \}; `required`: readonly \[`"result"`\]; `type`: `"object"`; \}\]; \}\]

## Functions

### createClientMessage()

> **createClientMessage**(`callTools`?): `Schema`

#### Parameters

##### callTools?

`Record`\<`string`, `Readonly`\<\{\}\>\>

#### Returns

`Schema`
