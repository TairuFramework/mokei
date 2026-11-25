# Skills over MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Stage:** planning
**Mode:** tasks

**Goal:** Base client and server support for the `io.modelcontextprotocol/skills` extension: publish skills, discover them, and read skill files with verification.

**Architecture:**
- `@mokei/context-protocol` holds everything shared:
  - the wire schemas;
  - the registry entry;
  - the format, path and digest helpers.
- `@mokei/context-server` builds an immutable `SkillCatalog` from in-code definitions and serves it next to the user's resources.
- `@mokei/context-server-node` loads definitions from disk.
- `@mokei/context-client` adds the skills methods and a `readSkillFile` that verifies against the entry the caller holds.

**Tech Stack:** TypeScript, `@sozai/schema` (JSON Schema plus FromSchema), `yaml` 2.x, `@sozai/codec` (`toB64`/`fromB64`), WebCrypto `crypto.subtle`, vitest, `@enkaku/transport` `DirectTransports`.

**Spec:** `docs/superpowers/specs/2026-11-25-skills-over-mcp-design.md`. Its "Rules from the Codex design review" section takes precedence over earlier sections. The extension spec text is at `.superpowers/review/skills-extension-spec.txt`, which is git-ignored.

## Global Constraints

- **Extension:** id `io.modelcontextprotocol/skills`, protocol revision `2026-07-28` only. Server settings are `{}` or `{ directoryRead: true }`.
- **Digest:** the format is `sha256:` plus 64 lowercase hex characters (`^sha256:[0-9a-f]{64}$`), computed over raw bytes with `globalThis.crypto.subtle.digest('SHA-256', …)`.
- **Limits:** `SKILL_LIMITS = { maxFiles: 512, maxBytes: 16_777_216 }`.
- **Error code:** `-32602` (`INVALID_PARAMS`) for every error below, with these exact messages:
  - unknown skill: `No skill is served at <uri>`;
  - unknown file: `Resource not found: <uri>`;
  - not a directory: `<uri> is not a directory resource`.
- **Portability:** no `node:` imports outside `@mokei/context-server-node`.
- **Helpers:** shared helpers live once, in `@mokei/context-protocol`, and are never copied.
- **No new package.** Use kebab-case file names, and `pnpm` only.
- **Changeset:** one intent file, `.changeset/skills-extension.md`, with `patch` bumps.
- **Builds:** cross-package tests import built `lib/`. Run `pnpm --filter <pkg> build` for a dependency before testing its dependents.
- **Running scripts:** use `rtk proxy pnpm run <script>`. The root lint is `rtk proxy pnpm run lint`.

## Review Focus

1. **A hostile server** sends an entry with `size: -1`, or with a digest in uppercase hex. `checkSkillEntry` must reject it as `invalid-entry` before any read. Test in Task 6.
2. **A file of invalid UTF-8 named `notes.txt`.** The server sends it as a base64 `blob`, and the client's digest still matches. Test in Task 4.
3. **A skill path segment containing `%2F`, or a segment `..`.** `createSkillCatalog` must throw `SkillFormatError`. Test in Task 3.
4. **A server that never advertises skills.** `listSkills()` rejects with `ExtensionNotDeclaredError`, and nothing goes on the wire. Test in Task 6.
5. **A client that never declares skills.** A mokei server still answers its `skills/list` and doesn't return `-32021`. Test in Task 4.

---

### Task 1: Shared skill format helpers (`@mokei/context-protocol`)

**Files:**
- Create: `packages/context-protocol/src/skill-format.ts`
- Modify: `packages/context-protocol/src/index.ts`, `packages/context-protocol/package.json`, `pnpm-workspace.yaml` (catalog `yaml: ^2.9.1`)
- Test: `packages/context-protocol/test/skill-format.test.ts`

