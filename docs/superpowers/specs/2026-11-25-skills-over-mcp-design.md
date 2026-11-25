# Skills over MCP: base client and server support

Item 3 of `docs/agents/plans/backlog/2026-11-25-mcp-extensions.md`.

## Intent

mokei's own agents and the rest of the stack need to load skills served over MCP, list them, and
eventually offer them to models in sessions. This item builds the protocol-level support only, as the
base for that later integration:

- a server publishes skills;
- a client discovers them and reads their files with the integrity checks the spec requires.

**Spec:** `io.modelcontextprotocol/skills`, Beta (SEP-2640 Final).
- Published spec: https://github.com/modelcontextprotocol/ext-skills/blob/main/specification/beta/skills.mdx
- Overview: https://modelcontextprotocol.io/extensions/skills/overview

## Goals

- **Protocol:** wire schemas and types for `skills/list`, `skills/get` and `resources/directory/read`, plus a
  registry entry for the extension.
- **Server, any runtime (`@mokei/context-server`):**
  - publish skills defined in code;
  - answer `skills/list`, `skills/get` and `resources/directory/read`;
  - serve skill files through `resources/read`.
- **Server, Node (`@mokei/context-server-node`):** load skill definitions from directories on disk.
- **Client (`@mokei/context-client`):**
  - list and get skill entries;
  - read the directories of a skill;
  - read skill files, checked against the entry the caller holds.

## Non-goals (later items)

- **Session, agent and host integration.** That covers:
  - registries keyed on (server label, URI);
  - user approval bound to manifests, including activation of nested skills;
  - offering skills to models, the CLI or host-desktop;
  - caches;
  - the `allowed-tools` and code-execution gates;
  - the origin tagging and cross-server read rules.

  The base layer leaves room for all of these but enforces none of them. A follow-on backlog item
  records them.
- **Dynamic skills on the server** (`"resources": "dynamic"`). The client still accepts them.
- **Skill files in `resources/list`.** `skills/list` is the discovery path, and leaving skill files out
  keeps a server's own resource pagination unchanged.
- **Per-skill or per-URI auth scopes.** One catalog-wide scope list is in scope; see Scopes.
- **Protocol revision `2025-11-25`.**

## Anti-goals

- **No reads without checks.** The client must never hand back skill file content without checking it.
  An unlisted URI, a size or digest mismatch, or a frontmatter mismatch is always an error.
- **No eager reads.** Nothing reads files before they're needed: not on connect, on listing or on
  `skills/get`.
- **Server-side code stays portable.** `@mokei/context-server` must not use `node:` APIs. File access
  is only in `@mokei/context-server-node`.

## Constraints

- **Protocol revision `2026-07-28` only.** The spec defines the extension against that revision. Its
  results need `resultType`, `ttlMs` and `cacheScope`, and its requests need the per-request `_meta`.
- **Digests:** `sha256:` followed by 64 lowercase hex characters, over the file's raw bytes. Hashing
  uses WebCrypto (`globalThis.crypto.subtle.digest`), which works in Node, browsers and React Native.
- **Limits:** 512 files and 16 MiB (16,777,216 bytes) per skill, `SKILL.md` included. Servers refuse to
  publish a skill over either limit. Clients must support skills up to these limits.
- **Error codes:** an unknown skill, an unknown file, or a URI that is missing or isn't a directory
  returns `-32602` (`INVALID_PARAMS`), with the spec's messages:
  - `No skill is served at <uri>`
  - `<uri> is not a directory resource`
- **Code sharing:** helpers used by both server and client live once, in `@mokei/context-protocol`, and
  are never copied. That covers digest computation, frontmatter parsing, the name rules, the limits and
  the URI helpers.
- **Packages:** no new package. Node code goes in the existing `@mokei/context-server-node`.

## Approaches

Three ways of building it were considered:
- **A.** Skills defined in code only.
- **B.** A, plus a loader for skill folders on disk.
- **C.** Skills as ordinary resources with no extension methods. Rejected: it doesn't conform to the
  spec.

**The user picked B.** The core definition is portable, with no file system access; the file system
loader is Node-only and lives in `@mokei/context-server-node`. Skills are directories on disk in practice,
so A alone would leave every server reading the folders in itself.

## Design

### Protocol (`@mokei/context-protocol`)

