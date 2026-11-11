import { TaskInterruptedError } from '@mokei/context-client'
import { TransportClosedError } from '@mokei/context-rpc'
import type { ServerConfig } from '@mokei/context-server'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { ContextUnavailableError } from '../src/errors.js'
import { ContextHost } from '../src/host.js'
import {
  blockNextListTools,
  deferred,
  loseServer,
  makeConfig,
  nextEvent,
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

/** Exposes the host's loss report so a test can lose a context synchronously. */
class TestHost extends ContextHost {
  loseNow(key: string): void {
    this.reportLoss(key, this.getContext(key).client, new Error('lost again'))
  }
}

const hosts: Array<ContextHost> = []
function makeHost(): TestHost {
  const host = new TestHost()
  hosts.push(host)
  return host
}

const releases: Array<() => void> = []

afterEach(async () => {
  for (const release of releases.splice(0)) release()
  resetTracked()
  vi.useRealTimers()
  for (const host of hosts.splice(0)) await host.dispose()
})

function callsOn(client: unknown) {
  return tracked.calls.filter((call) => call.client === client)
}

/** Loses `k` with the replacement's discovery blocked, so the context stays reconnecting. */
async function loseBlocked(host: ContextHost) {
  const lost = host.getContext('k').client
  const block = blockNextListTools(lost)
  releases.push(block.release)
  await loseServer(host, 'k')
  await block.entered
  return { lost, release: block.release }
}

/**
 * Tools whose first call blocks until its server goes away; later calls answer `ok`.
 * `entered` resolves once the first call is running on the server.
 */
function lossTools(annotations?: { readOnlyHint?: boolean }) {
  const entered = deferred()
  let calls = 0
  const blocking = {
    description: 'blocks once',
    inputSchema: { type: 'object' as const },
    ...(annotations == null ? {} : { annotations }),
    handler: async ({ signal }: { signal: AbortSignal }) => {
      calls += 1
      if (calls === 1) {
        entered.resolve()
        await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
      }
      return { content: [{ type: 'text' as const, text: 'ok' }] }
    },
  }
  const tools = { r: blocking, a: tool('a') } as unknown as ServerConfig['tools']
  return { tools, entered: entered.promise, calls: () => calls }
}

describe('call gate', () => {
  test('a call during reconnect waits and runs on the new client', async () => {
    const host = makeHost()
    host.addDirectContext({ key: 'k', config: makeConfig(), reconnect: true })
    await host.setup({ key: 'k' })
    const { lost, release } = await loseBlocked(host)

    let settled = false
    const pending = host.callTool({ key: 'k', name: 'a', arguments: {} }).finally(() => {
      settled = true
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(settled).toBe(false)
    release()
    await expect(pending).resolves.toMatchObject({ content: [] })
    const current = host.getContext('k').client
    expect(current).not.toBe(lost)
    expect(callsOn(lost)).toHaveLength(0)
    expect(callsOn(current)).toHaveLength(1)
  })

  test('gate timeout fails with ContextUnavailableError', async () => {
    const host = makeHost()
    host.addDirectContext({ key: 'k', config: makeConfig(), reconnect: { gateTimeoutMs: 50 } })
    await host.setup({ key: 'k' })
    await loseBlocked(host)

    await expect(host.callTool({ key: 'k', name: 'a', arguments: {} })).rejects.toBeInstanceOf(
      ContextUnavailableError,
    )
    await expect(host.callNamespacedTool({ id: 'k:a' })).resolves.toEqual({
      isError: true,
      content: [{ type: 'text', text: 'Context k is unavailable' }],
    })
    await expect(host.getPrompt({ key: 'k', name: 'p', arguments: {} })).rejects.toBeInstanceOf(
      ContextUnavailableError,
    )
  })

  test('the deadline covers the wait', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const host = makeHost()
    host.addDirectContext({ key: 'k', config: makeConfig(), reconnect: true })
    await host.setup({ key: 'k' })
    const { release } = await loseBlocked(host)

    const pending = host.callTool({ key: 'k', name: 'a', arguments: {}, timeout: 100 })
    await vi.advanceTimersByTimeAsync(80)
    release()
    await vi.advanceTimersByTimeAsync(0)
    await expect(pending).resolves.toMatchObject({ content: [] })
    const current = host.getContext('k').client
    const [call] = callsOn(current)
    expect(call?.params.timeout).toBeGreaterThan(0)
    expect(call?.params.timeout).toBeLessThanOrEqual(20)
  })

  test('abort wins over a gate opening', async () => {
    const host = makeHost()
    host.addDirectContext({ key: 'k', config: makeConfig(), reconnect: true })
    await host.setup({ key: 'k' })
    const { release } = await loseBlocked(host)

    const aborter = new AbortController()
    const reason = new Error('caller abort')
    // Listeners run synchronously right after the gate opens: the same tick.
    host.events.on('context:reconnected', () => {
      aborter.abort(reason)
    })
    const direct = host.callTool({ key: 'k', name: 'a', arguments: {}, signal: aborter.signal })
    const namespaced = host.callNamespacedTool({ id: 'k:a', signal: aborter.signal })
    const directError = direct.catch((error: unknown) => error)
    const namespacedError = namespaced.catch((error: unknown) => error)
    release()
    await expect(directError).resolves.toBe(reason)
    await expect(namespacedError).resolves.toBe(reason)
    expect(callsOn(host.getContext('k').client)).toHaveLength(0)
  })

  test('a removed and re-added key fails the waiting call', async () => {
    const host = makeHost()
    host.addDirectContext({ key: 'k', config: makeConfig(), reconnect: true })
    await host.setup({ key: 'k' })
    await loseBlocked(host)

    // Removed while waiting at the gate.
    const removedCall = host.callTool({ key: 'k', name: 'a', arguments: {} })
    const removedError = removedCall.catch((error: unknown) => error)
    await host.remove('k')
    host.addDirectContext({ key: 'k', config: makeConfig(), reconnect: true })
    await host.setup({ key: 'k' })
    expect(await removedError).toBeInstanceOf(ContextUnavailableError)
    expect(callsOn(host.getContext('k').client)).toHaveLength(0)

    // Removed and re-added as the gate opens: the waiter wakes on a different registration.
    const { release } = await loseBlocked(host)
    host.events.on('context:reconnected', () => {
      void host.remove('k')
      host.addDirectContext({ key: 'k', config: makeConfig() })
    })
    const swappedError = host
      .callTool({ key: 'k', name: 'a', arguments: {} })
      .catch((error: unknown) => error)
    release()
    expect(await swappedError).toBeInstanceOf(ContextUnavailableError)
    expect(callsOn(host.getContext('k').client)).toHaveLength(0)
  })
  test('a deadline that expires as the gate opens fails before dispatch', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const host = makeHost()
    host.addDirectContext({ key: 'k', config: makeConfig(), reconnect: true })
    await host.setup({ key: 'k' })
    const { release } = await loseBlocked(host)
    // Time passes between the gate opening and the waiter resuming.
    host.events.on('context:reconnected', () => {
      vi.setSystemTime(Date.now() + 150)
    })
    const error = host
      .callTool({ key: 'k', name: 'a', arguments: {}, timeout: 100 })
      .catch((e: unknown) => e)
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(await error).toBeInstanceOf(ContextUnavailableError)
    expect(callsOn(host.getContext('k').client)).toHaveLength(0)
  })

  test('a gate that closes again before dispatch is waited out', async () => {
    const host = makeHost()
    host.addDirectContext({ key: 'k', config: makeConfig(), reconnect: true })
    await host.setup({ key: 'k' })
    const { release } = await loseBlocked(host)
    let relost: unknown
    const off = host.events.on('context:reconnected', () => {
      off()
      relost = host.getContext('k').client
      host.loseNow('k')
    })
    const pending = host.callTool({ key: 'k', name: 'a', arguments: {} })
    release()
    await expect(pending).resolves.toMatchObject({ content: [] })
    const current = host.getContext('k').client
    expect(relost).toBeDefined()
    expect(current).not.toBe(relost)
    expect(callsOn(relost)).toHaveLength(0)
    expect(callsOn(current)).toHaveLength(1)
  })
  test('the dispatch budget is the one checked against the deadline', async () => {
    const host = makeHost()
    host.addDirectContext({ key: 'k', config: makeConfig(), reconnect: true })
    await host.setup({ key: 'k' })
    // The clock reads 0 at entry, then 99, then 100: a second read before dispatch would
    // cross the 100 ms deadline after the guard passed.
    const readings = [0, 99, 100]
    const now = vi.spyOn(Date, 'now').mockImplementation(() => readings.shift() ?? 100)
    const outcome = host
      .callTool({ key: 'k', name: 'a', arguments: {}, timeout: 100 })
      .catch((e: unknown) => e)
    await outcome
    now.mockRestore()
    const calls = callsOn(host.getContext('k').client)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.params.timeout).toBe(1)
  })
})