**Interfaces:**
- Produces:
  - `SKILL_LIMITS: { readonly maxFiles: 512; readonly maxBytes: 16777216 }`
  - `class SkillFormatError extends Error`, with `readonly skill?: string`
  - `computeDigest(bytes: Uint8Array): Promise<string>`
  - `isValidDigest(digest: string): boolean`
  - `isValidSkillName(name: string): boolean`
  - `validatePathSegments(path: string): Array<string>` (throws `SkillFormatError`)
  - `joinSkillURI(skillPath: string, relativePath?: string): string`, which gives `skill://<skillPath>` or `skill://<skillPath>/<relativePath>`, built with `validatePathSegments`
  - `skillRootURI(skillURI: string): string`
  - `skillNameFromURI(skillURI: string): string`
  - `isWithinSkill(skillURI: string, fileURI: string): boolean`
  - `isValidSkillURI(uri: string): boolean`: the scheme is `[a-z][a-z0-9+.-]*`, then `://`, then a path whose every segment passes the segment rule
  - `decodeExactUTF8(bytes: Uint8Array): string | null`
  - `parseSkillFrontmatter(text: string): Record<string, unknown>`
  - `validateSkillFrontmatter(frontmatter: Record<string, unknown>): void` (throws)
  - `frontmatterEquals(a: unknown, b: unknown): boolean`

- [ ] **Step 1: Write the failing tests.** The test names and assertions:
  - `computeDigest matches the spec example`: the UTF-8 bytes of `"# Invoice\n\nCustomer:\nAmount:\n"` digest to `sha256:61f4ea6d2c75fde1b4977219e7e3107d491c3c26aefb6686e84d6281c088d9ee`, and their length is 29.
    - Confirm those bytes against `.superpowers/review/skills-extension-spec.txt`, around "invoice.md". If the example text differs, use the spec's exact bytes.
  - `isValidDigest` is false for uppercase hex, for 63 hex characters, and without the `sha256:` prefix.
  - `isValidSkillName` is true for `git-workflow` and `a`. It is false for:
    - `Git`, `-a`, `a-`, `a--b`, the empty string;
    - 65 times `a` (64 times is true).
  - `validatePathSegments` throws `SkillFormatError` for:
    - `''`, `'/a'`, `'a//b'`, `'a/./b'`, `'a/../b'`;
    - segments containing `\`, `%`, `?`, `#`, or `\u0001`.

    It returns `['acme', 'billing', 'refunds']` for `'acme/billing/refunds'`.
  - `joinSkillURI('acme/billing/refunds', 'SKILL.md')` is `'skill://acme/billing/refunds/SKILL.md'`.
  - URI helpers on `skill://acme/billing/refunds/SKILL.md`:
    - `skillRootURI` gives `skill://acme/billing/refunds`.
    - `skillNameFromURI` gives `refunds`.
    - `isWithinSkill` is true for `.../refunds/examples/email.md`.
    - `isWithinSkill` is false for `skill://acme/billing/refunds-other/x.md` and `skill://acme/billing/x.md`.
    - The helpers work the same for `github://o/r/refunds/SKILL.md`.
  - `isValidSkillURI` is false for `skill://a/%2F/SKILL.md`, `skill://a/../SKILL.md` and `skill://a//SKILL.md`.
  - `decodeExactUTF8`:
    - returns null for `Uint8Array.of(0xff)`;
    - keeps a leading BOM: `Uint8Array.of(0xef, 0xbb, 0xbf, 0x61)` gives `'﻿a'`;
    - returns `'é'` for `0xc3 0xa9`.
  - `parseSkillFrontmatter`:
    - for `'---\nname: x\ndescription: y\nversion: 1.0\ncreated: 2026-01-01\n---\nbody'` it returns `{ name: 'x', description: 'y', version: 1, created: '2026-01-01' }`. The date stays a string because the `core` schema is used.
    - it throws `SkillFormatError` when there is no leading `---`, when the frontmatter isn't a mapping, or when `name` or `description` is missing or not a string.
  - `validateSkillFrontmatter` throws for:
    - an empty `description`, or one 1025 characters long;
    - `compatibility` 501 characters long;
    - `metadata: { a: 1 }`;
    - `license: 3`;
    - `'allowed-tools': ['x']`.

    It passes unknown fields unchanged.
  - `frontmatterEquals`:
    - `{a: [1, {b: 'c'}]}` equals itself regardless of key order;
    - `1` does not equal `'1'`;
    - `{a: undefined}` does not equal `{}`.

