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

### CacheableResult

> **CacheableResult** = `FromSchema`\<*typeof* `cacheableResult`\>

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

> **ClientMessage** = `ClientMessage20251125` \| `ClientMessage20260728`

Any message a client speaking any supported revision may send.

***

### ClientNotification

> **ClientNotification** = `ClientNotification20251125` \| `ClientNotification20260728`

Any notification a client speaking any supported revision may send.

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

> **ClientRequest** = `ClientRequest20251125` \| `ClientRequest20260728`

Any request a client speaking any supported revision may send.

***

### ClientRequestContext

> **ClientRequestContext** = `object`

What a client knows about itself when decorating an outgoing request.

#### Properties

##### capabilities

> **capabilities**: [`ClientCapabilities`](#clientcapabilities)

##### clientInfo?

> `optional` **clientInfo?**: [`Implementation`](#implementation)

##### logLevel?

> `optional` **logLevel?**: [`LoggingLevel`](#logginglevel)

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

##### server/discover

> **server/discover**: `object`

###### Params

> **Params**: [`DiscoverRequest`](#discoverrequest)\[`"params"`\]

###### Result

> **Result**: [`DiscoverResult`](#discoverresult)

##### tasks/cancel

> **tasks/cancel**: `object`

###### Params

> **Params**: [`TasksCancelRequest`](#taskscancelrequest)\[`"params"`\]

###### Result

> **Result**: [`TasksAcknowledgement`](#tasksacknowledgement)

##### tasks/get

> **tasks/get**: `object`

###### Params

> **Params**: [`TasksGetRequest`](#tasksgetrequest)\[`"params"`\]

###### Result

> **Result**: [`TasksGetResult`](#tasksgetresult)

##### tasks/update

> **tasks/update**: `object`

###### Params

> **Params**: [`TasksUpdateRequest`](#tasksupdaterequest)\[`"params"`\]

###### Result

> **Result**: [`TasksAcknowledgement`](#tasksacknowledgement)

##### tools/call

> **tools/call**: `object`

###### Params

> **Params**: [`CallToolRequest`](#calltoolrequest)\[`"params"`\]

###### Result

> **Result**: [`CallToolResult`](#calltoolresult) \| [`CreateTaskResult`](#createtaskresult)

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

### CreateTaskResult

> **CreateTaskResult** = [`Task`](#task) & `object`

#### Type Declaration

##### resultType

> **resultType**: `"task"`

***

### DetailedTask

> **DetailedTask** = [`Task`](#task) & `object` \| [`Task`](#task) & `object` \| [`Task`](#task) & `object` \| [`Task`](#task) & `object` \| [`Task`](#task) & `object`

***

### DiscoverRequest

> **DiscoverRequest** = `FromSchema`\<*typeof* `discoverRequest`\>

***

### DiscoverResult

> **DiscoverResult** = `FromSchema`\<*typeof* [`discoverResult`](#discoverresult-1)\>

***

### ElicitationCompleteNotification

> **ElicitationCompleteNotification** = `FromSchema`\<*typeof* [`elicitationCompleteNotification`](#elicitationcompletenotification-1)\>

***

### ElicitFormChoice

> **ElicitFormChoice** = `object`

#### Properties

##### label

> **label**: `string`

##### value

> **value**: `string`

***

### ElicitFormField

> **ElicitFormField** = `object`

#### Properties

##### choices?

> `optional` **choices?**: [`ElicitFormChoice`](#elicitformchoice)[]

##### default?

> `optional` **default?**: `unknown`

##### description?

> `optional` **description?**: `string`

##### format?

> `optional` **format?**: `string`

##### kind

> **kind**: [`ElicitFormFieldKind`](#elicitformfieldkind-1)

##### maximum?

> `optional` **maximum?**: `number`

##### maxLength?

> `optional` **maxLength?**: `number`

##### minimum?

> `optional` **minimum?**: `number`

##### minLength?

> `optional` **minLength?**: `number`

##### name

> **name**: `string`

##### pattern?

> `optional` **pattern?**: `string`

##### required

> **required**: `boolean`

##### title?

> `optional` **title?**: `string`

***

### ElicitFormFieldKind

> **ElicitFormFieldKind** = `"boolean"` \| `"number"` \| `"integer"` \| `"text"` \| `"choice"` \| `"multi"`

***

### ElicitFormResult

> **ElicitFormResult** = \{ `fields`: [`ElicitFormField`](#elicitformfield)[]; `ok`: `true`; \} \| \{ `ok`: `false`; `reason`: `string`; \}

***

### ElicitRequest

> **ElicitRequest** = `FromSchema`\<*typeof* `elicitRequest`\>

***

### ElicitResult

> **ElicitResult** = `FromSchema`\<*typeof* `elicitResult`\>

***

### EmptyResult

> **EmptyResult** = `FromSchema`\<*typeof* [`emptyResult`](#emptyresult-1)\>

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

### Icon

> **Icon** = `FromSchema`\<*typeof* `icon`\>

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

### InputRequest

> **InputRequest** = `FromSchema`\<*typeof* [`inputRequest`](#inputrequest-1)\>

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

### InputResponse

> **InputResponse** = `FromSchema`\<*typeof* [`inputResponse`](#inputresponse-1)\>

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

### OutputSchema

> **OutputSchema** = `FromSchema`\<*typeof* [`outputSchema`](#outputschema-1)\>

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

### ProtocolDefinition

> **ProtocolDefinition** = `object`

#### Properties

##### clientMessage

> **clientMessage**: `Schema`

Inbound-message validators, used by the server and client read loops.

##### clientMethods

> **clientMethods**: `ReadonlySet`\<`string`\>

Request methods a client may send in this revision.

##### clientNotifications

> **clientNotifications**: `ReadonlySet`\<`string`\>

Notification methods a client may send in this revision -- the notification counterpart of
[ProtocolDefinition.clientMethods](#clientmethods), and kept separate from it so that gating requests
on the method table cannot accidentally admit a notification as a request.

Must name exactly the members of this revision's `clientNotification` union: a name here
that the union rejects produces a frame the peer's own validator refuses, and a member of
the union missing here is refused locally though the peer would accept it. Guarded by a
test in `packages/context-protocol/test/versions.test.ts`.

##### decorateNotification

> **decorateNotification**: (`params`) => `unknown`

Adds this revision's protocol `_meta` to an outgoing notification's params.

Separate from `decorateRequest` and deliberately context-free: a notification is not a
request, so it carries only what a peer needs to route it to the right revision -- never the
`clientInfo`/`clientCapabilities`/`logLevel` envelope, which describes a request.

###### Parameters

###### params

`unknown`

###### Returns

`unknown`

##### decorateRequest

> **decorateRequest**: (`params`, `context`) => `unknown`

Adds this revision's protocol `_meta` to an outgoing request's params.

###### Parameters

###### params

`unknown`

###### context

[`ClientRequestContext`](#clientrequestcontext)

###### Returns

`unknown`

##### inputRequestMethods

> **inputRequestMethods**: `ReadonlySet`\<`string`\>

Methods this revision carries as requests embedded in an `input_required` result (MRTR,
SEP-2322), rather than as server-initiated requests.

Disjoint from [ProtocolDefinition.serverMethods](#servermethods) by construction: a method is reachable
one way or the other, never both. `2025-11-25` sends all three as real requests and so carries
none here; `2026-07-28` sends no requests at all and so carries all three.

##### readRequestMeta

> **readRequestMeta**: (`request`) => [`RequestMetaInfo`](#requestmetainfo)

Reads this revision's protocol `_meta` off an inbound request.

###### Parameters

###### request

[`Request`](#request)

###### Returns

[`RequestMetaInfo`](#requestmetainfo)

##### requiresCacheHints

> **requiresCacheHints**: `boolean`

True when `complete` results of cacheable methods must carry `ttlMs`/`cacheScope`.

##### requiresRequestMeta

> **requiresRequestMeta**: `boolean`

True when every request must carry protocol version and client capabilities in `_meta`.

##### serverMessage

> **serverMessage**: `Schema`

##### serverMethods

> **serverMethods**: `ReadonlySet`\<`string`\>

Methods a server may send in this revision.

##### version

> **version**: [`ProtocolVersion`](#protocolversion)

##### wrapResult

> **wrapResult**: (`result`, `context`) => `Record`\<`string`, `unknown`\>

Adds this revision's result envelope to an outgoing result.

###### Parameters

###### result

`Record`\<`string`, `unknown`\>

###### context

[`ServerResultContext`](#serverresultcontext)

###### Returns

`Record`\<`string`, `unknown`\>

***

### ProtocolVersion

> **ProtocolVersion** = `"2025-11-25"` \| `"2026-07-28"`

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

### RequestMetaInfo

> **RequestMetaInfo** = `object`

Protocol metadata a server reads off an inbound request.

#### Properties

##### clientCapabilities?

> `optional` **clientCapabilities?**: [`ClientCapabilities`](#clientcapabilities)

##### clientInfo?

> `optional` **clientInfo?**: [`Implementation`](#implementation)

##### logLevel?

> `optional` **logLevel?**: [`LoggingLevel`](#logginglevel)

##### protocolVersion?

> `optional` **protocolVersion?**: `string`

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

> **ServerMessage** = [`ServerRequest`](#serverrequest) \| [`ServerNotification`](#servernotification) \| `ServerResponse`

***

### ServerNotification

> **ServerNotification** = `FromSchema`\<*typeof* `cancelledNotification`\> \| `FromSchema`\<*typeof* [`elicitationCompleteNotification`](#elicitationcompletenotification-1)\> \| `FromSchema`\<*typeof* `loggingMessageNotification`\> \| `FromSchema`\<*typeof* `progressNotification`\> \| `FromSchema`\<*typeof* `resourceUpdatedNotification`\> \| `FromSchema`\<*typeof* `resourceListChangedNotification`\> \| `FromSchema`\<*typeof* `toolListChangedNotification`\> \| `FromSchema`\<*typeof* `promptListChangedNotification`\> \| [`TaskNotification`](#tasknotification)

***

### ServerNotifications

> **ServerNotifications** = `object`

#### Properties

##### prompts/list\_changed

> **prompts/list\_changed**: [`PromptListChangedNotification`](#promptlistchangednotification)

##### resources/list\_changed

> **resources/list\_changed**: [`ResourceListChangedNotification`](#resourcelistchangednotification)

##### tasks

> **tasks**: [`TaskNotification`](#tasknotification)

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

> **ServerResult** = `FromSchema`\<*typeof* [`emptyResult`](#emptyresult-1)\> \| `FromSchema`\<*typeof* `initializeResult`\> \| `FromSchema`\<*typeof* `completeResult`\> \| `FromSchema`\<*typeof* `getPromptResult`\> \| `FromSchema`\<*typeof* `listPromptsResult`\> \| `FromSchema`\<*typeof* `listResourcesResult`\> \| `FromSchema`\<*typeof* `listResourceTemplatesResult`\> \| `FromSchema`\<*typeof* `readResourceResult`\> \| `FromSchema`\<*typeof* `callToolResult`\> \| [`CreateTaskResult`](#createtaskresult) \| [`TasksGetResult`](#tasksgetresult) \| [`TasksAcknowledgement`](#tasksacknowledgement) \| `FromSchema`\<*typeof* `listToolsResult`\>

***

### ServerResultContext

> **ServerResultContext** = `object`

What a server knows about itself when wrapping an outgoing result.

#### Properties

##### serverInfo

> **serverInfo**: [`Implementation`](#implementation)

***

### SetLevelRequest

> **SetLevelRequest** = `FromSchema`\<*typeof* `setLevelRequest`\>

***

### SubscribeRequest

> **SubscribeRequest** = `FromSchema`\<*typeof* [`subscribeRequest`](#subscriberequest-1)\>

***

### SubscriptionFilter

> **SubscriptionFilter** = `FromSchema`\<*typeof* [`subscriptionFilter`](#subscriptionfilter-1)\>

***

### SubscriptionsAcknowledgedNotification

> **SubscriptionsAcknowledgedNotification** = `FromSchema`\<*typeof* [`subscriptionsAcknowledgedNotification`](#subscriptionsacknowledgednotification-1)\>

***

### SubscriptionsListenRequest

> **SubscriptionsListenRequest** = `FromSchema`\<*typeof* [`subscriptionsListenRequest`](#subscriptionslistenrequest-1)\>

***

### SubscriptionsListenResult

> **SubscriptionsListenResult** = `FromSchema`\<*typeof* [`subscriptionsListenResult`](#subscriptionslistenresult-1)\>

***

### Task

> **Task** = `FromSchema`\<*typeof* `task`\>

***

### TaskNotification

> **TaskNotification** = `object`

#### Indexable

> \[`key`: `string`\]: `unknown`

#### Properties

##### jsonrpc

> **jsonrpc**: `"2.0"`

##### method

> **method**: `"notifications/tasks"`

##### params

> **params**: [`DetailedTask`](#detailedtask)

***

### TasksAcknowledgement

> **TasksAcknowledgement** = `FromSchema`\<*typeof* `tasksAcknowledgement`\>

***

### TasksCancelRequest

> **TasksCancelRequest** = `FromSchema`\<*typeof* `tasksCancelRequest`\>

***

### TasksGetRequest

> **TasksGetRequest** = `FromSchema`\<*typeof* `tasksGetRequest`\>

***

### TasksGetResult

> **TasksGetResult** = [`DetailedTask`](#detailedtask) & `object`

#### Type Declaration

##### resultType

> **resultType**: `"complete"`

***

### TaskStatus

> **TaskStatus** = `FromSchema`\<*typeof* `taskStatus`\>

***

### TasksUpdateRequest

> **TasksUpdateRequest** = `FromSchema`\<*typeof* `tasksUpdateRequest`\>

***

### Tool

> **Tool** = `FromSchema`\<*typeof* `tool`\>

***

### ToolAnnotations

> **ToolAnnotations** = `FromSchema`\<*typeof* `toolAnnotations`\>

***

### ToolListChangedNotification

> **ToolListChangedNotification** = `FromSchema`\<*typeof* `toolListChangedNotification`\>

***

### UnsubscribeRequest

> **UnsubscribeRequest** = `FromSchema`\<*typeof* [`unsubscribeRequest`](#unsubscriberequest-1)\>

## Variables

### clientMessage

> `const` **clientMessage**: `object`

#### Type Declaration

##### anyOf

> `readonly` **anyOf**: readonly \[\{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: `"string"`; \}, \{ `type`: `"integer"`; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `properties`: \{ `progressToken`: \{ `anyOf`: ...; `description`: ...; \}; \}; `type`: `"object"`; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `description`: `"A ping, issued by either the server or the client, to check that the other party is still alive. The receiver must promptly respond, or else may be disconnected."`; `properties`: \{ `method`: \{ `const`: `"ping"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"method"`\]; `type`: `"object"`; \}\]; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: `"string"`; \}, \{ `type`: `"integer"`; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `properties`: \{ `progressToken`: \{ `anyOf`: ...; `description`: ...; \}; \}; `type`: `"object"`; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"initialize"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `capabilities`: \{ `description`: `"Capabilities a client may support. Known capabilities are defined here, in this schema, but this is not a closed set: any client can define its own, additional capabilities."`; `properties`: \{ `elicitation`: \{ `additionalProperties`: ...; `description`: ...; `properties`: ...; `type`: ...; \}; `experimental`: \{ `additionalProperties`: ...; `description`: ...; `type`: ...; \}; `extensions`: \{ `additionalProperties`: ...; `description`: ...; `type`: ...; \}; `roots`: \{ `description`: ...; `properties`: ...; `type`: ...; \}; `sampling`: \{ `additionalProperties`: ...; `description`: ...; `properties`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; `clientInfo`: \{ `description`: `"Describes the name and version of an MCP implementation, with an optional title for UI representation."`; `properties`: \{ `description`: \{ `description`: ...; `type`: ...; \}; `icons`: \{ `description`: ...; `items`: ...; `type`: ...; \}; `name`: \{ `description`: ...; `type`: ...; \}; `title`: \{ `description`: ...; `type`: ...; \}; `version`: \{ `type`: ...; \}; `websiteUrl`: \{ `description`: ...; `format`: ...; `type`: ...; \}; \}; `required`: readonly \[`"name"`, `"version"`\]; `type`: `"object"`; \}; `protocolVersion`: \{ `description`: `"The latest version of the Model Context Protocol that the client supports. The client MAY decide to support older versions as well."`; `type`: `"string"`; \}; \}; `required`: readonly \[`"capabilities"`, `"clientInfo"`, `"protocolVersion"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]; `description`: `"This request is sent from the client to the server when it first connects, asking it to begin initialization."`; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: `"string"`; \}, \{ `type`: `"integer"`; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `properties`: \{ `progressToken`: \{ `anyOf`: ...; `description`: ...; \}; \}; `type`: `"object"`; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"completion/complete"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `argument`: \{ `description`: `"The argument's information"`; `properties`: \{ `name`: \{ `description`: ...; `type`: ...; \}; `value`: \{ `description`: ...; `type`: ...; \}; \}; `required`: readonly \[`"name"`, `"value"`\]; `type`: `"object"`; \}; `context`: \{ `description`: `"Additional, optional context for completions"`; `properties`: \{ `arguments`: \{ `additionalProperties`: ...; `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; `ref`: \{ `anyOf`: readonly \[\{ `description`: ...; `properties`: ...; `required`: ...; `type`: ...; \}, \{ `description`: ...; `properties`: ...; `required`: ...; `type`: ...; \}\]; \}; \}; `required`: readonly \[`"argument"`, `"ref"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]; `description`: `"A request from the client to the server, to ask for completion options."`; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: `"string"`; \}, \{ `type`: `"integer"`; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `properties`: \{ `progressToken`: \{ `anyOf`: ...; `description`: ...; \}; \}; `type`: `"object"`; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"logging/setLevel"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `level`: \{ `description`: "The severity of a log message.\\n\\nThese map to syslog message severities, as specified in RFC-5424:\\nhttps://datatracker.ietf.org/doc/html/rfc5424#section-6.2.1"; `enum`: readonly \[`"alert"`, `"critical"`, `"debug"`, `"emergency"`, `"error"`, `"info"`, `"notice"`, `"warning"`\]; `type`: `"string"`; \}; \}; `required`: readonly \[`"level"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]; `description`: `"A request from the client to the server, to enable or adjust logging."`; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: `"string"`; \}, \{ `type`: `"integer"`; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `properties`: \{ `progressToken`: \{ `anyOf`: ...; `description`: ...; \}; \}; `type`: `"object"`; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"prompts/get"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `arguments`: \{ `additionalProperties`: \{ `type`: `"string"`; \}; `description`: `"Arguments to use for templating the prompt."`; `type`: `"object"`; \}; `name`: \{ `description`: `"The name of the prompt or prompt template."`; `type`: `"string"`; \}; \}; `required`: readonly \[`"name"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]; `description`: `"Used by the client to get a prompt provided by the server."`; \}, \{ `allOf`: readonly \[\{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: ...; \}, \{ `type`: ...; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `properties`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `params`: \{ `properties`: \{ `cursor`: \{ `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `type`: `"object"`; \}\]; \}, \{ `properties`: \{ `method`: \{ `const`: `"prompts/list"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"method"`\]; `type`: `"object"`; \}\]; `description`: `"Sent from the client to request a list of prompts and prompt templates the server has."`; \}, \{ `allOf`: readonly \[\{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: ...; \}, \{ `type`: ...; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `properties`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `params`: \{ `properties`: \{ `cursor`: \{ `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `type`: `"object"`; \}\]; \}, \{ `properties`: \{ `method`: \{ `const`: `"resources/list"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"method"`\]; `type`: `"object"`; \}\]; `description`: `"Sent from the client to request a list of resources the server has."`; \}, \{ `allOf`: readonly \[\{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: ...; \}, \{ `type`: ...; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `properties`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `params`: \{ `properties`: \{ `cursor`: \{ `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `type`: `"object"`; \}\]; \}, \{ `properties`: \{ `method`: \{ `const`: `"resources/templates/list"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"method"`\]; `type`: `"object"`; \}\]; `description`: `"Sent from the client to request a list of resource templates the server has."`; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: `"string"`; \}, \{ `type`: `"integer"`; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `properties`: \{ `progressToken`: \{ `anyOf`: ...; `description`: ...; \}; \}; `type`: `"object"`; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"resources/read"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `uri`: \{ `description`: `"The URI of the resource to read. The URI can use any protocol; it is up to the server how to interpret it."`; `format`: `"uri"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"uri"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]; `description`: `"Sent from the client to the server, to read a specific resource URI."`; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: `"string"`; \}, \{ `type`: `"integer"`; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `properties`: \{ `progressToken`: \{ `anyOf`: ...; `description`: ...; \}; \}; `type`: `"object"`; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"resources/subscribe"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `uri`: \{ `description`: `"The URI of the resource to subscribe to. The URI can use any protocol; it is up to the server how to interpret it."`; `format`: `"uri"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"uri"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]; `description`: `"Sent from the client to request resources/updated notifications from the server whenever a particular resource changes."`; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: `"string"`; \}, \{ `type`: `"integer"`; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `properties`: \{ `progressToken`: \{ `anyOf`: ...; `description`: ...; \}; \}; `type`: `"object"`; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"resources/unsubscribe"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `uri`: \{ `description`: `"The URI of the resource to unsubscribe from."`; `format`: `"uri"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"uri"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]; `description`: `"Sent from the client to request cancellation of resources/updated notifications from the server. This should follow a previous resources/subscribe request."`; \}, \{ `allOf`: readonly \[\{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: ...; \}, \{ `type`: ...; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `properties`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `params`: \{ `properties`: \{ `cursor`: \{ `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `type`: `"object"`; \}\]; \}, \{ `properties`: \{ `method`: \{ `const`: `"tools/list"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"method"`\]; `type`: `"object"`; \}\]; `description`: `"Sent from the client to request a list of tools the server has."`; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: `"string"`; \}, \{ `type`: `"integer"`; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `properties`: \{ `progressToken`: \{ `anyOf`: ...; `description`: ...; \}; \}; `type`: `"object"`; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"tools/call"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `arguments`: \{ `additionalProperties`: \{ \}; `type`: `"object"`; \}; `name`: \{ `type`: `"string"`; \}; \}; `required`: readonly \[`"name"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]; `description`: `"Used by the client to invoke a tool provided by the server."`; \}, \{ `anyOf`: readonly \[\{ `allOf`: readonly \[\{ `properties`: \{ `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `additionalProperties`: ...; `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"notifications/cancelled"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `reason`: \{ `type`: ...; \}; `requestId`: \{ `anyOf`: ...; `description`: ...; \}; \}; `required`: readonly \[`"requestId"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `additionalProperties`: ...; `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `description`: `"An out-of-band notification used to inform the receiver of a progress update for a long-running request."`; `properties`: \{ `method`: \{ `const`: `"notifications/progress"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `message`: \{ `description`: ...; `type`: ...; \}; `progress`: \{ `description`: ...; `type`: ...; \}; `progressToken`: \{ `anyOf`: ...; `description`: ...; \}; `total`: \{ `description`: ...; `type`: ...; \}; \}; `required`: readonly \[`"progress"`, `"progressToken"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `additionalProperties`: ...; `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"notifications/initialized"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"method"`\]; `type`: `"object"`; \}\]; `description`: `"This notification is sent from the client to the server after initialization has finished."`; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `additionalProperties`: ...; `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"notifications/roots/list_changed"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"method"`\]; `type`: `"object"`; \}\]; `description`: "A notification from the client to the server, informing it that the list of roots has changed.\\n    This notification should be sent whenever the client adds, removes, or modifies any root.\\n    The server should then request an updated list of roots using the ListRootsRequest."; \}\]; \}, \{ `anyOf`: readonly \[\{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: ...; \}, \{ `type`: ...; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `error`: \{ `properties`: \{ `code`: \{ `type`: ...; \}; `data`: \{ \}; `message`: \{ `type`: ...; \}; \}; `required`: readonly \[`"code"`, `"message"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"error"`\]; `type`: `"object"`; \}\]; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: ...; \}, \{ `type`: ...; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `result`: \{ `anyOf`: readonly \[\{ `additionalProperties`: ...; `properties`: ...; `type`: ...; \}, \{ `allOf`: ...; `description`: ...; \}, \{ `allOf`: ...; `description`: ...; \}, \{ `allOf`: ...; `description`: ...; \}\]; \}; \}; `required`: readonly \[`"result"`\]; `type`: `"object"`; \}\]; \}\]; \}\]

***

### createTaskResult

> `const` **createTaskResult**: `object`

#### Type Declaration

##### additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

##### properties

> `readonly` **properties**: `object`

###### properties.\_meta

> `readonly` **\_meta**: `object` = `metadata`

###### properties.\_meta.additionalProperties

> `readonly` **additionalProperties**: `object` = `{}`

###### properties.\_meta.description

> `readonly` **description**: `"See [specification/2025-11-25/basic/index#general-fields] for notes on _meta usage."` = `'See [specification/2025-11-25/basic/index#general-fields] for notes on _meta usage.'`

###### properties.\_meta.type

> `readonly` **type**: `"object"` = `'object'`

###### properties.createdAt

> `readonly` **createdAt**: `object`

###### properties.createdAt.format

> `readonly` **format**: `"date-time"` = `'date-time'`

###### properties.createdAt.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.lastUpdatedAt

> `readonly` **lastUpdatedAt**: `object`

###### properties.lastUpdatedAt.format

> `readonly` **format**: `"date-time"` = `'date-time'`

###### properties.lastUpdatedAt.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.pollIntervalMs

> `readonly` **pollIntervalMs**: `object`

###### properties.pollIntervalMs.type

> `readonly` **type**: `"integer"` = `'integer'`

###### properties.resultType

> `readonly` **resultType**: `object`

###### properties.resultType.const

> `readonly` **const**: `"task"` = `'task'`

###### properties.resultType.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.status

> `readonly` **status**: `object` = `taskStatus`

###### properties.status.enum

> `readonly` **enum**: readonly \[`"working"`, `"input_required"`, `"completed"`, `"failed"`, `"cancelled"`\]

###### properties.status.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.statusMessage

> `readonly` **statusMessage**: `object`

###### properties.statusMessage.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.taskId

> `readonly` **taskId**: `object`

###### properties.taskId.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.ttlMs

> `readonly` **ttlMs**: `object`

###### properties.ttlMs.anyOf

> `readonly` **anyOf**: readonly \[\{ `type`: `"integer"`; \}, \{ `type`: `"null"`; \}\]

##### required

> `readonly` **required**: readonly \[`"taskId"`, `"status"`, `"createdAt"`, `"lastUpdatedAt"`, `"ttlMs"`, `"resultType"`\]

##### type

> `readonly` **type**: `"object"` = `'object'`

***

### discoverResult

> `const` **discoverResult**: `object`

#### Type Declaration

##### allOf

> `readonly` **allOf**: readonly \[\{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `additionalProperties`: \{ \}; `description`: `"See [specification/2025-11-25/basic/index#general-fields] for notes on _meta usage."`; `type`: `"object"`; \}; \}; `type`: `"object"`; \}, \{ `properties`: \{ `cacheScope`: \{ `description`: "Controls whether shared intermediaries may cache the response. \\"public\\" allows shared caching; \\"private\\" restricts it to the requesting client."; `enum`: readonly \[`"public"`, `"private"`\]; `type`: `"string"`; \}; `ttlMs`: \{ `description`: `"Freshness hint in milliseconds. Allows clients to cache the response and reduce polling. Complements listChanged notifications."`; `type`: `"number"`; \}; \}; `type`: `"object"`; \}, \{ `properties`: \{ `capabilities`: \{ `description`: `"Capabilities that a server may support. Known capabilities are defined here, in this schema, but this is not a closed set: any server can define its own, additional capabilities."`; `properties`: \{ `completions`: \{ `additionalProperties`: `true`; `description`: `"Present if the server supports argument autocompletion suggestions."`; `properties`: \{ \}; `type`: `"object"`; \}; `experimental`: \{ `additionalProperties`: \{ `additionalProperties`: `true`; `properties`: \{ \}; `type`: `"object"`; \}; `description`: `"Experimental, non-standard capabilities that the client supports."`; `type`: `"object"`; \}; `extensions`: \{ `additionalProperties`: \{ `additionalProperties`: `true`; `properties`: \{ \}; `type`: `"object"`; \}; `description`: `"Optional extensions beyond the core protocol that this party supports."`; `type`: `"object"`; \}; `logging`: \{ `additionalProperties`: `true`; `description`: `"Present if the server supports sending log messages to the client."`; `properties`: \{ \}; `type`: `"object"`; \}; `prompts`: \{ `description`: `"Present if the server offers any prompt templates."`; `properties`: \{ `listChanged`: \{ `description`: `"Whether this server supports notifications for changes to the prompt list."`; `type`: `"boolean"`; \}; \}; `type`: `"object"`; \}; `resources`: \{ `description`: `"Present if the server offers any resources to read."`; `properties`: \{ `listChanged`: \{ `description`: `"Whether this server supports notifications for changes to the resource list."`; `type`: `"boolean"`; \}; `subscribe`: \{ `description`: `"Whether this server supports subscribing to resource updates."`; `type`: `"boolean"`; \}; \}; `type`: `"object"`; \}; `tools`: \{ `description`: `"Present if the server offers any tools to call."`; `properties`: \{ `listChanged`: \{ `description`: `"Whether this server supports notifications for changes to the tool list."`; `type`: `"boolean"`; \}; \}; `type`: `"object"`; \}; \}; `type`: `"object"`; \}; `instructions`: \{ `type`: `"string"`; \}; `resultType`: \{ `const`: `"complete"`; `type`: `"string"`; \}; `supportedVersions`: \{ `items`: \{ `type`: `"string"`; \}; `type`: `"array"`; \}; \}; `required`: readonly \[`"capabilities"`, `"resultType"`, `"supportedVersions"`\]; `type`: `"object"`; \}\]

***

### elicitationCompleteNotification

> `const` **elicitationCompleteNotification**: `object`

#### Type Declaration

##### allOf

> `readonly` **allOf**: readonly \[\{ `properties`: \{ `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `additionalProperties`: \{ \}; `description`: `"See [specification/2025-11-25/basic/index#general-fields] for notes on _meta usage."`; `type`: `"object"`; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"notifications/elicitation/complete"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `elicitationId`: \{ `description`: `"The identifier of the elicitation that completed."`; `type`: `"string"`; \}; \}; `required`: readonly \[`"elicitationId"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]

##### description

> `readonly` **description**: `"Sent by the server to indicate a URL-based elicitation is complete and the client may stop showing the prompt."` = `'Sent by the server to indicate a URL-based elicitation is complete and the client may stop showing the prompt.'`

***

### elicitRequestFormParams

> `const` **elicitRequestFormParams**: `object`

#### Type Declaration

##### properties

> `readonly` **properties**: `object`

###### properties.message

> `readonly` **message**: `object`

###### properties.message.description

> `readonly` **description**: `"The message to present to the user."` = `'The message to present to the user.'`

###### properties.message.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.mode

> `readonly` **mode**: `object`

###### properties.mode.const

> `readonly` **const**: `"form"` = `'form'`

###### properties.mode.description

> `readonly` **description**: `"Indicates this is a form-based elicitation request."` = `'Indicates this is a form-based elicitation request.'`

###### properties.mode.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.requestedSchema

> `readonly` **requestedSchema**: `object`

###### properties.requestedSchema.description

> `readonly` **description**: "A restricted subset of JSON Schema.\\nOnly top-level properties are allowed, without nesting." = 'A restricted subset of JSON Schema.\\nOnly top-level properties are allowed, without nesting.'

###### properties.requestedSchema.properties

> `readonly` **properties**: `object`

###### properties.requestedSchema.properties.properties

> `readonly` **properties**: `object`

###### properties.requestedSchema.properties.properties.additionalProperties

> `readonly` **additionalProperties**: `object` = `primitiveSchemaDefinition`

###### properties.requestedSchema.properties.properties.additionalProperties.anyOf

> `readonly` **anyOf**: readonly \[\{ `properties`: \{ `default`: \{ `type`: `"string"`; \}; `description`: \{ `type`: `"string"`; \}; `format`: \{ `enum`: readonly \[..., ..., ..., ...\]; `type`: `"string"`; \}; `maxLength`: \{ `type`: `"integer"`; \}; `minLength`: \{ `type`: `"integer"`; \}; `pattern`: \{ `type`: `"string"`; \}; `title`: \{ `type`: `"string"`; \}; `type`: \{ `const`: `"string"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"type"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `default`: \{ `type`: `"number"`; \}; `description`: \{ `type`: `"string"`; \}; `maximum`: \{ `type`: `"number"`; \}; `minimum`: \{ `type`: `"number"`; \}; `title`: \{ `type`: `"string"`; \}; `type`: \{ `enum`: readonly \[..., ...\]; `type`: `"string"`; \}; \}; `required`: readonly \[`"type"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `default`: \{ `type`: `"boolean"`; \}; `description`: \{ `type`: `"string"`; \}; `title`: \{ `type`: `"string"`; \}; `type`: \{ `const`: `"boolean"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"type"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `default`: \{ `type`: `"string"`; \}; `description`: \{ `type`: `"string"`; \}; `enum`: \{ `items`: \{ `type`: ...; \}; `type`: `"array"`; \}; `enumNames`: \{ `items`: \{ `type`: ...; \}; `type`: `"array"`; \}; `oneOf`: \{ `items`: \{ `properties`: ...; `required`: ...; `type`: ...; \}; `type`: `"array"`; \}; `title`: \{ `type`: `"string"`; \}; `type`: \{ `const`: `"string"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"type"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `default`: \{ `items`: \{ `type`: ...; \}; `type`: `"array"`; \}; `description`: \{ `type`: `"string"`; \}; `items`: \{ `anyOf`: readonly \[..., ...\]; \}; `title`: \{ `type`: `"string"`; \}; `type`: \{ `const`: `"array"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"items"`, `"type"`\]; `type`: `"object"`; \}\]

###### properties.requestedSchema.properties.properties.additionalProperties.description

> `readonly` **description**: "Restricted schema definitions that only allow primitive types\\nwithout nested objects or arrays." = 'Restricted schema definitions that only allow primitive types\\nwithout nested objects or arrays.'

###### properties.requestedSchema.properties.properties.type

> `readonly` **type**: `"object"` = `'object'`

###### properties.requestedSchema.properties.required

> `readonly` **required**: `object`

###### properties.requestedSchema.properties.required.items

> `readonly` **items**: `object`

###### properties.requestedSchema.properties.required.items.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.requestedSchema.properties.required.type

> `readonly` **type**: `"array"` = `'array'`

###### properties.requestedSchema.properties.type

> `readonly` **type**: `object`

###### properties.requestedSchema.properties.type.const

> `readonly` **const**: `"object"` = `'object'`

###### properties.requestedSchema.properties.type.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.requestedSchema.required

> `readonly` **required**: readonly \[`"properties"`, `"type"`\]

###### properties.requestedSchema.type

> `readonly` **type**: `"object"` = `'object'`

##### required

> `readonly` **required**: readonly \[`"message"`, `"requestedSchema"`\]

##### type

> `readonly` **type**: `"object"` = `'object'`

***

### emptyResult

> `const` **emptyResult**: `object`

An otherwise-empty result -- `ping`, `logging/setLevel`, `resources/subscribe`.

Closed on purpose. result is the open *base* every concrete result builds on, so
using it as a member of a result union makes that union match any object at all and the
other members are never consulted.

#### Type Declaration

##### additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

##### properties

> `readonly` **properties**: `object`

###### properties.\_meta

> `readonly` **\_meta**: `object` = `metadata`

###### properties.\_meta.additionalProperties

> `readonly` **additionalProperties**: `object` = `{}`

###### properties.\_meta.description

> `readonly` **description**: `"See [specification/2025-11-25/basic/index#general-fields] for notes on _meta usage."` = `'See [specification/2025-11-25/basic/index#general-fields] for notes on _meta usage.'`

###### properties.\_meta.type

> `readonly` **type**: `"object"` = `'object'`

##### type

> `readonly` **type**: `"object"` = `'object'`

***

### ENVELOPE\_VIOLATION

> `const` **ENVELOPE\_VIOLATION**: `"envelopeViolation"` = `'envelopeViolation'`

Key an `INVALID_PARAMS` error's `data` carries, set to `true`, when the request failed
before reaching any handler because it violated the transport envelope itself -- missing a
required `_meta` key on `2026-07-28` -- as opposed to an ordinary application error that
happens to share the same JSON-RPC code (an unknown tool name, invalid arguments).
`INVALID_PARAMS` alone cannot tell the two apart, since application errors use it too.

Not an `io.modelcontextprotocol/…` `_meta` key: this is a mokei-internal signal between
`ContextServer`, which throws it, and the HTTP transport, which reads it to decide `400`
vs. `200` (`packages/http-server/src/stateless.ts`) -- never something a peer is expected to
interpret.

***

### HEADER\_MISMATCH

> `const` **HEADER\_MISMATCH**: `-32020` = `-32020`

***

### INPUT\_REQUEST\_CAPABILITIES

> `const` **INPUT\_REQUEST\_CAPABILITIES**: `object`

The client capability each input-request method requires, independent of revision.

Read by the client when deciding whether a handler is configurable, and by the server when
deciding whether an embedded request may be sent to this client (`-32021`). One table so the
two cannot disagree about what `sampling` means.

#### Type Declaration

##### elicitation/create

> `readonly` **elicitation/create**: `"elicitation"` = `'elicitation'`

##### roots/list

> `readonly` **roots/list**: `"roots"` = `'roots'`

##### sampling/createMessage

> `readonly` **sampling/createMessage**: `"sampling"` = `'sampling'`

***

### inputRequest

> `const` **inputRequest**: `object`

A single embedded input request inside an `input_required` result (SEP-2322): a sampling,
elicitation or roots request carried in-band as `{ method, params }`.

Deliberately not `createMessageRequest`/`elicitRequest`/`listRootsRequest`: those build on
`request`, which requires `jsonrpc` and `id`. An embedded request is de-JSON-RPC'd -- it never
travels as a JSON-RPC request in this revision, because this revision has no server-initiated
requests at all. `additionalProperties: false` so the envelope cannot be smuggled back in.

#### Type Declaration

##### anyOf

> `readonly` **anyOf**: readonly \[\{ `additionalProperties`: `false`; `properties`: \{ `method`: \{ `const`: `"sampling/createMessage"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `includeContext`: \{ `description`: `"A request to include context from one or more MCP servers (including the caller), to be attached to the prompt. The client MAY ignore this request."`; `enum`: readonly \[`"allServers"`, `"none"`, `"thisServer"`\]; `type`: `"string"`; \}; `maxTokens`: \{ `description`: `"The maximum number of tokens to sample, as requested by the server. The client MAY choose to sample fewer tokens than requested."`; `type`: `"integer"`; \}; `messages`: \{ `items`: \{ `description`: `"Describes a message issued to or received from an LLM API."`; `properties`: \{ `content`: \{ `anyOf`: readonly \[..., ...\]; \}; `role`: \{ `description`: `"The sender or recipient of messages and data in a conversation."`; `enum`: readonly \[..., ...\]; `type`: `"string"`; \}; \}; `required`: readonly \[`"content"`, `"role"`\]; `type`: `"object"`; \}; `type`: `"array"`; \}; `metadata`: \{ `additionalProperties`: `true`; `description`: `"Optional metadata to pass through to the LLM provider. The format of this metadata is provider-specific."`; `properties`: \{ \}; `type`: `"object"`; \}; `modelPreferences`: \{ `description`: "The server's preferences for model selection, requested of the client during sampling.\\n\\nBecause LLMs can vary along multiple dimensions, choosing the \\"best\\" model is rarely straightforward.  Different models excel in different areas—some are faster but less capable, others are more capable but more expensive, and so on. This interface allows servers to express their priorities across multiple dimensions to help clients make an appropriate selection for their use case.\\n\\nThese preferences are always advisory. The client MAY ignore them. It is also up to the client to decide how to interpret these preferences and how to balance them against other considerations."; `properties`: \{ `costPriority`: \{ `description`: `"How much to prioritize cost when selecting a model. A value of 0 means cost is not important, while a value of 1 means cost is the most important factor."`; `maximum`: `1`; `minimum`: `0`; `type`: `"number"`; \}; `hints`: \{ `description`: "Optional hints to use for model selection.\\n\\nIf multiple hints are specified, the client MUST evaluate them in order (such that the first match is taken).\\n\\nThe client SHOULD prioritize these hints over the numeric priorities, but MAY still use the priorities to select from ambiguous matches."; `items`: \{ `description`: "Hints to use for model selection.\\n\\nKeys not declared here are currently left unspecified by the spec and are up to the client to interpret."; `properties`: \{ `name`: ...; \}; `type`: `"object"`; \}; `type`: `"array"`; \}; `intelligencePriority`: \{ `description`: `"How much to prioritize intelligence and capabilities when selecting a model. A value of 0 means intelligence is not important, while a value of 1 means intelligence is the most important factor."`; `maximum`: `1`; `minimum`: `0`; `type`: `"number"`; \}; `speedPriority`: \{ `description`: `"How much to prioritize sampling speed (latency) when selecting a model. A value of 0 means speed is not important, while a value of 1 means speed is the most important factor."`; `maximum`: `1`; `minimum`: `0`; `type`: `"number"`; \}; \}; `type`: `"object"`; \}; `stopSequences`: \{ `items`: \{ `type`: `"string"`; \}; `type`: `"array"`; \}; `systemPrompt`: \{ `description`: `"An optional system prompt the server wants to use for sampling. The client MAY modify or omit this prompt."`; `type`: `"string"`; \}; `temperature`: \{ `type`: `"number"`; \}; `toolChoice`: \{ `description`: `"Controls how the model should use the provided tools. Only valid if the client declares the sampling.tools capability."`; `properties`: \{ `mode`: \{ `description`: `"How the model should use tools."`; `enum`: readonly \[`"auto"`, `"required"`, `"none"`\]; `type`: `"string"`; \}; \}; `required`: readonly \[`"mode"`\]; `type`: `"object"`; \}; `tools`: \{ `description`: `"An array of tools that the model can call during sampling. Only valid if the client declares the sampling.tools capability. The client MUST return an error if this field is provided but the capability is not declared."`; `items`: \{ `description`: `"Definition for a tool the client can call."`; `properties`: \{ `_meta`: \{ `additionalProperties`: \{ \}; `description`: `"See [specification/2025-11-25/basic/index#general-fields] for notes on _meta usage."`; `type`: `"object"`; \}; `annotations`: \{ `description`: "Additional properties describing a Tool to clients.\\n\\nNOTE: all properties in ToolAnnotations are \*\*hints\*\*.\\nThey are not guaranteed to provide a faithful description of\\ntool behavior (including descriptive properties like \`title\`).\\n\\nClients should never make tool use decisions based on ToolAnnotations\\nreceived from untrusted servers."; `properties`: \{ `destructiveHint`: ...; `idempotentHint`: ...; `openWorldHint`: ...; `readOnlyHint`: ...; `title`: ...; \}; `type`: `"object"`; \}; `description`: \{ `description`: "A human-readable description of the tool.\\n\\nThis can be used by clients to improve the LLM's understanding of available tools. It can be thought of like a \\"hint\\" to the model."; `type`: `"string"`; \}; `icons`: \{ `description`: `"Optional icons representing the tool."`; `items`: \{ `description`: ...; `properties`: ...; `required`: ...; `type`: ...; \}; `type`: `"array"`; \}; `inputSchema`: \{ `description`: `"A JSON Schema object defining the expected parameters for the tool."`; `properties`: \{ `properties`: ...; `type`: ...; \}; `required`: readonly \[...\]; `type`: `"object"`; \}; `name`: \{ `description`: `"The name of the tool."`; `type`: `"string"`; \}; `outputSchema`: \{ `description`: "An optional JSON Schema object defining the structure of the tool's output returned in\\nthe structuredContent field of a CallToolResult."; `properties`: \{ `properties`: ...; `required`: ...; `type`: ...; \}; `required`: readonly \[...\]; `type`: `"object"`; \}; `title`: \{ `description`: "Intended for UI and end-user contexts — optimized to be human-readable and easily understood,\\neven by those unfamiliar with domain-specific terminology.\\n\\nIf not provided, the name should be used for display (except for Tool,\\nwhere \`annotations.title\` should be given precedence over using \`name\`,\\nif present)."; `type`: `"string"`; \}; \}; `required`: readonly \[`"inputSchema"`, `"name"`\]; `type`: `"object"`; \}; `type`: `"array"`; \}; \}; `required`: readonly \[`"maxTokens"`, `"messages"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `method`: \{ `const`: `"elicitation/create"`; `type`: `"string"`; \}; `params`: \{ `anyOf`: readonly \[\{ `properties`: \{ `message`: \{ `description`: `"The message to present to the user."`; `type`: `"string"`; \}; `mode`: \{ `const`: `"form"`; `description`: `"Indicates this is a form-based elicitation request."`; `type`: `"string"`; \}; `requestedSchema`: \{ `description`: "A restricted subset of JSON Schema.\\nOnly top-level properties are allowed, without nesting."; `properties`: \{ `properties`: \{ `additionalProperties`: ...; `type`: ...; \}; `required`: \{ `items`: ...; `type`: ...; \}; `type`: \{ `const`: ...; `type`: ...; \}; \}; `required`: readonly \[`"properties"`, `"type"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"message"`, `"requestedSchema"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `elicitationId`: \{ `description`: `"A unique identifier for this elicitation request, scoped to the server. This is opaque to the client."`; `type`: `"string"`; \}; `message`: \{ `description`: `"The message explaining why the user should navigate to the URL and what they should do there."`; `type`: `"string"`; \}; `mode`: \{ `const`: `"url"`; `description`: `"Indicates this is a URL-based elicitation request."`; `type`: `"string"`; \}; `url`: \{ `description`: `"The URL the user should navigate to for out-of-band elicitation."`; `format`: `"uri"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"elicitationId"`, `"message"`, `"mode"`, `"url"`\]; `type`: `"object"`; \}\]; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `method`: \{ `const`: `"roots/list"`; `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`\]; `type`: `"object"`; \}\]

***

### inputRequests

> `const` **inputRequests**: `object`

A map of embedded input requests, keyed by server-assigned identifiers unique to one request.

`minProperties: 1` rejects an empty map on the wire. The `inputRequiredResult` `anyOf` only
asserts key *presence*, so `{ inputRequests: {} }` would otherwise validate and drive the client
into a `requestState`-less retry loop that repeats byte-identically until the round cap trips.

#### Type Declaration

##### additionalProperties

> `readonly` **additionalProperties**: `object` = `inputRequest`

###### additionalProperties.anyOf

> `readonly` **anyOf**: readonly \[\{ `additionalProperties`: `false`; `properties`: \{ `method`: \{ `const`: `"sampling/createMessage"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `includeContext`: \{ `description`: `"A request to include context from one or more MCP servers (including the caller), to be attached to the prompt. The client MAY ignore this request."`; `enum`: readonly \[`"allServers"`, `"none"`, `"thisServer"`\]; `type`: `"string"`; \}; `maxTokens`: \{ `description`: `"The maximum number of tokens to sample, as requested by the server. The client MAY choose to sample fewer tokens than requested."`; `type`: `"integer"`; \}; `messages`: \{ `items`: \{ `description`: `"Describes a message issued to or received from an LLM API."`; `properties`: \{ `content`: \{ `anyOf`: ...; \}; `role`: \{ `description`: ...; `enum`: ...; `type`: ...; \}; \}; `required`: readonly \[`"content"`, `"role"`\]; `type`: `"object"`; \}; `type`: `"array"`; \}; `metadata`: \{ `additionalProperties`: `true`; `description`: `"Optional metadata to pass through to the LLM provider. The format of this metadata is provider-specific."`; `properties`: \{ \}; `type`: `"object"`; \}; `modelPreferences`: \{ `description`: "The server's preferences for model selection, requested of the client during sampling.\\n\\nBecause LLMs can vary along multiple dimensions, choosing the \\"best\\" model is rarely straightforward.  Different models excel in different areas—some are faster but less capable, others are more capable but more expensive, and so on. This interface allows servers to express their priorities across multiple dimensions to help clients make an appropriate selection for their use case.\\n\\nThese preferences are always advisory. The client MAY ignore them. It is also up to the client to decide how to interpret these preferences and how to balance them against other considerations."; `properties`: \{ `costPriority`: \{ `description`: `"How much to prioritize cost when selecting a model. A value of 0 means cost is not important, while a value of 1 means cost is the most important factor."`; `maximum`: `1`; `minimum`: `0`; `type`: `"number"`; \}; `hints`: \{ `description`: "Optional hints to use for model selection.\\n\\nIf multiple hints are specified, the client MUST evaluate them in order (such that the first match is taken).\\n\\nThe client SHOULD prioritize these hints over the numeric priorities, but MAY still use the priorities to select from ambiguous matches."; `items`: \{ `description`: ...; `properties`: ...; `type`: ...; \}; `type`: `"array"`; \}; `intelligencePriority`: \{ `description`: `"How much to prioritize intelligence and capabilities when selecting a model. A value of 0 means intelligence is not important, while a value of 1 means intelligence is the most important factor."`; `maximum`: `1`; `minimum`: `0`; `type`: `"number"`; \}; `speedPriority`: \{ `description`: `"How much to prioritize sampling speed (latency) when selecting a model. A value of 0 means speed is not important, while a value of 1 means speed is the most important factor."`; `maximum`: `1`; `minimum`: `0`; `type`: `"number"`; \}; \}; `type`: `"object"`; \}; `stopSequences`: \{ `items`: \{ `type`: `"string"`; \}; `type`: `"array"`; \}; `systemPrompt`: \{ `description`: `"An optional system prompt the server wants to use for sampling. The client MAY modify or omit this prompt."`; `type`: `"string"`; \}; `temperature`: \{ `type`: `"number"`; \}; `toolChoice`: \{ `description`: `"Controls how the model should use the provided tools. Only valid if the client declares the sampling.tools capability."`; `properties`: \{ `mode`: \{ `description`: `"How the model should use tools."`; `enum`: readonly \[..., ..., ...\]; `type`: `"string"`; \}; \}; `required`: readonly \[`"mode"`\]; `type`: `"object"`; \}; `tools`: \{ `description`: `"An array of tools that the model can call during sampling. Only valid if the client declares the sampling.tools capability. The client MUST return an error if this field is provided but the capability is not declared."`; `items`: \{ `description`: `"Definition for a tool the client can call."`; `properties`: \{ `_meta`: \{ `additionalProperties`: ...; `description`: ...; `type`: ...; \}; `annotations`: \{ `description`: ...; `properties`: ...; `type`: ...; \}; `description`: \{ `description`: ...; `type`: ...; \}; `icons`: \{ `description`: ...; `items`: ...; `type`: ...; \}; `inputSchema`: \{ `description`: ...; `properties`: ...; `required`: ...; `type`: ...; \}; `name`: \{ `description`: ...; `type`: ...; \}; `outputSchema`: \{ `description`: ...; `properties`: ...; `required`: ...; `type`: ...; \}; `title`: \{ `description`: ...; `type`: ...; \}; \}; `required`: readonly \[`"inputSchema"`, `"name"`\]; `type`: `"object"`; \}; `type`: `"array"`; \}; \}; `required`: readonly \[`"maxTokens"`, `"messages"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `method`: \{ `const`: `"elicitation/create"`; `type`: `"string"`; \}; `params`: \{ `anyOf`: readonly \[\{ `properties`: \{ `message`: \{ `description`: `"The message to present to the user."`; `type`: `"string"`; \}; `mode`: \{ `const`: `"form"`; `description`: `"Indicates this is a form-based elicitation request."`; `type`: `"string"`; \}; `requestedSchema`: \{ `description`: "A restricted subset of JSON Schema.\\nOnly top-level properties are allowed, without nesting."; `properties`: \{ `properties`: ...; `required`: ...; `type`: ...; \}; `required`: readonly \[..., ...\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"message"`, `"requestedSchema"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `elicitationId`: \{ `description`: `"A unique identifier for this elicitation request, scoped to the server. This is opaque to the client."`; `type`: `"string"`; \}; `message`: \{ `description`: `"The message explaining why the user should navigate to the URL and what they should do there."`; `type`: `"string"`; \}; `mode`: \{ `const`: `"url"`; `description`: `"Indicates this is a URL-based elicitation request."`; `type`: `"string"`; \}; `url`: \{ `description`: `"The URL the user should navigate to for out-of-band elicitation."`; `format`: `"uri"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"elicitationId"`, `"message"`, `"mode"`, `"url"`\]; `type`: `"object"`; \}\]; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}, \{ `additionalProperties`: `false`; `properties`: \{ `method`: \{ `const`: `"roots/list"`; `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`\]; `type`: `"object"`; \}\]

##### minProperties

> `readonly` **minProperties**: `1` = `1`

##### type

> `readonly` **type**: `"object"` = `'object'`

***

### inputResponse

> `const` **inputResponse**: `object`

A single embedded input response: the *bare* result for its request, never wrapped in a
`{ method, result }` envelope and never carrying this revision's `resultType` -- a suspended
exchange's sub-answers are not themselves protocol results.

#### Type Declaration

##### anyOf

> `readonly` **anyOf**: readonly \[\{ `allOf`: readonly \[\{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `additionalProperties`: \{ \}; `description`: `"See [specification/2025-11-25/basic/index#general-fields] for notes on _meta usage."`; `type`: `"object"`; \}; \}; `type`: `"object"`; \}, \{ `properties`: \{ `content`: \{ `anyOf`: readonly \[\{ `description`: `"Text provided to or from an LLM."`; `properties`: \{ `_meta`: \{ `additionalProperties`: ...; `description`: ...; `type`: ...; \}; `annotations`: \{ `properties`: ...; `type`: ...; \}; `text`: \{ `description`: ...; `type`: ...; \}; `type`: \{ `const`: ...; `type`: ...; \}; \}; `required`: readonly \[`"text"`, `"type"`\]; `type`: `"object"`; \}, \{ `description`: `"An image provided to or from an LLM."`; `properties`: \{ `_meta`: \{ `additionalProperties`: ...; `description`: ...; `type`: ...; \}; `annotations`: \{ `properties`: ...; `type`: ...; \}; `data`: \{ `description`: ...; `format`: ...; `type`: ...; \}; `mimeType`: \{ `description`: ...; `type`: ...; \}; `type`: \{ `const`: ...; `type`: ...; \}; \}; `required`: readonly \[`"data"`, `"mimeType"`, `"type"`\]; `type`: `"object"`; \}, \{ `description`: `"Audio provided to or from an LLM."`; `properties`: \{ `_meta`: \{ `additionalProperties`: ...; `description`: ...; `type`: ...; \}; `annotations`: \{ `properties`: ...; `type`: ...; \}; `data`: \{ `description`: ...; `format`: ...; `type`: ...; \}; `mimeType`: \{ `description`: ...; `type`: ...; \}; `type`: \{ `const`: ...; `type`: ...; \}; \}; `required`: readonly \[`"data"`, `"mimeType"`, `"type"`\]; `type`: `"object"`; \}\]; \}; `model`: \{ `description`: `"The name of the model that generated the message."`; `type`: `"string"`; \}; `role`: \{ `description`: `"The sender or recipient of messages and data in a conversation."`; `enum`: readonly \[`"assistant"`, `"user"`\]; `type`: `"string"`; \}; `stopReason`: \{ `description`: `"The reason why sampling stopped, if known."`; `type`: `"string"`; \}; \}; `required`: readonly \[`"content"`, `"model"`, `"role"`\]; `type`: `"object"`; \}\]; `description`: `"The client's response to a sampling/create_message request from the server. The client should inform the user before returning the sampled message, to allow them to inspect the response (human in the loop) and decide whether to allow the server to see it."`; \}, \{ `allOf`: readonly \[\{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `additionalProperties`: \{ \}; `description`: `"See [specification/2025-11-25/basic/index#general-fields] for notes on _meta usage."`; `type`: `"object"`; \}; \}; `type`: `"object"`; \}, \{ `properties`: \{ `action`: \{ `description`: "The user action in response to the elicitation.\\n- \\"accept\\": User submitted the form/confirmed the action\\n- \\"decline\\": User explicitly declined the action\\n- \\"cancel\\": User dismissed without making an explicit choice"; `enum`: readonly \[`"accept"`, `"cancel"`, `"decline"`\]; `type`: `"string"`; \}; `content`: \{ `additionalProperties`: \{ `anyOf`: readonly \[\{ `type`: `"string"`; \}, \{ `type`: `"number"`; \}, \{ `type`: `"boolean"`; \}, \{ `items`: \{ `type`: ...; \}; `type`: `"array"`; \}\]; \}; `description`: "The submitted form data, only present when action is \\"accept\\".\\nContains values matching the requested schema."; `type`: `"object"`; \}; \}; `required`: readonly \[`"action"`\]; `type`: `"object"`; \}\]; `description`: `"The client's response to an elicitation request."`; \}, \{ `allOf`: readonly \[\{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `additionalProperties`: \{ \}; `description`: `"See [specification/2025-11-25/basic/index#general-fields] for notes on _meta usage."`; `type`: `"object"`; \}; \}; `type`: `"object"`; \}, \{ `properties`: \{ `roots`: \{ `items`: \{ `description`: `"Represents a root directory or file that the server can operate on."`; `properties`: \{ `name`: \{ `description`: "An optional name for the root. This can be used to provide a human-readable identifier for the root, which may be useful for display purposes or for referencing the root in other parts of the application.',\\n      type: 'string"; \}; `uri`: \{ `description`: `"The URI identifying the root. This *must* start with file:// for now. This restriction may be relaxed in future versions of the protocol to allow other URI schemes."`; `format`: `"uri"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"uri"`\]; `type`: `"object"`; \}; `type`: `"array"`; \}; \}; `required`: readonly \[`"roots"`\]; `type`: `"object"`; \}\]; `description`: "The client's response to a roots/list request from the server.\\n    This result contains an array of Root objects, each representing a root directory or file that the server can operate on."; \}\]

***

### inputResponses

> `const` **inputResponses**: `object`

A map of embedded input responses, keyed as the server keyed its `inputRequests`.

#### Type Declaration

##### additionalProperties

> `readonly` **additionalProperties**: `object` = `inputResponse`

###### additionalProperties.anyOf

> `readonly` **anyOf**: readonly \[\{ `allOf`: readonly \[\{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `additionalProperties`: \{ \}; `description`: `"See [specification/2025-11-25/basic/index#general-fields] for notes on _meta usage."`; `type`: `"object"`; \}; \}; `type`: `"object"`; \}, \{ `properties`: \{ `content`: \{ `anyOf`: readonly \[\{ `description`: `"Text provided to or from an LLM."`; `properties`: \{ `_meta`: ...; `annotations`: ...; `text`: ...; `type`: ...; \}; `required`: readonly \[..., ...\]; `type`: `"object"`; \}, \{ `description`: `"An image provided to or from an LLM."`; `properties`: \{ `_meta`: ...; `annotations`: ...; `data`: ...; `mimeType`: ...; `type`: ...; \}; `required`: readonly \[..., ..., ...\]; `type`: `"object"`; \}, \{ `description`: `"Audio provided to or from an LLM."`; `properties`: \{ `_meta`: ...; `annotations`: ...; `data`: ...; `mimeType`: ...; `type`: ...; \}; `required`: readonly \[..., ..., ...\]; `type`: `"object"`; \}\]; \}; `model`: \{ `description`: `"The name of the model that generated the message."`; `type`: `"string"`; \}; `role`: \{ `description`: `"The sender or recipient of messages and data in a conversation."`; `enum`: readonly \[`"assistant"`, `"user"`\]; `type`: `"string"`; \}; `stopReason`: \{ `description`: `"The reason why sampling stopped, if known."`; `type`: `"string"`; \}; \}; `required`: readonly \[`"content"`, `"model"`, `"role"`\]; `type`: `"object"`; \}\]; `description`: `"The client's response to a sampling/create_message request from the server. The client should inform the user before returning the sampled message, to allow them to inspect the response (human in the loop) and decide whether to allow the server to see it."`; \}, \{ `allOf`: readonly \[\{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `additionalProperties`: \{ \}; `description`: `"See [specification/2025-11-25/basic/index#general-fields] for notes on _meta usage."`; `type`: `"object"`; \}; \}; `type`: `"object"`; \}, \{ `properties`: \{ `action`: \{ `description`: "The user action in response to the elicitation.\\n- \\"accept\\": User submitted the form/confirmed the action\\n- \\"decline\\": User explicitly declined the action\\n- \\"cancel\\": User dismissed without making an explicit choice"; `enum`: readonly \[`"accept"`, `"cancel"`, `"decline"`\]; `type`: `"string"`; \}; `content`: \{ `additionalProperties`: \{ `anyOf`: readonly \[\{ `type`: ...; \}, \{ `type`: ...; \}, \{ `type`: ...; \}, \{ `items`: ...; `type`: ...; \}\]; \}; `description`: "The submitted form data, only present when action is \\"accept\\".\\nContains values matching the requested schema."; `type`: `"object"`; \}; \}; `required`: readonly \[`"action"`\]; `type`: `"object"`; \}\]; `description`: `"The client's response to an elicitation request."`; \}, \{ `allOf`: readonly \[\{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `additionalProperties`: \{ \}; `description`: `"See [specification/2025-11-25/basic/index#general-fields] for notes on _meta usage."`; `type`: `"object"`; \}; \}; `type`: `"object"`; \}, \{ `properties`: \{ `roots`: \{ `items`: \{ `description`: `"Represents a root directory or file that the server can operate on."`; `properties`: \{ `name`: \{ `description`: ...; \}; `uri`: \{ `description`: ...; `format`: ...; `type`: ...; \}; \}; `required`: readonly \[`"uri"`\]; `type`: `"object"`; \}; `type`: `"array"`; \}; \}; `required`: readonly \[`"roots"`\]; `type`: `"object"`; \}\]; `description`: "The client's response to a roots/list request from the server.\\n    This result contains an array of Root objects, each representing a root directory or file that the server can operate on."; \}\]

##### type

> `readonly` **type**: `"object"` = `'object'`

***

### inputSchema

> `const` **inputSchema**: `object`

#### Type Declaration

##### description

> `readonly` **description**: `"A JSON Schema object defining the expected parameters for the tool."` = `'A JSON Schema object defining the expected parameters for the tool.'`

##### properties

> `readonly` **properties**: `object`

###### properties.properties

> `readonly` **properties**: `object`

###### properties.properties.additionalProperties

> `readonly` **additionalProperties**: `object`

###### properties.properties.additionalProperties.additionalProperties

> `readonly` **additionalProperties**: `true` = `true`

###### properties.properties.additionalProperties.properties

> `readonly` **properties**: `object` = `{}`

###### properties.properties.additionalProperties.type

> `readonly` **type**: `"object"` = `'object'`

###### properties.properties.type

> `readonly` **type**: `"object"` = `'object'`

###### properties.type

> `readonly` **type**: `object`

###### properties.type.const

> `readonly` **const**: `"object"` = `'object'`

###### properties.type.type

> `readonly` **type**: `"string"` = `'string'`

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

> `const` **LATEST\_PROTOCOL\_VERSION**: `"2026-07-28"` = `'2026-07-28'`

***

### META\_CLIENT\_CAPABILITIES

> `const` **META\_CLIENT\_CAPABILITIES**: `"io.modelcontextprotocol/clientCapabilities"` = `'io.modelcontextprotocol/clientCapabilities'`

***

### META\_PROTOCOL\_VERSION

> `const` **META\_PROTOCOL\_VERSION**: `"io.modelcontextprotocol/protocolVersion"` = `'io.modelcontextprotocol/protocolVersion'`

***

### META\_SUBSCRIPTION\_ID

> `const` **META\_SUBSCRIPTION\_ID**: `"io.modelcontextprotocol/subscriptionId"` = `'io.modelcontextprotocol/subscriptionId'`

***

### METHOD\_NOT\_FOUND

> `const` **METHOD\_NOT\_FOUND**: `-32601` = `-32601`

***

### MISSING\_REQUIRED\_CLIENT\_CAPABILITY

> `const` **MISSING\_REQUIRED\_CLIENT\_CAPABILITY**: `-32021` = `-32021`

***

### MOKEI\_VERSION

> `const` **MOKEI\_VERSION**: `"0.15.0"` = `'0.15.0'`

Version of the mokei packages, which release in lockstep. Reported as MCP client and server
implementation versions and as instrumentation scope versions. `test/version.test.ts` fails
when it drifts from `package.json`: update it after `pnpm version -r`.

***

### outputSchema

> `const` **outputSchema**: `object`

#### Type Declaration

##### description

> `readonly` **description**: "An optional JSON Schema object defining the structure of the tool's output returned in\\nthe structuredContent field of a CallToolResult." = "An optional JSON Schema object defining the structure of the tool's output returned in\\nthe structuredContent field of a CallToolResult."

##### properties

> `readonly` **properties**: `object`

###### properties.properties

> `readonly` **properties**: `object`

###### properties.properties.additionalProperties

> `readonly` **additionalProperties**: `object`

###### properties.properties.additionalProperties.additionalProperties

> `readonly` **additionalProperties**: `true` = `true`

###### properties.properties.additionalProperties.properties

> `readonly` **properties**: `object` = `{}`

###### properties.properties.additionalProperties.type

> `readonly` **type**: `"object"` = `'object'`

###### properties.properties.type

> `readonly` **type**: `"object"` = `'object'`

###### properties.required

> `readonly` **required**: `object`

###### properties.required.items

> `readonly` **items**: `object`

###### properties.required.items.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.required.type

> `readonly` **type**: `"array"` = `'array'`

###### properties.type

> `readonly` **type**: `object`

###### properties.type.const

> `readonly` **const**: `"object"` = `'object'`

###### properties.type.type

> `readonly` **type**: `"string"` = `'string'`

##### required

> `readonly` **required**: readonly \[`"type"`\]

##### type

> `readonly` **type**: `"object"` = `'object'`

***

### PARSE\_ERROR

> `const` **PARSE\_ERROR**: `-32700` = `-32700`

***

### PROTOCOL\_VERSIONS

> `const` **PROTOCOL\_VERSIONS**: readonly \[`"2026-07-28"`, `"2025-11-25"`\]

Supported revisions, newest first.

***

### PROTOCOLS

> `const` **PROTOCOLS**: `Record`\<[`ProtocolVersion`](#protocolversion), [`ProtocolDefinition`](#protocoldefinition)\>

***

### RESOURCE\_NOT\_FOUND

> `const` **RESOURCE\_NOT\_FOUND**: `-32002` = `-32002`

***

### samplingMessage

> `const` **samplingMessage**: `object`

#### Type Declaration

##### description

> `readonly` **description**: `"Describes a message issued to or received from an LLM API."` = `'Describes a message issued to or received from an LLM API.'`

##### properties

> `readonly` **properties**: `object`

###### properties.content

> `readonly` **content**: `object`

###### properties.content.anyOf

> `readonly` **anyOf**: readonly \[\{ `anyOf`: readonly \[\{ `description`: `"Text provided to or from an LLM."`; `properties`: \{ `_meta`: \{ `additionalProperties`: \{ \}; `description`: `"See [specification/2025-11-25/basic/index#general-fields] for notes on _meta usage."`; `type`: `"object"`; \}; `annotations`: \{ `properties`: \{ `audience`: \{ `description`: ...; `items`: ...; `type`: ...; \}; `lastModified`: \{ `description`: ...; `format`: ...; `type`: ...; \}; `priority`: \{ `description`: ...; `maximum`: ...; `minimum`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; `text`: \{ `description`: `"The text content of the message."`; `type`: `"string"`; \}; `type`: \{ `const`: `"text"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"text"`, `"type"`\]; `type`: `"object"`; \}, \{ `description`: `"An image provided to or from an LLM."`; `properties`: \{ `_meta`: \{ `additionalProperties`: \{ \}; `description`: `"See [specification/2025-11-25/basic/index#general-fields] for notes on _meta usage."`; `type`: `"object"`; \}; `annotations`: \{ `properties`: \{ `audience`: \{ `description`: ...; `items`: ...; `type`: ...; \}; `lastModified`: \{ `description`: ...; `format`: ...; `type`: ...; \}; `priority`: \{ `description`: ...; `maximum`: ...; `minimum`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; `data`: \{ `description`: `"The base64-encoded image data."`; `format`: `"byte"`; `type`: `"string"`; \}; `mimeType`: \{ `description`: `"The MIME type of the image. Different providers may support different image types."`; `type`: `"string"`; \}; `type`: \{ `const`: `"image"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"data"`, `"mimeType"`, `"type"`\]; `type`: `"object"`; \}, \{ `description`: `"Audio provided to or from an LLM."`; `properties`: \{ `_meta`: \{ `additionalProperties`: \{ \}; `description`: `"See [specification/2025-11-25/basic/index#general-fields] for notes on _meta usage."`; `type`: `"object"`; \}; `annotations`: \{ `properties`: \{ `audience`: \{ `description`: ...; `items`: ...; `type`: ...; \}; `lastModified`: \{ `description`: ...; `format`: ...; `type`: ...; \}; `priority`: \{ `description`: ...; `maximum`: ...; `minimum`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; `data`: \{ `description`: `"The base64-encoded audio data."`; `format`: `"byte"`; `type`: `"string"`; \}; `mimeType`: \{ `description`: `"The MIME type of the audio. Different providers may support different audio types."`; `type`: `"string"`; \}; `type`: \{ `const`: `"audio"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"data"`, `"mimeType"`, `"type"`\]; `type`: `"object"`; \}, \{ `description`: `"A request from the assistant to call a tool."`; `properties`: \{ `id`: \{ `type`: `"string"`; \}; `input`: \{ `additionalProperties`: \{ \}; `type`: `"object"`; \}; `name`: \{ `type`: `"string"`; \}; `type`: \{ `const`: `"tool_use"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"id"`, `"input"`, `"name"`, `"type"`\]; `type`: `"object"`; \}, \{ `description`: `"The result of a tool use, provided by the user back to the assistant."`; `properties`: \{ `content`: \{ `items`: \{ `anyOf`: readonly \[..., ..., ..., ..., ...\]; \}; `type`: `"array"`; \}; `isError`: \{ `type`: `"boolean"`; \}; `structuredContent`: \{ `additionalProperties`: \{ \}; `type`: `"object"`; \}; `toolUseId`: \{ `type`: `"string"`; \}; `type`: \{ `const`: `"tool_result"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"content"`, `"toolUseId"`, `"type"`\]; `type`: `"object"`; \}\]; \}, \{ `items`: \{ `anyOf`: readonly \[\{ `description`: `"Text provided to or from an LLM."`; `properties`: \{ `_meta`: \{ `additionalProperties`: \{ \}; `description`: `"See [specification/2025-11-25/basic/index#general-fields] for notes on _meta usage."`; `type`: `"object"`; \}; `annotations`: \{ `properties`: \{ `audience`: ...; `lastModified`: ...; `priority`: ...; \}; `type`: `"object"`; \}; `text`: \{ `description`: `"The text content of the message."`; `type`: `"string"`; \}; `type`: \{ `const`: `"text"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"text"`, `"type"`\]; `type`: `"object"`; \}, \{ `description`: `"An image provided to or from an LLM."`; `properties`: \{ `_meta`: \{ `additionalProperties`: \{ \}; `description`: `"See [specification/2025-11-25/basic/index#general-fields] for notes on _meta usage."`; `type`: `"object"`; \}; `annotations`: \{ `properties`: \{ `audience`: ...; `lastModified`: ...; `priority`: ...; \}; `type`: `"object"`; \}; `data`: \{ `description`: `"The base64-encoded image data."`; `format`: `"byte"`; `type`: `"string"`; \}; `mimeType`: \{ `description`: `"The MIME type of the image. Different providers may support different image types."`; `type`: `"string"`; \}; `type`: \{ `const`: `"image"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"data"`, `"mimeType"`, `"type"`\]; `type`: `"object"`; \}, \{ `description`: `"Audio provided to or from an LLM."`; `properties`: \{ `_meta`: \{ `additionalProperties`: \{ \}; `description`: `"See [specification/2025-11-25/basic/index#general-fields] for notes on _meta usage."`; `type`: `"object"`; \}; `annotations`: \{ `properties`: \{ `audience`: ...; `lastModified`: ...; `priority`: ...; \}; `type`: `"object"`; \}; `data`: \{ `description`: `"The base64-encoded audio data."`; `format`: `"byte"`; `type`: `"string"`; \}; `mimeType`: \{ `description`: `"The MIME type of the audio. Different providers may support different audio types."`; `type`: `"string"`; \}; `type`: \{ `const`: `"audio"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"data"`, `"mimeType"`, `"type"`\]; `type`: `"object"`; \}, \{ `description`: `"A request from the assistant to call a tool."`; `properties`: \{ `id`: \{ `type`: `"string"`; \}; `input`: \{ `additionalProperties`: \{ \}; `type`: `"object"`; \}; `name`: \{ `type`: `"string"`; \}; `type`: \{ `const`: `"tool_use"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"id"`, `"input"`, `"name"`, `"type"`\]; `type`: `"object"`; \}, \{ `description`: `"The result of a tool use, provided by the user back to the assistant."`; `properties`: \{ `content`: \{ `items`: \{ `anyOf`: ...; \}; `type`: `"array"`; \}; `isError`: \{ `type`: `"boolean"`; \}; `structuredContent`: \{ `additionalProperties`: \{ \}; `type`: `"object"`; \}; `toolUseId`: \{ `type`: `"string"`; \}; `type`: \{ `const`: `"tool_result"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"content"`, `"toolUseId"`, `"type"`\]; `type`: `"object"`; \}\]; \}; `type`: `"array"`; \}\]

###### properties.role

> **role**: `object`

###### properties.role.description

> `readonly` **description**: `"The sender or recipient of messages and data in a conversation."` = `'The sender or recipient of messages and data in a conversation.'`

###### properties.role.enum

> `readonly` **enum**: readonly \[`"assistant"`, `"user"`\]

###### properties.role.type

> `readonly` **type**: `"string"` = `'string'`

##### required

> `readonly` **required**: readonly \[`"content"`, `"role"`\]

##### type

> `readonly` **type**: `"object"` = `'object'`

***

### SERVER\_SHUTTING\_DOWN

> `const` **SERVER\_SHUTTING\_DOWN**: `-32000` = `-32000`

***

### serverMessage

> `const` **serverMessage**: `object`

Any MCP server message.

#### Type Declaration

##### anyOf

> `readonly` **anyOf**: readonly \[\{ `anyOf`: readonly \[\{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: ...; \}, \{ `type`: ...; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `properties`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `description`: `"A ping, issued by either the server or the client, to check that the other party is still alive. The receiver must promptly respond, or else may be disconnected."`; `properties`: \{ `method`: \{ `const`: `"ping"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"method"`\]; `type`: `"object"`; \}\]; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: ...; \}, \{ `type`: ...; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `properties`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"sampling/createMessage"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `includeContext`: \{ `description`: ...; `enum`: ...; `type`: ...; \}; `maxTokens`: \{ `description`: ...; `type`: ...; \}; `messages`: \{ `items`: ...; `type`: ...; \}; `metadata`: \{ `additionalProperties`: ...; `description`: ...; `properties`: ...; `type`: ...; \}; `modelPreferences`: \{ `description`: ...; `properties`: ...; `type`: ...; \}; `stopSequences`: \{ `items`: ...; `type`: ...; \}; `systemPrompt`: \{ `description`: ...; `type`: ...; \}; `temperature`: \{ `type`: ...; \}; `toolChoice`: \{ `description`: ...; `properties`: ...; `required`: ...; `type`: ...; \}; `tools`: \{ `description`: ...; `items`: ...; `type`: ...; \}; \}; `required`: readonly \[`"maxTokens"`, `"messages"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]; `description`: `"A request from the server to sample an LLM via the client. The client has full discretion over which model to select. The client should also inform the user before beginning sampling, to allow them to inspect the request (human in the loop) and decide whether to approve it."`; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: ...; \}, \{ `type`: ...; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `properties`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"roots/list"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"method"`\]; `type`: `"object"`; \}\]; `description`: "Sent from the server to request a list of root URIs from the client. Roots allow servers to ask for specific directories or files to operate on. A common example for roots is providing a set of repositories or directories a server should operate on.\\n    \\n  This request is typically used when the server needs to understand the file system structure or access specific locations that the client has permission to read from."; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: ...; \}, \{ `type`: ...; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `properties`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"elicitation/create"`; `type`: `"string"`; \}; `params`: \{ `anyOf`: readonly \[\{ `properties`: ...; `required`: ...; `type`: ...; \}, \{ `properties`: ...; `required`: ...; `type`: ...; \}\]; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]; `description`: `"A request from the server to elicit additional information from the user via the client."`; \}\]; \}, \{ `anyOf`: readonly \[\{ `allOf`: readonly \[\{ `properties`: \{ `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `additionalProperties`: ...; `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"notifications/cancelled"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `reason`: \{ `type`: ...; \}; `requestId`: \{ `anyOf`: ...; `description`: ...; \}; \}; `required`: readonly \[`"requestId"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `additionalProperties`: ...; `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"notifications/elicitation/complete"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `elicitationId`: \{ `description`: ...; `type`: ...; \}; \}; `required`: readonly \[`"elicitationId"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]; `description`: `"Sent by the server to indicate a URL-based elicitation is complete and the client may stop showing the prompt."`; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `additionalProperties`: ...; `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"notifications/message"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `data`: \{ `description`: ...; \}; `level`: \{ `description`: ...; `enum`: ...; `type`: ...; \}; `logger`: \{ `description`: ...; `type`: ...; \}; \}; `required`: readonly \[`"data"`, `"level"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]; `description`: `"Notification of a log message passed from server to client. If no logging/setLevel request has been sent from the client, the server MAY decide which messages to send automatically."`; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `additionalProperties`: ...; `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `description`: `"An out-of-band notification used to inform the receiver of a progress update for a long-running request."`; `properties`: \{ `method`: \{ `const`: `"notifications/progress"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `message`: \{ `description`: ...; `type`: ...; \}; `progress`: \{ `description`: ...; `type`: ...; \}; `progressToken`: \{ `anyOf`: ...; `description`: ...; \}; `total`: \{ `description`: ...; `type`: ...; \}; \}; `required`: readonly \[`"progress"`, `"progressToken"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `additionalProperties`: ...; `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"notifications/resources/updated"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `uri`: \{ `description`: ...; `format`: ...; `type`: ...; \}; \}; `required`: readonly \[`"uri"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]; `description`: `"A notification from the server to the client, informing it that a resource has changed and may need to be read again. This should only be sent if the client previously sent a resources/subscribe request."`; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `additionalProperties`: ...; `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"notifications/resources/list_changed"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"method"`\]; `type`: `"object"`; \}\]; `description`: `"An optional notification from the server to the client, informing it that the list of resources it can read from has changed. This may be issued by servers without any previous subscription from the client."`; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `additionalProperties`: ...; `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"notifications/tools/list_changed"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"method"`\]; `type`: `"object"`; \}\]; `description`: `"An optional notification from the server to the client, informing it that the list of tools it offers has changed. This may be issued by servers without any previous subscription from the client."`; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `additionalProperties`: ...; `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"notifications/prompts/list_changed"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"method"`\]; `type`: `"object"`; \}\]; `description`: `"An optional notification from the server to the client, informing it that the list of prompts it offers has changed. This may be issued by servers without any previous subscription from the client."`; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `additionalProperties`: ...; `description`: ...; `type`: ...; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"notifications/tasks"`; `type`: `"string"`; \}; `params`: \{ `allOf`: readonly \[\{ `properties`: ...; `required`: ...; `type`: ...; \}, \{ `anyOf`: ...; \}\]; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]; \}\]; \}, \{ `anyOf`: readonly \[\{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: ...; \}, \{ `type`: ...; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `error`: \{ `properties`: \{ `code`: \{ `type`: ...; \}; `data`: \{ \}; `message`: \{ `type`: ...; \}; \}; `required`: readonly \[`"code"`, `"message"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"error"`\]; `type`: `"object"`; \}\]; \}, \{ `allOf`: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: ...; \}, \{ `type`: ...; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `result`: \{ `anyOf`: readonly \[\{ `additionalProperties`: ...; `properties`: ...; `type`: ...; \}, \{ `allOf`: ...; `description`: ...; \}, \{ `allOf`: ...; `description`: ...; \}, \{ `allOf`: ...; `description`: ...; \}, \{ `allOf`: ...; `description`: ...; \}, \{ `allOf`: ...; `description`: ...; \}, \{ `allOf`: ...; `description`: ...; \}, \{ `allOf`: ...; `description`: ...; \}, \{ `allOf`: ...; `description`: ...; \}, \{ `additionalProperties`: ...; `properties`: ...; `required`: ...; `type`: ...; \}, \{ `allOf`: ...; \}, \{ `additionalProperties`: ...; `properties`: ...; `required`: ...; `type`: ...; \}, \{ `allOf`: ...; `description`: ...; \}\]; \}; \}; `required`: readonly \[`"result"`\]; `type`: `"object"`; \}\]; \}\]; \}\]

***

### subscribeRequest

> `const` **subscribeRequest**: `object`

#### Type Declaration

##### allOf

> `readonly` **allOf**: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: `"string"`; \}, \{ `type`: `"integer"`; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `properties`: \{ `progressToken`: \{ `anyOf`: readonly \[\{ `type`: ...; \}, \{ `type`: ...; \}\]; `description`: `"A progress token, used to associate progress notifications with the original request."`; \}; \}; `type`: `"object"`; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"resources/subscribe"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `uri`: \{ `description`: `"The URI of the resource to subscribe to. The URI can use any protocol; it is up to the server how to interpret it."`; `format`: `"uri"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"uri"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]

##### description

> `readonly` **description**: `"Sent from the client to request resources/updated notifications from the server whenever a particular resource changes."` = `'Sent from the client to request resources/updated notifications from the server whenever a particular resource changes.'`

***

### subscriptionFilter

> `const` **subscriptionFilter**: `object`

#### Type Declaration

##### properties

> `readonly` **properties**: `object`

###### properties.promptsListChanged

> `readonly` **promptsListChanged**: `object`

###### properties.promptsListChanged.type

> `readonly` **type**: `"boolean"` = `'boolean'`

###### properties.resourcesListChanged

> `readonly` **resourcesListChanged**: `object`

###### properties.resourcesListChanged.type

> `readonly` **type**: `"boolean"` = `'boolean'`

###### properties.resourceSubscriptions

> `readonly` **resourceSubscriptions**: `object`

###### properties.resourceSubscriptions.items

> `readonly` **items**: `object`

###### properties.resourceSubscriptions.items.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.resourceSubscriptions.type

> `readonly` **type**: `"array"` = `'array'`

###### properties.taskIds

> `readonly` **taskIds**: `object`

###### properties.taskIds.items

> `readonly` **items**: `object`

###### properties.taskIds.items.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.taskIds.type

> `readonly` **type**: `"array"` = `'array'`

###### properties.toolsListChanged

> `readonly` **toolsListChanged**: `object`

###### properties.toolsListChanged.type

> `readonly` **type**: `"boolean"` = `'boolean'`

##### type

> `readonly` **type**: `"object"` = `'object'`

***

### subscriptionsAcknowledgedNotification

> `const` **subscriptionsAcknowledgedNotification**: `object`

#### Type Declaration

##### allOf

> `readonly` **allOf**: readonly \[\{ `properties`: \{ `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `additionalProperties`: \{ \}; `description`: `"See [specification/2025-11-25/basic/index#general-fields] for notes on _meta usage."`; `type`: `"object"`; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"notifications/subscriptions/acknowledged"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `notifications`: \{ `properties`: \{ `promptsListChanged`: \{ `type`: `"boolean"`; \}; `resourcesListChanged`: \{ `type`: `"boolean"`; \}; `resourceSubscriptions`: \{ `items`: \{ `type`: `"string"`; \}; `type`: `"array"`; \}; `taskIds`: \{ `items`: \{ `type`: `"string"`; \}; `type`: `"array"`; \}; `toolsListChanged`: \{ `type`: `"boolean"`; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"notifications"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]

##### description

> `readonly` **description**: `"First message on a subscriptions/listen stream; reports the honored notification filter."` = `'First message on a subscriptions/listen stream; reports the honored notification filter.'`

***

### subscriptionsListenRequest

> `const` **subscriptionsListenRequest**: `object`

#### Type Declaration

##### allOf

> `readonly` **allOf**: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: `"string"`; \}, \{ `type`: `"integer"`; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `properties`: \{ `progressToken`: \{ `anyOf`: readonly \[\{ `type`: ...; \}, \{ `type`: ...; \}\]; `description`: `"A progress token, used to associate progress notifications with the original request."`; \}; \}; `type`: `"object"`; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"subscriptions/listen"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `notifications`: \{ `properties`: \{ `promptsListChanged`: \{ `type`: `"boolean"`; \}; `resourcesListChanged`: \{ `type`: `"boolean"`; \}; `resourceSubscriptions`: \{ `items`: \{ `type`: `"string"`; \}; `type`: `"array"`; \}; `taskIds`: \{ `items`: \{ `type`: `"string"`; \}; `type`: `"array"`; \}; `toolsListChanged`: \{ `type`: `"boolean"`; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"notifications"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]

##### description

> `readonly` **description**: `"Opens a long-lived channel for out-of-band server notifications (2026-07-28). Replaces the GET endpoint and resources/subscribe."` = `'Opens a long-lived channel for out-of-band server notifications (2026-07-28). Replaces the GET endpoint and resources/subscribe.'`

***

### subscriptionsListenResult

> `const` **subscriptionsListenResult**: `object`

#### Type Declaration

##### allOf

> `readonly` **allOf**: readonly \[\{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `additionalProperties`: \{ \}; `description`: `"See [specification/2025-11-25/basic/index#general-fields] for notes on _meta usage."`; `type`: `"object"`; \}; \}; `type`: `"object"`; \}, \{ `properties`: \{ `_meta`: \{ `properties`: \{ `io.modelcontextprotocol/subscriptionId`: \{ `anyOf`: readonly \[\{ `type`: `"string"`; \}, \{ `type`: `"integer"`; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; \}; `required`: readonly \[`"io.modelcontextprotocol/subscriptionId"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"_meta"`\]; `type`: `"object"`; \}\]

##### description

> `readonly` **description**: `"Terminal response to subscriptions/listen; sent only on graceful teardown."` = `'Terminal response to subscriptions/listen; sent only on graceful teardown.'`

***

### TASKS\_EXTENSION

> `const` **TASKS\_EXTENSION**: `"io.modelcontextprotocol/tasks"` = `'io.modelcontextprotocol/tasks'`

***

### toolChoice

> `const` **toolChoice**: `object`

#### Type Declaration

##### description

> `readonly` **description**: "Controls how the model should use the provided tools. \\"auto\\" (model decides), \\"required\\" (must call a tool), or \\"none\\" (must not call a tool)." = `'Controls how the model should use the provided tools. "auto" (model decides), "required" (must call a tool), or "none" (must not call a tool).'`

##### properties

> `readonly` **properties**: `object`

###### properties.mode

> `readonly` **mode**: `object`

###### properties.mode.description

> `readonly` **description**: `"How the model should use tools."` = `'How the model should use tools.'`

###### properties.mode.enum

> `readonly` **enum**: readonly \[`"auto"`, `"required"`, `"none"`\]

###### properties.mode.type

> `readonly` **type**: `"string"` = `'string'`

##### required

> `readonly` **required**: readonly \[`"mode"`\]

##### type

> `readonly` **type**: `"object"` = `'object'`

***

### toolResultContent

> `const` **toolResultContent**: `object`

#### Type Declaration

##### description

> `readonly` **description**: `"The result of a tool use, provided by the user back to the assistant."` = `'The result of a tool use, provided by the user back to the assistant.'`

##### properties

> `readonly` **properties**: `object`

###### properties.content

> `readonly` **content**: `object`

###### properties.content.items

> `readonly` **items**: `object` = `contentBlock`

###### properties.content.items.anyOf

> `readonly` **anyOf**: readonly \[\{ `description`: `"Text provided to or from an LLM."`; `properties`: \{ `_meta`: \{ `additionalProperties`: \{ \}; `description`: `"See [specification/2025-11-25/basic/index#general-fields] for notes on _meta usage."`; `type`: `"object"`; \}; `annotations`: \{ `properties`: \{ `audience`: \{ `description`: "Describes who the intended customer of this object or data is.\\n\\nIt can include multiple entries to indicate content useful for multiple audiences (e.g., \['user', 'assistant'\]."; `items`: \{ `description`: ...; `enum`: ...; `type`: ...; \}; `type`: `"array"`; \}; `lastModified`: \{ `description`: "The moment the resource was last modified, as an ISO 8601 formatted string.\\n\\nShould be an ISO 8601 formatted string (e.g., \\"2025-01-12T15:00:58Z\\").\\n\\nExamples: last activity timestamp in an open file, timestamp when the resource\\nwas attached, etc."; `format`: `"date-time"`; `type`: `"string"`; \}; `priority`: \{ `description`: "Describes how important this data is for operating the server.\\n\\nA value of 1 means \\"most important,\\" and indicates that the data is effectively required, while 0 means \\"least important,\\" and indicates that the data is entirely optional."; `maximum`: `1`; `minimum`: `0`; `type`: `"number"`; \}; \}; `type`: `"object"`; \}; `text`: \{ `description`: `"The text content of the message."`; `type`: `"string"`; \}; `type`: \{ `const`: `"text"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"text"`, `"type"`\]; `type`: `"object"`; \}, \{ `description`: `"An image provided to or from an LLM."`; `properties`: \{ `_meta`: \{ `additionalProperties`: \{ \}; `description`: `"See [specification/2025-11-25/basic/index#general-fields] for notes on _meta usage."`; `type`: `"object"`; \}; `annotations`: \{ `properties`: \{ `audience`: \{ `description`: "Describes who the intended customer of this object or data is.\\n\\nIt can include multiple entries to indicate content useful for multiple audiences (e.g., \['user', 'assistant'\]."; `items`: \{ `description`: ...; `enum`: ...; `type`: ...; \}; `type`: `"array"`; \}; `lastModified`: \{ `description`: "The moment the resource was last modified, as an ISO 8601 formatted string.\\n\\nShould be an ISO 8601 formatted string (e.g., \\"2025-01-12T15:00:58Z\\").\\n\\nExamples: last activity timestamp in an open file, timestamp when the resource\\nwas attached, etc."; `format`: `"date-time"`; `type`: `"string"`; \}; `priority`: \{ `description`: "Describes how important this data is for operating the server.\\n\\nA value of 1 means \\"most important,\\" and indicates that the data is effectively required, while 0 means \\"least important,\\" and indicates that the data is entirely optional."; `maximum`: `1`; `minimum`: `0`; `type`: `"number"`; \}; \}; `type`: `"object"`; \}; `data`: \{ `description`: `"The base64-encoded image data."`; `format`: `"byte"`; `type`: `"string"`; \}; `mimeType`: \{ `description`: `"The MIME type of the image. Different providers may support different image types."`; `type`: `"string"`; \}; `type`: \{ `const`: `"image"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"data"`, `"mimeType"`, `"type"`\]; `type`: `"object"`; \}, \{ `description`: `"Audio provided to or from an LLM."`; `properties`: \{ `_meta`: \{ `additionalProperties`: \{ \}; `description`: `"See [specification/2025-11-25/basic/index#general-fields] for notes on _meta usage."`; `type`: `"object"`; \}; `annotations`: \{ `properties`: \{ `audience`: \{ `description`: "Describes who the intended customer of this object or data is.\\n\\nIt can include multiple entries to indicate content useful for multiple audiences (e.g., \['user', 'assistant'\]."; `items`: \{ `description`: ...; `enum`: ...; `type`: ...; \}; `type`: `"array"`; \}; `lastModified`: \{ `description`: "The moment the resource was last modified, as an ISO 8601 formatted string.\\n\\nShould be an ISO 8601 formatted string (e.g., \\"2025-01-12T15:00:58Z\\").\\n\\nExamples: last activity timestamp in an open file, timestamp when the resource\\nwas attached, etc."; `format`: `"date-time"`; `type`: `"string"`; \}; `priority`: \{ `description`: "Describes how important this data is for operating the server.\\n\\nA value of 1 means \\"most important,\\" and indicates that the data is effectively required, while 0 means \\"least important,\\" and indicates that the data is entirely optional."; `maximum`: `1`; `minimum`: `0`; `type`: `"number"`; \}; \}; `type`: `"object"`; \}; `data`: \{ `description`: `"The base64-encoded audio data."`; `format`: `"byte"`; `type`: `"string"`; \}; `mimeType`: \{ `description`: `"The MIME type of the audio. Different providers may support different audio types."`; `type`: `"string"`; \}; `type`: \{ `const`: `"audio"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"data"`, `"mimeType"`, `"type"`\]; `type`: `"object"`; \}, \{ `description`: "A resource that the server is capable of reading, included in a prompt or tool call result.\\n\\nNote: resource links returned by tools are not guaranteed to appear in the results of \`resources/list\` requests."; `properties`: \{ `_meta`: \{ `additionalProperties`: \{ \}; `description`: `"See [specification/2025-11-25/basic/index#general-fields] for notes on _meta usage."`; `type`: `"object"`; \}; `annotations`: \{ `properties`: \{ `audience`: \{ `description`: "Describes who the intended customer of this object or data is.\\n\\nIt can include multiple entries to indicate content useful for multiple audiences (e.g., \['user', 'assistant'\]."; `items`: \{ `description`: ...; `enum`: ...; `type`: ...; \}; `type`: `"array"`; \}; `lastModified`: \{ `description`: "The moment the resource was last modified, as an ISO 8601 formatted string.\\n\\nShould be an ISO 8601 formatted string (e.g., \\"2025-01-12T15:00:58Z\\").\\n\\nExamples: last activity timestamp in an open file, timestamp when the resource\\nwas attached, etc."; `format`: `"date-time"`; `type`: `"string"`; \}; `priority`: \{ `description`: "Describes how important this data is for operating the server.\\n\\nA value of 1 means \\"most important,\\" and indicates that the data is effectively required, while 0 means \\"least important,\\" and indicates that the data is entirely optional."; `maximum`: `1`; `minimum`: `0`; `type`: `"number"`; \}; \}; `type`: `"object"`; \}; `description`: \{ `description`: "A description of what this resource represents.\\n\\nThis can be used by clients to improve the LLM's understanding of available resources. It can be thought of like a \\"hint\\" to the model."; `type`: `"string"`; \}; `mimeType`: \{ `description`: `"The MIME type of this resource, if known."`; `type`: `"string"`; \}; `name`: \{ `description`: `"Intended for programmatic or logical use, but used as a display name in past specs or fallback (if title isn't present)."`; `type`: `"string"`; \}; `size`: \{ `description`: "The size of the raw resource content, in bytes (i.e., before base64 encoding or any tokenization), if known.\\n\\nThis can be used by Hosts to display file sizes and estimate context window usage."; `type`: `"integer"`; \}; `title`: \{ `description`: "Intended for UI and end-user contexts — optimized to be human-readable and easily understood,\\neven by those unfamiliar with domain-specific terminology.\\n\\nIf not provided, the name should be used for display (except for Tool,\\nwhere \`annotations.title\` should be given precedence over using \`name\`,\\nif present)."; `type`: `"string"`; \}; `type`: \{ `const`: `"resource_link"`; `type`: `"string"`; \}; `uri`: \{ `description`: `"The URI of this resource."`; `format`: `"uri"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"name"`, `"type"`, `"uri"`\]; `type`: `"object"`; \}, \{ `description`: "The contents of a resource, embedded into a prompt or tool call result.\\n\\nIt is up to the client how best to render embedded resources for the benefit\\nof the LLM and/or the user."; `properties`: \{ `_meta`: \{ `additionalProperties`: \{ \}; `description`: `"See [specification/2025-11-25/basic/index#general-fields] for notes on _meta usage."`; `type`: `"object"`; \}; `annotations`: \{ `properties`: \{ `audience`: \{ `description`: "Describes who the intended customer of this object or data is.\\n\\nIt can include multiple entries to indicate content useful for multiple audiences (e.g., \['user', 'assistant'\]."; `items`: \{ `description`: ...; `enum`: ...; `type`: ...; \}; `type`: `"array"`; \}; `lastModified`: \{ `description`: "The moment the resource was last modified, as an ISO 8601 formatted string.\\n\\nShould be an ISO 8601 formatted string (e.g., \\"2025-01-12T15:00:58Z\\").\\n\\nExamples: last activity timestamp in an open file, timestamp when the resource\\nwas attached, etc."; `format`: `"date-time"`; `type`: `"string"`; \}; `priority`: \{ `description`: "Describes how important this data is for operating the server.\\n\\nA value of 1 means \\"most important,\\" and indicates that the data is effectively required, while 0 means \\"least important,\\" and indicates that the data is entirely optional."; `maximum`: `1`; `minimum`: `0`; `type`: `"number"`; \}; \}; `type`: `"object"`; \}; `resource`: \{ `anyOf`: readonly \[\{ `properties`: \{ `_meta`: ...; `mimeType`: ...; `text`: ...; `uri`: ...; \}; `required`: readonly \[..., ...\]; `type`: `"object"`; \}, \{ `properties`: \{ `_meta`: ...; `blob`: ...; `mimeType`: ...; `uri`: ...; \}; `required`: readonly \[..., ...\]; `type`: `"object"`; \}\]; \}; `type`: \{ `const`: `"resource"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"resource"`, `"type"`\]; `type`: `"object"`; \}\]

###### properties.content.type

> `readonly` **type**: `"array"` = `'array'`

###### properties.isError

> `readonly` **isError**: `object`

###### properties.isError.type

> `readonly` **type**: `"boolean"` = `'boolean'`

###### properties.structuredContent

> `readonly` **structuredContent**: `object`

###### properties.structuredContent.additionalProperties

> `readonly` **additionalProperties**: `object` = `{}`

###### properties.structuredContent.type

> `readonly` **type**: `"object"` = `'object'`

###### properties.toolUseId

> `readonly` **toolUseId**: `object`

###### properties.toolUseId.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.type

> `readonly` **type**: `object`

###### properties.type.const

> `readonly` **const**: `"tool_result"` = `'tool_result'`

###### properties.type.type

> `readonly` **type**: `"string"` = `'string'`

##### required

> `readonly` **required**: readonly \[`"content"`, `"toolUseId"`, `"type"`\]

##### type

> `readonly` **type**: `"object"` = `'object'`

***

### toolUseContent

> `const` **toolUseContent**: `object`

#### Type Declaration

##### description

> `readonly` **description**: `"A request from the assistant to call a tool."` = `'A request from the assistant to call a tool.'`

##### properties

> `readonly` **properties**: `object`

###### properties.id

> `readonly` **id**: `object`

###### properties.id.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.input

> `readonly` **input**: `object`

###### properties.input.additionalProperties

> `readonly` **additionalProperties**: `object` = `{}`

###### properties.input.type

> `readonly` **type**: `"object"` = `'object'`

###### properties.name

> `readonly` **name**: `object`

###### properties.name.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.type

> `readonly` **type**: `object`

###### properties.type.const

> `readonly` **const**: `"tool_use"` = `'tool_use'`

###### properties.type.type

> `readonly` **type**: `"string"` = `'string'`

##### required

> `readonly` **required**: readonly \[`"id"`, `"input"`, `"name"`, `"type"`\]

##### type

> `readonly` **type**: `"object"` = `'object'`

***

### unsubscribeRequest

> `const` **unsubscribeRequest**: `object`

#### Type Declaration

##### allOf

> `readonly` **allOf**: readonly \[\{ `properties`: \{ `id`: \{ `anyOf`: readonly \[\{ `type`: `"string"`; \}, \{ `type`: `"integer"`; \}\]; `description`: `"A uniquely identifying ID for a request in JSON-RPC."`; \}; `jsonrpc`: \{ `const`: `"2.0"`; `type`: `"string"`; \}; `method`: \{ `type`: `"string"`; \}; `params`: \{ `additionalProperties`: \{ \}; `properties`: \{ `_meta`: \{ `properties`: \{ `progressToken`: \{ `anyOf`: readonly \[\{ `type`: ...; \}, \{ `type`: ...; \}\]; `description`: `"A progress token, used to associate progress notifications with the original request."`; \}; \}; `type`: `"object"`; \}; \}; `type`: `"object"`; \}; \}; `required`: readonly \[`"id"`, `"jsonrpc"`, `"method"`\]; `type`: `"object"`; \}, \{ `properties`: \{ `method`: \{ `const`: `"resources/unsubscribe"`; `type`: `"string"`; \}; `params`: \{ `properties`: \{ `uri`: \{ `description`: `"The URI of the resource to unsubscribe from."`; `format`: `"uri"`; `type`: `"string"`; \}; \}; `required`: readonly \[`"uri"`\]; `type`: `"object"`; \}; \}; `required`: readonly \[`"method"`, `"params"`\]; `type`: `"object"`; \}\]

##### description

> `readonly` **description**: `"Sent from the client to request cancellation of resources/updated notifications from the server. This should follow a previous resources/subscribe request."` = `'Sent from the client to request cancellation of resources/updated notifications from the server. This should follow a previous resources/subscribe request.'`

***

### UNSUPPORTED\_PROTOCOL\_VERSION

> `const` **UNSUPPORTED\_PROTOCOL\_VERSION**: `-32022` = `-32022`

***

### URL\_ELICITATION\_REQUIRED

> `const` **URL\_ELICITATION\_REQUIRED**: `-32042` = `-32042`

## Functions

### declaresTasksExtension()

> **declaresTasksExtension**(`capabilities`): `boolean`

#### Parameters

##### capabilities

\{\[`key`: `string`\]: `unknown`; `elicitation?`: \{\[`key`: `string`\]: `unknown`; \}; `experimental?`: \{\[`key`: `string`\]: `object`; \}; `extensions?`: \{\[`key`: `string`\]: `object`; \}; `roots?`: \{\[`key`: `string`\]: `unknown`; `listChanged?`: `boolean`; \}; `sampling?`: \{\[`key`: `string`\]: `unknown`; `tools?`: \{\[`key`: `string`\]: `unknown`; \}; \}; \} \| `undefined`

#### Returns

`boolean`

***

### elicitFormFields()

> **elicitFormFields**(`schema`): [`ElicitFormResult`](#elicitformresult)

Describes the portable elicitation form subset without compiling validators.

#### Parameters

##### schema

`unknown`

#### Returns

[`ElicitFormResult`](#elicitformresult)

***

### inferSchemaDraft()

> **inferSchemaDraft**(`schema`): `"07"` \| `"2020-12"`

Infer the JSON Schema draft to validate a user-provided schema against, from its
`$schema` dialect URI. Defaults to draft-07; a schema declaring the 2020-12 dialect
opts into 2020-12 keywords (`$ref`, `prefixItems`, `unevaluatedProperties`, …).
Detecting from `$schema` keeps existing draft-07 schemas (the implicit default)
validating unchanged, so the relaxation is non-breaking.

#### Parameters

##### schema

`Schema`

#### Returns

`"07"` \| `"2020-12"`

***

### isCreateTaskResult()

> **isCreateTaskResult**(`value`): `value is CreateTaskResult`

#### Parameters

##### value

`unknown`

#### Returns

`value is CreateTaskResult`

***

### isHandshakeRequired()

> **isHandshakeRequired**(`protocol`): `boolean`

Whether a revision requires the `initialize`/`initialized` handshake before other traffic.
Derived from `clientMethods`; replaces the former `ProtocolDefinition.requiresHandshake` field.

#### Parameters

##### protocol

[`ProtocolDefinition`](#protocoldefinition)

#### Returns

`boolean`

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

### isPerRequestLogLevel()

> **isPerRequestLogLevel**(`protocol`): `boolean`

Whether log level is scoped per request (read from each request's `_meta`) rather than set
session-wide via `logging/setLevel`. Derived from `clientMethods`; replaces the former
`ProtocolDefinition.requiresPerRequestLogLevel` field.

This derivation relies on an invariant that any future revision must satisfy: a revision omits
`logging/setLevel` from `clientMethods` only when it scopes log level per request. A revision
that dropped `logging/setLevel` for some other reason -- e.g. because it removed logging
support entirely -- would be misread by this helper as using per-request log levels, so adding
such a revision must revisit this function rather than rely on the derivation as-is.

#### Parameters

##### protocol

[`ProtocolDefinition`](#protocoldefinition)

#### Returns

`boolean`

***

### isSupportedProtocolVersion()

> **isSupportedProtocolVersion**(`version`): `version is ProtocolVersion`

#### Parameters

##### version

`string`

#### Returns

`version is ProtocolVersion`
