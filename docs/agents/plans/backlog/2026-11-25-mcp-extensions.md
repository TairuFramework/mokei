# MCP extensions support

Official MCP extensions (https://modelcontextprotocol.io/extensions/overview) not yet supported,
in priority order. Tasks (`io.modelcontextprotocol/tasks`) is already fully supported.

Each item is its own plan; item 1 is a prerequisite for the others.

## 1. Generic extension plumbing

Done: `docs/agents/plans/completed/2026-11-25-extension-plumbing.complete.md`.

## 2. OAuth Client Credentials

Done for `private_key_jwt`: `docs/agents/plans/completed/2026-11-25-oauth-client-credentials.complete.md`.

- Deferred, add on concrete demand, keeping the pinned-issuer and store-key rules:
  - `client_secret_basic` / `client_secret_post` client authentication (scoped out: JWT only).
  - RSA (`RS256`) keys and PEM import (scoped out: kokuin's `EdDSA` and `ES256` only).

## 3. Skills over MCP

`io.modelcontextprotocol/skills` (Beta, SEP-2640 Final).

Base client and server support is implemented on the `mcp-extensions` branch: `skills/list` and
`skills/get`, `skill://` files via `resources/read` with digest and size manifests, optional
`resources/directory/read` (`directoryRead: true`), disk loading in `context-server-node`, and a
verifying client (`readSkillFile`, `SkillVerificationError`).

Remaining follow-on work:

- Session, agent and host integration:
  - registries keyed by server label + URI;
  - user approval bound to the manifest, including activation of nested skills;
  - caches;
  - origin tagging and cross-server read rules;
  - the `allowed-tools` and code-execution gates;
  - offering skills to models in the CLI and host-desktop.
  - Keep on-demand loading: never prefetch files.
- Dynamic skills on the server (`"resources": "dynamic"`); the client already accepts them.
- Skill files in `resources/list` (`skills/list` stays the discovery path until then).
- Per-skill or per-URI auth scopes; today one catalog-wide scope list.
- Protocol revision `2025-11-25` support for the extension methods.

## 4. Events

`io.modelcontextprotocol/events` (Beta, SEP-3415 Final). Requires `2026-07-28`.

- `events/list` with `inputSchema`, `payloadSchema` and `delivery` per event type;
  `notifications/events/list_changed`.
- Poll (`events/poll`) and push (`events/stream`) first.
- Webhook (`events/subscribe`) later: Standard Webhooks HMAC signing, `https` callbacks, endpoint
  verification and SSRF protection in `http-server`.
- Cursors with `truncated` and `maxAgeMs`, `eventId` dedup; payloads are untrusted input.
- Natural consumers: flow daemon, mcp-notify, unattended agents.

## 5. MCP Apps (server side)

`io.modelcontextprotocol/ui` (Stable, ext-apps).

- Server helpers: tool `_meta.ui.resourceUri`, `ui://` resources with
  `text/html;profile=mcp-app`, `_meta.ui.csp` / `permissions`.
- Host-side rendering (sandboxed iframe + postMessage `ui/*` dialect) only if `host-desktop`
  should render apps; out of scope until then.

## Parked

- **Server Cards** (Beta, destination not stated): `.well-known` metadata discovery in
  `http-server`. Revisit once the spec settles.
- **Enterprise-Managed Authorization** (Stable): RFC 8693 token exchange for an ID-JAG, then the
  `jwt-bearer` grant, plus enterprise IdP configuration. Revisit on concrete demand.
- **Experimental extensions** (interceptors, variants, tool-annotations, file-uploads,
  filesystems): no stability guarantees; wait for Beta.

