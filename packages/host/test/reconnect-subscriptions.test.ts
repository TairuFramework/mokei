import type * as EnkakuTransport from '@enkaku/transport'
import type * as ContextClientModule from '@mokei/context-client'
import { META_SUBSCRIPTION_ID } from '@mokei/context-protocol'
import type { ServerConfig } from '@mokei/context-server'
import { createMemoryTokenStore, createOAuthMiddleware, tokenStoreKey } from '@mokei/http-client'
import { createRuntime } from '@sozai/runtime'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { ContextHost } from '../src/index.js'
import {
  deferred,
  loseServer,
  nextEvent,
  resetTracked,
  tool,
  tracked,
} from './support/reconnect.js'

type ListenMessage = {
  id?: unknown
  method?: string
  params?: { notifications?: { resourceSubscriptions?: Array<string> } }
}

const hooks = vi.hoisted(() => ({
  /** Runs before a client's `subscribeResource` reaches the wire. */
  beforeSubscribe: undefined as ((client: unknown, uri: string) => Promise<void>) | undefined,
  /** Every `subscriptions/listen` a direct server received, with the pair it arrived on. */
  listens: [] as Array<{ pair: unknown; id: unknown; uris: Array<string>; served: boolean }>,
  /** Answers a direct server's `subscriptions/listen` with this error instead of serving it. */
  rejectListen: undefined as
    | ((pair: unknown, uris: Array<string>) => { code: number; message: string } | undefined)
    | undefined,
}))

vi.mock('@enkaku/transport', async (importOriginal) => {
  const { mockTransportModule } = await import('./support/reconnect.js')
  const original = await mockTransportModule(
    importOriginal as () => Promise<typeof EnkakuTransport>,
  )
  class InterceptedDirectTransports<R, W> extends original.DirectTransports<R, W> {
    constructor(...args: ConstructorParameters<typeof original.DirectTransports>) {
      super(...args)
      const server = this.server as unknown as {
        read(): Promise<ReadableStreamReadResult<unknown>>
        write(message: unknown): Promise<void>
      }
      const read = server.read.bind(server)
      server.read = async () => {
        for (;;) {
          const next = await read()
          if (next.done) return next
          const message = next.value as ListenMessage
          if (message.method !== 'subscriptions/listen') return next
          const uris = message.params?.notifications?.resourceSubscriptions ?? []
          const error = hooks.rejectListen?.(this, uris)
          hooks.listens.push({ pair: this, id: message.id, uris, served: error == null })
          if (error == null) return next
          await server.write({ jsonrpc: '2.0', id: message.id, error })
        }
      }
    }
  }
  return { ...original, DirectTransports: InterceptedDirectTransports }
})
vi.mock('@mokei/context-client', async (importOriginal) => {
  const { mockClientModule } = await import('./support/reconnect.js')
  const original = await mockClientModule(
    importOriginal as () => Promise<typeof ContextClientModule>,
  )
  type Params = Parameters<InstanceType<typeof original.ContextClient>['subscribeResource']>[0]
  class HookedClient extends original.ContextClient {
    override async subscribeResource(params: Params): Promise<void> {
      await hooks.beforeSubscribe?.(this, params.uri)
      await super.subscribeResource(params)
    }
  }
  return { ...original, ContextClient: HookedClient }
})

const FAST = { initialDelayMs: 1, maxDelayMs: 1 }
const KEY = 'subs'
const A = 'file:///a'
const B = 'file:///b'
const C = 'file:///c'

const config = {
  name: 'subs',
  version: '1.0.0',
  protocolVersions: ['2026-07-28'],
  tools: { a: tool('a') },
  resources: { list: () => ({ resources: [] }), read: () => ({ contents: [] }) },
  subscriptions: true,
} satisfies ServerConfig

const hosts: Array<ContextHost> = []

async function connect() {
  const host = new ContextHost()
  hosts.push(host)
  host.addDirectContext({ key: KEY, config, protocolVersion: '2026-07-28', reconnect: FAST })
  await host.setup({ key: KEY })
  return host
}

function currentPair(host: ContextHost): unknown {
  return tracked.pairs.get(tracked.transports.get(host.getContext(KEY).client) as object)
}

/** The resources of the last listen filter a pair's server served. */
function lastListen(pair: unknown): Array<string> | undefined {
  return hooks.listens.filter((listen) => listen.pair === pair && listen.served).at(-1)?.uris
}

/** Every resource a pair's server was ever asked to subscribe to. */
function everListened(pair: unknown): Set<string> {
  return new Set(
    hooks.listens.filter((listen) => listen.pair === pair).flatMap((listen) => listen.uris),
  )
}

