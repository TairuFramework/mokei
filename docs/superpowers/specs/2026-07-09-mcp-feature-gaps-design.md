# MCP 2025-11-25 feature gaps — design

**Date:** 2026-07-09
**Source:** `docs/agents/plans/backlog/2026-07-02-mcp-feature-gaps.md`
**Scope:** gaps 1 and 2, plus the incidental `resource.ts` typo. Gap 3
(`resources/subscribe`) stays in the backlog, folded into B4.

## Problem

Comparing mokei's surface against the official MCP SDK v2 surfaced three spec
features that `context-protocol` types but no package implements:

1. **Client-side pagination walk.** `ContextClient.listTools` / `listPrompts` /
   `listResources` / `listResourceTemplates` issue a single request and never
   follow `nextCursor`. Against a paginating server, mokei silently sees only the
   first page; `ContextHost` tool aggregation and the session layer then operate
   on a truncated tool set. Mokei's own server returns full lists, which is why
   this never bit locally. This is an interop bug, not a missing feature.
2. **Tool `outputSchema` + `structuredContent`.** The tool schema carries
   `outputSchema` and `CallToolResult` carries `structuredContent`, but
   `createTool` accepts no output schema, the server never advertises one, and
   neither side produces or validates structured results.
3. **`resources/subscribe`.** Types exist; no client methods, no server dispatch,
   no capability declaration. Deferred — the `2026-07-28` revision replaces this
   surface with `subscriptions/listen` (B4), and no known peer needs the legacy
   form.

## Gap 1 — pagination walk (`context-client`)

A private `#listPaged<T>(method, params, key, options)` on `ContextClient`
performs the walk once. The four public methods become thin wrappers that name
their result key (`tools`, `prompts`, `resources`, `resourceTemplates`).

```ts
type ListOptions = {
  signal?: AbortSignal
  maxPages?: number
  timeout?: number
}

listTools(params?: ListToolsRequest['params'], options?: ListOptions): Promise<ListToolsResult>
listPrompts(params?: ListPromptsRequest['params'], options?: ListOptions): Promise<ListPromptsResult>
listResources(params?: ListResourcesRequest['params'], options?: ListOptions): Promise<ListResourcesResult>
listResourceTemplates(params?: ListResourceTemplatesRequest['params'], options?: ListOptions): Promise<ListResourceTemplatesResult>
```

### Behaviour

- **No `cursor` in `params`** — walk. Start with no cursor, follow `nextCursor`
  from each response, concatenate the result arrays, stop when a response omits
  `nextCursor`. Return the aggregate with `nextCursor` absent.
- **`cursor` present in `params`** — the caller is driving pagination. Issue
  exactly one request and return the page verbatim, `nextCursor` intact.
- `timeout` bounds each page, not the whole walk.
- `signal` aborts between pages and cancels the request in flight.

### Page cap

`options.maxPages` overrides `ClientParams.listMaxPages`, which defaults to
`100`. The spec sets no bound; the cap exists to stop an unbounded walk and to
terminate a server that returns the same `nextCursor` forever.

Exceeding it throws `ListMaxPagesError`, carrying the pages fetched, the last
cursor, and the partial result array so a caller can recover and resume.
Truncation is never silent — returning a partial result with `nextCursor` set
would reproduce the very bug being fixed, one page-cap later instead of at page
one.

### Initialization and capabilities

All four `await this.#initialized` before their first request. `listTools`
already did; the other three got it implicitly through `_write`, which the walk
loop must not rely on.

Capability guards are unchanged: `listTools` requires the `tools` capability, the
other three check nothing. Adding guards to the other three is a separate
behaviour change, out of scope here.

### Breaking change

`listPrompts` / `listResources` / `listResourceTemplates` return `Promise<T>`
instead of `SentRequest<T>`. `SentRequest` adds `.id` and `.cancel()`, neither of
which any caller in the repo uses on these methods. `cancel()` could only ever
have cancelled a single request, which is meaningless once one call spans N
requests; `options.signal` replaces it and covers the whole walk.

`ContextHost.setup()` needs no change and stops silently truncating.

## Gap 2 — `outputSchema` + `structuredContent`

### Factory API

`createTool` and `createPrompt` convert from positional arguments to a single
parameters object. This makes `outputSchema` an optional field rather than a
fourth positional argument or an overload, and leaves room for `title`,
`annotations`, and `icons` later without further signature churn.

```ts
createTool({
  description: 'Search the index',
  inputSchema: { type: 'object', properties: { q: { type: 'string' } } } as const,
  outputSchema: { type: 'object', properties: { count: { type: 'number' } } } as const,
  handler: ({ arguments: { q } }) => ({ structuredContent: { count: 1 } }),
})

createPrompt({
  description: 'Greet someone',
  argumentsSchema: { type: 'object', properties: { name: { type: 'string' } } } as const,
  handler: ({ arguments: { name } }) => ({ messages: [...] }),
})
```

`createPrompt`'s `argumentsSchema` is optional, matching
`GenericPromptDefinition`. When omitted, no input validation runs and `arguments`
types as `Record<string, unknown>`.

Both are breaking. Roughly 40 `createTool` and 6 `createPrompt` call sites exist,
all in tests, READMEs, and doc comments; no production source outside
`definitions.ts` calls them.

### Typing

`TypedToolHandler<Arguments, Output = unknown>` gains a second parameter.
`FromSchema<OutputSchema>` flows into it exactly as `FromSchema<InputSchema>`
already flows into `Arguments`.

With an `outputSchema`, the handler's return type narrows to:

