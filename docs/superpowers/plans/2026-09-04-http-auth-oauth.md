# HTTP transport auth — OAuth + JWT Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Stage:** executing
**Mode:** tasks

**Goal:** Add OAuth 2.1 authorization to mokei's HTTP transport — a native client-side flow (discovery → PKCE → token → refresh → 401 re-auth) and server-side bearer verification for `@mokei/http-server`.

**Architecture:** A single option-agnostic fetch-middleware seam on `HTTPTransport` carries the client OAuth flow, implemented natively on the Kigu stack (no MCP SDK, no `jose`; WebCrypto + `@sozai/codec` only). The server gains a pluggable `OAuthTokenVerifier` with two shipped implementations (external-IdP JWKS via WebCrypto, stack-native DID via `@kokuin/token`), a `requireBearerAuth` gate that works in both serving modes, and an RFC 9728 metadata endpoint. Node-only interactive pieces (loopback authorize handler, file token store) live in `@mokei/host-node`.

**Tech Stack:** TypeScript, WebCrypto (`crypto.subtle`), `@sozai/codec` (base64url), `@kokuin/token` (DID verifier only), hono (`@mokei/http-server`), `nano-spawn` (browser launch), vitest.

**Spec:** `docs/superpowers/specs/2026-09-04-http-auth-oauth-design.md` — the plan argues from the spec; executors read both.

## Global Constraints

- **Conventions:** the `kigu:conventions` skill (canonical). Match surrounding code style.
- **Package manager:** `pnpm`/`pnpx` only — never `npm`/`npx`. New workspace deps use `catalog:` or `workspace:^`.
- **No new package.** Client OAuth core → `@mokei/http-client`; Node interactive → `@mokei/host-node`; server auth → `@mokei/http-server`.
- **Catalog additions (verified missing, add once to `pnpm-workspace.yaml` under `catalog:`):** `'@sozai/codec': ^0.4.0` (Tasks 2, 9) and `'@kokuin/token': ^0.5.0` (Task 11). Then reference as `"@sozai/codec": "catalog:"` / `"@kokuin/token": "catalog:"` in the package's dependencies and run `pnpm install`. `@kokuin/token`'s `verifyToken(token)` returns `Token<Payload>` with `.payload` (a record carrying `.iss`) — confirmed against `../kokuin/packages/token/src/token.ts`.
- **No new client JWT dependency.** The client flow signs nothing. Client uses only WebCrypto + `@sozai/codec`. `@kokuin/token` is a `@mokei/http-server` dependency (DID verifier) only.
- **Running tests:** run vitest directly to avoid the `rtk` shim — `cd packages/<pkg> && pnpm exec vitest run test/<file>.test.ts`. Do **not** use `pnpm run test` for a single file.
- **Lint/format:** `rtk proxy pnpm run lint` (never bare `pnpm lint`), or `pnpm exec biome check --write <files>`.
- **Tests live in** `packages/<pkg>/test/*.test.ts`; import source as `../src/<file>.js`; framework is `vitest` (`describe/test/expect`, `vi` for stubs).
- **MCP revisions** `2025-11-25` and `2026-07-28` both remain served; auth is orthogonal to revision.
- **Transport fetch sites** to route through the seam: `packages/http-client/src/transport.ts:338` (refresh), `:682` (POST), `:978` (GET), `:1081` (DELETE).
- **Canonical resource** (RFC 8707): scheme + host + port + path of the transport `url`, no query/fragment. Same value is the client `resource` param, the `TokenStore` key, the verifier audience, and the metadata `resource`.
- **Verifier invariants (normative for every verifier):** signature, `iss`, `aud` (= `ctx.resource`), `exp`, `nbf` (± clock tolerance).

---

### Task 1: Fetch-middleware seam on `HTTPTransport` (Unit A)

**Files:**
- Modify: `packages/http-client/src/transport.ts` (add `fetchMiddleware` param + `#fetch`; route 4 fetch sites; static-auth guard; `HTTP_TRANSPORT_PARAM_KEYS`)
- Test: `packages/http-client/test/fetch-middleware.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type FetchLike = (url: string, init?: RequestInit) => Promise<Response>`
  - `type FetchMiddleware = (next: FetchLike) => FetchLike`
  - `HTTPTransportParams.fetchMiddleware?: FetchMiddleware`
  - Exported from `@mokei/http-client`: `FetchLike`, `FetchMiddleware`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/http-client/test/fetch-middleware.test.ts
import { afterEach, describe, expect, test, vi } from 'vitest'
import { HTTPTransport, type FetchMiddleware } from '../src/transport.js'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('fetchMiddleware', () => {
  afterEach(() => vi.unstubAllGlobals())

  test('routes POST sends through the supplied middleware', async () => {
    const seen: string[] = []
    const middleware: FetchMiddleware = (next) => async (url, init) => {
      seen.push(String((JSON.parse(String(init?.body)) as { method?: string }).method))
      return next(url, init)
    }
    const global = vi.fn(async () => jsonResponse({ jsonrpc: '2.0', id: 0, result: {} }))
    vi.stubGlobal('fetch', global)

    const transport = new HTTPTransport({ url: 'https://example.test/mcp', fetchMiddleware: middleware })
    await transport.write({ jsonrpc: '2.0', id: 0, method: 'ping' } as never)

    expect(seen).toContain('ping')
    expect(global).toHaveBeenCalledOnce()
    await transport.dispose()
  })

  test('throws when static auth and an Authorization-setting middleware both given', () => {
    const middleware: FetchMiddleware = (next) => next
    expect(
      () =>
        new HTTPTransport({
          url: 'https://example.test/mcp',
          auth: { type: 'bearer', token: 'x' },
          fetchMiddleware: middleware,
        }),
    ).toThrow(/mutually exclusive|both/i)
  })
})
```

> Note: `transport.write(...)` drives the writable sink (see `HTTPTransport`'s `writeTo` wiring). If the existing tests use a different drive helper, match theirs.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/http-client && pnpm exec vitest run test/fetch-middleware.test.ts`
Expected: FAIL — `fetchMiddleware` not a known param / no `FetchMiddleware` export.

- [ ] **Step 3: Implement**

In `transport.ts`:
1. Add near the top-level types:
```ts
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>
export type FetchMiddleware = (next: FetchLike) => FetchLike
```
2. Add to `HTTPTransportParams`:
```ts
  /** Wraps the transport's fetch (e.g. OAuth). Composed once over globalThis.fetch. */
  fetchMiddleware?: FetchMiddleware
```
3. Add a field `#fetch: FetchLike` and set it in the constructor:
```ts
const baseFetch: FetchLike = (url, init) => globalThis.fetch(url, init)
this.#fetch = params.fetchMiddleware ? params.fetchMiddleware(baseFetch) : baseFetch
```
4. Static-auth guard in the constructor, before building headers — reject the combination that would set `Authorization` twice. Static `header`/`basic`/`bearer` with a middleware present:
```ts
if (params.fetchMiddleware && params.auth && params.auth.type !== 'header') {
  throw new Error('Static `auth` and `fetchMiddleware` are mutually exclusive (both set Authorization)')
}
```
5. Replace the four `fetch(this.#url, …)` / `fetch(this.#url, …)` calls at lines 338, 682, 978, 1081 with `this.#fetch(this.#url, …)`.
6. Add `fetchMiddleware: true` to `HTTP_TRANSPORT_PARAM_KEYS`.
7. Export `FetchLike`, `FetchMiddleware` from `src/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/http-client && pnpm exec vitest run test/fetch-middleware.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full package suite (no regressions on the 4 sites)**

Run: `cd packages/http-client && pnpm exec vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/http-client/src/transport.ts packages/http-client/src/index.ts packages/http-client/test/fetch-middleware.test.ts
git commit -m "feat(http-client): add fetchMiddleware seam to HTTPTransport"
```

---

### Task 2: PKCE + canonical-resource utilities (Unit B)

**Files:**
- Create: `packages/http-client/src/oauth/pkce.ts`
- Create: `packages/http-client/src/oauth/resource.ts`
- Test: `packages/http-client/test/oauth-pkce.test.ts`
- Modify: `packages/http-client/package.json` (add `@sozai/codec`)

**Interfaces:**
- Produces:
  - `createPKCE(): Promise<{ verifier: string; challenge: string; method: 'S256' }>`
  - `challengeFromVerifier(verifier: string): Promise<string>`
  - `canonicalResource(url: string): string`

- [ ] **Step 1: Write the failing test (RFC 7636 Appendix B vector)**

```ts
// packages/http-client/test/oauth-pkce.test.ts
import { describe, expect, test } from 'vitest'
import { challengeFromVerifier, createPKCE } from '../src/oauth/pkce.js'
import { canonicalResource } from '../src/oauth/resource.js'