- [ ] **Step 2: Run to confirm they fail.** Run `cd packages/context-protocol && ../../node_modules/.bin/vitest run test/skill-format.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement in `skill-format.ts`.**
  - `decodeExactUTF8` uses `new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })` and returns null on a throw.
  - `parseSkillFrontmatter` uses `parse(block, { schema: 'core' })` from `yaml`, then `JSON.parse(JSON.stringify(...))`.
  - Add `yaml: catalog:` to the package `dependencies`. Export everything from `index.ts`.

- [ ] **Step 4: Run to confirm they pass.** Run the same command, plus `rtk proxy pnpm run --filter @mokei/context-protocol test:types`. Expected: PASS.

- [ ] **Step 5: Commit.** `feat(context-protocol): skill format, path and digest helpers`

### Task 2: Skills schemas and registry entry (`@mokei/context-protocol`)

**Files:**
- Create: `packages/context-protocol/src/skills.ts`
- Modify:
  - `src/extensions.ts`
  - `src/versions/2026-07-28.ts` (`clientMethods`, `clientRequest`, `ClientRequest`, `serverResult`, `ServerResult`)
  - `src/procedure.ts`
  - `src/http-headers.ts`
  - `src/index.ts`
- Test: `packages/context-protocol/test/skills.test.ts`; extend `test/extensions.test.ts`

**Interfaces:**
- Produces:
  - Schemas, each with a matching type through `FromSchema`: `skillResource`, `skill`, `listSkillsRequest`, `listSkillsResult`, `getSkillRequest`, `getSkillResult`, `readResourceDirectoryRequest`, `readResourceDirectoryResult`. The types are `SkillResource`, `Skill`, `ListSkillsRequest`, `ListSkillsResult`, `GetSkillRequest`, `GetSkillResult`, `ReadResourceDirectoryRequest` and `ReadResourceDirectoryResult`.
  - `SKILLS_EXTENSION = 'io.modelcontextprotocol/skills'`.
  - `SKILLS: ExtensionDefinition`:
    - `clientMethods: new Set(['skills/list', 'skills/get', 'resources/directory/read'])`
    - `protocolVersions: new Set(['2026-07-28'])`
    - `clientDeclaration: 'none'`
  - `ExtensionDefinition` gains `clientDeclaration?: 'required' | 'none'`. An absent value means `'required'`.
  - `EXTENSIONS` includes `SKILLS`.
  - Typed method map entries:
    - `'skills/list': { Params: ListSkillsRequest['params']; Result: ListSkillsResult }`
    - `'skills/get'` and `'resources/directory/read'`, alike.

- [ ] **Step 1: Write the failing tests.**
  - `skills.test.ts` validates the spec's examples with the `2026-07-28` `clientMessage` and `serverMessage` validators:
    - the `skills/list` request and its result, which includes a `"dynamic"` entry;
    - the `skills/get` request and result;
    - the `resources/directory/read` request and result.
  - It also rejects:
    - a `skillResource` whose digest is `sha256:ABC`;
    - a `skill` that has no `resources`;
    - a `resources` value of `"static"`;
    - `size: -1` and `size: 1.5`. Sizes use `type: 'integer', minimum: 0`.
  - `extensions.test.ts` asserts:
    - `extensionForClientMethod('skills/get')` is `SKILLS`;
    - `SKILLS.clientDeclaration` is `'none'`;
    - `SKILLS.protocolVersions` is exactly `2026-07-28`.

- [ ] **Step 2: Run to confirm they fail.** Expected: FAIL, unknown method or export.

- [ ] **Step 3: Implement.**
  - Follow the `resource.ts` pattern: `allOf` with `paginatedRequest`, `paginatedResult` and `cacheableResult`.
  - Wrap the requests with `withProtocolMeta(forbidRetryParams(...))` and the results with `withResultType`.
  - Add each result to `ServerResult` as `CompleteResultOf<typeof X>`.
  - Map `skills/get` and `resources/directory/read` to `uri` in `MCP_NAME_HEADER_SOURCE`.

- [ ] **Step 4: Run to confirm they pass.** Run the package's full suite with `rtk proxy pnpm run --filter @mokei/context-protocol test`. Existing conformance and versions tests must stay green. Expected: PASS.

- [ ] **Step 5: Commit.** `feat(context-protocol): skills extension schemas and registry entry`

### Task 3: Skill catalog (`@mokei/context-server`)

**Files:**
- Create: `packages/context-server/src/skill-catalog.ts`
- Modify: `packages/context-server/src/index.ts`, `packages/context-server/package.json` (add `@sozai/codec: catalog:` if it is missing)
- Test: `packages/context-server/test/skill-catalog.test.ts`

**Interfaces:**
- Consumes: Task 1 helpers, and Task 2's `Skill` and `Resource` types.
- Produces:
  - `SkillDefinition = { path: string; files: Record<string, string | Uint8Array>; directories?: Array<string> }`
  - `SkillCatalogOptions = { directoryRead?: boolean; cache?: CacheHints; scopes?: Array<string> }`
  - `createSkillCatalog(definitions: Array<SkillDefinition>, options?: SkillCatalogOptions): Promise<SkillCatalog>`
  - `SkillCatalog`, immutable:
    - `readonly entries: ReadonlyArray<Skill>`, in definition order
    - `readonly directoryRead: boolean`
    - `readonly cache?: CacheHints`
    - `readonly scopes?: ReadonlyArray<string>`
    - `getEntry(uri: string): Skill | undefined`
    - `getFile(uri: string): { uri: string; mimeType: string; text?: string; blob?: string } | undefined`: one representation, decided at build time
    - `getDirectory(uri: string): Array<Resource> | undefined`: direct children, with subdirectories as `mimeType: 'inode/directory'`
    - `has(uri: string): boolean`: true for any catalog file or directory URI

- [ ] **Step 1: Write the failing tests.** Each is a test name with its assertion:
  - `builds a manifest from served bytes`:
    - one skill `pdf-processing` with `SKILL.md` and `templates/invoice.md` (the spec example bytes);
    - its entry's `resources` lists both files with the spec digests and sizes;
    - `frontmatter` deep-equals the parsed YAML.
  - `rejects each invalid definition` (parameterised, each throws `SkillFormatError`):
    - name differs from the last path segment;
    - invalid name;
    - path `acme/../refunds`;
    - path segment `a%2Fb`;
    - file key `../x`;
    - no `SKILL.md`;
    - 513 files;
    - more than 16,777,216 bytes in total;
    - duplicate `path`;
    - description 1025 characters long.
  - `rejects inconsistent nested definitions`:
    - the enclosing skill omits a file of the nested skill;
    - the same URI is given different bytes in the two definitions.
  - `publishes a nested skill separately`: `outer/inner` is its own entry, and outer's manifest includes `skill://outer/inner/SKILL.md`.
  - `chooses text only for exact UTF-8`:
    - `notes.txt` holding `0xff` gives a `blob` that base64-decodes to `0xff`;
    - a `.md` file with a BOM gives `text` that starts with `﻿`;
    - an ASCII `.bin` file gives `text`, and its MIME type is `application/octet-stream`.
  - `indexes directories, including empty ones`:
    - `getDirectory('skill://pdf-processing')` lists `SKILL.md` and `templates` (`inode/directory`);
    - `directories: ['empty']` lists `empty`, and `getDirectory('skill://pdf-processing/empty')` returns `[]`;
    - with a skill at `acme/billing/refunds`, `getDirectory('skill://acme')` lists `billing` (a prefix directory);
    - `getDirectory('skill://pdf-processing/SKILL.md')` returns `undefined`.
  - `SKILL.md mime is text/markdown`.