**Registry entry `SKILLS`:**
- `id: 'io.modelcontextprotocol/skills'`, no `revision`.
- `protocolVersions: {'2026-07-28'}`.
- `clientMethods: {'skills/list', 'skills/get', 'resources/directory/read'}`.
- Server settings are `{}` or `{ directoryRead: true }`.

**No client declaration required.** The spec has clients declare nothing: they call the methods once
they've seen the server's declaration. Item 1's server gate answers an undeclared client with
`MISSING_REQUIRED_CLIENT_CAPABILITY`, which this extension must not trigger. So:
- `ExtensionDefinition` gains `clientDeclaration?: 'required' | 'none'`, default `'required'`.
- `SKILLS` sets `'none'`, so the server skips its "client declared it" check.
- The local gates are unchanged: enabled on this side and supported on the negotiated revision.

**`directoryRead` gate.** The settings flag adds a second gate for `resources/directory/read`:
- **Server:** the method returns `METHOD_NOT_FOUND` unless the server enabled `directoryRead`.
- **Client:** the call is refused locally unless the server's settings carry `directoryRead: true`.

**Schemas.** They go in a new `skills.ts` module and follow the existing `resource.ts` pattern:
- `skillResource`: `{uri, digest, size}`, with `digest` matching `^sha256:[0-9a-f]{64}$`.
- `skill`: `{uri, frontmatter: {name, description, …}, resources: SkillResource[] | 'dynamic', _meta?}`.
- `listSkillsRequest` (paginated) and `listSkillsResult` (paginated and cacheable, `skills: Skill[]`).
- `getSkillRequest` (`uri`) and `getSkillResult` (cacheable, `skill`).
- `readResourceDirectoryRequest` (paginated, `uri`) and `readResourceDirectoryResult` (paginated and
  cacheable, `resources: Resource[]`).

**Wiring into the `2026-07-28` definition:**
- Add the three methods to `clientMethods` and to the `clientRequest` union, using
  `withProtocolMeta(forbidRetryParams(...))`.
- Add the three results to `serverResult` and to the `ServerResult` union, wrapped with `withResultType`.
- Add them to the typed method map in `procedure.ts`.
- Map `skills/get` and `resources/directory/read` to `uri` in the `Mcp-Name` header source.

**Shared helpers, in a `skills` module exported from the package:**
- `SKILL_LIMITS = { maxFiles: 512, maxBytes: 16_777_216 }`.
- `computeDigest(bytes: Uint8Array): Promise<string>`, which returns `sha256:<hex>`.
- `parseSkillFrontmatter(text: string): Record<string, unknown>`.
  - It requires the file to begin with a `---` YAML block, which must be a mapping with string `name`
    and `description`.
  - It throws `SkillFormatError` otherwise.
- `isValidSkillName(name)`, following the Agent Skills naming rules:
  - 1 to 64 characters, lowercase letters, digits and hyphens;
  - no leading, trailing or doubled hyphen.
- URI helpers:
  - `skillRootURI(skillURI)`, which strips `/SKILL.md`;
  - `skillNameFromURI(skillURI)`, the final path segment of the skill;
  - `isWithinSkill(skillURI, fileURI)`.
- `frontmatterEquals(a, b)`, a structural deep equality over values JSON can represent.

**YAML parsing (my call):** use the `yaml` package (eemeli/yaml), added to the workspace catalog as a
dependency of `@mokei/context-protocol`.
- Parse with its `core` schema, so a date stays a string, and convert the result to JSON so the
  frontmatter is plain JSON.
- Both server and client need the same parse, and a second parser would risk the two disagreeing on the
  same `SKILL.md`.

### Server, portable (`@mokei/context-server`)

**Definitions.**
```
SkillDefinition = { path: string; files: Record<string, string | Uint8Array> }
```
- `path` is the skill path within the namespace, for example `git-workflow` or `acme/billing/refunds`.
- The keys of `files` are paths relative to the skill root, separated by `/`, and must include
  `SKILL.md`.
- String content means its UTF-8 bytes.

**Catalog.** `createSkillCatalog(definitions, options?): Promise<SkillCatalog>` is asynchronous,
because WebCrypto is.
- It validates each skill and throws `SkillFormatError`, naming the skill, on any failure:
  - the last segment of `path` equals the frontmatter `name`;
  - `name` follows the naming rules;
  - the file paths are normalised, with no `.`, `..` or empty segments, and no leading `/`;
  - the skill is within the limits;
  - two skills don't share the same `path`.
