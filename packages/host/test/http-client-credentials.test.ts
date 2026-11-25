import type { ClientAssertionSigner } from '@mokei/http-client'
import { createRuntime } from '@sozai/runtime'
import { afterEach, expect, test } from 'vitest'

import { ContextHost } from '../src/index.js'
import { nextEvent } from './support/reconnect.js'

const url = 'https://mcp.example.test/mcp'
const issuer = 'https://as.example.test'
const extensionID = 'io.modelcontextprotocol/oauth-client-credentials'

const signer: ClientAssertionSigner = {
  alg: 'EdDSA',
  async sign() {
    return new Uint8Array([1, 2, 3])
  },
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

/** A `2025-11-25` server that answers `401` until the bearer token from its token endpoint. */
function server() {
  const initializes: Array<{ extensions?: Record<string, unknown> }> = []
  let tokenRequests = 0
  let sessions = 0
  let failNextCall = false
  const fetch = async (target: string, init?: RequestInit): Promise<Response> => {
    if (target.includes('/.well-known/oauth-protected-resource')) {
      return json({ resource: url, authorization_servers: [issuer] })
    }
    if (target === `${issuer}/.well-known/oauth-authorization-server`) {
      return json({ issuer, token_endpoint: `${issuer}/token` })
    }
    if (target === `${issuer}/token`) {
      tokenRequests += 1
      return json({ access_token: 'tok-1', token_type: 'Bearer', expires_in: 3600 })
    }
    const headers = new Headers(init?.headers)
    if (headers.get('Authorization') !== 'Bearer tok-1') {
      return new Response('unauth', { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } })
    }
    if (init?.method === 'GET') return new Response(null, { status: 405 })
    if (init?.method === 'DELETE') return new Response(null, { status: 204 })
    const body = JSON.parse(String(init?.body)) as {
      id?: number
      method?: string
      params?: { capabilities?: { extensions?: Record<string, unknown> } }
    }
    if (body.id == null) return new Response(null, { status: 202 })
    if (body.method === 'tools/call' && failNextCall) {
      failNextCall = false
      throw new TypeError('fetch failed')
    }
    const reply = (result: unknown, extra: Record<string, string> = {}) =>
      json({ jsonrpc: '2.0', id: body.id, result }, 200, extra)
    switch (body.method) {
      case 'initialize':
        sessions += 1
        initializes.push({ extensions: body.params?.capabilities?.extensions })
        return reply(
          {
            protocolVersion: '2025-11-25',
            capabilities: { tools: {} },
            serverInfo: { name: 'http', version: '1.0.0' },
          },
          { 'Mcp-Session-Id': `s${sessions}` },
        )
      case 'tools/list':
        return reply({ tools: [{ name: 'write', inputSchema: { type: 'object' } }] })
      case 'tools/call':
        return reply({ content: [{ type: 'text', text: 'ok' }] })
      default:
        return json({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'nope' } })
    }
  }
  return {
    initializes,
    tokenRequests: () => tokenRequests,
    failNextCall: () => {
      failNextCall = true
    },
    runtime: createRuntime({ fetch: fetch as typeof globalThis.fetch }),
  }
}

const hosts: Array<ContextHost> = []

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.dispose()))
})

test('addHTTPContext({ clientCredentials }) declares the extension and authenticates', async () => {
  const env = server()
  const host = new ContextHost()
  hosts.push(host)
  await host.addHTTPContext({
    key: 'remote',
    url,
    protocolVersion: '2025-11-25',
    runtime: env.runtime,
    clientCredentials: { clientID: 'svc', issuer, signer },
  })
  await host.setup({ key: 'remote' })

  expect(env.initializes).toHaveLength(1)
  expect(env.initializes[0]?.extensions?.[extensionID]).toEqual({})
  expect(env.tokenRequests()).toBe(1)
})

test('a reconnect declares the extension again and reuses the stored token', async () => {
  const env = server()
  const host = new ContextHost()
  hosts.push(host)
  await host.addHTTPContext({
    key: 'remote',
    url,
    protocolVersion: '2025-11-25',
    runtime: env.runtime,
    reconnect: { initialDelayMs: 1, maxDelayMs: 1 },
    clientCredentials: { clientID: 'svc', issuer, signer },
  })
  await host.setup({ key: 'remote' })
  const firstClient = host.getContext('remote').client

  env.failNextCall()
  const reconnected = nextEvent(host, 'context:reconnected')
  await expect(host.callTool({ key: 'remote', name: 'write', arguments: {} })).rejects.toThrow()
  await reconnected

  expect(host.getContext('remote').client).not.toBe(firstClient)
  expect(env.initializes).toHaveLength(2)
  expect(env.initializes[1]?.extensions?.[extensionID]).toEqual({})
  expect(env.tokenRequests()).toBe(1)
})

test('addHTTPContext rejects clientCredentials combined with fetchMiddleware', async () => {
  const host = new ContextHost()
  hosts.push(host)
  await expect(
    host.addHTTPContext({
      key: 'remote',
      url,
      clientCredentials: { clientID: 'svc', issuer, signer },
      fetchMiddleware: (next) => next,
    }),
  ).rejects.toThrow('clientCredentials cannot be combined with fetchMiddleware')
})