- [ ] **Step 2: Run to confirm they fail.**

- [ ] **Step 3: Implement.**
  - Keep one `Map<uri, bytes>` file store. Validate every definition with Task 1's `validatePathSegments`, `isValidSkillName`, `parseSkillFrontmatter` and `validateSkillFrontmatter`.
  - Decide each file's representation with `decodeExactUTF8`, falling back to `toB64`.
  - Use a small MIME map: `.md` is `text/markdown`, `.txt` `text/plain`, `.json` `application/json`, `.yaml`/`.yml` `application/yaml`, `.py` `text/x-python`, `.js` `text/javascript`, `.ts` `text/typescript`, `.sh` `text/x-shellscript`, and anything else `application/octet-stream`.
  - Do every check before computing any digest.

- [ ] **Step 4: Run to confirm they pass.**

- [ ] **Step 5: Commit.** `feat(context-server): skill catalog`

### Task 4: Serve skills from `ContextServer` (`@mokei/context-server`)

**Files:**
- Modify:
  - `packages/context-server/src/server.ts`: `ServerConfig.skills`, the constructor, `_handleRequest`'s extension gate, `#dispatchRequest`, `requiredScopes`
  - `src/cache.ts`: `CACHEABLE_METHODS`
- Test: `packages/context-server/test/skills.test.ts`

