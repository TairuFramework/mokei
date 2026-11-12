import type { ServerConfig } from '@mokei/context-server'
import { SpanStatusCode } from '@opentelemetry/api'
import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  ContextUnavailableError,
  ReconnectDeclinedError,
  ReconnectExhaustedError,
} from '../src/errors.js'
import { ContextHost } from '../src/host.js'
import { ReconnectController } from '../src/reconnect.js'
import { useTestTracing } from './support/otel.js'
import {
  blockNextListTools,
  holdNextListToolsResult,
  isDisposed,
  loseServer,
  makeConfig,
  nextEvent,
  pairOf,
  record,
  resetTracked,
  tool,
  tracked,
} from './support/reconnect.js'

vi.mock('@enkaku/transport', async (importOriginal) => {
  const { mockTransportModule } = await import('./support/reconnect.js')
  return await mockTransportModule(importOriginal)
})

vi.mock('@mokei/context-client', async (importOriginal) => {
  const { mockClientModule } = await import('./support/reconnect.js')
  return await mockClientModule(importOriginal)
})

const { exporter } = useTestTracing()

/** A config whose spread (one per factory call) throws while `failing` is set. */
function failingConfig() {
  const state = { failing: false, calls: 0 }
  const base = makeConfig()
  const config = {
    name: base.name,
    version: base.version,
    protocolVersions: base.protocolVersions,
    get tools() {
      if (state.failing) {
        state.calls += 1
        throw new Error(`factory ${state.calls}`)
      }
      return base.tools
    },
  } as ServerConfig
  return { state, config }
}

const hosts: Array<ContextHost> = []
function makeHost(params?: ConstructorParameters<typeof ContextHost>[0]): ContextHost {
  const host = new ContextHost(params)
  hosts.push(host)
  return host
}

afterEach(async () => {
  resetTracked()
  vi.useRealTimers()
  vi.restoreAllMocks()
  for (const host of hosts.splice(0)) await host.dispose()
})

