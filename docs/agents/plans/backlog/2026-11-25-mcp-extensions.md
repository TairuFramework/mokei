# MCP extensions support

Official MCP extensions (https://modelcontextprotocol.io/extensions/overview) not yet supported,
in priority order. Tasks (`io.modelcontextprotocol/tasks`) is already fully supported.

Each item is its own plan; item 1 is a prerequisite for the others.

## 1. Generic extension plumbing

Today only tasks can be declared: `ContextServer` sets `capabilities.extensions` for tasks alone,
and `ContextClient` derives its capabilities from the handlers it is given, adding tasks itself.

- `extensions` param on `ContextServer` and `ContextClient` to declare extension identifiers with
  their settings objects.
- Settings-aware helpers generalising `declaresTasksExtension` (per-request client capabilities on
  the server; discovered server capabilities on the client).
- Carry `capabilities.extensions` through `initialize` on `2025-11-25` (initialization-based
  negotiation), not only through `_meta` / `server/discover` on `2026-07-28`.
- Honour the settings `revision` rule: a peer receiving an unknown `revision` does not enable the
  extension.
- Make the client's tasks declaration configurable. It is currently always declared on
  `2026-07-28`, while the spec says extensions are disabled by default and require explicit
  opt-in. Keeping it on by default is acceptable since `task-waiter` handles it transparently.

## 2. OAuth Client Credentials

`io.modelcontextprotocol/oauth-client-credentials` (Stable, ext-auth).

- `http-client` OAuth middleware only acts as a public PKCE client.
- Add the `client_credentials` grant with `client_secret_basic` and `private_key_jwt` client
  authentication, for headless use (CLI, flow daemon, CI).

## 3. Skills over MCP

`io.modelcontextprotocol/skills` (Beta, SEP-2640 Final).

- Server: register skills, implement `skills/list` and `skills/get`, serve files via
  `resources/read` (`skill://` scheme), manifests with SHA-256 digest and byte size per file,
  `resultType` / `ttlMs` / `cacheScope` on results. Optional `resources/directory/read` behind
  `directoryRead: true`.
- Client: list/get skills, verify digests, sizes and frontmatter before use, restrict reads to the
  retained manifest, preserve server identity + URI.
- Session / agent layer: on-demand loading with approval bound to the manifest; never prefetch
  files.

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