**Interfaces:**
- Consumes: `SkillCatalog` (Task 3), and `SKILLS` with `clientDeclaration` (Task 2).
- Produces: `ServerConfig.skills?: SkillCatalog`.

- [ ] **Step 1: Write the failing tests.** Drive a `ContextServer` over `DirectTransports` with raw requests, as `test/extensions.test.ts` does. On `2026-07-28` unless stated:
  - `declares skills and resources`:
    - `server/discover` capabilities carry `extensions['io.modelcontextprotocol/skills']` equal to `{}`, or `{ directoryRead: true }` when the catalog has it;
    - `resources` is present.
  - `skills/list returns every entry on one page` with `resultType: 'complete'`, plus `ttlMs` and `cacheScope`. The catalog's `cache` overrides the server's.
  - `skills/get unknown uri is -32602` with the message `No skill is served at skill://nope/SKILL.md`.
  - `a client that never declared skills is still served`: the client's `_meta` capabilities have no `extensions`, and `skills/list` still succeeds (no `-32021`). This is Review Focus 5.
  - `resources/directory/read`:
    - lists children;
    - a non-directory returns `-32602` with `<uri> is not a directory resource`;
    - with `directoryRead` off, it returns `METHOD_NOT_FOUND`.
  - `resources/read routes catalog uris to the catalog`:
    - with a user `resources.read` mock, a catalog URI never calls the mock;
    - `skill://unknown/x.md` returns `-32602` `Resource not found: skill://unknown/x.md` without calling the mock;
    - `file:///a` calls the mock.
  - `serves blobs byte-exact` (Review Focus 2): `notes.txt` holding `0xff` returns a `blob`, and the digest of the decoded bytes equals the manifest digest.
  - `skills-only server answers resource lists empty`: with no `resources` param, `resources/list` and `resources/templates/list` return empty arrays.
  - `2025-11-25`:
    - the three skills methods return `METHOD_NOT_FOUND`;
    - `initialize` capabilities carry no skills extension;
    - `resources/read` of a catalog URI still returns the file.
  - `catalog scopes apply to all four operations`:
    - a catalog with `scopes: ['skills:read']`, and a request whose `auth` has no scopes, makes `skills/list`, `skills/get`, `resources/directory/read` and a catalog `resources/read` throw the insufficient-scope error;
    - a user `resources.scopes` function is not consulted for catalog URIs.

- [ ] **Step 2: Run to confirm they fail.**

- [ ] **Step 3: Implement.**
  - In `_handleRequest`, skip `requireExtension` when `definition.clientDeclaration === 'none'`.
  - `resources/directory/read` also needs `this.#skills?.directoryRead === true`. If not, throw `METHOD_NOT_FOUND`.
  - Add the three methods to `CACHEABLE_METHODS`. Apply `catalog.cache` ahead of the server hints for those methods and for catalog `resources/read`.

- [ ] **Step 4: Run to confirm they pass.** Run the full `@mokei/context-server` suite. Expected: PASS, with existing tests unchanged.

- [ ] **Step 5: Commit.** `feat(context-server): serve skills`

### Task 5: Node skill loader (`@mokei/context-server-node`)

