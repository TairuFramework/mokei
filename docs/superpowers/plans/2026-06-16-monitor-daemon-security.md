# Monitor + Daemon Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the unauthenticated remote-code-execution hole in the host monitor and harden daemon socket permissions + lifecycle.

**Architecture:** Two trust boundaries. The network-facing monitor HTTP server gates every `/api` request with a Host-header allowlist (DNS-rebinding defense) plus a secret bearer token (CSRF defense). The local daemon socket stays `requireAuth: false` but is `chmod 0600` so only the same OS user can open it; daemon startup connects-before-removing to avoid orphaning a live daemon, kills its children on shutdown, and polls the socket instead of racing a fixed timeout.

**Tech Stack:** TypeScript, Hono, `@hono/node-server`, `@enkaku/*` transports, `node:crypto`, `node:net`, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-16-monitor-daemon-security-design.md`

**Conventions (from AGENTS.md + repo memory):**
- `pnpm` only, never `npm`/`npx`. Lint via `rtk proxy pnpm run lint`.
- `type` not `interface`; `Array<T>` not `T[]`; no `any`; `HTTP`/`ID` casing.
- Vitest is root-hoisted: a package runs tests with a `"test:unit": "vitest run"` script and no local `vitest` devDep (see `packages/host`). Tests live in `<pkg>/test/*.test.ts` and import source as `../src/<file>.js`.
- Cross-package tests resolve built `lib/`, and the CLI dev binary runs from `dist`/`lib`: **rebuild a package (`pnpm --filter @mokei/<pkg> build`) before running consumers' tests or the CLI.**

---

## File Structure

**New files:**
- `packages/host-monitor/src/auth.ts` — pure request-gate logic (token + Host/Origin allowlist).
- `packages/host-monitor/src/html.ts` — pure token-into-HTML injection helper.
- `packages/host-monitor/test/auth.test.ts` — gate unit tests.
- `packages/host-monitor/test/html.test.ts` — injection unit tests.
- `packages/host/src/daemon/socket.ts` — `isSocketLive`, `waitForSocket`, `safeRemove`.
- `packages/host/test/socket.test.ts` — socket-helper unit tests.
- `packages/host/test/daemon-server.test.ts` — `killChildren` + socket-`0600` tests.

**Modified files:**
- `packages/host-monitor/src/index.ts` — bind host, mint token, inject HTML route, gate `/api`.
- `packages/host-monitor/package.json` — add `test:unit` script.
- `packages/host/src/server.ts` — child tracking, `dispose`/`killChildren`, socket `chmod 0600`.
- `packages/host/src/daemon/process.ts` — connect-before-remove, signal handlers.
- `packages/host/src/daemon/controller.ts` — `waitForSocket` + `safeRemove`.
- `packages/cli/src/commands/monitor.tsx` — `--host` flag.
- `monitor/src/host/client.ts` — wrapped `fetch` sending the bearer token.
- `monitor/index.html` — no change needed (token injected at serve time).
- `docs/agents/plans/roadmap.md`, `docs/agents/plans/next/…` — move item to completed.

---

## Task 1: Token-into-HTML injection helper (host-monitor)

**Files:**
- Create: `packages/host-monitor/src/html.ts`
- Test: `packages/host-monitor/test/html.test.ts`
- Modify: `packages/host-monitor/package.json`

- [ ] **Step 1: Add the `test:unit` script**

In `packages/host-monitor/package.json`, change the `test` script and add `test:unit` (mirror `packages/host`):

```json
    "test:types": "tsc --noEmit --skipLibCheck",
    "test:unit": "vitest run",
    "test": "pnpm run test:types && pnpm run test:unit",
```

- [ ] **Step 2: Write the failing test**

`packages/host-monitor/test/html.test.ts`:

```ts
import { describe, expect, test } from 'vitest'

import { injectToken } from '../src/html.js'

describe('injectToken', () => {
  test('inserts the token script before </head>', () => {
    const out = injectToken('<html><head></head><body></body></html>', 'abc123')
    expect(out).toContain('window.__MOKEI_TOKEN__="abc123"')
    expect(out.indexOf('window.__MOKEI_TOKEN__')).toBeLessThan(out.indexOf('</head>'))
  })

  test('escapes the token as JSON to avoid breaking out of the script', () => {
    const out = injectToken('<head></head>', '</script><x>')
    expect(out).not.toContain('</script><x>"')
    expect(out).toContain(JSON.stringify('</script><x>'))
  })

  test('prepends the script when there is no head', () => {
    const out = injectToken('<body>hi</body>', 'tok')
    expect(out.startsWith('<script>')).toBe(true)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @mokei/host-monitor exec vitest run test/html.test.ts`
Expected: FAIL — cannot resolve `../src/html.js`.

- [ ] **Step 4: Implement `injectToken`**

`packages/host-monitor/src/html.ts`:

```ts
/**
 * Splice a secret token into served HTML as a global the monitor UI reads.
 * The token is JSON-encoded so a token value can never break out of the
 * <script> element.
 */