- It computes every manifest from the bytes that will actually be served.
- It builds an index of every directory, which `resources/directory/read` uses.
- `options`: `{ directoryRead?: boolean; cache?: CacheHints }`.
  - `directoryRead` defaults to `false`.
  - `cache` gives the hints for the skills methods; when absent, the server-wide cache hints apply.

**Nested skills.** When a skill's `files` include another skill's directory, both skills are
published.
- The enclosing skill's manifest lists the nested skill's files, which the spec requires.
- The nested skill is listed as its own entry.
- With the Node loader this happens automatically. With in-code definitions, the author supplies each
  skill and its files.

**`ContextServer` param** `skills?: SkillCatalog`:
- It declares `SKILLS` with `{}` or `{ directoryRead: true }`, on `2026-07-28` only.
- It also declares the `resources` capability, with `listChanged` unchanged, even when no `resources`
  param is given.
- **`skills/list`:** every entry on one page, in catalog order. The spec allows a single page.
- **`skills/get`:** returns the entry for that `SKILL.md` URI, or `-32602` if there is none.
- **`resources/directory/read`:** returns the direct children of a directory.
  - A directory is a skill root, a directory inside a skill, or a prefix directory such as
    `skill://acme`.
  - Subdirectories carry `mimeType: 'inode/directory'`, and everything comes on one page.
  - An unknown URI, or a URI that isn't a directory, returns `-32602`.
- **`resources/read`:**
  - A URI that is a catalog file returns the file. A `skill://` URI that isn't one returns `-32602`.
    Skill URIs are always answered by the catalog and never reach the user's handler.
  - Any other URI goes to the user's `resources.read` handler. With no handler, it returns `-32602`.
  - Text files are returned as `text`: `.md`, `.txt`, `.json`, `.yaml`, `.yml` and the common source
    extensions. Every other file is returned as a base64 `blob`, so the bytes go out exactly as
    hashed.
  - `SKILL.md` gets `mimeType: 'text/markdown'`. Other files get a type from a small extension map, or
    `application/octet-stream` when unknown.
- Cache hints: add `skills/list`, `skills/get` and `resources/directory/read` to `CACHEABLE_METHODS`.
- **Scopes (user decision).** `createSkillCatalog` options gain `scopes?: string[]`.
  - The list applies alike to `skills/list`, `skills/get`, `resources/directory/read` and the
    `resources/read` of any catalog URI, through the existing `requiredScopes` check. Listing a skill
    therefore never needs fewer scopes than reading it.
  - Without the option, only the server-wide scopes apply.
  - A catalog URI read never consults `resources.scopes`. Every other URI still does.
- Skills use the `skill://` scheme only; other schemes are left out.

### Server, Node (`@mokei/context-server-node`)

**Loader.** `loadSkillDefinitions(root: string, options?: { prefix?: string }): Promise<SkillDefinition[]>`.
- It walks `root`, and every directory that contains a `SKILL.md` becomes a skill.
  - The skill's `path` is `prefix` (if any) joined with its path relative to `root`.
  - Its `files` are every regular file under that directory, nested skills included.
- It skips symlinks, and names starting with `.` (such as `.DS_Store` and `.git`).
- It reads files as bytes.

**Convenience.**
`loadSkillCatalog(root, options?: { prefix?, directoryRead?, cache? })` runs the loader and then
`createSkillCatalog`.

**Tests.** The package gets vitest and a `test/` directory. It currently has type tests only.

### Client (`@mokei/context-client`)

**Enabling.** The param `skills?: boolean` enables the client side.
- It declares `SKILLS` as `{}`. That's harmless, and it lets servers see support.
- It unlocks the methods below.
- Every method also requires the server's declaration, through `#requireServerExtensionAsync`, which
  throws `ExtensionNotDeclaredError`. These are its first callers.

**Methods:**
- `listSkills(params?: ListParams<{ cursor? }>): Promise<ListSkillsResult>`. It uses `#listPaged` with
  key `skills`, the same way `listResources` does.
- `getSkill(uri: string, options?): Promise<GetSkillResult>`.
- `readResourceDirectory(params: ListParams<{ uri, cursor? }>): Promise<ReadResourceDirectoryResult>`.
  - It uses `#listPaged` with key `resources`.
  - It is refused locally unless the server's settings carry `directoryRead: true`.