**Files:**
- Create: `packages/context-server-node/src/skills.ts`, `packages/context-server-node/test/skills.test.ts`, `packages/context-server-node/vitest.config.ts` (copy from `packages/context-server`)
- Modify:
  - `packages/context-server-node/src/index.ts`
  - `packages/context-server-node/package.json`: scripts `test` = `pnpm run test:types && pnpm run test:unit`, `test:unit` = `vitest run`, and devDependency `vitest: catalog:`, matching `context-server`'s `package.json`

**Interfaces:**
- Consumes: `SkillDefinition`, `createSkillCatalog`, `SkillCatalogOptions` (Task 3).
- Produces:
  - `loadSkillDefinitions(root: string, options?: { prefix?: string }): Promise<Array<SkillDefinition>>`
  - `loadSkillCatalog(root: string, options?: { prefix?: string } & SkillCatalogOptions): Promise<SkillCatalog>`

- [ ] **Step 1: Write the failing tests.** Build a tree under `mkdtemp(join(tmpdir(), 'mokei-skills-'))`.
  - `loads skills with nesting and prefix`:
    - the tree has `a/SKILL.md`, `a/ref/x.md`, `a/inner/SKILL.md` and an empty `a/empty/`;
    - with `prefix: 'acme'`, the loader gives paths `acme/a` and `acme/a/inner`;
    - `a`'s `files` include `inner/SKILL.md`;
    - `a`'s `directories` include `empty`.
  - `skips symlinks and dotfiles`: `a/.DS_Store`, `a/.git/config` and a symlink `a/link.md` are all absent from `files`.
  - `rejects an invalid prefix`: `prefix: '../x'` throws `SkillFormatError`.
  - `loadSkillCatalog builds a served catalog`: `entries.length === 2`.

- [ ] **Step 2: Run to confirm they fail.**

- [ ] **Step 3: Implement.**
  - Use `readdir(dir, { withFileTypes: true })` and `readFile`.
  - Skip any `Dirent` whose name starts with `.`, and any that `isSymbolicLink()`.
  - Validate the prefix with `validatePathSegments`.
  - Join each path with `/` using `relative()` and split on `sep`.

- [ ] **Step 4: Run to confirm they pass.** Run `rtk proxy pnpm run --filter @mokei/context-server-node test`.

- [ ] **Step 5: Commit.** `feat(context-server-node): load skills from disk`

### Task 6: Client skills support (`@mokei/context-client`)

**Files:**
- Create: `packages/context-client/src/skill-verification.ts`
- Modify:
  - `src/types.ts`: `ClientParams.skills?: boolean`
  - `src/client.ts`: the constructor declares `SKILLS`; add the methods
  - `src/errors.ts`
  - `src/index.ts`
- Test: `packages/context-client/test/skills.test.ts`, using an in-process server and client pair as `test/extensions.test.ts` does (build `context-server` first)

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:
  - `SkillVerificationReason = 'invalid-entry' | 'limits' | 'unlisted' | 'response' | 'size' | 'digest' | 'frontmatter'`
  - `class SkillVerificationError extends Error`, with `readonly reason: SkillVerificationReason` and `readonly uri: string`
  - `checkSkillEntry(entry: Skill): void`
  - `SkillFile = { uri: string; mimeType?: string; bytes: Uint8Array; text?: string }`
  - `ContextClient` methods:
    - `listSkills(params?: ListParams<ListSkillsRequest['params']>): Promise<ListSkillsResult>`
    - `getSkill(uri: string, options?: RequestOptions): Promise<GetSkillResult>`
    - `readResourceDirectory(params: ListParams<ReadResourceDirectoryRequest['params']>): Promise<ReadResourceDirectoryResult>`
    - `readSkillFile(entry: Skill, uri: string, options?: RequestOptions): Promise<SkillFile>`

