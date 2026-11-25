# Extension plumbing

**Status:** complete (2026-11-25)

Item 1 of the MCP extensions backlog (`docs/agents/plans/backlog/2026-11-25-mcp-extensions.md`). Adds one shared mechanism that every built-in MCP extension (https://modelcontextprotocol.io/extensions/overview) uses, so new extensions don't each hand-roll capability declaration, method gating and peer checks.

## Key decisions

- **Built-in only.** mokei ships each extension as a first-class, typed feature. There is no public API for registering third-party methods or handlers, and no free-form `extensions` param on either side. Each extension is enabled by its own feature param, such as `tasks` or `oauthClientCredentials`.
- **Registry in `@mokei/context-protocol`.** Each `ExtensionDefinition` gives:
  - `id`
  - an optional settings `revision`
  - the protocol revisions it can be negotiated on
  - the client and server methods it adds

  Helpers:
  - `extensionForClientMethod` and `extensionForServerMethod` return the definition that adds a method.
  - `readExtension` returns the peer's settings, or `null` when the extension is absent or its `revision` differs.
  - `declareExtension` builds the settings object to advertise.
- **Reachability, not validation.** Revision method sets still list extension methods. Wire schemas and derived types are unchanged. In addition, the registry guards each extension method: it is reachable only when the extension is enabled locally, supported on the negotiated revision, and declared by the peer.
- **Server gating:**
  - A core method proceeds as before.
  - An extension method that is not enabled, or not supported on this revision, returns `METHOD_NOT_FOUND`.
  - An extension method the client did not declare returns `MISSING_REQUIRED_CLIENT_CAPABILITY` with `data.requiredCapabilities.extensions[id]`.

  Client capabilities are read through one accessor: per-request `_meta` on `2026-07-28`, the stored `initialize` capabilities on `2025-11-25`. `HandlerRequest.clientCapabilities` exposes them to feature code.
- **Advertising:** `server/discover` on `2026-07-28` and the `initialize` result on `2025-11-25` each list the enabled extensions supported on that revision.
- **Client side:**
  - The client declares extensions per revision, in per-request `_meta` and in `initialize`.
  - Outgoing extension methods are refused locally when the extension is not enabled.
  - `getServerExtension(definition)` reads the server's declaration and applies the `revision` rule.
  - Internal `#requireServerExtensionAsync` throws `ExtensionNotDeclaredError`. Skills and Events will be its first callers.
- **Tasks migrated onto the registry.**
  - **Breaking:** the client `tasks` option now defaults to `false`, following the spec's explicit opt-in rule. `tasks: false` is enforced before any send, including `waitForTask` and `subscriptions/listen` with `taskIds`.
  - A client declaring Tasks with an unknown `revision` now counts as not declaring it.
  - Every in-repo caller that relies on Tasks opts in explicitly. `createFlowHost` and `addDecisionFlow` require a tasks-enabled session.

## Also breaking

`HandlerRequest.clientCapabilities` is required.
