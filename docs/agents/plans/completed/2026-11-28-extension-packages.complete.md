# Extension packages: Skills moved out of the core packages

**Status:** complete (2026-11-28)

Every MCP extension had been growing `@mokei/context-protocol`, `@mokei/context-server` and
`@mokei/context-client`. Skills alone added about 600 lines of behaviour plus `yaml` and
`@sozai/codec` dependencies, paid for by every consumer including React Native apps. This work
gave core a small set of generic extension hooks and moved Skills into its own packages as the
pilot, before Skills was ever released (PR #102), so nothing published had to move.

## Approach

The options were:

- **Extensions inject into core through hooks.**
- **Extension packages wrap the core server and client.**
- **A hybrid of the two (chosen):**
  - core keeps the registry, the wire schemas and every gating rule, plus generic `@internal` hooks;
  - the extension packages provide the behaviour: handlers, a resource provider, and a client
    wrapper built on exported helpers.

  Wrapping alone would have forced extensions to copy gating, paging and cache-hint logic.

## What was built

- **`@mokei/context-server`:** an `extensions` option taking `ServerExtension` objects. Each one has:
  - a definition, plus settings;
  - method handlers;
  - a `ResourceProvider` with `owns` and `read`;
  - `capabilities.resources`, cache hints and scopes.

  Extensions are matched by definition id, and duplicate ids throw. The hook types are `@internal`.
- **`@mokei/context-client`:** an `extensions` option, taking definitions or `{ definition, settings }`.
  Duplicate ids are last-wins. Two `@internal` helpers, `requireClientExtension` and `listPaged`,
  reach the client's private gate and pager without copying them.
- **New packages:**
  - `@mokei/extension-skills`: format helpers (limits, digests, names, URIs, frontmatter). Moved
    from `context-protocol`, which dropped `yaml` and the `dom` lib.
  - `@mokei/extension-skills-server`: `createSkillCatalog` and `skillsServerExtension(catalog)`.
  - `@mokei/extension-skills-client`: `createSkillsClient(client)` and `SkillVerificationError`.
    Users opt in with `extensions: [SKILLS]` on the client.
  - `@mokei/extension-skills-node`: `loadSkillDefinitions` and `loadSkillCatalog`, the only
    package using `node:` modules.
- **Unchanged:** wire schemas, the `SKILLS` registry entry and the extension gate stay in
  `context-protocol` and core. Tasks and OAuth client credentials stay in core.

## Key decisions

- **Core keeps the gate.**
  - The checks for enabled, on this revision, and declared by the peer stay in core; an extension
    cannot skip or re-implement them.
  - On the server, a method of a configured extension without a handler is `METHOD_NOT_FOUND`.
    A test proves the gate refuses even a method the core switch would answer.
- **Dispatch order** for an extension request: its handler, then its resource provider, then the
  core fallbacks.
  - With `capabilities.resources: true` and no `resources` option, the server declares
    `resources: {}`, answers empty list pages, and returns `Resource not found` for unowned URIs.
  - An extension's scopes and cache settings replace the server's for its own requests.
- **No wire change.** The wrapper methods throw the same errors at the same points as the removed
  core methods, and the moved tests kept their assertions.
- **Public versus internal.**
  - The `extensions` options are public, since they are how users enable Skills.
  - The hook types and helpers stay `@internal` until Events and Apps have tested the shape.
- **Naming.** Later extensions follow `extension-<name>` plus `-server`, `-client` and `-node`.

## Known gaps

The hooks don't yet cover several things later extensions need:

- held or streaming responses;
- notifications sent outside a request, and a `dispose` hook;
- per-method cacheability (today every extension method gets cache hints);
- an async `ResourceProvider.read` that receives `auth` and `signal`.

These are listed against Events and MCP Apps in `docs/agents/plans/backlog/2026-11-25-mcp-extensions.md`.