describe('PKCE', () => {
  test('matches the RFC 7636 Appendix B test vector', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    expect(await challengeFromVerifier(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  test('createPKCE returns S256 with a matching challenge', async () => {
    const { verifier, challenge, method } = await createPKCE()
    expect(method).toBe('S256')
    expect(await challengeFromVerifier(verifier)).toBe(challenge)
  })
})

describe('canonicalResource', () => {
  test('drops query and fragment, keeps scheme host port path', () => {
    expect(canonicalResource('https://mcp.example.com/mcp?x=1#y')).toBe('https://mcp.example.com/mcp')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/http-client && pnpm exec vitest run test/oauth-pkce.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement**

Add dep to `packages/http-client/package.json` dependencies: `"@sozai/codec": "catalog:"`. Run `pnpm install` at repo root.

```ts
// packages/http-client/src/oauth/pkce.ts
import { toB64U } from '@sozai/codec'

export type PKCE = { verifier: string; challenge: string; method: 'S256' }

export async function challengeFromVerifier(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return toB64U(new Uint8Array(digest))
}

export async function createPKCE(): Promise<PKCE> {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const verifier = toB64U(bytes)
  return { verifier, challenge: await challengeFromVerifier(verifier), method: 'S256' }
}
```

```ts
// packages/http-client/src/oauth/resource.ts
/** Canonical MCP resource (RFC 8707): scheme + host + port + path, no query/fragment. */
export function canonicalResource(url: string): string {
  const u = new URL(url)
  u.search = ''
  u.hash = ''
  // Preserve an explicit trailing slash only when the path is exactly '/'.
  return u.toString().replace(/\/$/, u.pathname === '/' ? '/' : '')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/http-client && pnpm exec vitest run test/oauth-pkce.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/http-client/src/oauth/pkce.ts packages/http-client/src/oauth/resource.ts packages/http-client/test/oauth-pkce.test.ts packages/http-client/package.json pnpm-lock.yaml
git commit -m "feat(http-client): PKCE S256 and canonical-resource helpers"
```

---

### Task 3: OAuth discovery + validation (Unit B)

**Files:**
- Create: `packages/http-client/src/oauth/discovery.ts`
- Test: `packages/http-client/test/oauth-discovery.test.ts`

**Interfaces:**
- Consumes: `FetchLike` (Task 1), `canonicalResource` (Task 2).
- Produces:
  - `type ProtectedResourceMetadata = { resource: string; authorization_servers: string[] }`
  - `type AuthServerMetadata = { issuer: string; authorization_endpoint: string; token_endpoint: string; code_challenge_methods_supported?: string[] }`
  - `parseResourceMetadataUrl(wwwAuthenticate: string | null): string | null`
  - `discover(params: { resource: string; resourceMetadataUrl?: string; fetch: FetchLike; selectAuthServer?: (servers: string[]) => string }): Promise<{ prm: ProtectedResourceMetadata; as: AuthServerMetadata }>`

- [ ] **Step 1: Write the failing test**

```ts
// packages/http-client/test/oauth-discovery.test.ts
import { describe, expect, test } from 'vitest'
import { discover, parseResourceMetadataUrl } from '../src/oauth/discovery.js'

const resource = 'https://mcp.example.com/mcp'

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

test('parses resource_metadata from WWW-Authenticate', () => {
  const header = 'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"'
  expect(parseResourceMetadataUrl(header)).toBe('https://mcp.example.com/.well-known/oauth-protected-resource/mcp')
})

test('discovers and validates PRM resource + AS issuer', async () => {
  const fetch = async (url: string): Promise<Response> => {
    if (url.includes('oauth-protected-resource')) {
      return json({ resource, authorization_servers: ['https://as.example.com'] })
    }
    if (url === 'https://as.example.com/.well-known/oauth-authorization-server') {
      return json({
        issuer: 'https://as.example.com',
        authorization_endpoint: 'https://as.example.com/authorize',
        token_endpoint: 'https://as.example.com/token',
        code_challenge_methods_supported: ['S256'],
      })
    }
    throw new Error(`unexpected ${url}`)
  }
  const { prm, as } = await discover({ resource, fetch })
  expect(prm.resource).toBe(resource)
  expect(as.issuer).toBe('https://as.example.com')
})

test('rejects PRM whose resource does not match', async () => {
  const fetch = async (): Promise<Response> => json({ resource: 'https://evil.test', authorization_servers: ['https://as.example.com'] })
  await expect(discover({ resource, resourceMetadataUrl: 'https://mcp.example.com/.well-known/oauth-protected-resource/mcp', fetch })).rejects.toThrow(/resource/i)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/http-client && pnpm exec vitest run test/oauth-discovery.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// packages/http-client/src/oauth/discovery.ts
import type { FetchLike } from '../transport.js'

export type ProtectedResourceMetadata = { resource: string; authorization_servers: string[] }
export type AuthServerMetadata = {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  code_challenge_methods_supported?: string[]
}

export function parseResourceMetadataUrl(header: string | null): string | null {
  if (!header) return null
  const match = /resource_metadata="([^"]+)"/.exec(header)
  return match ? match[1] : null
}

function requireHttps(url: string): void {
  const u = new URL(url)
  const local = u.hostname === '127.0.0.1' || u.hostname === 'localhost'
  if (u.protocol !== 'https:' && !local) throw new Error(`OAuth endpoint must be https: ${url}`)
}

function wellKnownPRM(resource: string): string {
  const u = new URL(resource)
  const path = u.pathname === '/' ? '' : u.pathname
  return `${u.origin}/.well-known/oauth-protected-resource${path}`
}

export async function discover(params: {
  resource: string
  resourceMetadataUrl?: string
  fetch: FetchLike
  selectAuthServer?: (servers: string[]) => string
}): Promise<{ prm: ProtectedResourceMetadata; as: AuthServerMetadata }> {
  const prmUrl = params.resourceMetadataUrl ?? wellKnownPRM(params.resource)
  requireHttps(prmUrl)
  const prmRes = await params.fetch(prmUrl)
  if (!prmRes.ok) throw new Error(`protected-resource metadata HTTP ${prmRes.status}`)
  const prm = (await prmRes.json()) as ProtectedResourceMetadata
  if (prm.resource !== params.resource) {
    throw new Error(`metadata resource ${prm.resource} != requested ${params.resource}`)
  }
  if (!Array.isArray(prm.authorization_servers) || prm.authorization_servers.length === 0) {
    throw new Error('metadata has no authorization_servers')
  }
  const issuer = (params.selectAuthServer ?? ((s) => s[0]))(prm.authorization_servers)
  requireHttps(issuer)
  const asUrl = `${issuer.replace(/\/$/, '')}/.well-known/oauth-authorization-server`
  const asRes = await params.fetch(asUrl)
  if (!asRes.ok) throw new Error(`authorization-server metadata HTTP ${asRes.status}`)
  const as = (await asRes.json()) as AuthServerMetadata
  if (as.issuer !== issuer) throw new Error(`AS issuer ${as.issuer} != ${issuer}`)
  requireHttps(as.authorization_endpoint)
  requireHttps(as.token_endpoint)
  const methods = as.code_challenge_methods_supported
  if (methods && !methods.includes('S256')) throw new Error('AS does not support PKCE S256')
  return { prm, as }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/http-client && pnpm exec vitest run test/oauth-discovery.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/http-client/src/oauth/discovery.ts packages/http-client/test/oauth-discovery.test.ts
git commit -m "feat(http-client): OAuth discovery with RFC 9728/8414 validation"
```

---

### Task 4: `TokenStore` interface + in-memory default (Unit B)

**Files:**
- Create: `packages/http-client/src/oauth/store.ts`
- Test: `packages/http-client/test/oauth-store.test.ts`

**Interfaces:**
- Produces:
  - `type StoredTokens = { accessToken: string; tokenType: string; refreshToken?: string; expiresAt?: number; scope?: string }`
  - `interface TokenStore { get(key: string): Promise<StoredTokens | undefined>; set(key: string, tokens: StoredTokens): Promise<void>; clear(key: string): Promise<void> }`
  - `createMemoryTokenStore(): TokenStore`

- [ ] **Step 1: Write the failing test**

```ts
// packages/http-client/test/oauth-store.test.ts
import { describe, expect, test } from 'vitest'
import { createMemoryTokenStore } from '../src/oauth/store.js'

test('memory store round-trips and clears', async () => {
  const store = createMemoryTokenStore()
  await store.set('k', { accessToken: 'a', tokenType: 'Bearer' })
  expect((await store.get('k'))?.accessToken).toBe('a')
  await store.clear('k')
  expect(await store.get('k')).toBeUndefined()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/http-client && pnpm exec vitest run test/oauth-store.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// packages/http-client/src/oauth/store.ts
export type StoredTokens = {
  accessToken: string
  tokenType: string
  refreshToken?: string
  expiresAt?: number
  scope?: string
}

export interface TokenStore {
  get(key: string): Promise<StoredTokens | undefined>
  set(key: string, tokens: StoredTokens): Promise<void>
  clear(key: string): Promise<void>
}

export function createMemoryTokenStore(): TokenStore {
  const map = new Map<string, StoredTokens>()
  return {
    async get(key) {
      return map.get(key)
    },
    async set(key, tokens) {
      map.set(key, tokens)
    },
    async clear(key) {
      map.delete(key)
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/http-client && pnpm exec vitest run test/oauth-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/http-client/src/oauth/store.ts packages/http-client/test/oauth-store.test.ts
git commit -m "feat(http-client): TokenStore interface + in-memory default"
```

---

### Task 5: OAuth middleware — token attach, expiry, refresh (Unit B, part 1)

**Files:**
- Create: `packages/http-client/src/oauth/middleware.ts`
- Test: `packages/http-client/test/oauth-middleware-refresh.test.ts`

**Interfaces:**
- Consumes: `FetchLike`/`FetchMiddleware` (Task 1), `TokenStore`/`StoredTokens` (Task 4), `canonicalResource` (Task 2).
- Produces:
  - `interface AuthorizationHandler { authorize(params: { buildAuthorizationUrl(redirectUri: string): string; state: string }): Promise<{ code: string; state: string; redirectUri: string }> }`
  - `type OAuthClientConfig = { clientId: string; scopes?: string[]; resource?: string; handler: AuthorizationHandler; store?: TokenStore; clockSkewSeconds?: number; now?: () => number }`
  - `createOAuthMiddleware(config: OAuthClientConfig): FetchMiddleware`
  - Internal (exported for tests): `exchangeRefresh(...)`, `nearExpiry(tokens, now, skew)`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/http-client/test/oauth-middleware-refresh.test.ts
import { describe, expect, test } from 'vitest'
import { createOAuthMiddleware, type AuthorizationHandler } from '../src/oauth/middleware.js'
import { createMemoryTokenStore } from '../src/oauth/store.js'

const resource = 'https://mcp.example.com/mcp'
const handler: AuthorizationHandler = {
  async authorize() {
    throw new Error('should not authorize when a valid refresh token exists')
  },
}

test('attaches the stored access token as Bearer', async () => {
  const store = createMemoryTokenStore()
  await store.set(resource, { accessToken: 'tok', tokenType: 'Bearer', expiresAt: 9_999_999_999 })
  const mw = createOAuthMiddleware({ clientId: 'c', resource, handler, store, now: () => 1000 })
  let seenAuth: string | null = null
  const next = async (_url: string, init?: RequestInit): Promise<Response> => {
    seenAuth = new Headers(init?.headers).get('Authorization')
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  await mw(next)(resource, { method: 'POST', body: '{}' })
  expect(seenAuth).toBe('Bearer tok')
})

test('pre-emptively refreshes an access token near expiry', async () => {
  const store = createMemoryTokenStore()
  await store.set(resource, { accessToken: 'old', tokenType: 'Bearer', refreshToken: 'r1', expiresAt: 1000 })
  let tokenCalls = 0
  const next = async (url: string, init?: RequestInit): Promise<Response> => {
    if (url.endsWith('/token')) {
      tokenCalls += 1
      return new Response(JSON.stringify({ access_token: 'new', token_type: 'Bearer', expires_in: 3600, refresh_token: 'r2' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json', Authorization: '' } })
  }
  const mw = createOAuthMiddleware({
    clientId: 'c', resource, handler, store, now: () => 999,
    // inject token endpoint so this test needs no discovery
    // (see implementation note: config may accept a pre-resolved tokenEndpoint for refresh)
  } as never)
  // drive one request; expect refresh to have run and rotated the token
  await mw(next)(resource, { method: 'POST', body: '{}' })
  expect(tokenCalls).toBe(1)
  expect((await store.get(resource))?.accessToken).toBe('new')
  expect((await store.get(resource))?.refreshToken).toBe('r2')
})
```

> Implementation note: the refresh path needs a token endpoint. Cache the discovered `AuthServerMetadata` in the middleware after the first authorize, and persist the `token_endpoint`/`issuer` alongside tokens (extend `StoredTokens` with optional `tokenEndpoint?: string` and `issuer?: string`, or hold an in-middleware discovery cache keyed by resource). Choose one and keep it internal; the test above tolerates either by allowing config injection. If you extend `StoredTokens`, update Task 4's type and the file store (Task 8).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/http-client && pnpm exec vitest run test/oauth-middleware-refresh.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `middleware.ts` with:
- `nearExpiry(tokens, now, skew)`: `tokens.expiresAt != null && tokens.expiresAt - skew <= now()` (seconds).
- `exchangeRefresh(fetchUnwrapped, tokenEndpoint, { clientId, resource, refreshToken, scopes })`: POST `application/x-www-form-urlencoded` body `grant_type=refresh_token&refresh_token=…&client_id=…&resource=…`; on success map `{ access_token, token_type, expires_in, refresh_token, scope }` to `StoredTokens` (`expiresAt = now()+expires_in`); rotate `refreshToken` (fall back to the old one if the response omits it); reject a non-bearer `token_type`.
- `createOAuthMiddleware(config)`: returns `(next) => async (url, init)`:
  1. read `store.get(resource)`; if present and `nearExpiry`, refresh (single-flight — see Task 6), persist.
  2. attach `Authorization: Bearer <accessToken>` (clone `init.headers` into a `Headers`).
  3. call `next(url, init)`.
  4. (401 handling added in Task 6.)
- The **unwrapped** fetch used for token/refresh/discovery is `next` (never the middleware).

Store `token_endpoint` + `issuer` in the middleware's per-resource discovery cache so refresh has an endpoint without re-discovery.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/http-client && pnpm exec vitest run test/oauth-middleware-refresh.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/http-client/src/oauth/middleware.ts packages/http-client/test/oauth-middleware-refresh.test.ts packages/http-client/src/oauth/store.ts
git commit -m "feat(http-client): OAuth middleware token attach + refresh"
```

---

### Task 6: OAuth middleware — 401 flow, PKCE authorize, state, single-flight (Unit B, part 2)

**Files:**
- Modify: `packages/http-client/src/oauth/middleware.ts`
- Test: `packages/http-client/test/oauth-middleware-authorize.test.ts`
- Modify: `packages/http-client/src/index.ts` (export OAuth surface)

**Interfaces:**
- Consumes: everything from Tasks 2–5.
- Produces (added exports on `@mokei/http-client`): `createOAuthMiddleware`, `AuthorizationHandler`, `OAuthClientConfig`, `TokenStore`, `StoredTokens`, `createMemoryTokenStore`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/http-client/test/oauth-middleware-authorize.test.ts
import { describe, expect, test } from 'vitest'
import { createOAuthMiddleware, type AuthorizationHandler } from '../src/oauth/middleware.js'
import { createMemoryTokenStore } from '../src/oauth/store.js'

const resource = 'https://mcp.example.com/mcp'

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

test('runs full authorize on 401 then retries with the new token', async () => {
  const store = createMemoryTokenStore()
  let capturedState = ''
  const handler: AuthorizationHandler = {
    async authorize({ buildAuthorizationUrl, state }) {
      capturedState = state
      const url = new URL(buildAuthorizationUrl('http://127.0.0.1:5555/cb'))
      // assert the core stamped the required params
      expect(url.searchParams.get('response_type')).toBe('code')
      expect(url.searchParams.get('code_challenge_method')).toBe('S256')
      expect(url.searchParams.get('resource')).toBe(resource)
      expect(url.searchParams.get('state')).toBe(state)
      return { code: 'auth-code', state, redirectUri: 'http://127.0.0.1:5555/cb' }
    },
  }

  let protectedCalls = 0
  const next = async (url: string, init?: RequestInit): Promise<Response> => {
    if (url.includes('oauth-protected-resource')) return json({ resource, authorization_servers: ['https://as.example.com'] })
    if (url.endsWith('/.well-known/oauth-authorization-server')) {
      return json({ issuer: 'https://as.example.com', authorization_endpoint: 'https://as.example.com/authorize', token_endpoint: 'https://as.example.com/token', code_challenge_methods_supported: ['S256'] })
    }
    if (url.endsWith('/token')) return json({ access_token: 'fresh', token_type: 'Bearer', expires_in: 3600 })
    // protected resource: 401 first, then 200 once Authorization present
    protectedCalls += 1
    const auth = new Headers(init?.headers).get('Authorization')
    if (auth === 'Bearer fresh') return json({ ok: true })
    return new Response('unauth', { status: 401, headers: { 'WWW-Authenticate': 'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"' } })
  }

  const mw = createOAuthMiddleware({ clientId: 'c', resource, handler, store })
  const res = await mw(next)(resource, { method: 'POST', body: '{}' })
  expect(res.status).toBe(200)
  expect(capturedState).not.toBe('')
  expect((await store.get(resource))?.accessToken).toBe('fresh')
})

test('rejects a state mismatch from the handler', async () => {
  const store = createMemoryTokenStore()
  const handler: AuthorizationHandler = {
    async authorize({ buildAuthorizationUrl }) {
      buildAuthorizationUrl('http://127.0.0.1:1/cb')
      return { code: 'c', state: 'WRONG', redirectUri: 'http://127.0.0.1:1/cb' }
    },
  }
  const next = async (url: string): Promise<Response> => {
    if (url.includes('oauth-protected-resource')) return json({ resource, authorization_servers: ['https://as.example.com'] })
    if (url.endsWith('/.well-known/oauth-authorization-server')) return json({ issuer: 'https://as.example.com', authorization_endpoint: 'https://as.example.com/authorize', token_endpoint: 'https://as.example.com/token' })
    return new Response('unauth', { status: 401, headers: { 'WWW-Authenticate': 'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"' } })
  }
  const mw = createOAuthMiddleware({ clientId: 'c', resource, handler, store })
  await expect(mw(next)(resource, { method: 'POST', body: '{}' })).rejects.toThrow(/state/i)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/http-client && pnpm exec vitest run test/oauth-middleware-authorize.test.ts`
Expected: FAIL — 401 flow not implemented.

- [ ] **Step 3: Implement**

Extend the middleware returned function:
- After `next(url, init)`, if `res.status === 401` and this request has not already retried:
  1. Acquire the **single-flight** lock for `resource` (a `Map<string, Promise<StoredTokens>>`). If a flight is in progress, await it; else start one.
  2. Inside the flight: re-check the store (a concurrent flight may have populated it). If still unauthenticated:
     - `parseResourceMetadataUrl(res.headers.get('WWW-Authenticate'))` → `discover({ resource, resourceMetadataUrl, fetch: next, selectAuthServer })`.
     - `createPKCE()`; generate a single-use `state` via `toB64U(crypto.getRandomValues(new Uint8Array(16)))`.
     - `buildAuthorizationUrl(redirectUri)` closure stamps: `response_type=code`, `client_id`, `redirect_uri`, `code_challenge`, `code_challenge_method=S256`, `state`, `scope` (space-joined, when set), `resource`, onto `as.authorization_endpoint`.
     - call `handler.authorize({ buildAuthorizationUrl, state })`.
     - **Validate** returned `state === state` (throw on mismatch); consume it.
     - token exchange (POST form to `as.token_endpoint`): `grant_type=authorization_code`, `code`, `redirect_uri` (the returned one), `client_id`, `code_verifier`, `resource`. No client secret / auth header.
     - map to `StoredTokens`, cache `token_endpoint`/`issuer`, `store.set(resource, …)`.
  3. Release the flight, resolve with the tokens.
  4. Re-attach `Authorization: Bearer <accessToken>` and call `next(url, init)` **once more** (bounded to a single retry).
- Refresh (Task 5) shares the same single-flight map.

Export from `src/index.ts`: `createOAuthMiddleware`, `type AuthorizationHandler`, `type OAuthClientConfig`, `type TokenStore`, `type StoredTokens`, `createMemoryTokenStore`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/http-client && pnpm exec vitest run test/oauth-middleware-authorize.test.ts test/oauth-middleware-refresh.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite + lint**

Run: `cd packages/http-client && pnpm exec vitest run`
Run: `rtk proxy pnpm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/http-client/src/oauth packages/http-client/src/index.ts packages/http-client/test/oauth-middleware-authorize.test.ts
git commit -m "feat(http-client): OAuth 401 authorize flow with PKCE, state, single-flight"
```

---

### Task 7: Node loopback authorization handler (Unit C)

**Files:**
- Create: `packages/host-node/src/oauth/loopback.ts`
- Test: `packages/host-node/test/oauth-loopback.test.ts`
- Modify: `packages/host-node/package.json` (add `@mokei/http-client` for the `AuthorizationHandler` type)

**Interfaces:**
- Consumes: `AuthorizationHandler` (Task 6).
- Produces: `createLoopbackAuthorizationHandler(options?: { timeoutMs?: number; openBrowser?: (url: string) => Promise<void> }): AuthorizationHandler`

- [ ] **Step 1: Write the failing test (inject a fake browser opener that drives the redirect)**

```ts
// packages/host-node/test/oauth-loopback.test.ts
import { describe, expect, test } from 'vitest'
import { createLoopbackAuthorizationHandler } from '../src/oauth/loopback.js'

test('captures code+state from the loopback redirect', async () => {
  const handler = createLoopbackAuthorizationHandler({
    // Instead of opening a real browser, immediately GET the redirect URI with a fake code.
    openBrowser: async (authUrl) => {
      const url = new URL(authUrl)
      const redirect = new URL(url.searchParams.get('redirect_uri') as string)
      redirect.searchParams.set('code', 'the-code')
      redirect.searchParams.set('state', url.searchParams.get('state') as string)
      await fetch(redirect.toString())
    },
  })

  const state = 'st-123'
  const result = await handler.authorize({
    state,
    buildAuthorizationUrl: (redirectUri) => {
      const u = new URL('https://as.example.com/authorize')
      u.searchParams.set('redirect_uri', redirectUri)
      u.searchParams.set('state', state)
      return u.toString()
    },
  })
  expect(result.code).toBe('the-code')
  expect(result.state).toBe(state)
  expect(result.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//)
})

test('rejects on OAuth error response', async () => {
  const handler = createLoopbackAuthorizationHandler({
    openBrowser: async (authUrl) => {
      const redirect = new URL(new URL(authUrl).searchParams.get('redirect_uri') as string)
      redirect.searchParams.set('error', 'access_denied')
      await fetch(redirect.toString())
    },
  })
  await expect(
    handler.authorize({ state: 's', buildAuthorizationUrl: (r) => `https://as.example.com/authorize?redirect_uri=${encodeURIComponent(r)}` }),
  ).rejects.toThrow(/access_denied/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/host-node && pnpm exec vitest run test/oauth-loopback.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Add `"@mokei/http-client": "workspace:^"` to `packages/host-node/package.json` dependencies; `pnpm install`.

```ts
// packages/host-node/src/oauth/loopback.ts
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import spawn from 'nano-spawn'
import type { AuthorizationHandler } from '@mokei/http-client'

async function defaultOpenBrowser(url: string): Promise<void> {
  const platform = process.platform
  if (platform === 'darwin') await spawn('open', [url])
  else if (platform === 'win32') await spawn('cmd.exe', ['/c', 'start', '', url])
  else await spawn('xdg-open', [url])
}

export function createLoopbackAuthorizationHandler(options: {
  timeoutMs?: number
  openBrowser?: (url: string) => Promise<void>
} = {}): AuthorizationHandler {
  const timeoutMs = options.timeoutMs ?? 300_000
  const openBrowser = options.openBrowser ?? defaultOpenBrowser
  return {
    authorize({ buildAuthorizationUrl, state }) {
      return new Promise((resolve, reject) => {
        const path = `/cb/${randomBytes(8).toString('hex')}`
        const server = createServer((req, res) => {
          const url = new URL(req.url ?? '/', 'http://127.0.0.1')
          if (url.pathname !== path) {
            res.writeHead(404).end()
            return
          }
          const error = url.searchParams.get('error')
          const code = url.searchParams.get('code')
          const returnedState = url.searchParams.get('state')
          res.writeHead(error ? 400 : 200, { 'Content-Type': 'text/html' })
          res.end(`<html><body>${error ? 'Authorization failed.' : 'Authorization complete — you may close this window.'}</body></html>`)
          shutdown()
          if (error) reject(new Error(`OAuth error: ${error}`))
          else if (code && returnedState != null) resolve({ code, state: returnedState, redirectUri })
          else reject(new Error('Loopback callback missing code/state'))
        })
        let redirectUri = ''
        const timer = setTimeout(() => {
          shutdown()
          reject(new Error('Authorization timed out'))
        }, timeoutMs)
        function shutdown(): void {
          clearTimeout(timer)
          server.close()
        }
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address()
          if (addr == null || typeof addr === 'string') {
            shutdown()
            reject(new Error('Failed to bind loopback server'))
            return
          }
          redirectUri = `http://127.0.0.1:${addr.port}${path}`
          void openBrowser(buildAuthorizationUrl(redirectUri)).catch((err) => {
            shutdown()
            reject(err instanceof Error ? err : new Error(String(err)))
          })
        })
      })
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/host-node && pnpm exec vitest run test/oauth-loopback.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/host-node/src/oauth/loopback.ts packages/host-node/test/oauth-loopback.test.ts packages/host-node/package.json pnpm-lock.yaml
git commit -m "feat(host-node): loopback OAuth authorization handler"
```

---

### Task 8: File-backed token store (Unit C)

**Files:**
- Create: `packages/host-node/src/oauth/file-store.ts`
- Test: `packages/host-node/test/oauth-file-store.test.ts`

**Interfaces:**
- Consumes: `TokenStore`/`StoredTokens` (Task 6 exports).
- Produces: `createFileTokenStore(path: string): TokenStore`

- [ ] **Step 1: Write the failing test**

```ts
// packages/host-node/test/oauth-file-store.test.ts
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { createFileTokenStore } from '../src/oauth/file-store.js'

test('persists tokens to disk, owner-only, and round-trips', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mokei-oauth-'))
  const file = join(dir, 'tokens.json')
  const store = createFileTokenStore(file)
  await store.set('https://mcp.example.com/mcp', { accessToken: 'a', tokenType: 'Bearer' })

  const reopened = createFileTokenStore(file)
  expect((await reopened.get('https://mcp.example.com/mcp'))?.accessToken).toBe('a')

  if (process.platform !== 'win32') {
    const mode = (await stat(file)).mode & 0o777
    expect(mode).toBe(0o600)
  }
  // no plaintext key names leaked beyond the token value structure is fine; just assert JSON parses
  JSON.parse(await readFile(file, 'utf8'))
})

test('treats corrupt file as empty', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mokei-oauth-'))
  const file = join(dir, 'tokens.json')
  await (await import('node:fs/promises')).writeFile(file, 'not json', 'utf8')
  const store = createFileTokenStore(file)
  expect(await store.get('anything')).toBeUndefined()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/host-node && pnpm exec vitest run test/oauth-file-store.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// packages/host-node/src/oauth/file-store.ts
import { readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { StoredTokens, TokenStore } from '@mokei/http-client'

async function readAll(path: string): Promise<Record<string, StoredTokens>> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Record<string, StoredTokens>
  } catch {
    return {}
  }
}

async function writeAll(path: string, data: Record<string, StoredTokens>): Promise<void> {
  const tmp = join(dirname(path), `.${randomBytes(6).toString('hex')}.tmp`)
  await writeFile(tmp, JSON.stringify(data), { mode: 0o600 })
  await rename(tmp, path)
}

export function createFileTokenStore(path: string): TokenStore {
  return {
    async get(key) {
      return (await readAll(path))[key]
    },
    async set(key, tokens) {
      const all = await readAll(path)
      all[key] = tokens
      await writeAll(path, all)
    },
    async clear(key) {
      const all = await readAll(path)
      delete all[key]
      await writeAll(path, all)
    },
  }
}
```

> `rename` over the same directory is atomic on POSIX; `mode: 0o600` on the temp file carries owner-only perms to the final file. `writeFile`'s `mode` only applies on create — acceptable here since the temp name is always new.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/host-node && pnpm exec vitest run test/oauth-file-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Export + commit**

Add to `packages/host-node/src/index.ts`: `export { createLoopbackAuthorizationHandler } from './oauth/loopback.js'` and `export { createFileTokenStore } from './oauth/file-store.js'`.

```bash
git add packages/host-node/src/oauth/file-store.ts packages/host-node/test/oauth-file-store.test.ts packages/host-node/src/index.ts
git commit -m "feat(host-node): file-backed OAuth token store"
```

---

### Task 9: `OAuthTokenVerifier` interface + shared JWT decode (Unit D)

**Files:**
- Create: `packages/http-server/src/auth/verifier.ts` (interface + `AuthInfo` + shared JWT parsing helpers)
- Test: `packages/http-server/test/auth-verifier.test.ts`

**Interfaces:**
- Produces:
  - `type AuthInfo = { subject: string; scopes: string[]; expiresAt?: number; raw?: unknown }`
  - `interface OAuthTokenVerifier { verifyAccessToken(token: string, ctx: { resource: string }): Promise<AuthInfo> }`
  - `class TokenVerificationError extends Error { code: 'invalid_token' | 'insufficient_scope' }`
  - Helpers: `decodeJwt(token): { header; payload; signingInput: Uint8Array; signature: Uint8Array }`, `assertStandardClaims(payload, { resource, now, toleranceSeconds })`, `scopesFromClaim(payload): string[]`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/http-server/test/auth-verifier.test.ts
import { describe, expect, test } from 'vitest'
import { assertStandardClaims, scopesFromClaim, TokenVerificationError } from '../src/auth/verifier.js'

const resource = 'https://mcp.example.com/mcp'

test('accepts a token bound to the resource and unexpired', () => {
  expect(() => assertStandardClaims({ aud: resource, exp: 2000, iss: 'https://as' }, { resource, now: 1000, toleranceSeconds: 30 })).not.toThrow()
})

test('rejects a wrong audience', () => {
  expect(() => assertStandardClaims({ aud: 'https://other', exp: 2000, iss: 'https://as' }, { resource, now: 1000, toleranceSeconds: 30 })).toThrow(TokenVerificationError)
})

test('rejects an expired token', () => {
  expect(() => assertStandardClaims({ aud: resource, exp: 900, iss: 'https://as' }, { resource, now: 1000, toleranceSeconds: 30 })).toThrow(/expired|exp/i)
})

test('extracts space-delimited scopes', () => {
  expect(scopesFromClaim({ scope: 'a b c' })).toEqual(['a', 'b', 'c'])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/http-server && pnpm exec vitest run test/auth-verifier.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// packages/http-server/src/auth/verifier.ts
import { fromB64U } from '@sozai/codec'

export type AuthInfo = { subject: string; scopes: string[]; expiresAt?: number; raw?: unknown }

export interface OAuthTokenVerifier {
  verifyAccessToken(token: string, ctx: { resource: string }): Promise<AuthInfo>
}

export class TokenVerificationError extends Error {
  code: 'invalid_token' | 'insufficient_scope'
  constructor(code: 'invalid_token' | 'insufficient_scope', message: string) {
    super(message)
    this.name = 'TokenVerificationError'
    this.code = code
  }
}

export function decodeJwt(token: string): {
  header: Record<string, unknown>
  payload: Record<string, unknown>
  signingInput: Uint8Array
  signature: Uint8Array
} {
  const parts = token.split('.')
  if (parts.length !== 3) throw new TokenVerificationError('invalid_token', 'malformed JWT')
  const [h, p, s] = parts
  const header = JSON.parse(new TextDecoder().decode(fromB64U(h))) as Record<string, unknown>
  const payload = JSON.parse(new TextDecoder().decode(fromB64U(p))) as Record<string, unknown>
  return { header, payload, signingInput: new TextEncoder().encode(`${h}.${p}`), signature: fromB64U(s) }
}

export function assertStandardClaims(
  payload: Record<string, unknown>,
  { resource, now, toleranceSeconds, issuer }: { resource: string; now: number; toleranceSeconds: number; issuer?: string },
): void {
  const aud = payload.aud
  const audOk = aud === resource || (Array.isArray(aud) && aud.includes(resource))
  if (!audOk) throw new TokenVerificationError('invalid_token', `token audience does not include ${resource}`)
  if (issuer != null && payload.iss !== issuer) throw new TokenVerificationError('invalid_token', 'issuer mismatch')
  const exp = payload.exp
  if (typeof exp === 'number' && exp + toleranceSeconds < now) throw new TokenVerificationError('invalid_token', 'token expired')
  const nbf = payload.nbf
  if (typeof nbf === 'number' && nbf - toleranceSeconds > now) throw new TokenVerificationError('invalid_token', 'token not yet valid')
}

export function scopesFromClaim(payload: Record<string, unknown>): string[] {
  const scope = payload.scope
  if (typeof scope === 'string') return scope.split(' ').filter(Boolean)
  if (Array.isArray(payload.scp)) return payload.scp.filter((s): s is string => typeof s === 'string')
  return []
}
```

Add `"@sozai/codec": "catalog:"` to `packages/http-server/package.json` dependencies if absent; `pnpm install`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/http-server && pnpm exec vitest run test/auth-verifier.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/http-server/src/auth/verifier.ts packages/http-server/test/auth-verifier.test.ts packages/http-server/package.json pnpm-lock.yaml
git commit -m "feat(http-server): OAuthTokenVerifier interface + JWT claim helpers"
```

---

### Task 10: JWKS verifier (Unit D)

**Files:**
- Create: `packages/http-server/src/auth/jwks-verifier.ts`
- Test: `packages/http-server/test/auth-jwks.test.ts`

**Interfaces:**
- Consumes: Task 9 helpers.
- Produces: `createJWKSVerifier(config: { issuer: string; jwksUri?: string; fetch?: FetchLike; toleranceSeconds?: number; now?: () => number }): OAuthTokenVerifier`
  (`FetchLike` re-declared locally or imported from `@mokei/http-client`; a local `type FetchLike = typeof fetch`-shaped alias is fine to avoid a cross-dep.)

- [ ] **Step 1: Write the failing test (generate an ES256 key with WebCrypto, sign a JWT, verify)**

```ts
// packages/http-server/test/auth-jwks.test.ts
import { describe, expect, test } from 'vitest'
import { toB64U } from '@sozai/codec'
import { createJWKSVerifier } from '../src/auth/jwks-verifier.js'

const issuer = 'https://as.example.com'
const resource = 'https://mcp.example.com/mcp'

function b64uJson(obj: unknown): string {
  return toB64U(new TextEncoder().encode(JSON.stringify(obj)))
}

async function makeToken(): Promise<{ token: string; jwk: JsonWebKey }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  jwk.kid = 'test-key'
  const header = { alg: 'ES256', typ: 'JWT', kid: 'test-key' }
  const payload = { iss: issuer, aud: resource, sub: 'user-1', exp: Math.floor(Date.now() / 1000) + 3600, scope: 'read' }
  const signingInput = `${b64uJson(header)}.${b64uJson(payload)}`
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(signingInput))
  return { token: `${signingInput}.${toB64U(new Uint8Array(sig))}`, jwk }
}

test('verifies an ES256 JWT against a JWKS', async () => {
  const { token, jwk } = await makeToken()
  const fetchJwks = async (): Promise<Response> => new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  const verifier = createJWKSVerifier({ issuer, jwksUri: `${issuer}/jwks`, fetch: fetchJwks as never })
  const info = await verifier.verifyAccessToken(token, { resource })
  expect(info.subject).toBe('user-1')
  expect(info.scopes).toEqual(['read'])
})

test('rejects a token for the wrong resource', async () => {
  const { token, jwk } = await makeToken()
  const fetchJwks = async (): Promise<Response> => new Response(JSON.stringify({ keys: [jwk] }), { status: 200 })
  const verifier = createJWKSVerifier({ issuer, jwksUri: `${issuer}/jwks`, fetch: fetchJwks as never })
  await expect(verifier.verifyAccessToken(token, { resource: 'https://other.test' })).rejects.toThrow(/audience/i)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/http-server && pnpm exec vitest run test/auth-jwks.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Key points:
- `ALG` allowlist: `{ RS256: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, ES256: { name: 'ECDSA', hash: 'SHA-256', namedCurve: 'P-256' } }`.
- JWKS cache: hold `{ keys, fetchedAt }`; honour `Cache-Control: max-age` from the JWKS response, default TTL (e.g. 300s). On an unknown `kid` (or a verify failure that could be rotation), force **one** refresh; single-flight concurrent fetches with an in-flight promise.
- Bound the key set (e.g. reject a JWKS with > 50 keys).
- Import the JWK with `crypto.subtle.importKey('jwk', jwk, alg, false, ['verify'])`, matching JWK `kty` to the header `alg` (`EC`→ES256, `RSA`→RS256) and checking `use`/`key_ops` when present. Reject a header `alg` not in the allowlist **before** importing (no algorithm confusion).
- Resolve `jwksUri` from config, else RFC 8414 discovery on `issuer` (`${issuer}/.well-known/oauth-authorization-server` → `jwks_uri`).
- After signature check, call `assertStandardClaims(payload, { resource: ctx.resource, issuer: config.issuer, now, toleranceSeconds })` and build `AuthInfo` (`subject: payload.sub`, `scopes: scopesFromClaim(payload)`, `expiresAt: payload.exp`, `raw: payload`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/http-server && pnpm exec vitest run test/auth-jwks.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/http-server/src/auth/jwks-verifier.ts packages/http-server/test/auth-jwks.test.ts
git commit -m "feat(http-server): WebCrypto JWKS access-token verifier"
```

---

### Task 11: DID verifier (Unit D)

**Files:**
- Create: `packages/http-server/src/auth/did-verifier.ts`
- Test: `packages/http-server/test/auth-did.test.ts`
- Modify: `packages/http-server/package.json` (add `@kokuin/token`)

**Interfaces:**
- Consumes: Task 9 helpers, `@kokuin/token` (`verifyToken`, `randomIdentity`).
- Produces: `createDIDVerifier(config?: { toleranceSeconds?: number; now?: () => number }): OAuthTokenVerifier`

- [ ] **Step 1: Write the failing test**

```ts
// packages/http-server/test/auth-did.test.ts
import { describe, expect, test } from 'vitest'
import { randomIdentity } from '@kokuin/token'
import { createDIDVerifier } from '../src/auth/did-verifier.js'

const resource = 'https://mcp.example.com/mcp'

test('verifies a DID-issued token bound to the resource', async () => {
  const identity = randomIdentity()
  const token = await identity.signToken({ aud: resource, scope: 'read', exp: Math.floor(Date.now() / 1000) + 3600 })
  const verifier = createDIDVerifier()
  const info = await verifier.verifyAccessToken(token, { resource })
  expect(info.subject).toBe(identity.id)
  expect(info.scopes).toEqual(['read'])
})

test('rejects a DID token for the wrong resource', async () => {
  const identity = randomIdentity()
  const token = await identity.signToken({ aud: 'https://other.test', exp: Math.floor(Date.now() / 1000) + 3600 })
  const verifier = createDIDVerifier()
  await expect(verifier.verifyAccessToken(token, { resource })).rejects.toThrow(/audience/i)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/http-server && pnpm exec vitest run test/auth-did.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Add `"@kokuin/token": "catalog:"` to `packages/http-server/package.json` dependencies; `pnpm install`. (Confirm the catalog carries `@kokuin/token`; if not, add it to `pnpm-workspace.yaml`'s catalog with the version the sibling stack uses.)

```ts
// packages/http-server/src/auth/did-verifier.ts
import { verifyToken } from '@kokuin/token'
import { assertStandardClaims, scopesFromClaim, TokenVerificationError, type AuthInfo, type OAuthTokenVerifier } from './verifier.js'

export function createDIDVerifier(config: { toleranceSeconds?: number; now?: () => number } = {}): OAuthTokenVerifier {
  const toleranceSeconds = config.toleranceSeconds ?? 30
  const now = config.now ?? (() => Math.floor(Date.now() / 1000))
  return {
    async verifyAccessToken(token, ctx) {
      let verified
      try {
        verified = await verifyToken(token)
      } catch (err) {
        throw new TokenVerificationError('invalid_token', `DID token verification failed: ${err instanceof Error ? err.message : String(err)}`)
      }
      const payload = verified.payload as Record<string, unknown>
      // iss is enforced by verifyToken (the DID that signed it); apply the shared aud/exp/nbf checks.
      assertStandardClaims(payload, { resource: ctx.resource, now: now(), toleranceSeconds })
      return {
        subject: String(payload.iss ?? verified.payload.iss),
        scopes: scopesFromClaim(payload),
        expiresAt: typeof payload.exp === 'number' ? payload.exp : undefined,
        raw: payload,
      } satisfies AuthInfo
    },
  }
}
```

> Verify the exact `verifyToken` return shape against `../kokuin/packages/token/src/token.ts` during implementation; adjust `verified.payload` access if the field differs.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/http-server && pnpm exec vitest run test/auth-did.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/http-server/src/auth/did-verifier.ts packages/http-server/test/auth-did.test.ts packages/http-server/package.json pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "feat(http-server): DID access-token verifier via @kokuin/token"
```

---

### Task 12: `requireBearerAuth` gate + `WWW-Authenticate` challenges (Unit D)

**Files:**
- Create: `packages/http-server/src/auth/require-bearer.ts`
- Test: `packages/http-server/test/auth-require-bearer.test.ts`

**Interfaces:**
- Consumes: `OAuthTokenVerifier`, `TokenVerificationError`, `AuthInfo` (Task 9).
- Produces:
  - `type BearerAuthOptions = { verifier: OAuthTokenVerifier; resource: string; requiredScopes?: string[]; resourceMetadataUrl: string }`
  - `createBearerAuthGate(options): (request: Request) => Promise<{ response?: Response; authInfo?: AuthInfo }>`
  - A hono-middleware adapter `bearerAuthMiddleware(options)` (used by Task 14).

- [ ] **Step 1: Write the failing test**

```ts
// packages/http-server/test/auth-require-bearer.test.ts
import { describe, expect, test } from 'vitest'
import { createBearerAuthGate } from '../src/auth/require-bearer.js'
import type { OAuthTokenVerifier } from '../src/auth/verifier.js'
import { TokenVerificationError } from '../src/auth/verifier.js'

const resource = 'https://mcp.example.com/mcp'
const metadataUrl = 'https://mcp.example.com/.well-known/oauth-protected-resource/mcp'

const okVerifier: OAuthTokenVerifier = {
  async verifyAccessToken() {
    return { subject: 'u', scopes: ['read'] }
  },
}

test('401 with resource_metadata when no token', async () => {
  const gate = createBearerAuthGate({ verifier: okVerifier, resource, resourceMetadataUrl: metadataUrl })
  const { response } = await gate(new Request(resource, { method: 'POST' }))
  expect(response?.status).toBe(401)
  expect(response?.headers.get('WWW-Authenticate')).toContain(`resource_metadata="${metadataUrl}"`)
})

test('403 insufficient_scope when a required scope is missing', async () => {
  const gate = createBearerAuthGate({ verifier: okVerifier, resource, resourceMetadataUrl: metadataUrl, requiredScopes: ['admin'] })
  const { response } = await gate(new Request(resource, { method: 'POST', headers: { Authorization: 'Bearer x' } }))
  expect(response?.status).toBe(403)
  expect(response?.headers.get('WWW-Authenticate')).toContain('insufficient_scope')
})

test('passes (no response) and returns authInfo on success', async () => {
  const gate = createBearerAuthGate({ verifier: okVerifier, resource, resourceMetadataUrl: metadataUrl, requiredScopes: ['read'] })
  const { response, authInfo } = await gate(new Request(resource, { method: 'POST', headers: { Authorization: 'Bearer x' } }))
  expect(response).toBeUndefined()
  expect(authInfo?.subject).toBe('u')
})

test('401 invalid_token when the verifier rejects', async () => {
  const badVerifier: OAuthTokenVerifier = {
    async verifyAccessToken() {
      throw new TokenVerificationError('invalid_token', 'bad')
    },
  }
  const gate = createBearerAuthGate({ verifier: badVerifier, resource, resourceMetadataUrl: metadataUrl })
  const { response } = await gate(new Request(resource, { method: 'POST', headers: { Authorization: 'Bearer x' } }))
  expect(response?.status).toBe(401)
  expect(response?.headers.get('WWW-Authenticate')).toContain('invalid_token')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/http-server && pnpm exec vitest run test/auth-require-bearer.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// packages/http-server/src/auth/require-bearer.ts
import type { AuthInfo, OAuthTokenVerifier } from './verifier.js'
import { TokenVerificationError } from './verifier.js'

export type BearerAuthOptions = {
  verifier: OAuthTokenVerifier
  resource: string
  requiredScopes?: string[]
  resourceMetadataUrl: string
}

function challenge(metadataUrl: string, error?: string, extra?: Record<string, string>): string {
  const parts = [`Bearer resource_metadata="${metadataUrl}"`]
  if (error) parts.push(`error="${error}"`)
  for (const [k, v] of Object.entries(extra ?? {})) parts.push(`${k}="${v}"`)
  return parts.join(', ')
}

function unauthorized(status: number, header: string): Response {
  return new Response(null, { status, headers: { 'WWW-Authenticate': header } })
}

export function createBearerAuthGate(options: BearerAuthOptions): (request: Request) => Promise<{ response?: Response; authInfo?: AuthInfo }> {
  const { verifier, resource, requiredScopes = [], resourceMetadataUrl } = options
  return async (request) => {
    const header = request.headers.get('Authorization')
    const match = header ? /^Bearer (.+)$/i.exec(header) : null
    if (!match) {
      return { response: unauthorized(401, challenge(resourceMetadataUrl)) }
    }
    let authInfo: AuthInfo
    try {
      authInfo = await verifier.verifyAccessToken(match[1], { resource })
    } catch (err) {
      if (err instanceof TokenVerificationError) {
        return { response: unauthorized(401, challenge(resourceMetadataUrl, 'invalid_token')) }
      }
      throw err
    }
    const missing = requiredScopes.filter((s) => !authInfo.scopes.includes(s))
    if (missing.length > 0) {
      return { response: unauthorized(403, challenge(resourceMetadataUrl, 'insufficient_scope', { scope: requiredScopes.join(' ') })) }
    }
    return { authInfo }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/http-server && pnpm exec vitest run test/auth-require-bearer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/http-server/src/auth/require-bearer.ts packages/http-server/test/auth-require-bearer.test.ts
git commit -m "feat(http-server): requireBearerAuth gate with 401/403 challenges"
```

---

### Task 13: Protected-resource metadata endpoint (Unit D)

**Files:**
- Create: `packages/http-server/src/auth/metadata.ts`
- Test: `packages/http-server/test/auth-metadata.test.ts`

**Interfaces:**
- Produces:
  - `type ProtectedResourceMetadataConfig = { resource: string; authorizationServers: string[] }`
  - `protectedResourceMetadataPath(resource: string): string` (RFC 9728 §3.1 path-insertion)
  - `protectedResourceMetadataResponse(config): Response`

- [ ] **Step 1: Write the failing test**

```ts
// packages/http-server/test/auth-metadata.test.ts
import { describe, expect, test } from 'vitest'
import { protectedResourceMetadataPath, protectedResourceMetadataResponse } from '../src/auth/metadata.js'

test('path-insertion for a path-bearing resource', () => {
  expect(protectedResourceMetadataPath('https://host.example/mcp')).toBe('/.well-known/oauth-protected-resource/mcp')
})

test('path for a root resource', () => {
  expect(protectedResourceMetadataPath('https://host.example/')).toBe('/.well-known/oauth-protected-resource')
})

test('serves resource + authorization_servers', async () => {
  const res = protectedResourceMetadataResponse({ resource: 'https://host.example/mcp', authorizationServers: ['https://as.example'] })
  const body = (await res.json()) as { resource: string; authorization_servers: string[] }
  expect(body.resource).toBe('https://host.example/mcp')
  expect(body.authorization_servers).toEqual(['https://as.example'])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/http-server && pnpm exec vitest run test/auth-metadata.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// packages/http-server/src/auth/metadata.ts
export type ProtectedResourceMetadataConfig = { resource: string; authorizationServers: string[] }

export function protectedResourceMetadataPath(resource: string): string {
  const u = new URL(resource)
  const suffix = u.pathname === '/' ? '' : u.pathname
  return `/.well-known/oauth-protected-resource${suffix}`
}

export function protectedResourceMetadataResponse(config: ProtectedResourceMetadataConfig): Response {
  return new Response(
    JSON.stringify({ resource: config.resource, authorization_servers: config.authorizationServers }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/http-server && pnpm exec vitest run test/auth-metadata.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/http-server/src/auth/metadata.ts packages/http-server/test/auth-metadata.test.ts
git commit -m "feat(http-server): RFC 9728 protected-resource metadata endpoint"
```

---

### Task 14: Wire auth into `serveHTTP` + raw `handleRequest` + exports (Unit D)

**Files:**
- Modify: `packages/http-server/src/serve.ts` (add `auth` option; mount gate + metadata route)
- Modify: `packages/http-server/src/index.ts` (export the auth surface)
- Test: `packages/http-server/test/serve-auth.test.ts`

**Interfaces:**
- Consumes: Tasks 9–13.
- Produces: `ServeHTTPParams.auth?: BearerAuthOptions & { authorizationServers: string[] }`; exports `createJWKSVerifier`, `createDIDVerifier`, `createBearerAuthGate`, `protectedResourceMetadataPath`, `protectedResourceMetadataResponse`, `OAuthTokenVerifier`, `AuthInfo`, `TokenVerificationError`, `BearerAuthOptions`.

- [ ] **Step 1: Write the failing test (end-to-end over the real hono app on port 0)**

```ts
// packages/http-server/test/serve-auth.test.ts
import { ContextServer, type ServerConfig } from '@mokei/context-server'
import { afterEach, describe, expect, test } from 'vitest'
import { serveHTTP } from '../src/serve.js'
import type { OAuthTokenVerifier } from '../src/auth/verifier.js'

const SERVER_CONFIG: ServerConfig = {
  name: 'test', version: '1.0.0', protocolVersions: ['2025-11-25'],
  tools: { echo: { description: 'e', inputSchema: { type: 'object' }, handler: async () => ({ content: [] }) } },
}

const verifier: OAuthTokenVerifier = {
  async verifyAccessToken(token) {
    if (token !== 'good') throw new (await import('../src/auth/verifier.js')).TokenVerificationError('invalid_token', 'no')
    return { subject: 'u', scopes: ['read'] }
  },
}

describe('serveHTTP auth', () => {
  let server: ReturnType<typeof serveHTTP> | null = null
  afterEach(async () => { await server?.dispose(); server = null })

  test('rejects unauthenticated MCP POST with 401', async () => {
    server = serveHTTP({
      createServer: ({ transport }) => new ContextServer({ ...SERVER_CONFIG, transport }),
      port: 0, hostname: '127.0.0.1',
      auth: { verifier, resource: 'http://127.0.0.1/mcp', resourceMetadataUrl: 'http://127.0.0.1/.well-known/oauth-protected-resource/mcp', authorizationServers: ['https://as.example'] },
    })
    const addr = (server.server.address() as { port: number }).port
    const res = await fetch(`http://127.0.0.1:${addr}/mcp`, { method: 'POST', body: '{}' })
    expect(res.status).toBe(401)
  })

  test('serves protected-resource metadata unauthenticated', async () => {
    server = serveHTTP({
      createServer: ({ transport }) => new ContextServer({ ...SERVER_CONFIG, transport }),
      port: 0, hostname: '127.0.0.1',
      auth: { verifier, resource: 'http://127.0.0.1/mcp', resourceMetadataUrl: 'http://127.0.0.1/.well-known/oauth-protected-resource/mcp', authorizationServers: ['https://as.example'] },
    })
    const addr = (server.server.address() as { port: number }).port
    const res = await fetch(`http://127.0.0.1:${addr}/.well-known/oauth-protected-resource/mcp`)
    expect(res.status).toBe(200)
    expect(((await res.json()) as { authorization_servers: string[] }).authorization_servers).toEqual(['https://as.example'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/http-server && pnpm exec vitest run test/serve-auth.test.ts`
Expected: FAIL — no `auth` option.

- [ ] **Step 3: Implement**

In `serve.ts`:
```ts
import { createBearerAuthGate, type BearerAuthOptions } from './auth/require-bearer.js'
import { protectedResourceMetadataPath, protectedResourceMetadataResponse } from './auth/metadata.js'

export type ServeHTTPParams = HTTPHandlerParams & {
  port?: number
  hostname?: string
  path?: string
  auth?: BearerAuthOptions & { authorizationServers: string[] }
}
```
In the body, after building `app`:
```ts
if (params.auth) {
  const gate = createBearerAuthGate(params.auth)
  const metaPath = protectedResourceMetadataPath(params.auth.resource)
  app.get(metaPath, () => protectedResourceMetadataResponse({ resource: params.auth!.resource, authorizationServers: params.auth!.authorizationServers }))
  app.all(path, async (ctx) => {
    const { response } = await gate(ctx.req.raw)
    if (response) return response
    return await handler.handleRequest(ctx.req.raw)
  })
} else {
  app.all(path, async (ctx) => handler.handleRequest(ctx.req.raw))
}
```
Replace the existing single `app.all(path, …)` with this branch. Export the auth surface from `src/index.ts`.

> Raw-mode composition: `createBearerAuthGate` already returns a `Request → { response? }` gate, so a consumer using `createHTTPHandler` directly wraps `handleRequest` the same way (documented in the module JSDoc). No extra code needed beyond exporting the gate.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/http-server && pnpm exec vitest run test/serve-auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite + lint**

Run: `cd packages/http-server && pnpm exec vitest run`
Run: `rtk proxy pnpm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/http-server/src/serve.ts packages/http-server/src/index.ts packages/http-server/test/serve-auth.test.ts
git commit -m "feat(http-server): serveHTTP auth option + metadata route + exports"
```

---

### Task 15: Thread `fetchMiddleware` through the host (seam)

**Files:**
- Modify: `packages/host/src/host.ts` (`HTTPContextParams` + `addHTTPContext`)
- Test: `packages/host/test/http-context-auth.test.ts` (or extend an existing host test)

**Interfaces:**
- Consumes: `FetchMiddleware` (Task 1).
- Produces: `HTTPContextParams.fetchMiddleware?: FetchMiddleware` forwarded into `new HTTPTransport(...)`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/host/test/http-context-auth.test.ts
import { describe, expect, test, vi } from 'vitest'
import { ContextHost } from '../src/host.js'

test('addHTTPContext forwards fetchMiddleware to the transport', async () => {
  let wrapped = false
  const middleware = (next: (u: string, i?: RequestInit) => Promise<Response>) => {
    wrapped = true
    return next
  }
  const global = vi.fn(async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 0, result: { protocolVersion: '2025-11-25', capabilities: {} } }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', global)
  const host = new ContextHost()
  // pin a revision to avoid the auto probe; the assertion is only that middleware was composed
  await host.addHTTPContext({ key: 'k', url: 'https://mcp.example/mcp', protocolVersion: '2025-11-25', fetchMiddleware: middleware }).catch(() => {})
  expect(wrapped).toBe(true)
  vi.unstubAllGlobals()
})
```

> If `addHTTPContext` performs a handshake that this stub can't fully satisfy, the `.catch(() => {})` keeps the test focused on the composition assertion (`wrapped`). Adjust to match how sibling host tests stub the client if one exists.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/host && pnpm exec vitest run test/http-context-auth.test.ts`
Expected: FAIL — `fetchMiddleware` not accepted/forwarded.

- [ ] **Step 3: Implement**

In `host.ts`:
- Add to `HTTPContextParams`:
```ts
  /** Fetch middleware (e.g. OAuth from createOAuthMiddleware) applied to the transport. */
  fetchMiddleware?: FetchMiddleware
```
  (import `FetchMiddleware` from `@mokei/http-client`).
- In `addHTTPContext`, destructure `fetchMiddleware` and pass it into the transport:
```ts
const { key, url, headers, auth, timeout, protocolVersion, fetchMiddleware } = params
…
transport: new HTTPTransport({ url, headers, auth, timeout, fetchMiddleware }) as ClientTransport,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/host && pnpm exec vitest run test/http-context-auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/host/src/host.ts packages/host/test/http-context-auth.test.ts
git commit -m "feat(host): forward fetchMiddleware through addHTTPContext"
```

---

### Task 16: End-to-end integration test (client ↔ server)

**Files:**
- Create: `packages/http-server/test/oauth-e2e.test.ts` (server has the client as a devDependency already via workspace; if not, place under `integration-tests/`)

**Interfaces:**
- Consumes: `serveHTTP` + auth (Task 14), `createOAuthMiddleware` + memory store (Task 6), a stub `AuthorizationHandler`.

- [ ] **Step 1: Write the test**

Stand up:
1. A tiny fake AS as a second hono/`serveHTTP`-independent handler (or an in-test `fetch` shim) exposing `/.well-known/oauth-authorization-server`, `/authorize` (returns a redirect the stub handler follows), `/token` (returns a signed JWT for the DID or a static token verified by a stub verifier).
2. `serveHTTP` with `auth: { verifier: <stub accepting the AS token>, resource, resourceMetadataUrl, authorizationServers: [AS] }` on port 0.
3. An `HTTPTransport`/`createHTTPClient` with `fetchMiddleware: createOAuthMiddleware({ clientId, resource, handler: stubHandler, store })`.

Drive one MCP request; assert: first hits 401, discovery runs, stub handler yields a code, token exchange succeeds, retried request returns 200, and a second request reuses the stored token (no second authorize).

```ts
// sketch — fill in concrete fetch wiring following test/serve-auth.test.ts and oauth-middleware-authorize.test.ts
test('client authorizes against a protected server and reuses the token', async () => {
  // … see Step description; assert authorizeCount === 1 across two requests
})
```

> This task's test is the acceptance harness for the in-process interop goal. Keep the fake AS minimal; the stub `AuthorizationHandler` returns `{ code, state, redirectUri }` synchronously without a browser.

- [ ] **Step 2: Run it (red, then implement wiring until green)**

Run: `cd packages/http-server && pnpm exec vitest run test/oauth-e2e.test.ts`
Expected: initially FAIL, then PASS once wiring is complete.

- [ ] **Step 3: Commit**

```bash
git add packages/http-server/test/oauth-e2e.test.ts
git commit -m "test: in-process OAuth client<->server interop"
```

---

### Task 17: CLI wiring for `mokei chat` (acceptance)

**Files:**
- Modify: the `mokei chat` / context-add path in `packages/cli/src` that calls `addHTTPContext` (locate with `grep -rn "addHTTPContext" packages/cli/src`).
- Modify: `packages/cli/package.json` if it needs `@mokei/http-client` for `createOAuthMiddleware` (it already depends on `@mokei/host-node`).
- Test: extend an existing CLI test or add `packages/cli/test/oauth-wiring.test.ts` asserting that, given an `--oauth-client-id` flag (or config), the CLI composes `createOAuthMiddleware` with `createLoopbackAuthorizationHandler` + `createFileTokenStore` and passes `fetchMiddleware` to `addHTTPContext`.

**Interfaces:**
- Consumes: `createOAuthMiddleware` (Task 6), `createLoopbackAuthorizationHandler` + `createFileTokenStore` (Tasks 7–8), `addHTTPContext` (Task 15).

- [ ] **Step 1: Decide the config surface**

Add a way to declare a remote MCP server needs OAuth: a `--oauth-client-id <id>` flag (and optional `--oauth-scope`) on the relevant command, or a field in the CLI's server config. Keep it minimal; the file token store path lives under the CLI's existing state directory (reuse `packages/cli/src/fs.ts` helpers; pick a stable path like `<config-dir>/oauth-tokens.json`).

- [ ] **Step 2: Write a focused test**

Assert the composition function (extract a small `buildOAuthMiddleware({ clientId, scopes, tokensPath })` helper in the CLI) returns a `FetchMiddleware` and that the loopback handler + file store are wired. Mock the network; do not open a browser.

- [ ] **Step 3: Implement + run**

Run: `cd packages/cli && pnpm exec vitest run test/oauth-wiring.test.ts`
Expected: PASS.

- [ ] **Step 4: Manual QA note (for the qa stage, not automated here)**

Document in the PR: `mokei chat` against a real OAuth-protected MCP server (or a local test AS) — browser opens, consent, tokens persist under the config dir, a second run reuses them.

- [ ] **Step 5: Commit**

```bash
git add packages/cli
git commit -m "feat(cli): wire OAuth middleware into mokei chat HTTP contexts"
```

---

## Self-Review

**Spec coverage:**
- Unit A fetch seam → Task 1. ✓
- Unit B client OAuth (PKCE, resource, discovery, store, middleware, 401 flow, state, single-flight, refresh, non-recursive fetch) → Tasks 2–6. ✓
- Unit C Node handler + file store → Tasks 7–8. ✓
- Unit D server (verifier interface, JWKS, DID, requireBearerAuth 401/403, metadata, both serving modes) → Tasks 9–14. ✓
- Seam threading (host) → Task 15. ✓
- Integration + interop (in-process) → Task 16. ✓
- `mokei chat` acceptance → Task 17. ✓
- Static-auth/OAuth mutual exclusion → Task 1. ✓
- Pre-registered `client_id` (no DCR/CIMD) → Task 6 config, no registration task. ✓

**Placeholder scan:** Task 16's e2e body is a guided sketch (the only non-verbatim test), justified because its wiring composes concrete pieces built verbatim in Tasks 6 and 14; the reviewer follows two named sibling tests. Task 17 leaves the exact CLI flag/config surface to a Step-1 decision because it depends on the CLI's existing command structure not yet read — flagged, not hidden.

**Type consistency:** `StoredTokens` (Task 4) may gain `tokenEndpoint?`/`issuer?` in Task 5 — Task 5 explicitly instructs updating Task 4's type and the Task 8 file store if so. `FetchLike`/`FetchMiddleware` names consistent across Tasks 1/3/5/15. `OAuthTokenVerifier.verifyAccessToken(token, ctx)` signature consistent across Tasks 9/10/11/12. `AuthInfo` shape consistent. `createBearerAuthGate` returns `{ response?, authInfo? }` consistently in Tasks 12/14.

**Open implementation checks flagged for executors:** exact `@kokuin/token` `verifyToken` return shape (Task 11), whether `@kokuin/token` is in the catalog (Task 11), and the CLI command surface (Task 17).