export function injectToken(html: string, token: string): string {
  const tag = `<script>window.__MOKEI_TOKEN__=${JSON.stringify(token)}</script>`
  return html.includes('</head>') ? html.replace('</head>', `${tag}</head>`) : `${tag}${html}`
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @mokei/host-monitor exec vitest run test/html.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/host-monitor/src/html.ts packages/host-monitor/test/html.test.ts packages/host-monitor/package.json
git commit -m "feat(host-monitor): add token-into-HTML injection helper"
```

---

## Task 2: Request-gate logic (host-monitor)

**Files:**
- Create: `packages/host-monitor/src/auth.ts`
- Test: `packages/host-monitor/test/auth.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/host-monitor/test/auth.test.ts`:

```ts
import { describe, expect, test } from 'vitest'

import { buildAllowedHosts, verifyApiRequest } from '../src/auth.js'

const TOKEN = 'a'.repeat(64)

function req(headers: Record<string, string>): Request {
  return new Request('http://127.0.0.1/api', { method: 'POST', headers })
}

describe('buildAllowedHosts', () => {
  test('includes localhost aliases for a loopback bind', () => {
    const hosts = buildAllowedHosts('127.0.0.1', 5000)
    expect(hosts.has('127.0.0.1:5000')).toBe(true)
    expect(hosts.has('localhost:5000')).toBe(true)
  })

  test('uses only the bind host for a remote bind', () => {
    const hosts = buildAllowedHosts('192.168.1.10', 5000)
    expect(hosts.has('192.168.1.10:5000')).toBe(true)
    expect(hosts.has('localhost:5000')).toBe(false)
  })
})

describe('verifyApiRequest', () => {
  const opts = { token: TOKEN, allowedHosts: buildAllowedHosts('127.0.0.1', 5000) }

  test('accepts a valid Host + token', () => {
    expect(verifyApiRequest(req({ host: 'localhost:5000', authorization: `Bearer ${TOKEN}` }), opts)).toBe(true)
  })

  test('rejects a missing token', () => {
    expect(verifyApiRequest(req({ host: 'localhost:5000' }), opts)).toBe(false)
  })

  test('rejects a wrong token', () => {
    expect(verifyApiRequest(req({ host: 'localhost:5000', authorization: `Bearer ${'b'.repeat(64)}` }), opts)).toBe(false)
  })

  test('rejects a foreign Host (DNS-rebinding)', () => {
    expect(verifyApiRequest(req({ host: 'evil.com:5000', authorization: `Bearer ${TOKEN}` }), opts)).toBe(false)
  })

  test('rejects a foreign Origin when present', () => {
    expect(
      verifyApiRequest(req({ host: 'localhost:5000', origin: 'http://evil.com', authorization: `Bearer ${TOKEN}` }), opts),
    ).toBe(false)
  })

  test('accepts a matching Origin', () => {
    expect(
      verifyApiRequest(req({ host: 'localhost:5000', origin: 'http://localhost:5000', authorization: `Bearer ${TOKEN}` }), opts),
    ).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mokei/host-monitor exec vitest run test/auth.test.ts`
Expected: FAIL — cannot resolve `../src/auth.js`.

- [ ] **Step 3: Implement the gate**

`packages/host-monitor/src/auth.ts`:

```ts
import { timingSafeEqual } from 'node:crypto'

export type GateOptions = { token: string; allowedHosts: Set<string> }

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  // Length check first: timingSafeEqual throws on unequal lengths.
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

/** Host:port values we accept on the Host/Origin headers for a given bind. */
export function buildAllowedHosts(host: string, port: number): Set<string> {
  const hosts = new Set<string>([`${host}:${port}`])
  if (host === '127.0.0.1' || host === 'localhost' || host === '::1') {
    hosts.add(`127.0.0.1:${port}`)
    hosts.add(`localhost:${port}`)
    hosts.add(`[::1]:${port}`)
  }
  return hosts
}

/**
 * Gate an /api request. Host-header allowlist defeats DNS rebinding; the
 * Origin check defeats classic CSRF when present; the bearer token defeats a
 * blind cross-origin fetch that cannot read the token.
 */
export function verifyApiRequest(request: Request, opts: GateOptions): boolean {
  const host = request.headers.get('host')
  if (host == null || !opts.allowedHosts.has(host)) {
    return false
  }
  const origin = request.headers.get('origin')
  if (origin != null) {
    let originHost: string
    try {
      originHost = new URL(origin).host
    } catch {
      return false
    }
    if (!opts.allowedHosts.has(originHost)) {
      return false
    }
  }
  const auth = request.headers.get('authorization')
  const prefix = 'Bearer '
  return auth != null && auth.startsWith(prefix) && safeEqual(auth.slice(prefix.length), opts.token)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mokei/host-monitor exec vitest run test/auth.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/host-monitor/src/auth.ts packages/host-monitor/test/auth.test.ts
git commit -m "feat(host-monitor): add token + Host/Origin request gate"
```

---

## Task 3: Wire the monitor server (bind + token + gate)

**Files:**
- Modify: `packages/host-monitor/src/index.ts`

This task wires the helpers into `startMonitor`. It is integration glue; the logic is already unit-tested in Tasks 1–2. Verification is by type-check + a manual curl probe.

- [ ] **Step 1: Replace `startMonitor`**

Replace the body of `packages/host-monitor/src/index.ts` (keep the module doc comment at top) with:

```ts
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { Disposer, defer } from '@enkaku/async'
import { createServerBridge } from '@enkaku/http-server-transport'
import { connectSocket, createTransportStream } from '@enkaku/socket-transport'
import { type ServerType, serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { DEFAULT_SOCKET_PATH, type Protocol } from '@mokei/host-protocol'
import getPort from 'get-port'
import { Hono } from 'hono'

import { buildAllowedHosts, verifyApiRequest } from './auth.js'
import { injectToken } from './html.js'

export type MonitorParams = {
  socketPath?: string
  port?: number
  host?: string
}

export type Monitor = {
  disposer: Disposer
  host: string
  port: number
  server: ServerType
  token: string
}

export async function startMonitor(params: MonitorParams = {}): Promise<Monitor> {
  const host = params.host ?? '127.0.0.1'
  const socketPath = params.socketPath ?? DEFAULT_SOCKET_PATH
  const socketStream = await createTransportStream(connectSocket(socketPath))
  const serverBridge = createServerBridge<Protocol>()
  const token = randomBytes(32).toString('hex')

  const distDir = join(import.meta.dirname, '../dist')
  const indexHTML = injectToken(await readFile(join(distDir, 'index.html'), 'utf8'), token)

  const port = await getPort({ port: params.port })
  const allowedHosts = buildAllowedHosts(host, port)

  const app = new Hono()
  app.all('/api', (ctx) => {
    return verifyApiRequest(ctx.req.raw, { token, allowedHosts })
      ? serverBridge.handleRequest(ctx.req.raw)
      : ctx.text('Forbidden', 403)
  })
  // Serve the token-injected HTML for the entry point and SPA fallback; let
  // serveStatic handle real asset files only.
  const serveIndex = (ctx: { html: (body: string) => Response }) => ctx.html(indexHTML)
  app.get('/', (ctx) => serveIndex(ctx))
  app.use('/*', serveStatic({ root: `${relative(process.cwd(), distDir)}` }))
  app.notFound((ctx) => serveIndex(ctx))

  const server = serve({ fetch: app.fetch, port, hostname: host })
  const serverClosed = defer<void>()
  server.on('close', () => {
    serverClosed.resolve()
  })

  const decoupled = Promise.all([
    socketStream.readable.pipeTo(serverBridge.stream.writable),
    serverBridge.stream.readable.pipeTo(socketStream.writable),
  ])
  const disposer = new Disposer({
    dispose: async () => {
      server.close()
      serverBridge.stream.writable.close()
      socketStream.writable.close()
      await Promise.all([serverClosed, decoupled])
    },
  })

  return { disposer, host, port, server, token }
}
```

Note: `import.meta.dirname` is already used by the existing code, so the swc/Node target supports it.

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @mokei/host-monitor run test:types`
Expected: PASS (no type errors).

- [ ] **Step 3: Manual gate probe**

```bash
pnpm --filter @mokei/host-monitor build
# In one shell start a daemon + monitor (uses the CLI from Task 5, or:)
node -e "import('@mokei/host').then(m=>m.runDaemon())" &
node -e "import('@mokei/host-monitor').then(async m=>{const x=await m.startMonitor();console.log('PORT',x.port,'TOKEN',x.token)})" &
```

Then, against the printed PORT:
- `curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:PORT/api` → **403** (no token).
- `curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Host: evil.com:PORT' -H "Authorization: Bearer TOKEN" http://127.0.0.1:PORT/api` → **403** (bad Host).
- `curl -s http://127.0.0.1:PORT/ | grep -c __MOKEI_TOKEN__` → **1** (HTML carries the token).

Kill the background processes when done.

- [ ] **Step 4: Commit**

```bash
git add packages/host-monitor/src/index.ts
git commit -m "feat(host-monitor): bind localhost, mint token, gate /api"
```

---

## Task 4: Monitor UI sends the bearer token

**Files:**
- Modify: `monitor/src/host/client.ts`

The UI reads `window.__MOKEI_TOKEN__` (injected in Task 3) and attaches it to every `/api` fetch. `@enkaku/http-client-transport` `ClientTransport` accepts a custom `fetch` but no header option, so we wrap `fetch`.

- [ ] **Step 1: Replace `createHostClient`**

`monitor/src/host/client.ts`:

```ts
import { Client } from '@enkaku/client'
import { ClientTransport } from '@enkaku/http-client-transport'
import type { Protocol } from '@mokei/host-protocol'

export type HostClient = Client<Protocol>

export function createHostClient(url: string): HostClient {
  const token = (globalThis as { __MOKEI_TOKEN__?: string }).__MOKEI_TOKEN__
  const authFetch: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers)
    if (token != null) {
      headers.set('authorization', `Bearer ${token}`)
    }
    return fetch(input, { ...init, headers })
  }
  const transport = new ClientTransport<Protocol>({ url, fetch: authFetch })
  return new Client<Protocol>({ transport })
}
```

- [ ] **Step 2: Build the UI and copy into the package dist**

Run:
```bash
pnpm --filter mokei-monitor build      # or: cd monitor && pnpm build
pnpm --filter @mokei/host-monitor exec pnpm run app:copy
```
(Confirm the UI package name with `node -p "require('./monitor/package.json').name"` if the filter fails; `app:copy` is the script that copies `monitor/dist` → `host-monitor/dist`.)

Expected: `packages/host-monitor/dist/index.html` exists.

- [ ] **Step 3: Manual end-to-end check**

Start daemon + monitor (as in Task 3 / via `mokei monitor` after Task 5), open the printed `http://localhost:PORT/` in a browser. Expected: the monitor UI loads, lists contexts, and the network tab shows `/api` requests carrying `Authorization: Bearer …` and returning 200 (not 403).

- [ ] **Step 4: Commit**

```bash
git add monitor/src/host/client.ts
git commit -m "feat(monitor): attach bearer token to /api requests"
```

---

## Task 5: CLI `--host` flag

**Files:**
- Modify: `packages/cli/src/commands/monitor.tsx`

- [ ] **Step 1: Add the flag and thread `host`**

In `packages/cli/src/commands/monitor.tsx`, add the option and pass it through:

```tsx
  withSocketPath(cmd)
  cmd.option('-p, --port <number>', 'port for the monitor UI server')
  cmd.option('--host <host>', 'host to bind the monitor UI server', '127.0.0.1')

  cmd.action(async (opts: Record<string, string | undefined>) => {
    const socketPath = opts.path
    const port = opts.port != null ? Number.parseInt(opts.port, 10) : undefined
    const host = opts.host ?? '127.0.0.1'
    await runDaemon({ socketPath })
    const monitor = await startMonitor({ port, socketPath, host })
    const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${monitor.port}/`
```

Leave the rest of the action body unchanged.

- [ ] **Step 2: Rebuild host-monitor then the CLI**

Run:
```bash
pnpm --filter @mokei/host-monitor build
pnpm --filter @mokei/cli build
```
(Required: the CLI resolves `@mokei/host-monitor` from its built `lib`, and the dev binary runs from built output.)

- [ ] **Step 3: Manual smoke test**

Run: `./packages/cli/bin/dev.js monitor` (or the repo's dev entry), confirm it prints `monitor running on http://localhost:<port>/` and the UI loads. Then `./…/dev.js monitor --host 127.0.0.1 --port 0` still works.
Expected: monitor starts; binding is loopback by default.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/commands/monitor.tsx
git commit -m "feat(cli): add --host flag to monitor command"
```

---

## Task 6: Daemon socket helpers (host)

**Files:**
- Create: `packages/host/src/daemon/socket.ts`
- Test: `packages/host/test/socket.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/host/test/socket.test.ts`:

```ts
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

import { isSocketLive, safeRemove, waitForSocket } from '../src/daemon/socket.js'

let server: Server | undefined
const sockets: Array<string> = []

function tmpSocket(): string {
  const path = join(tmpdir(), `mokei-test-${process.pid}-${sockets.length}.sock`)
  sockets.push(path)
  return path
}

afterEach(async () => {
  if (server != null) {
    await new Promise<void>((resolve) => server?.close(() => resolve()))
    server = undefined
  }
  for (const path of sockets) {
    safeRemove(path)
  }
})

function listen(path: string): Promise<Server> {
  return new Promise((resolve) => {
    const s = createServer()
    s.listen(path, () => resolve(s))
  })
}

describe('isSocketLive', () => {
  test('returns false for a non-existent socket', async () => {
    await expect(isSocketLive(tmpSocket())).resolves.toBe(false)
  })

  test('returns true when a server is listening', async () => {
    const path = tmpSocket()
    server = await listen(path)
    await expect(isSocketLive(path)).resolves.toBe(true)
  })
})

describe('waitForSocket', () => {
  test('resolves once a server starts listening', async () => {
    const path = tmpSocket()
    server = await listen(path)
    await expect(waitForSocket(path, { timeout: 1000, interval: 20 })).resolves.toBeUndefined()
  })

  test('rejects when the socket never appears', async () => {
    await expect(waitForSocket(tmpSocket(), { timeout: 150, interval: 20 })).rejects.toThrow()
  })
})

describe('safeRemove', () => {
  test('does not throw when the path is absent', () => {
    expect(() => safeRemove(tmpSocket())).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mokei/host exec vitest run test/socket.test.ts`
Expected: FAIL — cannot resolve `../src/daemon/socket.js`.

- [ ] **Step 3: Implement the helpers**

`packages/host/src/daemon/socket.ts`:

```ts
import { rmSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { connectSocket } from '@enkaku/socket-transport'

/** True if something is actively listening on the socket (not just a stale file). */
export async function isSocketLive(socketPath: string): Promise<boolean> {
  try {
    const socket = await connectSocket(socketPath)
    socket.destroy()
    return true
  } catch {
    return false
  }
}

export type WaitForSocketOptions = { timeout?: number; interval?: number }

/** Poll until the socket accepts a connection, or reject after `timeout` ms. */
export async function waitForSocket(
  socketPath: string,
  options: WaitForSocketOptions = {},
): Promise<void> {
  const timeout = options.timeout ?? 3000
  const interval = options.interval ?? 50
  const deadline = Date.now() + timeout
  for (;;) {
    if (await isSocketLive(socketPath)) {
      return
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for socket ${socketPath}`)
    }
    await delay(interval)
  }
}

/** Remove a socket file, tolerating concurrent removal (ENOENT). */
export function safeRemove(socketPath: string): void {
  try {
    rmSync(socketPath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mokei/host exec vitest run test/socket.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/host/src/daemon/socket.ts packages/host/test/socket.test.ts
git commit -m "feat(host): add daemon socket liveness/wait/safe-remove helpers"
```

---

## Task 7: Daemon server — child tracking, dispose, socket 0600

**Files:**
- Modify: `packages/host/src/server.ts`
- Test: `packages/host/test/daemon-server.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/host/test/daemon-server.test.ts`:

```ts
import { spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

import { safeRemove } from '../src/daemon/socket.js'
import { killChildren, startServer } from '../src/server.js'

const sockets: Array<string> = []

function tmpSocket(): string {
  const path = join(tmpdir(), `mokei-srv-${process.pid}-${sockets.length}.sock`)
  sockets.push(path)
  return path
}

afterEach(() => {
  for (const path of sockets) {
    safeRemove(path)
  }
})

describe('killChildren', () => {
  test('kills every tracked child and empties the map', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e9)'])
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    const children = new Map([['c1', child]])

    killChildren(children)

    expect(children.size).toBe(0)
    await exited // resolves only if the child was actually killed
  })
})

describe('startServer', () => {
  test('chmods the socket to 0600', async () => {
    const socketPath = tmpSocket()
    const { dispose } = await startServer({ socketPath })
    expect(statSync(socketPath).mode & 0o777).toBe(0o600)
    await dispose()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mokei/host exec vitest run test/daemon-server.test.ts`
Expected: FAIL — `killChildren` not exported / `startServer` returns a `Server`, has no `dispose`.

- [ ] **Step 3: Modify `server.ts`**

In `packages/host/src/server.ts`:

(a) Update imports at the top:

```ts
import { chmodSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { type ChildProcess } from 'node:child_process'
import { createServer, type Server, type Socket } from 'node:net'
```

(b) Add `children` to `HandlersContext`:

```ts
type HandlersContext = {
  activeContexts: Record<string, ActiveContextInfo>
  children: Map<string, ChildProcess>
  events: EventTarget
  startedTime: number
  shutdown?: () => void | Promise<void>
}
```

(c) In the `spawn` handler, track the child and clean it up on abort. Replace the lines around `activeContexts[contextID] = { startedTime: Date.now() }` and the abort listener:

```ts
    spawn: async (ctx) => {
      const contextID = randomUUID()
      const spawned = await spawnContextServer(ctx.param)
      activeContexts[contextID] = { startedTime: Date.now() }
      children.set(contextID, spawned.childProcess)
      events.dispatchEvent(
        new CustomEvent('context:start', {
          detail: {
            meta: createEventMeta(contextID),
            data: { transport: 'stdio', command: ctx.param.command, args: ctx.param.args },
          },
        }),
      )

      const stream = await createTransportStream(spawned.streams)

      ctx.signal.addEventListener('abort', () => {
        spawned.childProcess.kill()
        delete activeContexts[contextID]
        children.delete(contextID)
        events.dispatchEvent(
          new CustomEvent('context:stop', { detail: { meta: createEventMeta(contextID) } }),
        )
      })
```

(In `createHandlers`, destructure `children` alongside the existing fields:
`function createHandlers({ activeContexts, children, events, startedTime, shutdown }: HandlersContext)`.)

(d) Add the `killChildren` export (above `serveSocket`):

```ts
/** Kill every tracked child process and clear the map. */
export function killChildren(children: Map<string, ChildProcess>): void {
  for (const child of children.values()) {
    try {
      child.kill()
    } catch {
      // Child may already be gone; ignore.
    }
  }
  children.clear()
}
```

(e) Replace `ServerParams` and `startServer` (and add the `RunningServer` type):

```ts
export type ServerParams = {
  socketPath?: string
  shutdown?: () => void | Promise<void>
}

export type RunningServer = {
  server: Server
  dispose: () => Promise<void>
}

export function startServer(params: ServerParams = {}): Promise<RunningServer> {
  const socketPath = params.socketPath ?? DEFAULT_SOCKET_PATH

  const children = new Map<string, ChildProcess>()
  let disposed = false
  const dispose = async (): Promise<void> => {
    if (disposed) {
      return
    }
    disposed = true
    killChildren(children)
    await params.shutdown?.()
  }

  const context: HandlersContext = {
    activeContexts: {},
    children,
    events: new EventTarget(),
    startedTime: Date.now(),
    // The RPC `shutdown` channel runs the same path as a signal-driven dispose.
    shutdown: dispose,
  }
  const server = createServer((socket) => {
    serveSocket(socket, context)
  })

  return new Promise((resolve, reject) => {
    server.on('error', (err) => {
      reject(err)
    })
    server.listen(socketPath, () => {
      try {
        // Same-OS-user trust boundary: only the owner may drive the spawn channel.
        chmodSync(socketPath, 0o600)
      } catch (err) {
        server.close()
        reject(err)
        return
      }
      resolve({ server, dispose })
    })
  })
}
```

Note: the RPC `shutdown` handler already does `await shutdown?.()`; since `context.shutdown` is now `dispose`, the RPC shutdown kills children too.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mokei/host exec vitest run test/daemon-server.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full host test suite (no regressions)**

Run: `pnpm --filter @mokei/host run test:unit`
Expected: PASS (existing lifecycle/framing/http-transport/local-tools tests still green).

- [ ] **Step 6: Commit**

```bash
git add packages/host/src/server.ts packages/host/test/daemon-server.test.ts
git commit -m "feat(host): track+kill daemon children, chmod socket 0600, expose dispose"
```

---

## Task 8: Daemon process — connect-before-remove + signals

**Files:**
- Modify: `packages/host/src/daemon/process.ts`

`startServer` now returns `{ server, dispose }`, so this file must be updated to compile regardless. It also gains the split-brain guard and signal handlers.

- [ ] **Step 1: Replace `process.ts`**

`packages/host/src/daemon/process.ts`:

```ts
import { parseArgs } from 'node:util'
import { DEFAULT_SOCKET_PATH } from '@mokei/host-protocol'

import { startServer } from '../server.js'
import { isSocketLive, safeRemove } from './socket.js'

const args = parseArgs({
  options: {
    path: {
      type: 'string',
      short: 'p',
      default: DEFAULT_SOCKET_PATH,
    },
  },
  strict: false,
})
const socketPath = args.values.path as string

// Split-brain guard: if a live daemon already owns the socket, do not disturb it
// (blindly removing the socket would orphan that daemon's children).
if (await isSocketLive(socketPath)) {
  process.exit(0)
}
// Stale socket file (no listener): safe to remove before binding.
safeRemove(socketPath)

const { server, dispose } = await startServer({
  socketPath,
  shutdown: () => {
    server.close()
    safeRemove(socketPath)
  },
})

// Run the shutdown path on termination so we never leak the socket file or
// spawned MCP children.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void dispose().finally(() => process.exit(0))
  })
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @mokei/host run test:types`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/host/src/daemon/process.ts
git commit -m "fix(host): connect-before-remove + signal-driven daemon shutdown"
```

---

## Task 9: Daemon controller — poll instead of race

**Files:**
- Modify: `packages/host/src/daemon/controller.ts`

- [ ] **Step 1: Update `spawnDaemon` and `runDaemon`**

In `packages/host/src/daemon/controller.ts`:

(a) Update imports — drop `openSync, rmSync` from `node:fs` if unused (keep `openSync`; it is still used for log files), drop the `node:timers/promises` import, and add the socket helpers:

```ts
import { openSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Client } from '@enkaku/client'
import { connectSocket, SocketTransport } from '@enkaku/socket-transport'
import {
  type ClientMessage,
  DEFAULT_SOCKET_PATH,
  type Protocol,
  type ServerMessage,
} from '@mokei/host-protocol'
import spawn from 'nano-spawn'

import { safeRemove, waitForSocket } from './socket.js'
```

(b) Replace the fixed wait in `spawnDaemon`:

```ts
  // Dereference child process so it can be garbage collected
  const childProcess = await subprocess.nodeChildProcess
  childProcess.unref()
  // Wait for the socket to accept connections (poll with backoff instead of a
  // fixed delay that spuriously fails on slow startup).
  await waitForSocket(socketPath)
}
```

(c) In `runDaemon`, replace `rmSync(socketPath)` with `safeRemove(socketPath)`:

```ts
export async function runDaemon(options: DaemonOptions = {}): Promise<HostClient> {
  const socketPath = options.socketPath ?? DEFAULT_SOCKET_PATH
  try {
    return await createClient(socketPath)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ECONNREFUSED' || code === 'ENOENT') {
      if (code === 'ECONNREFUSED') {
        safeRemove(socketPath)
      }
      await spawnDaemon(options)
      return await createClient(socketPath)
    }
    throw err
  }
}
```

- [ ] **Step 2: Type-check + full host suite**

Run: `pnpm --filter @mokei/host run test:types && pnpm --filter @mokei/host run test:unit`
Expected: PASS.

- [ ] **Step 3: Manual race check**

```bash
pnpm --filter @mokei/host build
node -e "Promise.all([import('@mokei/host').then(m=>m.runDaemon()),import('@mokei/host').then(m=>m.runDaemon())]).then(()=>console.log('both connected')).then(()=>process.exit(0))"
```
Then verify only one daemon is running: `pgrep -fl 'daemon/process.js' | wc -l` → **1**. Kill it: `pkill -f 'daemon/process.js'`, then `ls ~/.mokei-daemon.sock` → absent (signal handler removed it).

- [ ] **Step 4: Commit**

```bash
git add packages/host/src/daemon/controller.ts
git commit -m "fix(host): poll daemon socket on startup, tolerate concurrent removal"
```

---

## Task 10: Docs + roadmap update

**Files:**
- Modify: `packages/host/README.md` (or `packages/host-monitor/README.md` if the trust note fits better there)
- Modify: `docs/agents/plans/roadmap.md`
- Move: `docs/agents/plans/next/2026-06-12-monitor-daemon-security.md` → `docs/agents/plans/completed/`

- [ ] **Step 1: Document the trust boundary**

Add a short "Security" note to `packages/host/README.md` stating: the daemon control socket is `chmod 0600` (same-OS-user only); the monitor binds `127.0.0.1` by default and gates `/api` with a Host-header allowlist plus a per-start bearer token; `--host` opt-in remote binding still requires the token, and exposing the spawn channel beyond localhost is at the operator's risk.

- [ ] **Step 2: Move the completed plan + update roadmap**

```bash
git mv docs/agents/plans/next/2026-06-12-monitor-daemon-security.md docs/agents/plans/completed/2026-06-16-monitor-daemon-security.md
```

In `docs/agents/plans/roadmap.md`: remove the "Monitor + daemon security" bullet from **Now (next/)**, and add a line under the shipped/completed list noting items 1–5 landed on this branch. Bump **Last updated** to `2026-06-16`.

- [ ] **Step 3: Full repo verification**

Run:
```bash
pnpm build
pnpm test
rtk proxy pnpm run lint
```
Expected: build, all tests, and lint pass.

- [ ] **Step 4: Commit**

```bash
git add packages/host/README.md docs/agents/plans/
git commit -m "docs: record monitor+daemon security hardening, update roadmap"
```

---

## Self-Review

**Spec coverage:**
- Trust model (Host allowlist + token; socket 0600) → Tasks 2, 3, 7. ✓
- Item 1 localhost bind + `host` param + `--host` → Tasks 3, 5. ✓
- Item 2 token mint + HTML inject + UI fetch + `/api` gate → Tasks 1, 2, 3, 4. ✓
- Item 3 socket 0600 + fatal on chmod fail + docs → Tasks 7, 10. ✓
- Item 4 connect-before-remove + signals + kill children → Tasks 6, 7, 8. ✓
- Item 5 poll socket + guarded remove + race mitigation → Tasks 6, 8, 9. ✓
- Error handling (403, silent race exit, fatal chmod) → Tasks 3, 7, 8. ✓
- Testing (gate, perms, helpers, child-kill) → Tasks 1, 2, 6, 7. ✓

**Type consistency:** `verifyApiRequest`/`buildAllowedHosts`/`GateOptions` (Task 2) used identically in Task 3. `injectToken` (Task 1) used in Task 3. `isSocketLive`/`waitForSocket`/`safeRemove` (Task 6) used in Tasks 8, 9. `killChildren`/`RunningServer.dispose` (Task 7) used in Task 8. `Monitor.host`/`.token` added in Task 3, `host` consumed in Task 5. ✓

**Placeholders:** none — every code/test step has full content.

**Note on the two-daemon split-brain race:** automated coverage is at the helper level (`isSocketLive`, `waitForSocket`, `killChildren`); end-to-end multi-process behavior is covered by the manual checks in Tasks 3 and 9 to avoid brittle process-spawning tests.