```ts
Omit<CallToolResult, 'content'> & {
  content?: Array<ContentBlock>
  structuredContent: FromSchema<OutputSchema>
}
```

`structuredContent` becomes mandatory — omitting it is a compile error.
`content` becomes optional (see auto-fill below), though `CallToolResult` itself
still requires it on the wire. Without an `outputSchema` the handler's return
type is today's `CallToolResult`, unchanged.

`TypedToolDefinition` gains an optional `outputSchema`. `ExtractToolTypes` is
untouched; it extracts input types only.

### Server behaviour

Advertising is free. `ContextServer`'s constructor already spreads
`{ handler, ...info }` into `#toolsList`, so an `outputSchema` on the definition
appears in `tools/list` with no server-side plumbing.

`createTool` wraps the handler with an output validator built by
`createValidator`, mirroring the existing input-validation path. After the
handler returns:

1. If an `outputSchema` was declared and `structuredContent` is absent, or
   present but invalid, throw
   `RPCError(INTERNAL_ERROR, 'Invalid tool output', { issues })`.
   A handler violating its own declared schema is a server bug, not a tool
   failure — `isError` is the channel for a tool telling the model it failed,
   and conflating the two would hide the bug from the server author.
2. If `structuredContent` is present and `content` is absent, set `content` to
   `[{ type: 'text', text: JSON.stringify(structuredContent) }]`. A handler that
   supplies its own `content` is left untouched. This satisfies the spec's
   backwards-compatibility SHOULD without taking control from tool authors.

`issues` uses the `{ message, path }` shape `createTool` and `createPrompt`
already produce for input-validation failures.

### Client behaviour

`ContextClient` keeps `#toolOutputSchemas: Map<string, Validator>`, populated
from every `tools/list` response the client receives — including each page of a
walk — and cleared on `notifications/tools/list_changed`.

`callTool` validates `structuredContent` against the cached validator for that
tool name when one exists, throwing
`StructuredContentValidationError { toolName, issues }` on mismatch. When no
schema is cached — because `listTools` was never called, or the tool declared
none — no validation runs and no error is raised. The client never blocks a call
on knowledge it does not have.

## Typo

`packages/context-protocol/src/resource.ts:312`

```ts
export type UnsubscribeRequest = FromSchema<typeof subscribeRequest>   // wrong
export type UnsubscribeRequest = FromSchema<typeof unsubscribeRequest> // fixed
```

Type-only, and no implementation references it, since gap 3 is unimplemented.
Fixing it now removes a trap for whoever implements B4.

## Errors

| Error | Package | Raised when |
|---|---|---|
| `ListMaxPagesError` | `context-client` | a walk exceeds `maxPages` |
| `StructuredContentValidationError` | `context-client` | received `structuredContent` violates the tool's advertised `outputSchema` |
| `RPCError(INTERNAL_ERROR)` | `context-server` | a handler's `structuredContent` violates, or is missing against, its declared `outputSchema` |

The first two are exported from `@mokei/context-client` alongside
`CapabilityNotDeclaredError` and `UnsupportedProtocolVersionError`. The server
case reuses `RPCError`, as it must cross the wire as a protocol error.

## Out of scope

- `host` and `session` are unchanged. `structuredContent` passes through them
  untouched; surfacing it to the model is a separate design question.
- `resources/subscribe` (gap 3) — folded into B4, per the backlog note.
- Server-side pagination, i.e. mokei servers cursoring their own lists. Full
  lists are spec-conformant; this is a confirmed non-gap.
- Live SDK v2 interop tests — tracked as item 1 of
  `docs/agents/plans/backlog/2026-07-02-mcp-sdk-v2-adoption.md`.

## Testing

### Client pagination

Against a fake transport scripted to return N pages, per list method:

- a three-page walk returns one flat array and no `nextCursor`
- the second and third requests each carry the cursor from their predecessor
- an explicit `cursor` in `params` yields exactly one request and preserves
  `nextCursor` in the result
- exceeding `maxPages` throws `ListMaxPagesError` with the partial results
  attached
- a server echoing an unchanging cursor terminates at the cap rather than
  spinning
- `signal` aborts a walk in progress

Each method gets its own case rather than only the shared helper: a wrapper
naming the wrong result key is the plausible failure, and a helper-only test
cannot catch it.

### Server `outputSchema`

- an `outputSchema` on a definition appears in the `tools/list` response
- a conforming handler result passes through unmodified
- a violating `structuredContent` surfaces `INTERNAL_ERROR` with `issues`
- a missing `structuredContent` against a declared schema surfaces
  `INTERNAL_ERROR`
- `content` is auto-filled from `structuredContent` when omitted, and preserved
  when supplied

### Client validation

- `listTools` then `callTool` validates and passes a conforming result
- a bad `structuredContent` throws `StructuredContentValidationError`
- `callTool` without a prior `listTools` performs no validation
- `notifications/tools/list_changed` clears the cache, so a re-listed tool
  validates against its new schema

### End to end

One pass through the real server/client pair exercising a paginating server and a
structured tool together.

### Migration

The existing `createTool` / `createPrompt` call sites across `context-server`
and `host` tests migrate to the object form. Their assertions are unchanged; a
green suite after migration is the regression signal.

## Release

Breaking changes, all in one minor (pre-1.0):

- `@mokei/context-client` — `listPrompts` / `listResources` /
  `listResourceTemplates` return `Promise` instead of `SentRequest`; all four
  list methods now aggregate pages by default
- `@mokei/context-server` — `createTool` and `createPrompt` take a single
  parameters object

A changeset accompanies the branch.
