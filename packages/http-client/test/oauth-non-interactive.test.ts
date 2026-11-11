import { transportFailureOf } from '@mokei/context-client'
import { createRuntime } from '@sozai/runtime'
import { describe, expect, test } from 'vitest'

import { REQUEST_INTERACTION } from '../src/interaction.js'
import { createOAuthMiddleware } from '../src/oauth/middleware.js'
import { createMemoryTokenStore, tokenStoreKey } from '../src/oauth/store.js'
import { HTTPTransport } from '../src/transport.js'

const resource = 'https://mcp.example.com/mcp'
const AS = 'https://as.example.com'
const METADATA = 'https://mcp.example.com/.well-known/oauth-protected-resource/mcp'
const key = tokenStoreKey({ resource, clientID: 'c', scopes: ['read'] })

type Frame = { id?: unknown; error?: { code: number; message: string; data?: unknown } }

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

/** A resource wanting `tok:good`, an authorisation server, and an OAuth middleware in front. */
function setup(
  options: {
    gate?: Promise<void>
    mode?: 'unauthorized' | 'insufficient'
    onUnauthorizedBodyCancel?: () => void
  } = {},
) {
  const store = createMemoryTokenStore()
  let authorizeCalls = 0
  const methods: Array<string | undefined> = []
  const handler = {
    async authorize({
      state,
    }: {
      state: string
    }): Promise<{ code: string; state: string; redirectURI: string }> {
      authorizeCalls++
      await options.gate
      return { code: 'good', state, redirectURI: 'http://127.0.0.1:5555/cb' }
    },
  }
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    if (url.includes('oauth-protected-resource')) {
      return json({ resource, authorization_servers: [AS] })
    }
    if (url.endsWith('/.well-known/oauth-authorization-server')) {
      return json({
        issuer: AS,
        authorization_endpoint: `${AS}/authorize`,
        token_endpoint: `${AS}/token`,
        code_challenge_methods_supported: ['S256'],
      })
    }
    if (url === `${AS}/token`) {
      const body = new URLSearchParams(String(init?.body))
      if (body.get('grant_type') === 'refresh_token') {
        return json({ access_token: 'tok:good', token_type: 'Bearer', expires_in: 3600 })
      }
      return json({
        access_token: `tok:${body.get('code')}`,
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'refresh',
      })
    }
    methods.push(init?.method)
    const token = new Headers(init?.headers).get('Authorization')
    if (init?.method === 'DELETE') {
      return token === 'Bearer tok:good' ? new Response(null, { status: 204 }) : unauthorized()
    }
    if (options.mode === 'insufficient') {
      return json({ error: 'forbidden' }, 403, {
        'WWW-Authenticate': `Bearer error="insufficient_scope", scope="read admin", resource_metadata="${METADATA}"`,
      })
    }
    if (token !== 'Bearer tok:good') return unauthorized()
    return json({ jsonrpc: '2.0', id: 1, result: {} }, 200, { 'Mcp-Session-Id': 'sess' })
  }
  const unauthorized = () =>
    new Response(
      new ReadableStream({
        cancel: () => options.onUnauthorizedBodyCancel?.(),
      }),
      {
        status: 401,
        headers: { 'WWW-Authenticate': `Bearer resource_metadata="${METADATA}"` },
      },
    )
  const fetchMiddleware = createOAuthMiddleware({
    clientID: 'c',
    resource,
    scopes: ['read'],
    handler,
    store,
  })
  const make = (interactive?: boolean) => {
    const transport = new HTTPTransport({
      url: resource,
      runtime: createRuntime({ fetch: fetch as typeof globalThis.fetch }),
      fetchMiddleware,
      interactive,
    })
    const send = (id: number, method = 'tools/list') =>
      transport.write({ jsonrpc: '2.0', id, method } as never)
    const frame = async () => (await transport.read()).value as Frame
    return { transport, send, frame }
  }
  return { store, methods, make, authorizeCalls: () => authorizeCalls, fetchMiddleware, fetch }
}

