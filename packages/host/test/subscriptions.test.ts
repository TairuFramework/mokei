import { DirectTransports } from '@enkaku/transport'
import type {
  ClientMessage,
  RequestID,
  ServerCapabilities,
  ServerMessage,
  Tool,
} from '@mokei/context-protocol'
import { META_SUBSCRIPTION_ID } from '@mokei/context-protocol'
import { describe, expect, test } from 'vitest'

import { ContextHost } from '../src/host.js'

const ACK_METHOD = 'notifications/subscriptions/acknowledged'

/** Caps a subscribe-capable `2026-07-28` server advertises. */
const SUBSCRIBE_CAPS: ServerCapabilities = {
  resources: { subscribe: true, listChanged: true },
  tools: { listChanged: true },
  prompts: { listChanged: true },
}

function discoverResult(capabilities: ServerCapabilities) {
  return {
    capabilities,
    resultType: 'complete' as const,
    supportedVersions: ['2026-07-28'],
    serverInfo: { name: 'Test', version: '0.0.0' },
  }
}

type Deferred = { promise: Promise<void>; resolve: () => void }
function deferred(): Deferred {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/** Flush pending micro/macro tasks so the client read loop drains written frames. */
async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

type ServerState = {
  listenId: RequestID | undefined
  resourceListCount: number
  resourceReadCount: number
  toolListCount: number
}

/**
 * Drives a fake `2026-07-28` server over the paired transport: answers `server/discover`,
 * acknowledges `subscriptions/listen`, and answers `tools/list`/`resources/list`. `tools` is a
 * mutable getter so a `tools/list_changed` re-list can observe a different aggregate. Dispatches
 * by method so the test never depends on request-id ordering.
 */
function startServer(
  server: DirectTransports<ServerMessage, ClientMessage>['server'],
  getTools: () => Array<Tool>,
) {
  const state: ServerState = {
    listenId: undefined,
    resourceListCount: 0,
    resourceReadCount: 0,
    toolListCount: 0,
  }
  const firstAck = deferred()

  void (async () => {
    while (true) {
      const next = await server.read()
      if (next.done) {
        break
      }
      const message = next.value as { id?: RequestID; method?: string; params?: unknown }
      switch (message.method) {
        case 'server/discover': {
          server.write({
            jsonrpc: '2.0',
            id: message.id as RequestID,
            result: discoverResult(SUBSCRIBE_CAPS),
          } as never)
          break
        }
        case 'subscriptions/listen': {
          const filter = (message.params as { notifications?: unknown }).notifications
          state.listenId = message.id
          server.write({
            jsonrpc: '2.0',
            method: ACK_METHOD,
            params: { notifications: filter, _meta: { [META_SUBSCRIPTION_ID]: message.id } },
          } as never)
          firstAck.resolve()
          break
        }
        case 'tools/list': {
          state.toolListCount += 1
          server.write({
            jsonrpc: '2.0',
            id: message.id as RequestID,
            result: { resultType: 'complete', tools: getTools() },
          } as never)
          break
        }
        case 'resources/list': {
          state.resourceListCount += 1
          server.write({
            jsonrpc: '2.0',
            id: message.id as RequestID,
            result: { resultType: 'complete', resources: [] },
          } as never)
          break
        }
        case 'resources/read': {
          state.resourceReadCount += 1
          server.write({
            jsonrpc: '2.0',
            id: message.id as RequestID,
            result: { contents: [] },
          } as never)
          break
        }
        default:
          break
      }
    }
  })()

  return {
    state,
    firstAcked: firstAck.promise,
    emit: (frame: unknown) => server.write(frame as never),
  }
}

function tool(name: string): Tool {
  return { name, inputSchema: { type: 'object', properties: {} } }
}

describe('ContextHost subscription events', () => {
  test('a resources/list_changed re-lists the context and emits resources:changed', async () => {
    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    const host = new ContextHost()
    host.createContext({
      key: 'srv',
      transport: transports.client,
      protocolVersion: '2026-07-28',
    })
    const sub = startServer(transports.server, () => [])

    await host.setup({ key: 'srv' })
    await sub.firstAcked

    const changed = new Promise<{ key: string }>((resolve) => {
      host.events.on('resources:changed', resolve)
    })

    const listsBefore = sub.state.resourceListCount
    sub.emit({
      jsonrpc: '2.0',
      method: 'notifications/resources/list_changed',
      params: { _meta: { [META_SUBSCRIPTION_ID]: sub.state.listenId } },
    })

    expect(await changed).toEqual({ key: 'srv' })
    // The host re-listed the affected list before emitting.
    expect(sub.state.resourceListCount).toBe(listsBefore + 1)

    await host.dispose()
  })

  test('a resources/updated emits resource:updated without re-reading', async () => {
    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    const host = new ContextHost()
    host.createContext({
      key: 'srv',
      transport: transports.client,
      protocolVersion: '2026-07-28',
    })
    const sub = startServer(transports.server, () => [])

    await host.setup({ key: 'srv' })
    await sub.firstAcked

    const updated = new Promise<{ key: string; uri: string }>((resolve) => {
      host.events.on('resource:updated', resolve)
    })

    sub.emit({
      jsonrpc: '2.0',
      method: 'notifications/resources/updated',
      params: { uri: 'file:///x', _meta: { [META_SUBSCRIPTION_ID]: sub.state.listenId } },
    })

    expect(await updated).toEqual({ key: 'srv', uri: 'file:///x' })
    await flush()
    // resource:updated must not trigger a re-read.
    expect(sub.state.resourceReadCount).toBe(0)

    await host.dispose()
  })

  test('a tools/list_changed refreshes the namespaced tool aggregate before emitting', async () => {
    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    const host = new ContextHost()
    let currentTools: Array<Tool> = [tool('a')]
    host.createContext({
      key: 'srv',
      transport: transports.client,
      protocolVersion: '2026-07-28',
    })
    const sub = startServer(transports.server, () => currentTools)

    await host.setup({ key: 'srv' })
    await sub.firstAcked

    // Baseline aggregate from setup.
    expect(host.getContext('srv').tools.map((ct) => ct.id)).toEqual(['srv:a'])

    // Disable the existing tool so the refresh can be checked for enabled-state preservation.
    host.disableContextTools({ key: 'srv', toolNames: ['a'] })

    const changed = new Promise<{ key: string }>((resolve) => {
      host.events.on('tools:changed', resolve)
    })

    // The server now advertises a different tool set.
    currentTools = [tool('a'), tool('b')]
    sub.emit({
      jsonrpc: '2.0',
      method: 'notifications/tools/list_changed',
      params: { _meta: { [META_SUBSCRIPTION_ID]: sub.state.listenId } },
    })

    expect(await changed).toEqual({ key: 'srv' })
    const tools = host.getContext('srv').tools
    // Aggregate refreshed to the new server list, namespaced, with prior enabled state preserved.
    expect(tools.map((ct) => ct.id)).toEqual(['srv:a', 'srv:b'])
    expect(tools.find((ct) => ct.id === 'srv:a')?.enabled).toBe(false)
    expect(tools.find((ct) => ct.id === 'srv:b')?.enabled).toBe(true)

    await host.dispose()
  })
})