describe('context reconnect (direct)', () => {
  test('reconnect off keeps today’s removal', async () => {
    const host = makeHost()
    const events = record(host)
    host.addDirectContext({ key: 'k', config: makeConfig() })
    await host.setup({ key: 'k' })
    const removed = nextEvent(host, 'context:removed')
    await loseServer(host, 'k')
    await removed
    expect(host.hasContext({ key: 'k' })).toBe(false)
    expect(events.map((e) => e.name)).not.toContain('context:reconnecting')
  })

  test('a loss before setup is not reconnected', async () => {
    const host = makeHost()
    const events = record(host)
    const client = host.addDirectContext({ key: 'k', config: makeConfig(), reconnect: true })
    await client.initialize()
    const removed = nextEvent(host, 'context:removed')
    await loseServer(host, 'k')
    await removed
    expect(host.hasContext({ key: 'k' })).toBe(false)
    expect(events.map((e) => e.name)).not.toContain('context:reconnecting')
  })

  test('reconnects and keeps enabled and allow by name', async () => {
    const host = makeHost()
    const tools = { a: tool('a'), a2: tool('a2'), b: tool('b') } as Record<
      string,
      ReturnType<typeof tool>
    >
    const first = host.addDirectContext({ key: 'k', config: makeConfig(tools), reconnect: true })
    await host.setup({ key: 'k' })
    host.disableContextTools({ key: 'k', toolNames: ['b'] })
    host.setContextTools({
      key: 'k',
      tools: host
        .getContext('k')
        .tools.map((ct) => (ct.tool.name === 'a' ? { ...ct, allow: 'always' as const } : ct)),
    })
    // The next generation's server advertises `c` and no longer `a2`.
    delete tools.a2
    tools.c = tool('c')
    const events = record(host)

    const reconnected = nextEvent(host, 'context:reconnected')
    await loseServer(host, 'k')
    await expect(reconnected).resolves.toEqual({ key: 'k', attempts: 1 })

    const context = host.getContext('k')
    expect(context.client).not.toBe(first)
    const byName = Object.fromEntries(context.tools.map((ct) => [ct.tool.name, ct]))
    expect(Object.keys(byName).sort()).toEqual(['a', 'b', 'c'])
    expect(byName.a).toMatchObject({ id: 'k:a', enabled: true, allow: 'always' })
    expect(byName.b?.enabled).toBe(false)
    expect(byName.c).toMatchObject({ id: 'k:c', enabled: true })
    expect(byName.c?.allow).toBeUndefined()
    expect(events.filter((e) => e.name === 'tools:changed')).toHaveLength(1)
    // The new client serves calls.
    await expect(context.client.listTools()).resolves.toMatchObject({
      tools: expect.arrayContaining([expect.objectContaining({ name: 'c' })]),
    })
  })

  test('events are ordered', async () => {
    const host = makeHost()
    host.addDirectContext({ key: 'k', config: makeConfig(), reconnect: true })
    await host.setup({ key: 'k' })
    const events = record(host)
    const reconnected = nextEvent(host, 'context:reconnected')
    await loseServer(host, 'k')
    await reconnected
    expect(events.map((e) => e.name)).toEqual(['context:reconnecting', 'context:reconnected'])
    expect(events[0]?.payload).toMatchObject({ key: 'k', attempt: 1 })
    expect((events[0]?.payload as { error?: unknown } | undefined)?.error).toBeInstanceOf(Error)
  })

  test('exhausted attempts fail then remove', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    vi.spyOn(Math, 'random').mockReturnValue(1)
    const host = makeHost()
    const { state, config } = failingConfig()
    host.addDirectContext({ key: 'k', config, reconnect: true })
    await host.setup({ key: 'k' })
    const events = record(host)
    state.failing = true
    const removed = nextEvent(host, 'context:removed')
    await loseServer(host, 'k')
    await vi.advanceTimersByTimeAsync(250 + 500 + 1000 + 2000)
    await removed

    expect(state.calls).toBe(5)
    const names = events.map((e) => e.name)
    expect(names.filter((n) => n === 'context:reconnecting')).toHaveLength(5)
    expect(names.slice(-2)).toEqual(['context:failed', 'context:removed'])
    const failed = events.find((e) => e.name === 'context:failed')
    const error = (failed?.payload as { error?: Error } | undefined)?.error as Error
    expect(error).toBeInstanceOf(ReconnectExhaustedError)
    expect((error as ReconnectExhaustedError).attempts).toBe(5)
    expect((error as ReconnectExhaustedError).key).toBe('k')
    expect((error.cause as Error).message).toBe('factory 5')
    expect(host.hasContext({ key: 'k' })).toBe(false)
  })

  test('backoff doubles from the initial delay', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    vi.spyOn(Math, 'random').mockReturnValue(1)
    const host = makeHost()
    const { state, config } = failingConfig()
    host.addDirectContext({ key: 'k', config, reconnect: true })
    await host.setup({ key: 'k' })
    state.failing = true
    await loseServer(host, 'k')
    await vi.advanceTimersByTimeAsync(0)
    expect(state.calls).toBe(1)
    await vi.advanceTimersByTimeAsync(249)
    expect(state.calls).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(state.calls).toBe(2)
    await vi.advanceTimersByTimeAsync(499)
    expect(state.calls).toBe(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(state.calls).toBe(3)
  })

  test('the lost client is disposed at once', async () => {
    const host = makeHost()
    const first = host.addDirectContext({ key: 'k', config: makeConfig(), reconnect: true })
    await host.setup({ key: 'k' })
    const pair = pairOf(host, 'k')
    const block = blockNextListTools()
    await loseServer(host, 'k')
    // The candidate is still blocked: no attempt has resolved, yet the lost generation is gone.
    await block.entered
    await vi.waitFor(() => {
      expect(isDisposed(first)).toBe(true)
      expect(pair.client.signal.aborted).toBe(true)
    })
    expect(host.getContext('k').client).toBe(first)
    block.release()
    await nextEvent(host, 'context:reconnected')
  })

  test('remove during reconnect stops the loop', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    vi.spyOn(Math, 'random').mockReturnValue(1)
    const host = makeHost()
    const { state, config } = failingConfig()
    host.addDirectContext({ key: 'k', config, reconnect: true })
    await host.setup({ key: 'k' })
    const events = record(host)
    state.failing = true
    await loseServer(host, 'k')
    await vi.advanceTimersByTimeAsync(0)
    expect(state.calls).toBe(1)
    await host.remove('k')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(state.calls).toBe(1)
    const names = events.map((e) => e.name)
    expect(names).not.toContain('context:failed')
    expect(names.filter((n) => n === 'context:removed')).toHaveLength(1)
  })

  test('a late attempt never touches a re-added key', async () => {
    const host = makeHost()
    host.addDirectContext({ key: 'k', config: makeConfig(), reconnect: true })
    await host.setup({ key: 'k' })
    const block = blockNextListTools()
    await loseServer(host, 'k')
    await block.entered
    const candidate = block.client()

    await host.remove('k')
    const events = record(host)
    const replacement = host.addDirectContext({ key: 'k', config: makeConfig({ z: tool('z') }) })
    await host.setup({ key: 'k' })
    block.release()

    await vi.waitFor(() => expect(isDisposed(candidate)).toBe(true))
    // Let any stale continuation run.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(host.getContext('k').client).toBe(replacement)
    expect(host.getContext('k').tools.map((ct) => ct.tool.name)).toEqual(['z'])
    expect(events.map((e) => e.name)).toEqual(['context:added'])
  })

  test('offline pauses without spending attempts', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    vi.spyOn(Math, 'random').mockReturnValue(1)
    let online = true
    let listener: ((online: boolean) => void) | undefined
    const host = makeHost({
      connectivity: {
        isOnline: () => online,
        subscribe: (l) => {
          listener = l
          return () => {
            listener = undefined
          }
        },
      },
    })
    host.addDirectContext({ key: 'k', config: makeConfig(), reconnect: true })
    await host.setup({ key: 'k' })
    const events = record(host)
    const clientsBefore = tracked.clients.length
    online = false
    await loseServer(host, 'k')
    await vi.advanceTimersByTimeAsync(3 * 5_000)
    expect(tracked.clients.length).toBe(clientsBefore)
    expect(events.filter((e) => e.name === 'context:reconnected')).toHaveLength(0)

    const reconnected = nextEvent(host, 'context:reconnected')
    online = true
    listener?.(true)
    await vi.advanceTimersByTimeAsync(0)
    await expect(reconnected).resolves.toEqual({ key: 'k', attempts: 1 })
    const attempts = events
      .filter((e) => e.name === 'context:reconnecting')
      .map((e) => (e.payload as { attempt: number }).attempt)
    expect(attempts).toEqual([1])
  })

  test('a throwing isOnline counts as online', async () => {
    const host = makeHost({
      connectivity: {
        isOnline: () => {
          throw new Error('no connectivity info')
        },
      },
    })
    host.addDirectContext({ key: 'k', config: makeConfig(), reconnect: true })
    await host.setup({ key: 'k' })
    const reconnected = nextEvent(host, 'context:reconnected')
    await loseServer(host, 'k')
    await expect(reconnected).resolves.toEqual({ key: 'k', attempts: 1 })
  })

  test('setup during reconnect waits and setup after a swap returns current tools', async () => {
    const host = makeHost()
    host.addDirectContext({ key: 'k', config: makeConfig(), reconnect: true })
    await host.setup({ key: 'k' })
    host.disableContextTools({ key: 'k', toolNames: ['b'] })

    // While reconnecting, setup waits for the swap and returns the current tools.
    const block = blockNextListTools()
    await loseServer(host, 'k')
    await block.entered
    let settled = false
    const during = host.setup({ key: 'k', enableTools: false }).finally(() => {
      settled = true
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(settled).toBe(false)
    block.release()
    const duringTools = await during
    expect(duringTools.find((ct) => ct.tool.name === 'b')?.enabled).toBe(false)
    expect(duringTools.find((ct) => ct.tool.name === 'a')?.enabled).toBe(true)

    // Setup started on a client that is swapped out meanwhile discards its own result.
    const current = host.getContext('k').client
    const setupBlock = blockNextListTools()
    const after = host.setup({ key: 'k', enableTools: false })
    await setupBlock.entered
    expect(setupBlock.client()).toBe(current)
    const reconnected = nextEvent(host, 'context:reconnected')
    await loseServer(host, 'k')
    await reconnected
    setupBlock.release()
    const afterTools = await after
    expect(afterTools).toBe(host.getContext('k').tools)
    expect(afterTools.find((ct) => ct.tool.name === 'a')?.enabled).toBe(true)
    expect(afterTools.find((ct) => ct.tool.name === 'b')?.enabled).toBe(false)
  })

  test('a refresh from a lost generation publishes nothing', async () => {
    const host = makeHost()
    host.addDirectContext({ key: 'k', config: makeConfig(), reconnect: true })
    await host.setup({ key: 'k' })
    const lost = host.getContext('k').client
    const events = record(host)
    const held = holdNextListToolsResult(lost)
    void lost.events.emit('toolsListChanged')
    await held.entered
    // The replacement's discovery is blocked, so the lost client is still registered.
    const block = blockNextListTools(lost)
    await loseServer(host, 'k')
    await block.entered
    host.setContextTools({
      key: 'k',
      tools: host.getContext('k').tools.filter((ct) => ct.tool.name === 'a'),
    })
    held.release()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(host.getContext('k').tools.map((ct) => ct.tool.name)).toEqual(['a'])
    expect(events.map((e) => e.name)).not.toContain('tools:changed')
    block.release()
    await nextEvent(host, 'context:reconnected')
  })

  test('a failure listener that re-adds the key keeps the replacement', async () => {
    const host = makeHost()
    const { state, config } = failingConfig()
    host.addDirectContext({ key: 'k', config, reconnect: { maxAttempts: 1 } })
    await host.setup({ key: 'k' })
    let replacement: unknown
    host.events.on('context:failed', () => {
      void host.remove('k')
      replacement = host.addDirectContext({ key: 'k', config: makeConfig() })
    })
    state.failing = true
    const failed = nextEvent(host, 'context:failed')
    await loseServer(host, 'k')
    await failed
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(replacement).toBeDefined()
    expect(host.hasContext({ key: 'k' })).toBe(true)
    expect(host.getContext('k').client).toBe(replacement)
  })

  test('a reconnected listener that removes the key suppresses tools:changed', async () => {
    const host = makeHost()
    const tools = { a: tool('a'), b: tool('b') } as Record<string, ReturnType<typeof tool>>
    host.addDirectContext({ key: 'k', config: makeConfig(tools), reconnect: true })
    await host.setup({ key: 'k' })
    tools.c = tool('c')
    const events = record(host)
    host.events.on('context:reconnected', () => {
      void host.remove('k')
    })
    const removed = nextEvent(host, 'context:removed')
    await loseServer(host, 'k')
    await removed
    expect(events.map((e) => e.name)).toContain('context:reconnected')
    expect(events.map((e) => e.name)).not.toContain('tools:changed')
  })

  test('setup never runs enableTools on superseded discovery', async () => {
    const host = makeHost()
    host.addDirectContext({ key: 'k', config: makeConfig(), reconnect: true })
    await host.setup({ key: 'k' })
    const lost = host.getContext('k').client
    const held = holdNextListToolsResult(lost)
    const enableTools = vi.fn(() => false)
    const pending = host.setup({ key: 'k', enableTools })
    await held.entered
    const reconnected = nextEvent(host, 'context:reconnected')
    await loseServer(host, 'k')
    await reconnected
    held.release()
    const tools = await pending
    expect(enableTools).not.toHaveBeenCalled()
    expect(tools).toBe(host.getContext('k').tools)
    expect(tools.every((ct) => ct.enabled)).toBe(true)
  })

  test('invalid reconnect options fail the add', () => {
    const host = makeHost()
    expect(() =>
      host.addDirectContext({ key: 'k', config: makeConfig(), reconnect: { maxAttempts: 0 } }),
    ).toThrow(RangeError)
    expect(host.hasContext({ key: 'k' })).toBe(false)
  })

  test('HTTP and direct contexts emit context:added', async () => {
    const host = makeHost()
    const added: Array<string> = []
    host.events.on('context:added', ({ key }) => {
      added.push(key)
    })
    host.addDirectContext({ key: 'direct', config: makeConfig() })
    await host.addHTTPContext({ key: 'http', url: 'http://127.0.0.1:1/mcp' })
    expect(added).toEqual(['direct', 'http'])
  })

  test('the new context span links to the lost one', async () => {
    const host = makeHost()
    host.addDirectContext({ key: 'k', config: makeConfig(), reconnect: true })
    await host.setup({ key: 'k' })
    const reconnected = nextEvent(host, 'context:reconnected')
    await loseServer(host, 'k')
    await reconnected
    await host.remove('k')
    const roots = exporter.getFinishedSpans().filter((span) => span.name === 'mcp.context')
    expect(roots).toHaveLength(2)
    const [lost, next] = roots
    expect(lost?.attributes['error.type']).toBe('context.lost')
    expect(lost?.status.code).toBe(SpanStatusCode.ERROR)
    expect(next?.attributes['mokei.context.reconnect.attempt']).toBe(1)
    expect(next?.links[0]?.context.spanId).toBe(lost?.spanContext().spanId)
    expect(next?.status.code).toBe(SpanStatusCode.UNSET)
  })
})

