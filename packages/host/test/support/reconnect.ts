/**
 * Shared harness for the reconnect tests. The `vi.mock` calls must stay in each test file (they
 * are hoisted per file); their factories delegate here:
 *
 * ```ts
 * vi.mock('@enkaku/transport', async (importOriginal) => {
 *   const { mockTransportModule } = await import('./support/reconnect.js')
 *   return await mockTransportModule(importOriginal)
 * })
 * vi.mock('@mokei/context-client', async (importOriginal) => {
 *   const { mockClientModule } = await import('./support/reconnect.js')
 *   return await mockClientModule(importOriginal)
 * })
 * ```
 *
 * Only type imports of the mocked modules are allowed in this file.
 */
import type * as EnkakuTransport from '@enkaku/transport'
import type * as ContextClientModule from '@mokei/context-client'
import type { ServerConfig } from '@mokei/context-server'

import type { ContextHost } from '../../src/host.js'
import type { HostEvents } from '../../src/types.js'

type AnyTransport = { dispose(): Promise<void>; signal: AbortSignal }
export type Pair = { client: AnyTransport; server: AnyTransport }

export type RecordedCall = {
  client: unknown
  params: { name: string; timeout?: number; signal?: AbortSignal }
  error?: unknown
}

export const tracked = {
  // client transport -> its DirectTransports pair
  pairs: new WeakMap<object, unknown>(),
  // client -> the transport it was built with
  transports: new WeakMap<object, unknown>(),
  clients: [] as Array<unknown>,
  calls: [] as Array<RecordedCall>,
  beforeListTools: undefined as ((client: unknown) => Promise<void>) | undefined,
  afterListTools: undefined as ((client: unknown) => Promise<void>) | undefined,
  /** Wraps a client's `callTool` outcome, e.g. to stand in for a client-side error mapping. */
  mapCallTool: undefined as
    | ((client: unknown, outcome: Promise<unknown>) => Promise<unknown>)
    | undefined,
}

export function resetTracked(): void {
  tracked.beforeListTools = undefined
  tracked.afterListTools = undefined
  tracked.mapCallTool = undefined
  tracked.calls = []
}

export async function mockTransportModule(
  importOriginal: () => Promise<typeof EnkakuTransport>,
): Promise<typeof EnkakuTransport> {
  const original = await importOriginal()
  class TrackedDirectTransports<R, W> extends original.DirectTransports<R, W> {
    constructor(...args: ConstructorParameters<typeof original.DirectTransports>) {
      super(...args)
      tracked.pairs.set(this.client, this)
    }
  }
  return { ...original, DirectTransports: TrackedDirectTransports }
}

export async function mockClientModule(
  importOriginal: () => Promise<typeof ContextClientModule>,
): Promise<typeof ContextClientModule> {
  const original = await importOriginal()
  type Client = InstanceType<typeof original.ContextClient>
  class TrackedClient extends original.ContextClient {
    constructor(params: ConstructorParameters<typeof original.ContextClient>[0]) {
      super(params)
      tracked.transports.set(this, params.transport)
      tracked.clients.push(this)
      const callTool = this.callTool.bind(this) as (params: unknown) => Promise<unknown>
      this.callTool = ((params: RecordedCall['params']) => {
        const call: RecordedCall = { client: this, params }
        tracked.calls.push(call)
        const outcome = callTool(params)
        const mapped = tracked.mapCallTool?.(this, outcome) ?? outcome
        return mapped.catch((error: unknown) => {
          call.error = error
          throw error
        })
      }) as Client['callTool']
    }

    override async listTools(...args: Parameters<Client['listTools']>) {
      const hook = tracked.beforeListTools
      if (hook != null) await hook(this)
      const result = await super.listTools(...args)
      const after = tracked.afterListTools
      if (after != null) await after(this)
      return result
    }
  }
  // The overloads of the tracked methods are re-declared loosely; the runtime shape matches.
  return { ...original, ContextClient: TrackedClient } as unknown as typeof ContextClientModule
}

export function pairOf(host: ContextHost, key: string): Pair {
  const client = host.getContext(key).client
  return tracked.pairs.get(tracked.transports.get(client) as object) as Pair
}

/** Simulates a lost connection: the current generation's server side goes away. */
export async function loseServer(host: ContextHost, key: string): Promise<void> {
  await pairOf(host, key).server.dispose()
}

export function tool(description: string) {
  return {
    description,
    inputSchema: { type: 'object' as const },
    handler: () => ({ content: [] }),
  }
}

export function makeConfig(
  tools: ServerConfig['tools'] = { a: tool('a'), a2: tool('a2'), b: tool('b') },
) {
  return {
    name: 'direct',
    version: '1.0.0',
    protocolVersions: ['2025-11-25'],
    tools,
  } satisfies ServerConfig
}

export type Recorded = { name: keyof HostEvents; payload: unknown }

export function record(host: ContextHost): Array<Recorded> {
  const events: Array<Recorded> = []
  const names: Array<keyof HostEvents> = [
    'context:added',
    'context:removed',
    'context:failed',
    'context:reconnecting',
    'context:reconnected',
    'tools:changed',
  ]
  for (const name of names) {
    host.events.on(name, (payload) => {
      events.push({ name, payload })
    })
  }
  return events
}

export function nextEvent<N extends keyof HostEvents>(
  host: ContextHost,
  name: N,
): Promise<HostEvents[N]> {
  return new Promise((resolve) => {
    const off = host.events.on(name, (payload) => {
      off()
      resolve(payload)
    })
  })
}

export function deferred() {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/** Holds the next successful `listTools` result of `client` until released. */
export function holdNextListToolsResult(client: unknown) {
  const entered = deferred()
  const release = deferred()
  tracked.afterListTools = async (c) => {
    if (c !== client) return
    tracked.afterListTools = undefined
    entered.resolve()
    await release.promise
  }
  return { entered: entered.promise, release: release.resolve }
}

/** Blocks the next `listTools` of a client other than `except` until released. */
export function blockNextListTools(except?: unknown) {
  const entered = deferred()
  const release = deferred()
  let blockedClient: unknown
  tracked.beforeListTools = async (client) => {
    if (client === except) return
    tracked.beforeListTools = undefined
    blockedClient = client
    entered.resolve()
    await release.promise
  }
  return { entered: entered.promise, release: release.resolve, client: () => blockedClient }
}

export function isDisposed(client: unknown): boolean {
  return (client as { signal: AbortSignal }).signal.aborted
}