async function reconnect(host: ContextHost): Promise<unknown> {
  const reconnected = nextEvent(host, 'context:reconnected')
  await loseServer(host, KEY)
  await reconnected
  return currentPair(host)
}

function lostEvents(host: ContextHost) {
  const lost: Array<{ key: string; uri: string; error: Error }> = []
  host.events.on('resource:subscription-lost', (payload) => {
    lost.push(payload)
  })
  return lost
}

afterEach(async () => {
  hooks.beforeSubscribe = undefined
  hooks.rejectListen = undefined
  hooks.listens = []
  resetTracked()
  await Promise.all(hosts.splice(0).map((host) => host.dispose()))
})

describe('resource subscriptions through the host', () => {
  test('subscriptions are restored after a reconnect', async () => {
    const host = await connect()
    await host.subscribeResource({ key: KEY, uri: A })
    await host.subscribeResource({ key: KEY, uri: B })
    expect(lastListen(currentPair(host))).toEqual([A, B])

    const pair = await reconnect(host)
    await vi.waitFor(() => expect(lastListen(pair)).toEqual([A, B]))
  })

  test('an unsubscribe during restoration is honoured', async () => {
    const host = await connect()
    await host.subscribeResource({ key: KEY, uri: A })
    await host.subscribeResource({ key: KEY, uri: B })
    const first = host.getContext(KEY).client

    const entered = deferred()
    const release = deferred()
    const restored: Array<string> = []
    hooks.beforeSubscribe = async (client, uri) => {
      if (client === first) return
      restored.push(uri)
      if (uri === A) {
        entered.resolve()
        await release.promise
      }
    }
    const pair = await reconnect(host)
    await entered.promise

    const unsubscribed = host.unsubscribeResource({ key: KEY, uri: B })
    release.resolve()
    await unsubscribed

    expect(restored).toEqual([A])
    expect(everListened(pair).has(B)).toBe(false)
    expect(lastListen(pair)).toEqual([A])
  })

  test('a failed unsubscribe keeps the URI', async () => {
    const host = await connect()
    await host.subscribeResource({ key: KEY, uri: A })
    const firstPair = currentPair(host)

    hooks.rejectListen = (pair, uris) =>
      pair === firstPair && !uris.includes(A) ? { code: -32603, message: 'no' } : undefined
    await expect(host.unsubscribeResource({ key: KEY, uri: A })).rejects.toThrow()
    hooks.rejectListen = undefined

    // The client driver kept the URI too: its next filter still carries it.
    await host.subscribeResource({ key: KEY, uri: C })
    expect(lastListen(firstPair)).toEqual([A, C])

    const pair = await reconnect(host)
    await vi.waitFor(() => expect(lastListen(pair)).toEqual([A, C]))
  })

  test('a failed re-subscribe drops the URI with resource:subscription-lost', async () => {
    const host = await connect()
    const lost = lostEvents(host)
    await host.subscribeResource({ key: KEY, uri: A })
    await host.subscribeResource({ key: KEY, uri: B })
    const firstPair = currentPair(host)

    hooks.rejectListen = (pair, uris) =>
      pair !== firstPair && uris.includes(B) ? { code: -32603, message: 'no' } : undefined
    const dropped = nextEvent(host, 'resource:subscription-lost')
    const pair = await reconnect(host)
    const event = await dropped

    expect(event).toMatchObject({ key: KEY, uri: B })
    expect(event.error).toBeInstanceOf(Error)
    expect(lastListen(pair)).toEqual([A])

    // Dropped for good: the next reconnect restores only A.
    hooks.rejectListen = undefined
    const next = await reconnect(host)
    await vi.waitFor(() => expect(lastListen(next)).toEqual([A]))
    expect(everListened(next).has(B)).toBe(false)
    expect(lost.map((entry) => entry.uri)).toEqual([B])
  })

  test('a failed unsubscribe during restoration re-subscribes the URI', async () => {
    const host = await connect()
    await host.subscribeResource({ key: KEY, uri: A })
    await host.subscribeResource({ key: KEY, uri: B })
    const first = host.getContext(KEY).client

    const entered = deferred()
    const release = deferred()
    hooks.beforeSubscribe = async (client, uri) => {
      if (client === first || uri !== A) return
      entered.resolve()
      await release.promise
    }
    const pair = await reconnect(host)
    await entered.promise

    const aborted = AbortSignal.abort(new Error('cancelled'))
    const unsubscribed = host.unsubscribeResource({ key: KEY, uri: B, signal: aborted })
    release.resolve()
    await expect(unsubscribed).rejects.toThrow('cancelled')
    hooks.beforeSubscribe = undefined

    // Restoration skipped B; the failed unsubscribe put it back and subscribed the current client.
    expect(lastListen(pair)).toEqual([A, B])
    expect(host.getContext(KEY).client.subscriptionFilter?.resourceSubscriptions).toEqual([A, B])
    const next = await reconnect(host)
    await vi.waitFor(() => expect(lastListen(next)).toEqual([A, B]))
  })

  test('an invalidated capability snapshot still restores subscriptions', async () => {
    const host = await connect()
    const lost = lostEvents(host)
    await host.subscribeResource({ key: KEY, uri: A })
    const first = host.getContext(KEY).client

    // A subscribe made during the reconnect runs on the new client ahead of the restoration.
    const entered = deferred()
    const release = deferred()
    hooks.beforeSubscribe = async (client, uri) => {
      if (client === first || uri !== C) return
      entered.resolve()
      await release.promise
    }
    const reconnected = nextEvent(host, 'context:reconnected')
    await loseServer(host, KEY)
    const subscribed = host.subscribeResource({ key: KEY, uri: C })
    await reconnected
    await entered.promise
    const pair = currentPair(host)
    const client = host.getContext(KEY).client

    // A list change invalidates the discovery snapshot before the restoration reads it.
    await vi.waitFor(() => expect(client.subscriptionFilter).not.toBeNull())
    const listen = hooks.listens.filter((entry) => entry.pair === pair && entry.served).at(-1)
    await (pair as { server: { write(message: unknown): Promise<void> } }).server.write({
      jsonrpc: '2.0',
      method: 'notifications/resources/list_changed',
      params: { _meta: { [META_SUBSCRIPTION_ID]: listen?.id } },
    })
    await vi.waitFor(() => expect(client.discoveredCapabilities).toBeNull())
    release.resolve()
    await subscribed

    await vi.waitFor(() => expect(lastListen(pair)).toEqual([A, C]))
    expect(lost).toEqual([])
  })

  test('calls are not blocked by restoration', async () => {
    const host = await connect()
    await host.subscribeResource({ key: KEY, uri: A })
    const first = host.getContext(KEY).client

    const entered = deferred()
    const release = deferred()
    hooks.beforeSubscribe = async (client) => {
      if (client === first) return
      entered.resolve()
      await release.promise
    }
    const pair = await reconnect(host)
    await entered.promise

    const result = await host.callTool({ key: KEY, name: 'a', arguments: {} })
    expect(result.isError).not.toBe(true)
    expect(everListened(pair).has(A)).toBe(false)

    release.resolve()
    await vi.waitFor(() => expect(lastListen(pair)).toEqual([A]))
  })
})