describe('non-interactive requests', () => {
  test('non-interactive 401 throws AuthRequiredError without calling the handler', async () => {
    const env = setup()
    const { transport, send, frame } = env.make(false)
    await send(1)
    const value = await frame()
    expect(transportFailureOf(value.error)).toEqual({ kind: 'auth-required' })
    expect(env.authorizeCalls()).toBe(0)
    await transport.dispose()
  })

  test('non-interactive still refreshes', async () => {
    const env = setup()
    await env.store.set(key, {
      accessToken: 'tok:old',
      tokenType: 'Bearer',
      refreshToken: 'refresh',
      expiresAt: 1,
      tokenEndpoint: `${AS}/token`,
    })
    const { transport, send, frame } = env.make(false)
    await send(1)
    const value = await frame()
    expect(value.error).toBeUndefined()
    expect(env.authorizeCalls()).toBe(0)
    await transport.dispose()
  })

  test('non-interactive 403 insufficient_scope is returned as-is', async () => {
    const env = setup({ mode: 'insufficient' })
    await env.store.set(key, { accessToken: 'tok:read', tokenType: 'Bearer' })
    const { transport, send, frame } = env.make(false)
    await send(1)
    const value = await frame()
    expect(transportFailureOf(value.error)).toEqual({ kind: 'http', status: 403 })
    expect(env.authorizeCalls()).toBe(0)
    await transport.dispose()
  })

  test('non-interactive may join an in-flight sign-in', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const env = setup({ gate })
    const a = env.make(true)
    const b = env.make(false)
    const sentA = a.send(1)
    // Let A reach the handler and park there.
    await viWaitFor(() => env.authorizeCalls() === 1)
    const sentB = b.send(2)
    // Give B time to reach the middleware and find A's flight.
    await new Promise((resolve) => setTimeout(resolve, 20))
    release()
    await Promise.all([sentA, sentB])
    const [fa, fb] = await Promise.all([a.frame(), b.frame()])
    expect(fa.error).toBeUndefined()
    expect(fb.error).toBeUndefined()
    expect(env.authorizeCalls()).toBe(1)
    await a.transport.dispose()
    await b.transport.dispose()
  })

  test('a joiner that aborts settles while the shared sign-in stays pending', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let cancels = 0
    let joinerReachedJoin: () => void = () => {}
    const reached = new Promise<void>((resolve) => {
      joinerReachedJoin = resolve
    })
    const env = setup({
      gate,
      onUnauthorizedBodyCancel: () => {
        // The first 401 is the interactive request; the second is the joiner, which goes on to
        // the join branch with no further await before it.
        if (++cancels === 2) joinerReachedJoin()
      },
    })
    const wrapped = env.fetchMiddleware(env.fetch as never)
    const a = wrapped(resource, { method: 'POST' })
    await viWaitFor(() => env.authorizeCalls() === 1)
    const controller = new AbortController()
    const reason = new Error('joiner cancelled')
    const b = wrapped(resource, {
      method: 'POST',
      signal: controller.signal,
      [REQUEST_INTERACTION]: 'never',
    } as RequestInit)
    const bOutcome = b.then(
      () => 'resolved',
      (error) => error,
    )
    await reached
    await new Promise((resolve) => setTimeout(resolve, 0))
    controller.abort(reason)
    expect(await bOutcome).toBe(reason)
    let aSettled = false
    const aDone = a.then(() => {
      aSettled = true
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(aSettled).toBe(false)
    release()
    await aDone
    expect(env.authorizeCalls()).toBe(1)
  })

  test('dispose DELETE of a non-interactive transport never authorises', async () => {
    const env = setup()
    await env.store.set(key, { accessToken: 'tok:good', tokenType: 'Bearer' })
    const { transport, send, frame } = env.make(true)
    await send(1)
    await frame()
    await env.store.set(key, { accessToken: 'tok:stale', tokenType: 'Bearer' })
    transport.setInteractive(false)
    await transport.dispose()
    expect(env.methods).toContain('DELETE')
    expect(env.authorizeCalls()).toBe(0)
  })

  test('listen is never interactive', async () => {
    const env = setup()
    const { transport, send, frame } = env.make(true)
    await send(1, 'subscriptions/listen')
    const value = await frame()
    expect(transportFailureOf(value.error)).toEqual({ kind: 'auth-required' })
    expect(env.authorizeCalls()).toBe(0)
    await transport.dispose()
  })

  test('setInteractive(true) restores sign-in', async () => {
    const env = setup()
    const { transport, send, frame } = env.make(false)
    await send(1)
    await frame()
    expect(env.authorizeCalls()).toBe(0)
    transport.setInteractive(true)
    await send(2)
    const value = await frame()
    expect(value.error).toBeUndefined()
    expect(env.authorizeCalls()).toBe(1)
    await transport.dispose()
  })
})

async function viWaitFor(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('condition not met')
}
