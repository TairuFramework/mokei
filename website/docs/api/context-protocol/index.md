# @mokei/context-protocol

Mokei MCP constants, schemas and types.

## Installation

```sh
npm install @mokei/context-protocol
```

## Type Aliases

### AnyMessage

> **AnyMessage** = [`Notification`](#notification) \| [`Request`](#request) \| [`Response`](#response)

***

### CallToolRequest

> **CallToolRequest** = `FromSchema`\<*typeof* `callToolRequest`\>

***

### CallToolResult

> **CallToolResult** = `FromSchema`\<*typeof* `callToolResult`\>

***

### CancelledNotification

> **CancelledNotification** = `FromSchema`\<*typeof* `cancelledNotification`\>

***

### ClientCapabilities

> **ClientCapabilities** = `FromSchema`\<*typeof* `clientCapabilities`\>

***

### ClientMessage

> **ClientMessage** = `FromSchema`\<*typeof* [`clientMessage`](#clientmessage-1)\>

***

### ClientNotification

> **ClientNotification** = `FromSchema`\<*typeof* `clientNotification`\>

***

### ClientNotifications

> **ClientNotifications** = `object`

#### Properties

##### initialized

> **initialized**: `InitializedNotification`

##### roots/list\_changed

> **roots/list\_changed**: [`RootsListChangedNotification`](#rootslistchangednotification)

***

### ClientRequest

> **ClientRequest** = `FromSchema`\<*typeof* `clientRequest`\>

***

### ClientRequests

> **ClientRequests** = `object`

#### Properties

##### completion/complete

> **completion/complete**: `object`

###### Params

> **Params**: [`CompleteRequest`](#completerequest)\[`"params"`\]

###### Result

> **Result**: [`CompleteResult`](#completeresult)

##### initialize

> **initialize**: `object`

###### Params

> **Params**: [`InitializeRequest`](#initializerequest)\[`"params"`\]

###### Result

> **Result**: [`InitializeResult`](#initializeresult)

##### logging/setLevel

> **logging/setLevel**: `object`

###### Params

> **Params**: [`SetLevelRequest`](#setlevelrequest)\[`"params"`\]

###### Result

> **Result**: [`Result`](#result)

##### prompts/get

> **prompts/get**: `object`

###### Params

> **Params**: [`GetPromptRequest`](#getpromptrequest)\[`"params"`\]

###### Result

> **Result**: [`GetPromptResult`](#getpromptresult)

##### prompts/list

> **prompts/list**: `object`

###### Params

> **Params**: [`ListPromptsRequest`](#listpromptsrequest)\[`"params"`\]

###### Result

> **Result**: [`ListPromptsResult`](#listpromptsresult)

##### resources/list

> **resources/list**: `object`

###### Params

> **Params**: [`ListResourcesRequest`](#listresourcesrequest)\[`"params"`\]

###### Result

> **Result**: [`ListResourcesResult`](#listresourcesresult)

##### resources/read

> **resources/read**: `object`

###### Params

> **Params**: [`ReadResourceRequest`](#readresourcerequest)\[`"params"`\]

###### Result

> **Result**: [`ReadResourceResult`](#readresourceresult)

##### resources/templates/list

> **resources/templates/list**: `object`

###### Params

> **Params**: [`ListResourceTemplatesRequest`](#listresourcetemplatesrequest)\[`"params"`\]

###### Result

> **Result**: [`ListResourceTemplatesResult`](#listresourcetemplatesresult)

##### tools/call

> **tools/call**: `object`

###### Params

> **Params**: [`CallToolRequest`](#calltoolrequest)\[`"params"`\]

###### Result

> **Result**: [`CallToolResult`](#calltoolresult)

##### tools/list

> **tools/list**: `object`

###### Params

> **Params**: [`ListToolsRequest`](#listtoolsrequest)\[`"params"`\]

###### Result

> **Result**: [`ListToolsResult`](#listtoolsresult)

***

### ClientResult

> **ClientResult** = `FromSchema`\<*typeof* `clientResult`\>

***

### CommonNotifications

> **CommonNotifications** = `object`

#### Properties

##### cancelled

> **cancelled**: [`CancelledNotification`](#cancellednotification)

##### progress

> **progress**: [`ProgressNotification`](#progressnotification)

***

### CommonRequests

> **CommonRequests** = `object`

#### Properties

##### ping

> **ping**: `object`

###### Method

> **Method**: `PingRequest`\[`"method"`\]

###### Params

> **Params**: `PingRequest`\[`"params"`\]

###### Result

> **Result**: [`Result`](#result)

***

### CompleteRequest

> **CompleteRequest** = `FromSchema`\<*typeof* `completeRequest`\>

***

### CompleteResult

> **CompleteResult** = `FromSchema`\<*typeof* `completeResult`\>

***

### CreateMessageRequest

> **CreateMessageRequest** = `FromSchema`\<*typeof* `createMessageRequest`\>

***

### CreateMessageResult

> **CreateMessageResult** = `FromSchema`\<*typeof* `createMessageResult`\>

***

### ElicitRequest

> **ElicitRequest** = `FromSchema`\<*typeof* `elicitRequest`\>

***

### ElicitResult

> **ElicitResult** = `FromSchema`\<*typeof* `elicitResult`\>

***

### ErrorResponse

> **ErrorResponse** = `FromSchema`\<*typeof* `errorResponse`\>

***

### GetPromptRequest

> **GetPromptRequest** = `FromSchema`\<*typeof* `getPromptRequest`\>

***

### GetPromptResult

> **GetPromptResult** = `FromSchema`\<*typeof* `getPromptResult`\>

***

### Implementation

> **Implementation** = `FromSchema`\<*typeof* `implementation`\>

***

### InitializeRequest

> **InitializeRequest** = `FromSchema`\<*typeof* `initializeRequest`\>

***

### InitializeResult

> **InitializeResult** = `FromSchema`\<*typeof* `initializeResult`\>

***

### InputSchema

> **InputSchema** = `FromSchema`\<*typeof* [`inputSchema`](#inputschema-1)\>

***

### ListPromptsRequest

> **ListPromptsRequest** = `FromSchema`\<*typeof* `listPromptsRequest`\>

***

### ListPromptsResult

> **ListPromptsResult** = `FromSchema`\<*typeof* `listPromptsResult`\>

***

### ListResourcesRequest

> **ListResourcesRequest** = `FromSchema`\<*typeof* `listResourcesRequest`\>

***

### ListResourcesResult

> **ListResourcesResult** = `FromSchema`\<*typeof* `listResourcesResult`\>

***

### ListResourceTemplatesRequest

> **ListResourceTemplatesRequest** = `FromSchema`\<*typeof* `listResourceTemplatesRequest`\>

***

### ListResourceTemplatesResult

> **ListResourceTemplatesResult** = `FromSchema`\<*typeof* `listResourceTemplatesResult`\>

***

### ListRootsRequest

> **ListRootsRequest** = `FromSchema`\<*typeof* `listRootsRequest`\>

***

### ListRootsResult

> **ListRootsResult** = `FromSchema`\<*typeof* `listRootsResult`\>

***

### ListToolsRequest

> **ListToolsRequest** = `FromSchema`\<*typeof* `listToolsRequest`\>

***

### ListToolsResult

> **ListToolsResult** = `FromSchema`\<*typeof* `listToolsResult`\>

***

### Log

> **Log** = `FromSchema`\<*typeof* `log`\>

***

### LoggingLevel

> **LoggingLevel** = `FromSchema`\<*typeof* `loggingLevel`\>

***

### LoggingMessageNotification

> **LoggingMessageNotification** = `FromSchema`\<*typeof* `loggingMessageNotification`\>

***

### Metadata

> **Metadata** = `FromSchema`\<*typeof* `metadata`\>

***

### Notification

> **Notification** = `FromSchema`\<*typeof* `notification`\>

***

### PaginatedResult

> **PaginatedResult** = `FromSchema`\<*typeof* `paginatedResult`\>

***

### ProgressNotification

> **ProgressNotification** = `FromSchema`\<*typeof* `progressNotification`\>

***

### Prompt

> **Prompt** = `FromSchema`\<*typeof* `prompt`\>

***

### PromptArgument

> **PromptArgument** = `FromSchema`\<*typeof* `promptArgument`\>

***

### PromptListChangedNotification

> **PromptListChangedNotification** = `FromSchema`\<*typeof* `promptListChangedNotification`\>

***

### ReadResourceRequest

> **ReadResourceRequest** = `FromSchema`\<*typeof* `readResourceRequest`\>

***

### ReadResourceResult

> **ReadResourceResult** = `FromSchema`\<*typeof* `readResourceResult`\>

***

### Request

> **Request** = `FromSchema`\<*typeof* `request`\>

***

### RequestID

> **RequestID** = `FromSchema`\<*typeof* `requestId`\>

***

### Resource

> **Resource** = `FromSchema`\<*typeof* `resource`\>

***

### ResourceListChangedNotification

> **ResourceListChangedNotification** = `FromSchema`\<*typeof* `resourceListChangedNotification`\>

***

### ResourceTemplate

> **ResourceTemplate** = `FromSchema`\<*typeof* `resourceTemplate`\>

***

### ResourceUpdatedNotification

> **ResourceUpdatedNotification** = `FromSchema`\<*typeof* `resourceUpdatedNotification`\>

***

### Response

> **Response** = `FromSchema`\<*typeof* `response`\>

***

### Result

> **Result** = `FromSchema`\<*typeof* `result`\>

***

### Root

> **Root** = `FromSchema`\<*typeof* `root`\>

***

### RootsListChangedNotification

> **RootsListChangedNotification** = `FromSchema`\<*typeof* `rootsListChangedNotification`\>

***

### ServerCapabilities

> **ServerCapabilities** = `FromSchema`\<*typeof* `serverCapabilities`\>

***

### ServerMessage

> **ServerMessage** = `FromSchema`\<*typeof* [`serverMessage`](#servermessage-1)\>

***

### ServerNotification

> **ServerNotification** = `FromSchema`\<*typeof* `serverNotification`\>

***

### ServerNotifications

> **ServerNotifications** = `object`

#### Properties

##### prompts/list\_changed

> **prompts/list\_changed**: [`PromptListChangedNotification`](#promptlistchangednotification)

##### resources/list\_changed

> **resources/list\_changed**: [`ResourceListChangedNotification`](#resourcelistchangednotification)

##### tools/list\_changed

> **tools/list\_changed**: [`ToolListChangedNotification`](#toollistchangednotification)

***

### ServerRequest

> **ServerRequest** = `FromSchema`\<*typeof* `serverRequest`\>

***

### ServerRequests

> **ServerRequests** = `object`

#### Properties

##### elicitation/create

> **elicitation/create**: `object`

###### Params

> **Params**: [`ElicitRequest`](#elicitrequest)\[`"params"`\]

###### Result

> **Result**: [`ElicitResult`](#elicitresult)

##### roots/list

> **roots/list**: `object`

###### Params

> **Params**: [`ListRootsRequest`](#listrootsrequest)\[`"params"`\]

###### Result

> **Result**: [`ListRootsResult`](#listrootsresult)

##### sampling/createMessage

> **sampling/createMessage**: `object`

###### Params

> **Params**: [`CreateMessageRequest`](#createmessagerequest)\[`"params"`\]

###### Result

> **Result**: [`CreateMessageResult`](#createmessageresult)

***

### ServerResult

> **ServerResult** = `FromSchema`\<*typeof* `serverResult`\>

***

### SetLevelRequest

> **SetLevelRequest** = `FromSchema`\<*typeof* `setLevelRequest`\>

***

### Tool

> **Tool** = `FromSchema`\<*typeof* `tool`\>

***

### ToolListChangedNotification

> **ToolListChangedNotification** = `FromSchema`\<*typeof* `toolListChangedNotification`\>

## Variables

### clientMessage

> `const` **clientMessage**: `object`

Any MCP client message.

#### Type declaration

##### anyOf

> `readonly` **anyOf**: readonly \[\{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: `"string"`; \}, \{ `type`: `"integer"`; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `properties`: \{ `progressToken`: \{ `anyOf`: ...; `description`: ...; \}; \}; `type`: `"object"`; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `description`: `"A ping, issued by either the server or the client, to check that the other party is still alive. The receiver must promptly respond, or else may be disconnected."`; `properties`: \{ `method`: \{ `const`: `"ping"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"method"`\]; `type`: `"object"`; \}\]; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: `"string"`; \}, \{ `type`: `"integer"`; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `properties`: \{ `progressToken`: \{ `anyOf`: ...; `description`: ...; \}; \}; `type`: `"object"`; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"initialize"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `capabilities`: \{ `description`: `"Capabilities a client may support. Known capabilities are defined here, in this schema, but this is not a closed set: any client can define its own, additional capabilities."`; `properties`: \{ `elicitation`: \{ `additionalProperties`: ...; `description`: ...; `properties`: ...; `type`: ...; \}; `experimental`: \{ `additionalProperties`: ...; `description`: ...; `type`: ...; \}; `roots`: \{ `description`: ...; `properties`: ...; `type`: ...; \}; `sampling`: \{ `additionalProperties`: ...; `description`: ...; `properties`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; `clientInfo`: \{ `description`: `"Describes the name and version of an MCP implementation, with an optional title for UI representation."`; `properties`: \{ `name`: \{ `description`: ...; `type`: ...; \}; `title`: \{ `description`: ...; `type`: ...; \}; `version`: \{ `type`: ...; \}; \}; `required`: readonly \[`"name"`, `"version"`\]; `type`: `"object"`; \}; `protocolVersion`: \{ `description`: `"The latest version of the Model Context Protocol that the client supports. The client MAY decide to support older versions as well."`; `type`: `"string"`; \}; \}; `required`: readonly \[`"capabilities"`, `"clientInfo"`, `"protocolVersion"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]; `description`: `"This request is sent from the client to the server when it first connects, asking it to begin initialization."`; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: `"string"`; \}, \{ `type`: `"integer"`; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `properties`: \{ `progressToken`: \{ `anyOf`: ...; `description`: ...; \}; \}; `type`: `"object"`; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"completion/complete"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `argument`: \{ `description`: `"The argument's information"`; `properties`: \{ `name`: \{ `description`: ...; `type`: ...; \}; `value`: \{ `description`: ...; `type`: ...; \}; \}; `required`: readonly \[`"name"`, `"value"`\]; `type`: `"object"`; \}; `context`: \{ `description`: `"Additional, optional context for completions"`; `properties`: \{ `arguments`: \{ `additionalProperties`: ...; `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; `ref`: \{ `anyOf`: readonly \[\{ `description`: ...; `properties`: ...; `required`: ...; `type`: ...; \}, \{ `description`: ...; `properties`: ...; `required`: ...; `type`: ...; \}\]; \}; \}; `required`: readonly \[`"argument"`, `"ref"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]; `description`: `"A request from the client to the server, to ask for completion options."`; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: `"string"`; \}, \{ `type`: `"integer"`; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `properties`: \{ `progressToken`: \{ `anyOf`: ...; `description`: ...; \}; \}; `type`: `"object"`; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"logging/setLevel"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `level`: \{ `description`: "The severity of a log message.\n\nThese map to syslog message severities, as specified in RFC-5424:\nhttps://datatracker.ietf.org/doc/html/rfc5424#section-6.2.1"; `enum`: readonly \[`"alert"`, `"critical"`, `"debug"`, `"emergency"`, `"error"`, `"info"`, `"notice"`, `"warning"`\]; `type`: `"string"`; \}; \}; `required`: readonly \[`"level"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]; `description`: `"A request from the client to the server, to enable or adjust logging."`; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: `"string"`; \}, \{ `type`: `"integer"`; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `properties`: \{ `progressToken`: \{ `anyOf`: ...; `description`: ...; \}; \}; `type`: `"object"`; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"prompts/get"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `arguments`: \{ `additionalProperties`: \{ `type`: `"string"`; \}; `description`: `"Arguments to use for templating the prompt."`; `type`: `"object"`; \}; `name`: \{ `description`: `"The name of the prompt or prompt template."`; `type`: `"string"`; \}; \}; `required`: readonly \[`"name"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]; `description`: `"Used by the client to get a prompt provided by the server."`; \}, \{ `allOf`: readonly \[\{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: ...; \}, \{ `type`: ...; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `properties`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `params`: \{ `properties`: \{ `cursor`: \{ `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `type`: `"object"`; \}\]; \}, \{ `properties`: \{ `method`: \{ `const`: `"prompts/list"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"method"`\]; `type`: `"object"`; \}\]; `description`: `"Sent from the client to request a list of prompts and prompt templates the server has."`; \}, \{ `allOf`: readonly \[\{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: ...; \}, \{ `type`: ...; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `properties`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `params`: \{ `properties`: \{ `cursor`: \{ `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `type`: `"object"`; \}\]; \}, \{ `properties`: \{ `method`: \{ `const`: `"resources/list"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"method"`\]; `type`: `"object"`; \}\]; `description`: `"Sent from the client to request a list of resources the server has."`; \}, \{ `allOf`: readonly \[\{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: ...; \}, \{ `type`: ...; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `properties`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `params`: \{ `properties`: \{ `cursor`: \{ `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `type`: `"object"`; \}\]; \}, \{ `properties`: \{ `method`: \{ `const`: `"resources/templates/list"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"method"`\]; `type`: `"object"`; \}\]; `description`: `"Sent from the client to request a list of resource templates the server has."`; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: `"string"`; \}, \{ `type`: `"integer"`; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `properties`: \{ `progressToken`: \{ `anyOf`: ...; `description`: ...; \}; \}; `type`: `"object"`; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"resources/read"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `uri`: \{ `description`: `"The URI of the resource to read. The URI can use any protocol; it is up to the server how to interpret it."`; `format`: `"uri"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"uri"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]; `description`: `"Sent from the client to the server, to read a specific resource URI."`; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: `"string"`; \}, \{ `type`: `"integer"`; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `properties`: \{ `progressToken`: \{ `anyOf`: ...; `description`: ...; \}; \}; `type`: `"object"`; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"resources/subscribe"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `uri`: \{ `description`: `"The URI of the resource to subscribe to. The URI can use any protocol; it is up to the server how to interpret it."`; `format`: `"uri"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"uri"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]; `description`: `"Sent from the client to request resources/updated notifications from the server whenever a particular resource changes."`; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: `"string"`; \}, \{ `type`: `"integer"`; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `properties`: \{ `progressToken`: \{ `anyOf`: ...; `description`: ...; \}; \}; `type`: `"object"`; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"resources/unsubscribe"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `uri`: \{ `description`: `"The URI of the resource to unsubscribe from."`; `format`: `"uri"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"uri"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]; `description`: `"Sent from the client to request cancellation of resources/updated notifications from the server. This should follow a previous resources/subscribe request."`; \}, \{ `allOf`: readonly \[\{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: ...; \}, \{ `type`: ...; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `properties`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `params`: \{ `properties`: \{ `cursor`: \{ `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `type`: `"object"`; \}\]; \}, \{ `properties`: \{ `method`: \{ `const`: `"tools/list"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"method"`\]; `type`: `"object"`; \}\]; `description`: `"Sent from the client to request a list of tools the server has."`; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: `"string"`; \}, \{ `type`: `"integer"`; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `properties`: \{ `progressToken`: \{ `anyOf`: ...; `description`: ...; \}; \}; `type`: `"object"`; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"tools/call"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `arguments`: \{ `additionalProperties`: \{ \}; `type`: `"object"`; \}; `name`: \{ `type`: `"string"`; \}; \}; `required`: readonly \[`"name"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]; `description`: `"Used by the client to invoke a tool provided by the server."`; \}, \{ `anyOf`: readonly \[\{ `allOf`: readonly \[\{ `properties`: \{ `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `additionalProperties`: ...; `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"notifications/cancelled"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `reason`: \{ `type`: ...; \}; `requestId`: \{ `anyOf`: ...; `description`: ...; \}; \}; `required`: readonly \[`"requestId"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `additionalProperties`: ...; `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `description`: `"An out-of-band notification used to inform the receiver of a progress update for a long-running request."`; `properties`: \{ `method`: \{ `const`: `"notifications/progress"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `message`: \{ `description`: ...; `type`: ...; \}; `progress`: \{ `description`: ...; `type`: ...; \}; `progressToken`: \{ `anyOf`: ...; `description`: ...; \}; `total`: \{ `description`: ...; `type`: ...; \}; \}; `required`: readonly \[`"progress"`, `"progressToken"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `additionalProperties`: ...; `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"notifications/initialized"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"method"`\]; `type`: `"object"`; \}\]; `description`: `"This notification is sent from the client to the server after initialization has finished."`; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `additionalProperties`: ...; `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"notifications/roots/list_changed"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"method"`\]; `type`: `"object"`; \}\]; `description`: "A notification from the client to the server, informing it that the list of roots has changed.\n    This notification should be sent whenever the client adds, removes, or modifies any root.\n    The server should then request an updated list of roots using the ListRootsRequest."; \}\]; \}, \{ `anyOf`: readonly \[\{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: ...; \}, \{ `type`: ...; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `error`: \{ `properties`: \{ `code`: \{ `type`: ...; \}; `data`: \{ `additionalProperties`: ...; `type`: ...; \}; `message`: \{ `type`: ...; \}; \}; `required`: readonly \[`"code"`, `"message"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"error"`\]; `type`: `"object"`; \}\]; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: ...; \}, \{ `type`: ...; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `result`: \{ `anyOf`: readonly \[\{ `additionalProperties`: ...; `properties`: ...; `type`: ...; \}, \{ `allOf`: ...; `description`: ...; \}, \{ `allOf`: ...; `description`: ...; \}, \{ `allOf`: ...; `description`: ...; \}\]; \}; \}; `required`: readonly \[`"result"`\]; `type`: `"object"`; \}\]; \}\]; \}\]

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

> `const` **LATEST\_PROTOCOL\_VERSION**: `"2025-06-18"` = `'2025-06-18'`

***

### METHOD\_NOT\_FOUND

> `const` **METHOD\_NOT\_FOUND**: `-32601` = `-32601`

***

### outputSchema

> `const` **outputSchema**: `object`

#### Type declaration

##### description

> `readonly` **description**: "An optional JSON Schema object defining the structure of the tool's output returned in\nthe structuredContent field of a CallToolResult." = `"An optional JSON Schema object defining the structure of the tool's output returned in\nthe structuredContent field of a CallToolResult."`

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

###### properties.required

> `readonly` **properties.required**: `object`

###### properties.required.items

> `readonly` **properties.required.items**: `object`

###### properties.required.items.type

> `readonly` **properties.required.items.type**: `"string"` = `'string'`

###### properties.required.type

> `readonly` **properties.required.type**: `"array"` = `'array'`

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

### PARSE\_ERROR

> `const` **PARSE\_ERROR**: `-32700` = `-32700`

***

### serverMessage

> `const` **serverMessage**: `object`

Any MCP server message.

#### Type declaration

##### anyOf

> `readonly` **anyOf**: readonly \[\{ `anyOf`: readonly \[\{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: ...; \}, \{ `type`: ...; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `properties`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `description`: `"A ping, issued by either the server or the client, to check that the other party is still alive. The receiver must promptly respond, or else may be disconnected."`; `properties`: \{ `method`: \{ `const`: `"ping"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"method"`\]; `type`: `"object"`; \}\]; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: ...; \}, \{ `type`: ...; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `properties`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"sampling/createMessage"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `includeContext`: \{ `description`: ...; `enum`: ...; `type`: ...; \}; `maxTokens`: \{ `description`: ...; `type`: ...; \}; `messages`: \{ `items`: ...; `type`: ...; \}; `metadata`: \{ `additionalProperties`: ...; `description`: ...; `properties`: ...; `type`: ...; \}; `modelPreferences`: \{ `description`: ...; `properties`: ...; `type`: ...; \}; `stopSequences`: \{ `items`: ...; `type`: ...; \}; `systemPrompt`: \{ `description`: ...; `type`: ...; \}; `temperature`: \{ `type`: ...; \}; \}; `required`: readonly \[`"maxTokens"`, `"messages"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]; `description`: `"A request from the server to sample an LLM via the client. The client has full discretion over which model to select. The client should also inform the user before beginning sampling, to allow them to inspect the request (human in the loop) and decide whether to approve it."`; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: ...; \}, \{ `type`: ...; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `properties`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"roots/list"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"method"`\]; `type`: `"object"`; \}\]; `description`: "Sent from the server to request a list of root URIs from the client. Roots allow servers to ask for specific directories or files to operate on. A common example for roots is providing a set of repositories or directories a server should operate on.\n    \n  This request is typically used when the server needs to understand the file system structure or access specific locations that the client has permission to read from."; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: ...; \}, \{ `type`: ...; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `properties`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"elicitation/create"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `message`: \{ `description`: ...; `type`: ...; \}; `requestedSchema`: \{ `description`: ...; `properties`: ...; `required`: ...; `type`: ...; \}; \}; `required`: readonly \[`"message"`, `"requestedSchema"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]; `description`: `"A request from the server to elicit additional information from the user via the client."`; \}\]; \}, \{ `anyOf`: readonly \[\{ `allOf`: readonly \[\{ `properties`: \{ `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `additionalProperties`: ...; `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"notifications/cancelled"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `reason`: \{ `type`: ...; \}; `requestId`: \{ `anyOf`: ...; `description`: ...; \}; \}; `required`: readonly \[`"requestId"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `additionalProperties`: ...; `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"notifications/message"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `data`: \{ `description`: ...; \}; `level`: \{ `description`: ...; `enum`: ...; `type`: ...; \}; `logger`: \{ `description`: ...; `type`: ...; \}; \}; `required`: readonly \[`"data"`, `"level"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]; `description`: `"Notification of a log message passed from server to client. If no logging/setLevel request has been sent from the client, the server MAY decide which messages to send automatically."`; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `additionalProperties`: ...; `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `description`: `"An out-of-band notification used to inform the receiver of a progress update for a long-running request."`; `properties`: \{ `method`: \{ `const`: `"notifications/progress"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `message`: \{ `description`: ...; `type`: ...; \}; `progress`: \{ `description`: ...; `type`: ...; \}; `progressToken`: \{ `anyOf`: ...; `description`: ...; \}; `total`: \{ `description`: ...; `type`: ...; \}; \}; `required`: readonly \[`"progress"`, `"progressToken"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `additionalProperties`: ...; `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"notifications/resources/updated"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `uri`: \{ `description`: ...; `format`: ...; `type`: ...; \}; \}; `required`: readonly \[`"uri"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]; `description`: `"A notification from the server to the client, informing it that a resource has changed and may need to be read again. This should only be sent if the client previously sent a resources/subscribe request."`; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `additionalProperties`: ...; `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"notifications/resources/list_changed"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"method"`\]; `type`: `"object"`; \}\]; `description`: `"An optional notification from the server to the client, informing it that the list of resources it can read from has changed. This may be issued by servers without any previous subscription from the client."`; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `additionalProperties`: ...; `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"notifications/tools/list_changed"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"method"`\]; `type`: `"object"`; \}\]; `description`: `"An optional notification from the server to the client, informing it that the list of tools it offers has changed. This may be issued by servers without any previous subscription from the client."`; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `additionalProperties`: ...; `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"notifications/prompts/list_changed"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"method"`\]; `type`: `"object"`; \}\]; `description`: `"An optional notification from the server to the client, informing it that the list of prompts it offers has changed. This may be issued by servers without any previous subscription from the client."`; \}\]; \}, \{ `anyOf`: readonly \[\{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: ...; \}, \{ `type`: ...; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `error`: \{ `properties`: \{ `code`: \{ `type`: ...; \}; `data`: \{ `additionalProperties`: ...; `type`: ...; \}; `message`: \{ `type`: ...; \}; \}; `required`: readonly \[`"code"`, `"message"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"error"`\]; `type`: `"object"`; \}\]; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: ...; \}, \{ `type`: ...; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `result`: \{ `anyOf`: readonly \[\{ `additionalProperties`: ...; `properties`: ...; `type`: ...; \}, \{ `allOf`: ...; `description`: ...; \}, \{ `allOf`: ...; `description`: ...; \}, \{ `allOf`: ...; `description`: ...; \}, \{ `allOf`: ...; `description`: ...; \}, \{ `allOf`: ...; `description`: ...; \}, \{ `allOf`: ...; `description`: ...; \}, \{ `allOf`: ...; `description`: ...; \}, \{ `allOf`: ...; `description`: ...; \}, \{ `allOf`: ...; `description`: ...; \}\]; \}; \}; `required`: readonly \[`"result"`\]; `type`: `"object"`; \}\]; \}\]; \}\]
