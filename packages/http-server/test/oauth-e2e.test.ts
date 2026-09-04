import type { ClientMessage, ServerMessage } from '@mokei/context-protocol'
import { ContextServer, type ServerConfig } from '@mokei/context-server'
import {
  type AuthorizationHandler,
  createMemoryTokenStore,
  createOAuthMiddleware,
  HTTPTransport,
} from '@mokei/http-client'
import { afterEach, describe, expect, test, vi } from 'vitest'

import type { OAuthTokenVerifier } from '../src/auth/verifier.js'
import { TokenVerificationError } from '../src/auth/verifier.js'
import { serveHTTP } from '../src/serve.js'

/**
 * In-process end-to-end interop: a real `@mokei/http-server` protected by `requireBearerAuth`,
 * driven by a real `@mokei/http-client` `HTTPTransport` carrying the OAuth `fetchMiddleware`,
 * against a minimal fake authorization server. Proves the whole client<->server OAuth path works
 * together — discovery, 401, authorize, token exchange, retry, and token reuse — not just each
 * side's unit behaviour in isolation.
 */

const SERVER_CONFIG: ServerConfig = {
  name: 'test',
  version: '1.0.0',
  protocolVersions: ['2025-11-25'],
  tools: {
    echo: {
      description: 'e',
      inputSchema: { type: 'object' },
      handler: async () => ({ content: [] }),
    },
  },
}

/**
 * `resource`/`resourceMetadataURL` are baked into the Hono app at `serveHTTP()` call time, but
 * `port: 0` only resolves an actual port once the socket is listening — after the app (and its
 * auth config) already exists. Rather than a bind-then-rebind dance to learn the port first, both
 * sides simply agree on a port-less identifier for the resource; the fake-AS `fetch` shim below is
 * the one thing that ever dereferences a URL against the real socket, and it stamps in the real
 * port at that point. Neither the server's bearer gate nor the client's canonical-resource
 * comparison ever needs the port to be part of the string, so this is a legitimate identifier, not
 * a workaround for a mismatch.
 */
const RESOURCE = 'http://127.0.0.1/mcp'
const RESOURCE_METADATA_URL = 'http://127.0.0.1/.well-known/oauth-protected-resource/mcp'

const AS_ISSUER = 'https://as.example.test'
const AS_METADATA_URL = `${AS_ISSUER}/.well-known/oauth-authorization-server`
const AS_TOKEN_URL = `${AS_ISSUER}/token`
const ACCESS_TOKEN = 'e2e-access'

const verifier: OAuthTokenVerifier = {
  async verifyAccessToken(token) {
    if (token !== ACCESS_TOKEN) throw new TokenVerificationError('invalid_token', 'no')
    return { subject: 'u', scopes: ['read'] }
  },
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * `server.address()` is `null` until the underlying TCP socket finishes binding, which is
 * asynchronous even for an IP-literal hostname on port 0 — so callers must wait for the
 * `listening` event before reading the assigned port.
 */
async function getPort(server: ReturnType<typeof serveHTTP>['server']): Promise<number> {
  const addr = server.address()
  if (addr && typeof addr !== 'string') return addr.port
  return new Promise((resolve) => {
    server.once('listening', () => {
      const listening = server.address()
      resolve((listening as { port: number }).port)
    })
  })
}

describe('OAuth client<->server interop', () => {
  let server: ReturnType<typeof serveHTTP> | null = null
  let transport: HTTPTransport | null = null

  afterEach(async () => {
    await transport?.dispose()
    transport = null
    await server?.dispose()
    server = null
    vi.unstubAllGlobals()
  })

  test('client authorizes against a protected server and reuses the token', async () => {
    server = serveHTTP({
      createServer: ({ transport: t }) => new ContextServer({ ...SERVER_CONFIG, transport: t }),
      port: 0,
      hostname: '127.0.0.1',
      auth: {
        verifier,
        resource: RESOURCE,
        resourceMetadataURL: RESOURCE_METADATA_URL,
        authorizationServers: [AS_ISSUER],
      },
    })
    const port = await getPort(server.server)

    let authorizeCalls = 0
    const handler: AuthorizationHandler = {
      async authorize({ buildAuthorizationURL, state }) {
        authorizeCalls += 1
        const url = new URL(buildAuthorizationURL('http://127.0.0.1:1/cb'))
        expect(url.searchParams.get('resource')).toBe(RESOURCE)
        expect(url.searchParams.get('state')).toBe(state)
        return { code: 'e2e-code', state, redirectURI: 'http://127.0.0.1:1/cb' }
      },
    }

    let tokenCalls = 0
    const realFetch = globalThis.fetch.bind(globalThis)

    // The fake authorization server, plus a pass-through to the REAL running http-server for
    // everything else (protected-resource metadata included — the real server already serves
    // that itself). The only rewrite this shim does is stamping the real, dynamically-assigned
    // port onto a port-less 127.0.0.1 URL before it actually hits the network.
    const fakeFetch = async (url: string, init?: RequestInit): Promise<Response> => {
      if (url === AS_METADATA_URL) {
        return json({
          issuer: AS_ISSUER,
          authorization_endpoint: `${AS_ISSUER}/authorize`,
          token_endpoint: AS_TOKEN_URL,
          code_challenge_methods_supported: ['S256'],
        })
      }
      if (url === AS_TOKEN_URL) {
        tokenCalls += 1
        return json({ access_token: ACCESS_TOKEN, token_type: 'Bearer', expires_in: 3600 })
      }
      const target = new URL(url)
      if (target.hostname === '127.0.0.1') target.port = String(port)
      return realFetch(target.toString(), init)
    }
    vi.stubGlobal('fetch', fakeFetch)

    transport = new HTTPTransport({
      url: RESOURCE,
      fetchMiddleware: createOAuthMiddleware({
        clientID: 'e2e-client',
        resource: RESOURCE,
        handler,
        store: createMemoryTokenStore(),
      }),
    })

    // First request: no stored token -> 401 -> discovery -> authorize -> token exchange -> retry.
    const initializeRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'e2e', version: '1.0' },
      },
    } as ClientMessage
    await transport.write(initializeRequest)
    const initResult = await transport.read()
    expect(initResult.done).toBe(false)
    const initValue = initResult.value as ServerMessage & { result?: unknown; error?: unknown }
    expect(initValue.error).toBeUndefined()
    expect(initValue.result).toBeDefined()

    expect(authorizeCalls).toBe(1)
    expect(tokenCalls).toBe(1)

    const initializedNotification = {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    } as ClientMessage
    await transport.write(initializedNotification)

    // Second request: the stored token is reused directly — no second 401, no second authorize.
    const pingRequest = { jsonrpc: '2.0', id: 2, method: 'ping' } as ClientMessage
    await transport.write(pingRequest)
    const pingResult = await transport.read()
    const pingValue = pingResult.value as ServerMessage & { result?: unknown; error?: unknown }
    expect(pingValue.error).toBeUndefined()
    expect(pingValue.result).toBeDefined()

    expect(authorizeCalls).toBe(1)
    expect(tokenCalls).toBe(1)
  })
})