const URL_MCP = 'https://mcp.example.test/mcp'
const ACK_METHOD = 'notifications/subscriptions/acknowledged'

type Body = { id?: number; method: string; params?: ListenMessage['params'] }

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

/** Holds a listen open: the acknowledgement is its only frame. */
function acknowledge(body: Body): Response {
  const frame = {
    jsonrpc: '2.0',
    method: ACK_METHOD,
    params: {
      notifications: body.params?.notifications ?? {},
      _meta: { [META_SUBSCRIPTION_ID]: body.id },
    },
  }
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`))
    },
  })
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

/**
 * A sessionless `2026-07-28` Streamable HTTP server behind a runtime fetch stub. `override`
 * answers a request first; `subscribe` is the `resources.subscribe` capability it advertises.
 */
function httpServer() {
  const listens: Array<Array<string>> = []
  const state = {
    subscribe: true,
    override: undefined as ((body: Body) => Response | 'reject' | undefined) | undefined,
  }
  const fetch = async (_url: string, init?: RequestInit): Promise<Response> => {
    if (init?.method !== 'POST' || typeof init.body !== 'string') {
      return new Response(null, { status: 405 })
    }
    const body = JSON.parse(init.body) as Body
    if (body.method === 'subscriptions/listen') {
      listens.push(body.params?.notifications?.resourceSubscriptions ?? [])
    }
    const replaced = state.override?.(body)
    if (replaced === 'reject') throw new TypeError('fetch failed')
    if (replaced != null) return replaced
    if (body.id == null) return new Response(null, { status: 202 })
    const reply = (result: unknown) => json({ jsonrpc: '2.0', id: body.id, result })
    switch (body.method) {
      case 'server/discover':
        return reply({
          resultType: 'complete',
          supportedVersions: ['2026-07-28'],
          capabilities: {
            tools: {},
            ...(state.subscribe ? { resources: { subscribe: true, listChanged: true } } : {}),
          },
          serverInfo: { name: 'http', version: '1.0.0' },
          ttlMs: 0,
          cacheScope: 'private',
        })
      case 'tools/list':
        return reply({
          resultType: 'complete',
          tools: [{ name: 'write', inputSchema: { type: 'object' } }],
          ttlMs: 0,
          cacheScope: 'private',
        })
      case 'tools/call':
        return reply({ resultType: 'complete', content: [] })
      case 'subscriptions/listen':
        // Acknowledged whatever the advertised capability: the host must not trust the ack alone.
        return acknowledge(body)
      default:
        return json({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'none' } })
    }
  }
  return { listens, state, runtime: createRuntime({ fetch: fetch as typeof globalThis.fetch }) }
}

async function connectHTTP(
  env: ReturnType<typeof httpServer>,
  extra: Partial<Parameters<ContextHost['addHTTPContext']>[0]> = {},
) {
  const host = new ContextHost()
  hosts.push(host)
  await host.addHTTPContext({
    key: KEY,
    url: URL_MCP,
    protocolVersion: '2026-07-28',
    runtime: env.runtime,
    reconnect: FAST,
    ...extra,
  })
  await host.setup({ key: KEY })
  return host
}

/** Drops the network under one call, then lets the reconnect through. */
async function reconnectHTTP(host: ContextHost, env: ReturnType<typeof httpServer>) {
  const previous = env.state.override
  let dropped = false
  env.state.override = (body) => {
    if (!dropped && body.method === 'tools/call') {
      dropped = true
      return 'reject'
    }
    return previous?.(body)
  }
  const reconnected = nextEvent(host, 'context:reconnected')
  await expect(host.callTool({ key: KEY, name: 'write', arguments: {} })).rejects.toThrow()
  await reconnected
}

describe('resource subscriptions over HTTP', () => {
  test('restoration never steps up', async () => {
    const env = httpServer()
    const metadata = 'https://mcp.example.test/.well-known/oauth-protected-resource/mcp'
    const store = createMemoryTokenStore()
    await store.set(tokenStoreKey({ resource: URL_MCP, clientID: 'c', scopes: ['read'] }), {
      accessToken: 'tok:good',
      tokenType: 'Bearer',
    })
    const authorize = vi.fn(async ({ state }: { state: string }) => {
      return { code: 'good', state, redirectURI: 'http://127.0.0.1:5555/cb' }
    })
    const fetchMiddleware = createOAuthMiddleware({
      clientID: 'c',
      resource: URL_MCP,
      scopes: ['read'],
      handler: { authorize },
      store,
    })
    const host = await connectHTTP(env, { fetchMiddleware })
    const lost = lostEvents(host)
    await host.subscribeResource({ key: KEY, uri: A })
    await host.subscribeResource({ key: KEY, uri: B })
    const before = env.listens.length

    env.state.override = (body) =>
      body.method === 'subscriptions/listen' &&
      (body.params?.notifications?.resourceSubscriptions ?? []).includes(B)
        ? json({ error: 'forbidden' }, 403, {
            'WWW-Authenticate': `Bearer error="insufficient_scope", scope="read admin", resource_metadata="${metadata}"`,
          })
        : undefined
    const dropped = nextEvent(host, 'resource:subscription-lost')
    await reconnectHTTP(host, env)
    const event = await dropped

    expect(event).toMatchObject({ key: KEY, uri: B })
    expect(authorize).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(env.listens.slice(before)).toContainEqual([A]))
    expect(lost.map((entry) => entry.uri)).toEqual([B])
  })

  test('a server without resource subscriptions drops every URI', async () => {
    const env = httpServer()
    const host = await connectHTTP(env)
    const lost = lostEvents(host)
    await host.subscribeResource({ key: KEY, uri: A })
    await host.subscribeResource({ key: KEY, uri: B })

    env.state.subscribe = false
    const before = env.listens.length
    await reconnectHTTP(host, env)

    await vi.waitFor(() => expect(lost.map((entry) => entry.uri).sort()).toEqual([A, B]))
    for (const entry of lost) {
      expect(entry.key).toBe(KEY)
      expect(entry.error).toBeInstanceOf(Error)
    }
    // Not restored: the new server was never asked for either URI.
    expect(env.listens.slice(before).flat()).toEqual([])
  })
})