describe('read-only retry', () => {
  test('a retry whose deadline expires as the gate opens fails before dispatch', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const host = makeHost()
    const { tools, entered } = lossTools({ readOnlyHint: true })
    host.addDirectContext({ key: 'k', config: makeConfig(tools), reconnect: true })
    await host.setup({ key: 'k' })
    host.events.on('context:reconnected', () => {
      vi.setSystemTime(Date.now() + 150)
    })
    const error = host
      .callTool({ key: 'k', name: 'r', arguments: {}, timeout: 100 })
      .catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(0)
    await entered
    await loseServer(host, 'k')
    await vi.advanceTimersByTimeAsync(0)
    expect(await error).toBeInstanceOf(ContextUnavailableError)
    expect(callsOn(host.getContext('k').client)).toHaveLength(0)
  })

  test('a read-only call lost in flight is retried once', async () => {
    const host = makeHost()
    const { tools, entered, calls } = lossTools({ readOnlyHint: true })
    host.addDirectContext({ key: 'k', config: makeConfig(tools), reconnect: true })
    await host.setup({ key: 'k' })
    const lost = host.getContext('k').client

    const pending = host.callTool({ key: 'k', name: 'r', arguments: {} })
    await entered
    await loseServer(host, 'k')
    await expect(pending).resolves.toEqual({ content: [{ type: 'text', text: 'ok' }] })

    const current = host.getContext('k').client
    expect(current).not.toBe(lost)
    const [lostCall] = callsOn(lost)
    expect(lostCall?.error).toBeInstanceOf(TransportClosedError)
    expect(callsOn(lost)).toHaveLength(1)
    expect(callsOn(current)).toHaveLength(1)
    expect(calls()).toBe(2)
  })

  test('the retry keeps the remaining deadline', async () => {
    const host = makeHost()
    const { tools, entered } = lossTools({ readOnlyHint: true })
    host.addDirectContext({ key: 'k', config: makeConfig(tools), reconnect: true })
    await host.setup({ key: 'k' })

    const pending = host.callTool({ key: 'k', name: 'r', arguments: {}, timeout: 5_000 })
    await entered
    await new Promise((resolve) => setTimeout(resolve, 30))
    await loseServer(host, 'k')
    await pending
    const [retried] = callsOn(host.getContext('k').client)
    expect(retried?.params.timeout).toBeLessThanOrEqual(5_000 - 30)
  })

  describe('non-read-only, timeouts, aborts and interrupted tasks are not retried', () => {
    test('a tool without readOnlyHint', async () => {
      const host = makeHost()
      const { tools, entered } = lossTools()
      host.addDirectContext({ key: 'k', config: makeConfig(tools), reconnect: true })
      await host.setup({ key: 'k' })
      const reconnected = nextEvent(host, 'context:reconnected')
      const error = host.callTool({ key: 'k', name: 'r', arguments: {} }).catch((e: unknown) => e)
      await entered
      await loseServer(host, 'k')
      expect(await error).toBeInstanceOf(TransportClosedError)
      await reconnected
      expect(callsOn(host.getContext('k').client)).toHaveLength(0)
    })

    test('a timed-out call', async () => {
      const host = makeHost()
      const { tools, entered } = lossTools({ readOnlyHint: true })
      host.addDirectContext({ key: 'k', config: makeConfig(tools), reconnect: true })
      await host.setup({ key: 'k' })
      const lost = host.getContext('k').client
      const error = host
        .callTool({ key: 'k', name: 'r', arguments: {}, timeout: 30 })
        .catch((e: unknown) => e)
      await entered
      // The client ends a timed-out exchange as cancelled; the timeout is the signal's reason.
      const thrown = await error
      expect(thrown).toBe(callsOn(lost)[0]?.error)
      expect(thrown).not.toBeInstanceOf(TransportClosedError)
      const reconnected = nextEvent(host, 'context:reconnected')
      await loseServer(host, 'k')
      await reconnected
      expect(callsOn(host.getContext('k').client)).toHaveLength(0)
    })

    test('an aborted call', async () => {
      const host = makeHost()
      const { tools, entered } = lossTools({ readOnlyHint: true })
      host.addDirectContext({ key: 'k', config: makeConfig(tools), reconnect: true })
      await host.setup({ key: 'k' })
      const lost = host.getContext('k').client
      const aborter = new AbortController()
      const reason = new Error('caller abort')
      const error = host
        .callTool({ key: 'k', name: 'r', arguments: {}, signal: aborter.signal })
        .catch((e: unknown) => e)
      await entered
      const reconnected = nextEvent(host, 'context:reconnected')
      aborter.abort(reason)
      await loseServer(host, 'k')
      const thrown = await error
      expect(thrown).toBe(callsOn(lost)[0]?.error)
      expect(thrown).not.toBeInstanceOf(TransportClosedError)
      await reconnected
      expect(callsOn(host.getContext('k').client)).toHaveLength(0)
    })

    test('an interrupted task', async () => {
      const host = makeHost()
      const { tools, entered } = lossTools({ readOnlyHint: true })
      host.addDirectContext({ key: 'k', config: makeConfig(tools), reconnect: true })
      await host.setup({ key: 'k' })
      const lost = host.getContext('k').client
      // Stands in for a server that returned a task before the loss: the client maps the
      // transport loss to TaskInterruptedError (covered in @mokei/context-client).
      tracked.mapCallTool = (client, outcome) =>
        client === lost
          ? outcome.catch((cause: unknown) => {
              throw new TaskInterruptedError({ taskID: 'task-1', cause })
            })
          : outcome
      const reconnected = nextEvent(host, 'context:reconnected')
      const error = host.callTool({ key: 'k', name: 'r', arguments: {} }).catch((e: unknown) => e)
      await entered
      await loseServer(host, 'k')
      const thrown = await error
      expect(thrown).toBeInstanceOf(TaskInterruptedError)
      expect((thrown as TaskInterruptedError).cause).toBeInstanceOf(TransportClosedError)
      await reconnected
      expect(callsOn(host.getContext('k').client)).toHaveLength(0)
    })
  })
})
