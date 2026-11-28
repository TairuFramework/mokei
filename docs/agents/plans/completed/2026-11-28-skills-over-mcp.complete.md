# Skills over MCP: base client and server support

**Status:** complete (2026-11-28)

Item 3 of the MCP extensions backlog (`docs/agents/plans/backlog/2026-11-25-mcp-extensions.md`). Implements `io.modelcontextprotocol/skills` (Beta, SEP-2640 Final; https://modelcontextprotocol.io/extensions/skills/overview) at the protocol level: a server publishes skills, and a client discovers them and reads their files with the integrity checks the spec requires. Session, agent and host integration stays in the backlog item.

## Approach

Three options were considered: skills defined in code only; code plus a disk loader; or skills as plain resources with no extension methods (rejected, not spec-conformant). The second was picked. The core catalog is portable with no file-system access; the disk loader is Node-only in `@mokei/context-server-node`. No new package.

## What was built

- **`@mokei/context-protocol`:**
  - Wire schemas and types for `skills/list`, `skills/get` and `resources/directory/read`, on revision `2026-07-28` only.
  - A `SKILLS` registry entry. Server settings are `{}` or `{ directoryRead: true }`.
  - Shared helpers in `skill-format.ts`, used by both server and client and never copied: `SKILL_LIMITS` (512 files, 16,777,216 bytes per skill, `SKILL.md` included), WebCrypto `sha256:` digests, name rules, path-segment validation, the URI builder, strict UTF-8 decoding, and frontmatter parsing, validation and equality.
- **`@mokei/context-server`:** `createSkillCatalog` and the `skills` server param.
  - The catalog answers the three extension methods and serves `skill://` files through `resources/read`.
  - Directory reads are on only with `directoryRead: true`.
  - Catalog scopes apply to catalog requests.
- **`@mokei/context-server-node`:** `loadSkillDefinitions` and `loadSkillCatalog` read skill folders from disk. Dotfiles and symlinks are skipped, empty directories are recorded, and output is sorted.
- **`@mokei/context-client`:**
  - A `skills: true` option, plus `listSkills`, `getSkill`, `readResourceDirectory` and `readSkillFile`.
  - `readSkillFile` checks every file against the entry the caller holds, and throws `SkillVerificationError` with a `reason` on any failure.

## Key decisions

- **No client declaration.** The spec has clients declare nothing. They call the methods once the server declares the extension. The registry gained `clientDeclaration: 'none'`, and the server gate skips its `MISSING_REQUIRED_CLIENT_CAPABILITY` check for such extensions.
- **Verified reads only, and on demand only.** The client never returns file content without checking it, and never prefetches: nothing is read on connect, on listing or on `skills/get`. `readSkillFile` runs these checks in order:
  1. A runtime check of the whole entry (`checkSkillEntry`), because TypeScript types don't check what a server sends. Sizes must be non-negative safe integers. Digests must match `^sha256:[0-9a-f]{64}$`. The skill URI must have at least two segments and end in `/SKILL.md`, so containment can't widen to the whole scheme.
  2. A check that the requested URI is listed in the entry, before any request is sent.
  3. Strict selection of the response: exactly one content item, with the requested URI and exactly one of `text` or `blob`.
  4. Size, then digest, over the bytes received.
  5. For `SKILL.md`, a strict check that its frontmatter equals the entry's. The frontmatter is parsed from a decode of the verified bytes.

  Some malformed responses are refused earlier by the wire validator, as `RPCError('Invalid response')`.
- **Byte-exact serving.** The catalog hashes each file's original bytes and serves exactly those bytes. A file goes out as `text` only when it decodes as strict UTF-8 and re-encodes to identical bytes, with any BOM kept. Otherwise it goes out as a base64 `blob`. This is decided once, when the catalog is built.
- **One path rule.** Every path segment must be non-empty, must not be `.` or `..`, and may contain only RFC 3986 `pchar` characters other than `%`. URIs are joined with `/` and never escaped. A name that would need escaping, such as one with a space or non-ASCII characters, is rejected when the catalog loads. It is not encoded, because a single bad URI would fail the `format: 'uri'` wire check and hide every skill on the server.
- **Frontmatter:** YAML 1.2 with the `core` schema, compared as plain JSON values. The server validates fields against the Agent Skills format before publishing and keeps unknown fields. A server that renders frontmatter under YAML 1.1 rules (such as `yes` for `true`) fails verification, and that is documented as known behaviour.
- **Catalog ownership.** When a catalog is configured, it answers every `skill://` URI. Nested skills share one file store keyed by URI. The catalog refuses an incomplete enclosing manifest, conflicting bytes for the same URI, and a URI that is both a file and a directory. Errors are `SkillFormatError`, naming the skill path.
- **Skills-only servers** declare `resources: {}` and answer the resource list methods with empty pages.
- **On `2025-11-25`:** the three methods and the declaration are absent, but `skill://` files are still readable as ordinary resources.
- **Error codes:** an unknown skill, an unknown file, or a URI that isn't a directory returns `-32602`, with the spec's messages.