- [ ] **Step 1: Write the failing tests.**
  - `checkSkillEntry rejects hostile entries` (Review Focus 1). Each of these throws `invalid-entry`:
    - `size: -1`;
    - `size: 2**53`;
    - digest `sha256:` plus 64 uppercase hex characters;
    - an empty `description`;
    - `uri` not ending in `/SKILL.md`;
    - the name segment not equal to `frontmatter.name`;
    - `resources` missing its own `uri`;
    - `uri` listed twice;
    - a file outside the skill root;
    - a URI containing `..` or `%2F`.

    Each of these throws `limits`: 513 entries, or a total over 16,777,216.
  - `readSkillFile verifies` against a real catalog server. It returns bytes equal to the served ones, and `text` for an `.md` file. Also:
    - an unlisted URI gives `unlisted`, and nothing is sent on the wire;
    - an entry whose digest was altered gives `digest`;
    - an altered size gives `size`;
    - an entry whose frontmatter was altered gives `frontmatter` on `SKILL.md`.
  - `readSkillFile rejects ambiguous responses`, using a fake server that answers `resources/read` itself. Each gives `response`:
    - two `contents`;
    - a `contents[0].uri` that doesn't match;
    - both `text` and `blob`.
  - `dynamic entries`:
    - any URI within the root is read;
    - `SKILL.md` frontmatter is still checked;
    - a URI outside the root gives `unlisted`.
  - `gates`:
    - with `skills` not enabled, `listSkills` throws `MethodNotInRevisionError`;
    - a server without skills gives `ExtensionNotDeclaredError`, with no request written (Review Focus 4);
    - against a server with `directoryRead` off, `readResourceDirectory` is refused locally;
    - on `2025-11-25`, `listSkills` is refused locally.
  - `skills: true declares the extension` as `{}` in the request `_meta` capabilities on `2026-07-28`.
  - `listSkills walks pages`: two pages from a fake server are merged under `skills`.
  - `no eager reads`: the server records no `resources/read` across `listSkills` and `getSkill`.

- [ ] **Step 2: Run to confirm they fail.**

- [ ] **Step 3: Implement.**
  - The methods await `#ready`, then `#requireServerExtensionAsync(SKILLS, options)`.
  - `readResourceDirectory` additionally checks `(await this.getServerExtension(SKILLS))?.directoryRead === true`. If not, it throws `ExtensionNotDeclaredError` with an `extension` value of `io.modelcontextprotocol/skills#directoryRead`.
  - `readSkillFile`:
    1. `checkSkillEntry`;
    2. the manifest check, or the root check for a dynamic entry;
    3. `this.readResource({ uri })`;
    4. strict content selection;
    5. the bytes are `fromB64(blob)`, or `new TextEncoder().encode(text)`;
    6. size, then `computeDigest`;
    7. for `SKILL.md`, `frontmatterEquals(parseSkillFrontmatter(decodeExactUTF8(bytes)), entry.frontmatter)`. Undecodable bytes give `frontmatter`.

    Return `text` from `decodeExactUTF8(bytes)` only when the server sent `text`.
  - Remove the `biome-ignore` on `#requireServerExtensionAsync`, now that it has callers.

- [ ] **Step 4: Run to confirm they pass.** Run the full `@mokei/context-client` suite.

- [ ] **Step 5: Commit.** `feat(context-client): skills methods and verified file reads`

### Task 7: Docs, changeset, follow-on backlog

**Files:**
- Modify:
  - `packages/context-server/README.md`, `packages/context-client/README.md`, `packages/context-server-node/README.md`: a Skills section each, with a minimal example
  - `docs/agents/architecture.md`: an extensions section noting Skills on `2026-07-28` and `clientDeclaration: 'none'`
  - `docs/agents/plans/backlog/2026-11-25-mcp-extensions.md`, item 3: base support is done; the session, agent and host integration stays as a follow-on, listing the spec's host MUSTs from the design's Non-goals
- Create: `.changeset/skills-extension.md`, with `patch` for `@mokei/context-protocol`, `@mokei/context-server`, `@mokei/context-server-node` and `@mokei/context-client`

- [ ] **Step 1:** Write the docs and the changeset. No `/Users/`, worktree or scratchpad paths.
- [ ] **Step 2:** Run `rtk proxy pnpm run build`, `rtk proxy pnpm run lint`, and `rtk proxy pnpm run --no-bail -r test`. Expected: all green.
- [ ] **Step 3: Commit.** `docs: skills extension`