describe('ReconnectController gate', () => {
  function controller() {
    return new ReconnectController({
      key: 'k',
      options: {},
      factory: () => new Promise(() => {}),
      hooks: {
        commit: () => null,
        fail: () => {},
        quiesce: () => {},
        emit: () => {},
      },
    })
  }

  test('an open gate passes at once', async () => {
    const ctl = controller()
    await expect(ctl.waitForGate({ deadline: Date.now() + 1_000 })).resolves.toBeUndefined()
  })

  test('a closed gate times out with ContextUnavailableError', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const ctl = controller()
    ctl.arm()
    ctl.lose(ctl.generation, new Error('lost'))
    const wait = ctl.waitForGate({ deadline: Date.now() + 100 })
    const assertion = expect(wait).rejects.toBeInstanceOf(ContextUnavailableError)
    await vi.advanceTimersByTimeAsync(100)
    await assertion
    ctl.abort(new Error('done'))
  })

  test('a caller abort wins and rejects with its reason', async () => {
    const ctl = controller()
    ctl.arm()
    ctl.lose(ctl.generation, new Error('lost'))
    const aborter = new AbortController()
    const wait = ctl.waitForGate({ signal: aborter.signal, deadline: Date.now() + 10_000 })
    const reason = new Error('caller abort')
    aborter.abort(reason)
    await expect(wait).rejects.toBe(reason)
    ctl.abort(new Error('done'))
  })

  test('a declining factory gives up at once with attempts 0', async () => {
    const declined = new ReconnectDeclinedError('respawn declined')
    const factory = vi.fn(() => Promise.reject(declined))
    const fail = vi.fn()
    const ctl = new ReconnectController({
      key: 'k',
      options: { initialDelayMs: 1, maxDelayMs: 1 },
      factory,
      hooks: { commit: () => null, fail, quiesce: () => {}, emit: () => {} },
    })
    ctl.arm()
    ctl.lose(ctl.generation, new Error('lost'))
    const error = await ctl.waitForGate({ deadline: Date.now() + 10_000 }).catch((e: unknown) => e)
    expect(factory).toHaveBeenCalledTimes(1)
    expect(fail).toHaveBeenCalledTimes(1)
    const failure = fail.mock.calls[0]?.[0] as ReconnectExhaustedError
    expect(failure).toBeInstanceOf(ReconnectExhaustedError)
    expect(failure.attempts).toBe(0)
    expect(failure.cause).toBe(declined)
    expect(error).toBeInstanceOf(ContextUnavailableError)
    expect((error as ContextUnavailableError).cause).toBe(failure)
  })

  test('abort fails waiters with ContextUnavailableError carrying the removal', async () => {
    const ctl = controller()
    ctl.arm()
    ctl.lose(ctl.generation, new Error('lost'))
    const wait = ctl.waitForGate({ deadline: Date.now() + 10_000 })
    const removal = new Error('removed')
    ctl.abort(removal)
    const error = await wait.catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ContextUnavailableError)
    expect((error as ContextUnavailableError).cause).toBe(removal)
  })
})
