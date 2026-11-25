# Extension plumbing design

Item 1 of `docs/agents/plans/backlog/2026-11-25-mcp-extensions.md`.

## Intent

Give mokei one shared mechanism for MCP extensions
(https://modelcontextprotocol.io/extensions/overview) so the built-in extensions that follow
(OAuth Client Credentials, Skills, Events, MCP Apps) plug into it instead of each hand-rolling
capability declaration, method gating and peer checks the way Tasks does today.

Extensions are **built-in only** (decided): mokei ships each supported extension as a first-class,
fully typed feature. There is no public API for third parties to register their own methods or
handlers.

## Goals

- An internal extension registry in `@mokei/context-protocol` describing each built-in extension.
- Method gating driven by the registry: an extension's methods are reachable only when the
  extension is enabled locally, supported on the negotiated revision, and declared by the peer.
- Declaring registry extensions (through each feature's own param) on both `ContextServer` and
  `ContextClient`, and reading the peer's declared extensions.
- Extension negotiation on `2025-11-25` through `initialize` (`capabilities.extensions`), for
  extensions that support that revision.
- The `revision` rule: a peer declaring a `revision` this side does not know is treated as not
  declaring the extension.
- Tasks migrated onto the registry, with its declaration on the client made configurable.

## Non-goals

- Public registration of third-party methods or handlers (option B, rejected).
- Implementing Skills, Events, Apps or Client Credentials themselves.
- Tasks on `2025-11-25` (the extension stays `2026-07-28`-only).
- Validating peer settings objects against a schema.

## Anti-goals

- Any Tasks behaviour change for clients that opt in with `tasks: true`, except the
  spec-mandated `revision` rule (see "Tasks behaviour after migration"). The client default
  flipping to off is the one deliberate change.
- Losing static types: request/result types derived from the revision schemas must stay as they
  are.

## Approaches

1. **Extension registry (picked).** One definition per extension (identifier, `revision`,
   supported protocol revisions, methods it adds). Allowed methods = core revision set plus the
   methods of enabled extensions, with one generic peer-declaration guard. Tasks moves into it.
   Costs a change to method gating on both sides and a Tasks regression risk covered by the
   existing tests.
2. **Keep hardcoding methods into revision method sets** (how Tasks works today) and only add
   declare/read helpers. Cheapest now, but every extension repeats its own guard, extension
   methods stay reachable when the extension is off, and an extension that also supports
   `2025-11-25` must edit both revision files. Rejected: debt grows with each extension.
3. Registry for declaration and settings only, methods still hardcoded. Dropped as approach 2
   with extra indirection.

## Design

### Registry (`@mokei/context-protocol`, new `src/extensions.ts`)

```ts
export type ExtensionDefinition = {
  /** `{vendor-prefix}/{extension-name}`, e.g. `io.modelcontextprotocol/tasks`. */
  id: string
  /** Settings `revision` this implementation speaks; absent = the initial revision. */
  revision?: string
  /** Protocol revisions this extension can be negotiated on. */
  protocolVersions: ReadonlySet<ProtocolVersion>
  /** Request methods the extension adds, client to server. */
  clientMethods: ReadonlySet<string>
  /** Request methods the extension adds, server to client (none yet; kept for symmetry). */
  serverMethods: ReadonlySet<string>
}

export const TASKS: ExtensionDefinition = {
  id: TASKS_EXTENSION,
  protocolVersions: new Set(['2026-07-28']),
  clientMethods: new Set(['tasks/get', 'tasks/update', 'tasks/cancel']),
  serverMethods: new Set(),
}

export const EXTENSIONS: ReadonlyArray<ExtensionDefinition> = [TASKS]
```

Helpers (exported, used by server and client):

- `extensionForClientMethod(method)` / `extensionForServerMethod(method)`: the definition that
  adds a method, or `undefined` for a core method.
- `readExtension(capabilities, definition)`: the peer's settings object for `definition`, or
  `null` when absent **or** when its `revision` differs from `definition.revision` (absent on both
  sides counts as equal).
- `declareExtension(definition, settings?)`: the settings object to advertise, with
  `revision` set from the definition when it has one.
- `declaresTasksExtension` is kept as a thin wrapper over `readExtension` for compatibility.

Wire schemas and derived types stay where they are: `tasks/*` request schemas remain in the
`2026-07-28` `clientRequest` union and `notifications/tasks` in its server notification union.
The registry governs **reachability**, not validation.

### Method sets (revised after Codex review)

`ProtocolDefinition.clientMethods` keeps its current contract: every method the revision can
carry, extension methods included (`tasks/*` stay in the `2026-07-28` set; the existing
`versions.test.ts` assertion holds). An extension that supports a revision must list its methods
in that revision's set, which it must touch anyway to add their schemas. The registry guard runs
**in addition** to the revision check: a method present in `clientMethods` that belongs to an
extension is reachable only when that extension is enabled locally and declared by the peer. No
separate core/extension unions.

### Server (`@mokei/context-server`)

- Enabled extensions: registry-only (decided). Each built-in is enabled by its own feature param
  (`tasks` enables Tasks, as today). There is no free-form `extensions` param: every extension
  mokei declares or reads has a registry entry, including metadata-only ones (MCP Apps will get a
  definition with empty method sets when it lands). Users cannot advertise an extension mokei
  does not implement.
- Client capabilities read uniformly through one internal accessor: per-request
  `readRequestMeta(request).clientCapabilities` on `2026-07-28`, the stored `initialize` params'
  capabilities on `2025-11-25` (today `readRequestMeta` returns `{}` there).
- `_handleRequest` gating, in order:
  1. Core method on this revision: proceed as today.
  2. Extension method, extension not enabled on this server or not supported on this revision:
     `METHOD_NOT_FOUND` (same message as today).
  3. Extension method, client did not declare it (via `readExtension`): `MISSING_REQUIRED_CLIENT_CAPABILITY`
     with `data.requiredCapabilities.extensions[id]`, exactly the shape `requireTasksExtension`
     produces today. This guard is a generic `requireExtension(definition, capabilities)` helper.
- Extension behaviour attached to core methods keeps its own check, built on the same
  `readExtension` / `requireExtension` helpers so errors stay identical (my call):
  `subscriptions/listen` with `notifications.taskIds` still fails with
  `MISSING_REQUIRED_CLIENT_CAPABILITY` when the client did not declare Tasks, and returning a
  `CreateTaskResult` / building the `#callTool` task context still require the declaration.
  `requireTasksExtension` becomes `requireExtension(TASKS, ...)`.
- Advertising: `server/discover` lists enabled extensions supported on `2026-07-28`; the
  `initialize` result lists those supported on `2025-11-25`. This generalises today's
  "strip tasks from the `2025-11-25` initialize result".
- Handler context gains `clientCapabilities` (from the accessor above) so feature code can check
  peer support for metadata-only extensions such as MCP Apps.

### Client (`@mokei/context-client`)

- New param `tasks?: boolean`, default `false` (decided: follow the spec's explicit opt-in rule):
  whether to declare Tasks on `2026-07-28`. This is a behaviour change: today the client always
  declares it. No free-form `extensions` param (registry-only, as on the server).
- `#capabilitiesFor(protocol)` builds handler-derived capabilities plus every enabled extension
  supported on that revision. It is used for per-request `_meta` on `2026-07-28` **and** for the
  `initialize` request on `2025-11-25` (today `#initialize` sends `#capabilities` without
  extensions).
- Outgoing gating in `request()`: an extension method is allowed only when its extension is enabled
  on this client and supported on the resolved revision; otherwise the existing unsupported-method
  error. Whether the **server** declared it is checked by feature code, not by `request()`.
  Tasks does **not** gain a server-declaration check: `client.tasks.*` and task waiting keep
  sending without one, as today (existing tests rely on it). `#requireServerExtensionAsync` has no
  caller in this item; Skills and Events are its first users.
- `tasks: false` is enforced before any send, not only in `request()`: `waitForTask()` rejects
  before acquiring the `TaskWaiter` (which today swallows synchronous listen failures and falls
  back to polling), `#openListen()` refuses task filters, and direct
  `request('subscriptions/listen', { notifications: { taskIds } })` is refused locally.
- Reading the server's extensions: `async getServerExtension(definition): Promise<Record<string, unknown> | null>`
  (takes a registry definition, not a bare id, so the `revision` rule always applies)
  reads the `initialize` result on `2025-11-25` and the connection-lifetime discover snapshot on
  `2026-07-28` (reusing `#requireServerCapabilityAsync`'s snapshot), applying the `revision` rule.
  An internal `#requireServerExtensionAsync(id)` throws a new `ExtensionNotDeclaredError`
  (sibling of `CapabilityNotDeclaredError`) for feature code that must not call before the server
  declared support.

### Tasks behaviour after migration

With `tasks: true`: unchanged from today (same declaration on `2026-07-28`, none on
`2025-11-25`, same errors, same `notifications/tasks` handling).

By default (`tasks: false`, a breaking default change, decided): the client does not declare
Tasks, so a conforming server never returns a `CreateTaskResult` and long-running tools answer
synchronously or with the server's non-task fallback. `client.tasks.*` calls and
`subscriptions/listen` with `taskIds` fail locally (my call). Callers relying on tasks add
`tasks: true`. Every in-repo caller that relies on tasks (tests, `host`, `session`, CLI, flow
packages) opts in explicitly; the builder finds them. The changeset and package README call the
change out.

Server side is unchanged: Tasks was already opt-in there through the `tasks` param.

The second intended change: the `revision` rule. Today the server checks Tasks by
presence only (`versions/2026-07-28.ts:74`); afterwards a client declaring Tasks with a `revision`
mokei does not know loses task context and `tasks/*` access, as the spec requires. Tested through
tool execution and the task methods.

## Testing

- Existing Tasks tests in `context-server`, `context-client` and integration pass with only
  `tasks: true` added to the clients they construct. A new test asserts the default client sends
  no Tasks declaration and never receives a `CreateTaskResult`.
- New: registry helpers (revision match/mismatch/absent); server gating (not enabled,
  unsupported revision, undeclared by client) on both revisions; `initialize` carrying
  `capabilities.extensions` both ways on `2025-11-25` (using a test-only registry definition that
  supports that revision, since Tasks does not); client `tasks: false`, including
  `subscriptions/listen` with `taskIds`; `getServerExtension` on both revisions.

## Left to the builder

- Exact names of the helpers above.
- How `host` / `session` layers surface the new client params (pass-through is enough).
- Changeset: patch bumps for `context-protocol`, `context-server`, `context-client`.
