# Extension packages: move Skills out of the core packages

## Intent

Every MCP extension added so far has grown `@mokei/context-protocol`, `@mokei/context-server` and
`@mokei/context-client`. Skills alone added about 600 lines of behaviour to them, plus a `yaml`
dependency in the protocol package and `@sozai/codec` in the server and client. Events and MCP Apps
would make those packages heavier still. Every consumer pays for every extension, including React
Native apps that use none of them.

This work gives core a small set of generic extension hooks, and moves Skills' behaviour into its own
packages as the pilot. Events and Apps will then be built as extension packages from the start.

**Timing:** this lands on the Skills branch (PR #102) before anything is released, so the Skills
exports never ship from the core packages and nothing published has to move.

## Goals

- **Hooks in core:** generic hooks in `@mokei/context-server` and `@mokei/context-client` that
  extension packages plug into:
  - method handlers;
  - resource providers;
  - capability and cache contributions;
  - scopes.
- **Skills moves out.** All Skills behaviour goes to four new packages, approved by the user:
  - `@mokei/extension-skills`: the shared format helpers;
  - `@mokei/extension-skills-server`: the catalog and the server extension;
  - `@mokei/extension-skills-client`: the client wrapper;
  - `@mokei/extension-skills-node`: the disk loader.

  The full table is under "Package layout".
- **Core stays free of Skills.** `@mokei/context-server` and `@mokei/context-client` no longer import
  anything Skills-specific. The protocol package loses the `yaml` dependency, and the server and
  client lose `@sozai/codec`, unless something else in them still needs it.
- **Behaviour is unchanged on the wire.** Errors, gating, cache hints, scopes and verification behave
  exactly as on the Skills branch today.

## Non-goals

- **Moving Tasks.** It is woven into `tools/call` results, the subscription hub and the task waiter.
  It stays in core with its `tasks` options.
- **Moving OAuth Client Credentials.** It has no methods and stays a core flag.
- **A public extension API for third parties.** That comes later, once Events and Apps have tested
  the hook shape.
- **Building Events or Apps** in this work.

## Anti-goals

- **The extension gate never moves into extension code.** Core keeps every gating rule. An extension
  must not be able to skip the "enabled, on this revision, declared by the peer" check, and must not
  need to re-implement it.
- **Extension packages never copy core logic,** such as paging, error construction or cache-hint
  application. Core exports what they need, marked `@internal`.
- **No Node APIs in the portable packages.** Only `@mokei/extension-skills-node` may use `node:` modules.

## Constraints

- **Wire schemas stay in `@mokei/context-protocol`.**
  - Covered: the Skills request and result schemas and types, `SKILLS_EXTENSION`, and the `SKILLS`
    registry entry.
  - The per-revision inbound validators remain fixed unions built once at module load. The method
    map in `procedure.ts` keeps the Skills methods, so `client.request('skills/list', …)` stays typed.
- **Hooks are `@internal`.**
  - They are exported for mokei's own extension packages and marked `@internal` in TSDoc. They may
    change in any patch release.
  - The READMEs don't document them as a public API.
- **No subpath exports.** The Node code is a sibling `-node` package, as the repo's convention for
  Node splits requires.
- **Package naming and layout** follow the existing packages: kebab-case files; `src/`, `test/`,
  `lib/`; the same build, lint and test scripts; and versions on the 0.16.x band.
- **Changesets:** patch bumps.

## Approaches

**Package layout.** Three were considered:
- **A.** Keep extensions built in, one file each inside the core packages.
- **B.** A full public plugin system, with validators composed at runtime and an extensible method
  map.
- **C.** Wrap the core server.

The user picked the hybrid instead: core keeps the registry, the schemas and generic hooks, and the
behaviour moves to extension packages. C was rejected because subclasses and wrappers don't compose
across several extensions, and still need the same internal hooks. B was rejected for now because
of per-instance validators, global typing and a semver contract fixed after only one pilot.

**Hook visibility.** The hooks are `@internal`, for mokei's packages only, until Events and Apps have
used them. Picked by the user.

**Server hook shape.** Three were considered:
1. One extension object per extension, passed in an `extensions` array.
2. Loose `methods` and `resourceProviders` options spread into the server config.
3. A middleware chain.

The user picked 1:
- 2 lets two extensions overwrite each other's options when spread;
- 3 pushes gating into each extension and makes ordering matter.

## Design

### `@mokei/context-protocol`

**Stays:**
- `skills.ts`: the schemas, types and `SKILLS_EXTENSION`.
- `extensions.ts`: `SKILLS` with `clientDeclaration: 'none'`.
- The wiring in `versions/2026-07-28.ts`, `procedure.ts`, `http-headers.ts` and `server.ts`.

**Moves to `@mokei/extension-skills`:** `skill-format.ts`, with its tests and the `yaml` dependency.
`SKILL_LIMITS`, the digest, name, segment and URI helpers, the strict UTF-8 decoder, the frontmatter
functions and `SkillFormatError` are no longer exported from the protocol package.

### `@mokei/context-server`: the `ServerExtension` hook

The new `@internal` type in its own file, `extension.ts`:

```ts
type ServerExtension = {
  definition: ExtensionDefinition
  settings?: Record<string, unknown>          // declared settings, e.g. { directoryRead: true }
  handlers: Partial<Record<string, ExtensionMethodHandler>>
  resources?: ResourceProvider                // takes over the URIs it owns
  capabilities?: { resources?: true }         // implies the resources capability
  cache?: CacheHints                          // hints for this extension's requests
  scopes?: ReadonlyArray<string>              // replaces other scopes for its requests
}

type ResourceProvider = {
  owns(uri: string): boolean
  read(uri: string): ReadResourceResult['contents'][number]   // throws RPCError -32602
}

type ExtensionMethodHandler = (request: HandlerRequest<…>) => Promise<unknown> | unknown
```

`ServerConfig.extensions?: ReadonlyArray<ServerExtension>` takes the place of `ServerConfig.skills`.
The test-only `_extensions` param merges into it, and `_registry` stays.

**How core uses it:**
- **Declaration.**
  - Each extension's `definition` and `settings` go into the extension map, so they are advertised
    exactly as today.
  - Two extensions with the same `definition.id` throw at construction.
  - `capabilities.resources` set and no `resources` param gives `resources: {}`, the skills-only
    rule.
- **Gating.**
  - The existing registry check runs first: `METHOD_NOT_FOUND` when the extension isn't enabled or
    isn't on this revision; `MISSING_REQUIRED_CLIENT_CAPABILITY` unless the definition is `'none'`.
  - Then an extension method with no entry in `handlers` returns `METHOD_NOT_FOUND`. That replaces
    the special case for `resources/directory/read` when `directoryRead` is off: the Skills
    extension only registers that handler when `directoryRead` is on.
- **Dispatch.**
  - An extension method goes to its handler before the core `switch`.
  - `resources/read` goes first to the provider whose `owns(uri)` is true. The first match wins, in
    the order of `extensions`. A provider takes precedence over the user's `resources` handler for
    the URIs it owns; that is today's rule that the catalog owns every `skill://` URI.
  - When no `resources` param is set and providers exist:
    - `resources/list` returns an empty page;
    - `resources/templates/list` returns an empty page;
    - `resources/read` of an unowned URI is `-32602` `Resource not found: <uri>`.

    This is today's skills-only behaviour, now generic.
- **Requests an extension answers.** These are its methods, and `resources/read` of a URI its
  provider owns. For them:
  - `requiredScopes` returns the extension's `scopes`, or `[]` when it sets none, replacing the
    other scopes;
  - `#cacheFor` merges the extension's `cache` over the server's, field by field, as the catalog
    does today.
- **Cacheable methods.** The fixed `CACHEABLE_METHODS` set is replaced: the set of methods that get
  cache hints is the core set plus every method of every configured extension.

`server.ts` loses every Skills reference: `SKILL_METHODS`, `SKILL_URI_PREFIX`, `#skills`,
`#isCatalogRequest`, `#readCatalogFile`, and the `skills/*` and `resources/directory/read` cases.
`cache.ts` loses the three Skills methods.

### `@mokei/context-client`: the extension option and `@internal` helpers

- **`ClientParams.extensions?: ReadonlyArray<ExtensionDefinition | { definition, settings? }>`**
  takes the place of `skills?: boolean`. It enables and declares extensions generically, and the
  test-only `_extensions` merges into it. `tasks` and `oauthClientCredentials` stay as they are.
- **`@internal` exports for extension packages.** These are free functions taking a `ContextClient`,
  not public methods, so the class API stays clean:
  - `requireClientExtension(client, definition, method, options?)`: waits for setup, runs the local
    check (`#refuseUndeclaredDefinition`), then checks the server's declaration
    (`#requireServerExtensionAsync`), and returns the server's settings.
  - The paging walker `listSkills` uses today, so the wrapper doesn't copy it.
- **What the client loses:** `listSkills`, `getSkill`, `readResourceDirectory`, `readSkillFile`,
  `skill-verification.ts`, the `SkillVerificationError` and `SkillFile` exports, and the
  `@sozai/codec` dependency if nothing else uses it.

### Package layout: one package per side

Each side depends only on its own core package. The user picked this over one package depending on
both cores, so a server-only consumer never installs the client, and the reverse. All four packages
are new and approved by the user. Every one except `-node` is portable.

| Package | Contents | Dependencies |
|---|---|---|
| `@mokei/extension-skills` | the shared format helpers | `@mokei/context-protocol`, `yaml` |
| `@mokei/extension-skills-server` | the catalog and the server extension | `@mokei/extension-skills`, `@mokei/context-server`, `@mokei/context-rpc`, `@sozai/codec` |
| `@mokei/extension-skills-client` | the client wrapper and verified reads | `@mokei/extension-skills`, `@mokei/context-client`, `@sozai/codec` |
| `@mokei/extension-skills-node` | the disk loader | `@mokei/extension-skills-server` |

The same layout applies to later extensions (Events, Apps): `extension-<name>` for code both sides
share, plus `-server`, `-client` and `-node` where needed. A side with nothing to hold isn't
created.

### `@mokei/extension-skills` (new)

These format helpers move from the protocol package:
- `SKILL_LIMITS` and `SkillFormatError`;
- the digest, name, path-segment and URI helpers;
- `decodeExactUTF8`;
- the frontmatter functions.

### `@mokei/extension-skills-server` (new)

- `createSkillCatalog` and its types, moved from the server.
- `skillsServerExtension(catalog): ServerExtension`. It builds:
  - the handlers: `skills/list`, `skills/get`, and `resources/directory/read` only when
    `directoryRead` is on;
  - the `skill://` resource provider;
  - `capabilities.resources`;
  - the catalog's `cache` and `scopes`.

### `@mokei/extension-skills-client` (new)

- `createSkillsClient(client): SkillsClient`, with `listSkills`, `getSkill`, `readResourceDirectory`
  and `readSkillFile`.
- `checkSkillEntry`, `SkillVerificationError` and `SkillFile`.

Behaviour, error types and reasons are exactly as today. The client must have been built with
`extensions: [SKILLS]`; otherwise every method throws the same error the local gate throws today.

**Usage:**

```ts
const catalog = await createSkillCatalog([...])
new ContextServer({ name, version, extensions: [skillsServerExtension(catalog)] })

const client = new ContextClient({ transport, extensions: [SKILLS] })
const skills = createSkillsClient(client)
const file = await skills.readSkillFile(entry, uri)
```

### `@mokei/extension-skills-node` (new)

`loadSkillDefinitions` and `loadSkillCatalog`, moved from `@mokei/context-server-node` with their
tests. It depends on `@mokei/extension-skills-server`. `@mokei/context-server-node` goes back to its state
before Skills, and its README drops the Skills section.

### Tests and docs

- **Tests move with the code.**
  - The format-helper tests go to `@mokei/extension-skills`.
  - The server tests go to `-server` and configure `ContextServer` with `skillsServerExtension`.
  - The client tests go to `-client` and use `createSkillsClient`.
  - Tests that need a real catalog behind the client, including the property test, live in `-client`
    with `-server` as a devDependency.
  The property test (every accepted catalog entry passes `checkSkillEntry` and the wire schema)
  moves too.
- **New core tests**, using a small test-only extension with a fake definition rather than Skills:
  - handler dispatch;
  - `METHOD_NOT_FOUND` for an extension method with no handler;
  - resource-provider takeover, and the providers-only empty pages;
  - scopes and cache replacement;
  - duplicate-id refusal;
  - `requireClientExtension` on the client.
- **Docs:**
  - the Skills README sections move to the new packages' READMEs;
  - `docs/agents/architecture.md` gains a short "extension packages" paragraph: hooks are
    `@internal`, and schemas stay in protocol;
  - backlog items 4 and 5 note that they are to be built as extension packages.
- **Changeset:** rewrite `.changeset/skills-extension.md` so it describes the final layout: the new
  packages, the core `extensions` options, and Skills exports only from the new packages. Nothing
  has been released, so no "moved" wording is needed.

## Calls settled after the builder check (my calls)

- **No `list()` on resource providers.** Merging provider entries into a user's paginated
  `resources/list` needs cursor-aware splicing, and Skills doesn't list its files. Add `list()` when
  Events or Apps needs it.
- **Extensions are matched by `definition.id`, not by object identity.** Core's extension map and
  gate key on the id. If two copies of `@mokei/context-protocol` are installed, `SKILLS` from either
  copy still matches.
- **The "no handler means `METHOD_NOT_FOUND`" rule covers only extensions passed in `extensions`.**
  Registry entries handled by core, such as Tasks, keep their core handling.
- **The core hook tests use a fake definition passed through `_registry`.** The fake definition
  claims a real wire method, because the inbound validators reject unknown method names. The
  existing `extensions.test.ts` case that claims `logging/setLevel` is rewritten to match.
- **Server-side handlers build their errors with `RPCError` from `@mokei/context-rpc`.** That package
  becomes a dependency of `@mokei/extension-skills-server`.
- **The client paging walker** (today the private `#listPaged`) and `ExtensionNotDeclaredError` are
  exported from `@mokei/context-client` for the wrapper. The walker is marked `@internal`.

## Left to the builder

- The exact `HandlerRequest` shape passed to `ExtensionMethodHandler`. Reuse the core handler
  context (`client`, `params`, `signal`, `meta`, `auth`, MRTR).
- Whether `@sozai/codec` is still needed in the server or client after the move. Check the imports.
- File names inside the new packages.
