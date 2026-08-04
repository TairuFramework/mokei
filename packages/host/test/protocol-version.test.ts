import { fileURLToPath } from 'node:url'
import { UnsupportedProtocolVersionError } from '@mokei/context-client'
import type { ProtocolVersion } from '@mokei/context-protocol'
import { createTool } from '@mokei/context-server'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { ContextHost, type HostClient, ProxyHost, spawnHostedContext } from '../src/index.js'
import * as spawnModule from '../src/spawn.js'

const ECHO_SERVER = fileURLToPath(new URL('./fixtures/echo-server.mjs', import.meta.url))

describe('ContextHost protocol version', () => {
  let host: ContextHost | null = null

  afterEach(async () => {
    await host?.dispose()
    host = null
  })

  test('addLocalContext defaults to auto, resolving the newest revision the server serves', async () => {
    host = new ContextHost()
    const client = await host.addLocalContext({
      key: 'echo',
      command: process.execPath,
      args: [ECHO_SERVER],
    })
    // Read after an awaited request so the `'auto'` probe is resolved rather than throwing
    // from the getter. The fixture serves both revisions, so the probe settles on the newest.
    await client.listTools()
    expect(client.protocolVersion).toBe('2026-07-28')
  })

  test('addLocalContext honours an explicit revision', async () => {
    host = new ContextHost()
    const client = await host.addLocalContext({
      key: 'echo',
      command: process.execPath,
      args: [ECHO_SERVER],
      protocolVersion: '2025-11-25',
    })
    await client.listTools()
    expect(client.protocolVersion).toBe('2025-11-25')
  })

  // A server with no tools declares no `tools` capability, so `listTools()` would throw
  // before the revision could be observed. One tool keeps the request real.
  const directConfig = {
    name: 'direct',
    version: '1.0.0',
    protocolVersions: ['2026-07-28', '2025-11-25'] as Array<ProtocolVersion>,
    tools: {
      ping: createTool({
        description: 'Reply with pong',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        handler: () => ({ content: [{ type: 'text' as const, text: 'pong' }] }),
      }),
    },
  }

  test('addDirectContext defaults to auto, resolving the newest revision the server serves', async () => {
    host = new ContextHost()
    const client = host.addDirectContext({ key: 'direct', config: directConfig })
    await client.listTools()
    expect(client.protocolVersion).toBe('2026-07-28')
  })

  // The reason the default is `'auto'` rather than the newest revision: a server that serves
  // `2025-11-25` only answers the probe's `server/discover` with an error, and the client
  // negotiates down instead of failing the connection the way a `'2026-07-28'` pin would.
  test('the default falls back to 2025-11-25 against a server that serves it only', async () => {
    host = new ContextHost()
    const client = host.addDirectContext({
      key: 'direct',
      config: { ...directConfig, protocolVersions: ['2025-11-25'] },
    })
    await client.listTools()
    expect(client.protocolVersion).toBe('2025-11-25')
  })

  // The explicit revision here is deliberately the one that is *not* the default: asserting
  // `'2026-07-28'` would pass even if `addDirectContext` dropped the parameter on the floor.
  test('addDirectContext honours an explicit revision', async () => {
    host = new ContextHost()
    const client = host.addDirectContext({
      key: 'direct',
      protocolVersion: '2025-11-25',
      config: directConfig,
    })
    await client.listTools()
    expect(client.protocolVersion).toBe('2025-11-25')
  })

  // No request is issued, which is exactly what the default being `'auto'` looks like from
  // here: a pinned revision resolves at construction, an `'auto'` one only once the probe has
  // reached the server — and nothing has, since the transport waits for a first request.
  test('addHTTPContext defaults to auto, leaving the revision unresolved until a request', async () => {
    host = new ContextHost()
    const client = await host.addHTTPContext({
      key: 'remote',
      url: 'https://mcp.example.com/api',
    })
    expect(() => client.protocolVersion).toThrow(
      "The 'auto' protocol version has not been resolved yet",
    )
  })

  test('addHTTPContext honours an explicit revision', async () => {
    host = new ContextHost()
    const client = await host.addHTTPContext({
      key: 'remote',
      url: 'https://mcp.example.com/api',
      protocolVersion: '2025-11-25',
    })
    expect(client.protocolVersion).toBe('2025-11-25')
  })
})

describe('ProxyHost protocol version', () => {
  // The daemon's `spawn` param schema sets `additionalProperties: false`, so `protocolVersion`
  // must reach the local client without ever being forwarded over the channel.
  function stubProxyHost(): { proxy: ProxyHost; getSpawnParam: () => Record<string, unknown> } {
    let spawnParam: Record<string, unknown> = {}
    const client = {
      createChannel: (_name: string, args: { param: Record<string, unknown> }) => {
        spawnParam = args.param
        return {
          // Never emits: no server is answering, and no request is issued here.
          readable: new ReadableStream(),
          writable: new WritableStream(),
          close: () => {},
        }
      },
      dispose: async () => {},
    }
    return {
      proxy: new ProxyHost(client as unknown as HostClient),
      getSpawnParam: () => spawnParam,
    }
  }

  test('spawn keeps the revision local and out of the daemon param', async () => {
    const { proxy, getSpawnParam } = stubProxyHost()
    const client = await proxy.spawn({
      key: 'proxied',
      command: 'server',
      protocolVersion: '2025-11-25',
    })

    expect(client.protocolVersion).toBe('2025-11-25')
    // Assert the capture happened before asserting what it lacks: `spawnParam` starts as `{}`,
    // so the `not.toHaveProperty` below would pass vacuously had `createChannel` never run.
    expect(getSpawnParam()).toMatchObject({ command: 'server' })
    expect(getSpawnParam()).not.toHaveProperty('protocolVersion')

    await proxy.dispose()
  })

  test('spawn defaults to auto', async () => {
    const { proxy } = stubProxyHost()
    const client = await proxy.spawn({ key: 'proxied', command: 'server' })

    // The stub never answers, so an unresolved revision *is* the observation: a pinned one
    // would have resolved at construction without any wire traffic.
    expect(() => client.protocolVersion).toThrow(
      "The 'auto' protocol version has not been resolved yet",
    )

    await proxy.dispose()
  })
})

describe('spawnHostedContext protocol version validation', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // Filed scenario: a bad version string in a config file. Pre-fix, `ContextClient`'s
  // constructor rejected the pin only after `spawnContextServer` had already spawned the
  // child (host.ts spawns, then constructs the client) — and since the throw happened before
  // `spawnHostedContext` could hand back a disposer, the child was unreachable and leaked. The
  // fix validates with the same `isSupportedProtocolVersion` predicate Task 8 uses, before
  // spawning anything.
  test('an unsupported pin throws before any child process is spawned', async () => {
    const spawnSpy = vi.spyOn(spawnModule, 'spawnContextServer')

    await expect(
      spawnHostedContext({
        command: process.execPath,
        args: ['-e', 'process.exit(0)'],
        protocolVersion: 'not-a-real-version' as ProtocolVersion,
      }),
    ).rejects.toThrow(UnsupportedProtocolVersionError)

    expect(spawnSpy).not.toHaveBeenCalled()
  })
})