- `readSkillFile(entry: Skill, uri: string, options?): Promise<SkillFile>`.
  - `SkillFile = { uri; mimeType?; bytes: Uint8Array; text?: string }`. `text` is present when the
    server returned text.
  - It performs one `resources/read`, so a skill's files are always read from the same server.
  - It throws `SkillVerificationError` with a `reason`:
    - `'invalid-entry'`: the entry fails the check below;
    - `'limits'`: the entry exceeds `SKILL_LIMITS`;
    - `'unlisted'`: the URI is not in the manifest. A `'dynamic'` entry allows any URI within the
      skill root;
    - `'size'` or `'digest'`: the bytes don't match the manifest;
    - `'frontmatter'`: for `SKILL.md`, the parsed frontmatter isn't `frontmatterEquals` the entry's.
  - Content without verified bytes is never returned.
  - Text content is UTF-8 encoded to bytes, and blobs are base64-decoded, before checking.
- `checkSkillEntry(entry): void`, exported so later layers can check an entry before approval. It
  throws `'invalid-entry'` or `'limits'`. The entry check:
  - `uri` ends in `/SKILL.md`, and its final skill segment equals `frontmatter.name`;
  - `resources` is an array or `'dynamic'`;
  - the array contains `uri` exactly once, and every other URI is within the skill root and unique;
  - the limits hold.
- The client doesn't cache anything. The entry passed to `readSkillFile` is the "held entry" the spec
  describes.

**Errors.** `SkillVerificationError` (with `reason` and `uri`) goes in `errors.ts`, exported.
`SkillFormatError` lives in `@mokei/context-protocol`.

## Testing

- **Protocol:**
  - schema tests for each new request and result, using the spec's examples;
  - helper tests: the spec's example digests and sizes, frontmatter parsing, name rules, URI helpers.
- **Server:**
  - catalog validation, one test per failure;
  - each method on `2026-07-28`, with `METHOD_NOT_FOUND` on `2025-11-25`;
  - `directoryRead` off gives `METHOD_NOT_FOUND`;
  - `resources/read` routing between the catalog and the user handler;
  - nested skills;
  - text versus blob encoding, round-tripped to the manifest digest.
- **Node:** loader tests over a temporary directory tree, covering nesting, prefix, symlink and dotfile
  skipping, and a skill over the limits.
- **Client, using an in-process server and client pair** (the pattern in `context-client/test/extensions.test.ts`):
  - each verification failure, provoked by a server whose content differs from its entry;
  - the local gates: client not enabled, server not declared, `directoryRead` not declared;
  - a no-read check: nothing calls `resources/read` before `readSkillFile`.

## Calls settled after the builder check (my calls)

- **Skills-only servers.** A server given `skills` and no `resources` param still answers both list
  methods, so the `resources` capability it advertises is honest:
  - `resources/list` and `resources/templates/list` return an empty page.
  - `listChanged` is advertised as it is today.
  - `subscribe` keeps its current rule (user resources plus a subscription hub), so a skills-only
    server doesn't advertise it.
- **`2025-11-25`.** The three extension methods and the extension declaration are absent there. The
  `skill://` files are still served through `resources/read` as ordinary resources, as the spec
  describes for a client that doesn't implement the extension. The `METHOD_NOT_FOUND` tests on
  `2025-11-25` cover only the three new methods.
- **Nested skills defined in code.** The catalog keeps one file store keyed by URI. `createSkillCatalog`
  rejects with `SkillFormatError`, and never merges, when either holds:
  - an enclosing skill's `files` leave out any file of a skill nested inside it, so its manifest would
    be incomplete;
  - two definitions give the same URI different bytes.
- **Frontmatter equality.** Equality is strict, as the spec requires: any field-by-field difference
  fails.
  - Both sides parse with YAML 1.2 using the `core` schema, and results are compared as plain JSON
    values.
  - A server that renders frontmatter under YAML 1.1 rules (for example, `yes` as `true`) fails
    verification against mokei. That is documented as known behaviour, not worked around.
- **Schemes and URI comparison.**
  - The URI helpers and `checkSkillEntry` work on generic `scheme://path` strings, so the client
    accepts skills under any scheme. The server publishes only `skill://`.
  - URIs are compared as exact strings.
  - `checkSkillEntry` rejects an entry as `'invalid-entry'` when any URI contains `.` or `..` segments,
    empty segments, `%2F`, `%2f` or a backslash.

## Left to the builder

- The exact text-extension list and the MIME map.
- How the directory index is stored.
- How errors are worded, beyond the spec's two messages.
- How the work splits into tasks.
