import { DirectTransports, type TransportType } from '@enkaku/transport'
import type { AnyMessage } from '@mokei/context-protocol'
import { defer } from '@sozai/async'
import type { Validator } from '@sozai/schema'
import { describe, expect, test, vi } from 'vitest'

import { RequestTimeoutError, TransportClosedError } from '../src/error.js'
import { ContextRPC, type RPCTypes } from '../src/rpc.js'

// Passthrough validator — these tests exercise transport lifecycle, not schema.
const passthrough = ((message: unknown) => ({ value: message })) as unknown as Validator<AnyMessage>

type TestTypes = RPCTypes & {
  SendRequests: { 'tools/list': { Params: Record<string, unknown>; Result: unknown } }
}

function makeRPC(transport: TransportType<AnyMessage, AnyMessage>): ContextRPC<TestTypes> {
  return new ContextRPC<TestTypes>({ transport, validateMessageIn: passthrough })
}

describe('ContextRPC transport lifecycle', () => {
  test('rejects pending requests with TransportClosedError on dispose', async () => {
    const transports = new DirectTransports<AnyMessage, AnyMessage>()
    const rpc = makeRPC(transports.client)
    rpc._handle()

    const pending = rpc.request('tools/list', {})
    const settled = pending.then(
      () => ({ ok: true }),
      (error: unknown) => ({ ok: false, error }),
    )

    await rpc.dispose()
    const outcome = await settled
    expect(outcome.ok).toBe(false)
    expect((outcome as { error: unknown }).error).toBeInstanceOf(TransportClosedError)

    await transports.dispose()
  })

  test('aborting an already-settled request does not notify cancellation', async () => {
    const transports = new DirectTransports<AnyMessage, AnyMessage>()
    const rpc = makeRPC(transports.client)
    rpc._handle()
    const notifySpy = vi.spyOn(rpc, 'notify')
    const controller = new AbortController()

    const pending = rpc.request('tools/list', {}, { signal: controller.signal })
    await transports.server.write({ jsonrpc: '2.0', id: 0, result: { tools: [] } } as AnyMessage)
    await expect(pending).resolves.toEqual({ tools: [] })

    controller.abort()
    await Promise.resolve()
    expect(notifySpy).not.toHaveBeenCalled()

    await rpc.dispose()
    await transports.dispose()
  })

  test('opt-in timeout rejects with RequestTimeoutError and notifies cancellation', async () => {
    const transports = new DirectTransports<AnyMessage, AnyMessage>()
    const rpc = makeRPC(transports.client)
    rpc._handle()
    const notifySpy = vi.spyOn(rpc, 'notify')

    const pending = rpc.request('tools/list', {}, { timeout: 30 })
    await expect(pending).rejects.toBeInstanceOf(RequestTimeoutError)
    expect(notifySpy).toHaveBeenCalledWith('cancelled', { requestId: 0 })

    await rpc.dispose()
    await transports.dispose()
  })

  test('aborting a pending request rejects it and notifies cancellation', async () => {
    const transports = new DirectTransports<AnyMessage, AnyMessage>()
    const rpc = makeRPC(transports.client)
    rpc._handle()
    const notifySpy = vi.spyOn(rpc, 'notify')
    const controller = new AbortController()

    const pending = rpc.request('tools/list', {}, { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toThrow('Cancelled')
    expect(notifySpy).toHaveBeenCalledWith('cancelled', { requestId: 0 })

    await rpc.dispose()
    await transports.dispose()
  })

  test('a signal aborted before the call rejects and writes nothing', async () => {
    const transports = new DirectTransports<AnyMessage, AnyMessage>()
    const rpc = makeRPC(transports.client)
    rpc._handle()
    const writeSpy = vi.spyOn(rpc, '_write')

    const reason = new Error('too late')
    const pending = rpc.request('tools/list', {}, { signal: AbortSignal.abort(reason) })

    await expect(pending).rejects.toBe(reason)
    expect(writeSpy).not.toHaveBeenCalled()

    await rpc.dispose()
    await transports.dispose()
  })

  test('a settled request removes its abort listener from the caller signal', async () => {
    const transports = new DirectTransports<AnyMessage, AnyMessage>()
    const rpc = makeRPC(transports.client)
    rpc._handle()
    const controller = new AbortController()
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener')

    const pending = rpc.request('tools/list', {}, { signal: controller.signal })
    await transports.server.write({ jsonrpc: '2.0', id: 0, result: { tools: [] } } as AnyMessage)
    await pending
    // Give the settle callback a turn.
    await Promise.resolve()

    expect(removeSpy).toHaveBeenCalled()

    await rpc.dispose()
    await transports.dispose()
  })

  test('_registerStreamExchange resolves on an inbound response', async () => {
    const transports = new DirectTransports<AnyMessage, AnyMessage>()
    const rpc = makeRPC(transports.client)
    rpc._handle()

    const pending = rpc._registerStreamExchange('tools/call', {})
    // Reply from the server side; request id starts at 0.
    await transports.server.write({ jsonrpc: '2.0', id: 0, result: { done: true } } as AnyMessage)
    await expect(pending).resolves.toEqual({ done: true })

    await rpc.dispose()
    await transports.dispose()
  })

  test('does not answer ping itself — the protocol layer decides', async () => {
    const transports = new DirectTransports<AnyMessage, AnyMessage>()
    const handled: Array<string> = []
    class TestRPC extends ContextRPC<TestTypes> {
      _handleRequest(request: TestTypes['HandleRequest']): Record<string, never> {
        handled.push(request.method)
        return {}
      }
    }
    const rpc = new TestRPC({ transport: transports.client, validateMessageIn: passthrough })
    rpc._handle()
    await transports.server.write({ jsonrpc: '2.0', id: 1, method: 'ping' } as AnyMessage)
    await vi.waitFor(() => expect(handled).toEqual(['ping']))
    await rpc.dispose()
    await transports.dispose()
  })

  test('a quick request behind a slow one answers first', async () => {
    const transports = new DirectTransports<AnyMessage, AnyMessage>()
    const slow = defer<void>()
    class TestRPC extends ContextRPC<TestTypes> {
      async _handleRequest(request: TestTypes['HandleRequest']): Promise<Record<string, unknown>> {
        if (request.method === 'slow') {
          await slow.promise
        }
        return { method: request.method }
      }
    }
    const rpc = new TestRPC({ transport: transports.client, validateMessageIn: passthrough })
    rpc._handle()

    const answered: Array<unknown> = []
    void (async () => {
      for await (const message of transports.server) {
        answered.push((message as { result?: { method?: string } }).result?.method)
      }
    })()

    await transports.server.write({ jsonrpc: '2.0', id: 1, method: 'slow' } as AnyMessage)
    await transports.server.write({ jsonrpc: '2.0', id: 2, method: 'quick' } as AnyMessage)

    await vi.waitFor(() => expect(answered).toEqual(['quick']))
    slow.resolve()
    await vi.waitFor(() => expect(answered).toEqual(['quick', 'slow']))

    await rpc.dispose()
    await transports.dispose()
  })

  test('a notification is handled while a request is in flight', async () => {
    const transports = new DirectTransports<AnyMessage, AnyMessage>()
    const slow = defer<void>()
    const notified: Array<string> = []
    class TestRPC extends ContextRPC<TestTypes> {
      async _handleRequest(): Promise<Record<string, unknown>> {
        await slow.promise
        return {}
      }
      _handleNotification(notification: { method: string }): void {
        notified.push(notification.method)
      }
    }
    const rpc = new TestRPC({ transport: transports.client, validateMessageIn: passthrough })
    rpc._handle()

    await transports.server.write({ jsonrpc: '2.0', id: 1, method: 'slow' } as AnyMessage)
    await transports.server.write({
      jsonrpc: '2.0',
      method: 'notifications/progress',
    } as AnyMessage)

    await vi.waitFor(() => expect(notified).toEqual(['notifications/progress']))
    slow.resolve()

    await rpc.dispose()
    await transports.dispose()
  })

  test('notifications/cancelled aborts a handler that is still running', async () => {
    const transports = new DirectTransports<AnyMessage, AnyMessage>()
    const started = defer<AbortSignal>()
    const never = defer<void>()
    class TestRPC extends ContextRPC<TestTypes> {
      async _handleRequest(
        _request: TestTypes['HandleRequest'],
        signal: AbortSignal,
      ): Promise<Record<string, unknown>> {
        started.resolve(signal)
        await never.promise
        return {}
      }
    }
    const rpc = new TestRPC({ transport: transports.client, validateMessageIn: passthrough })
    rpc._handle()

    await transports.server.write({ jsonrpc: '2.0', id: 1, method: 'slow' } as AnyMessage)
    const signal = await started.promise
    await transports.server.write({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId: 1 },
    } as AnyMessage)

    await vi.waitFor(() => expect(signal.aborted).toBe(true))

    never.resolve()
    await rpc.dispose()
    await transports.dispose()
  })

  test('dispose aborts an in-flight handler signal', async () => {
    const transports = new DirectTransports<AnyMessage, AnyMessage>()
    const started = defer<AbortSignal>()
    const never = defer<void>()
    class TestRPC extends ContextRPC<TestTypes> {
      async _handleRequest(
        _request: TestTypes['HandleRequest'],
        signal: AbortSignal,
      ): Promise<Record<string, unknown>> {
        started.resolve(signal)
        await never.promise
        return {}
      }
    }
    const rpc = new TestRPC({ transport: transports.client, validateMessageIn: passthrough })
    rpc._handle()

    await transports.server.write({ jsonrpc: '2.0', id: 1, method: 'slow' } as AnyMessage)
    const signal = await started.promise
    await rpc.dispose()

    expect(signal.aborted).toBe(true)

    never.resolve()
    await transports.dispose()
  })

  test('a peer hanging up aborts an in-flight handler signal', async () => {
    const transports = new DirectTransports<AnyMessage, AnyMessage>()
    const started = defer<AbortSignal>()
    const never = defer<void>()
    class TestRPC extends ContextRPC<TestTypes> {
      async _handleRequest(
        _request: TestTypes['HandleRequest'],
        signal: AbortSignal,
      ): Promise<Record<string, unknown>> {
        started.resolve(signal)
        await never.promise
        return {}
      }
    }
    const rpc = new TestRPC({ transport: transports.client, validateMessageIn: passthrough })
    rpc._handle()

    await transports.server.write({ jsonrpc: '2.0', id: 1, method: 'slow' } as AnyMessage)
    const signal = await started.promise
    await transports.server.dispose()

    await vi.waitFor(() => expect(signal.aborted).toBe(true))

    never.resolve()
    await rpc.dispose()
    await transports.dispose()
  })

  test('defaultRequestTimeout bounds a request that passes no timeout', async () => {
    const transports = new DirectTransports<AnyMessage, AnyMessage>()
    const rpc = new ContextRPC<TestTypes>({
      defaultRequestTimeout: 30,
      transport: transports.client,
      validateMessageIn: passthrough,
    })
    rpc._handle()

    await expect(rpc.request('tools/list', {})).rejects.toBeInstanceOf(RequestTimeoutError)

    await rpc.dispose()
    await transports.dispose()
  })

  test('an explicit timeout wins over defaultRequestTimeout', async () => {
    const transports = new DirectTransports<AnyMessage, AnyMessage>()
    const rpc = new ContextRPC<TestTypes>({
      defaultRequestTimeout: 10_000,
      transport: transports.client,
      validateMessageIn: passthrough,
    })
    rpc._handle()

    await expect(rpc.request('tools/list', {}, { timeout: 30 })).rejects.toBeInstanceOf(
      RequestTimeoutError,
    )

    await rpc.dispose()
    await transports.dispose()
  })
})

describe('ContextRPC invalid inbound messages', () => {
  // Rejects anything without a `method`, i.e. every response frame.
  const rejectResponses = ((message: unknown) => {
    return (message as { method?: unknown }).method == null
      ? { issues: [{ message: 'invalid' }] }
      : { value: message }
  }) as unknown as Validator<AnyMessage>

  test('an invalid response rejects its caller instead of stranding it', async () => {
    const transports = new DirectTransports<AnyMessage, AnyMessage>()
    const rpc = new ContextRPC<TestTypes>({
      transport: transports.client,
      validateMessageIn: rejectResponses,
    })
    rpc._handle()

    const pending = rpc.request('tools/list', {})
    await transports.server.write({ jsonrpc: '2.0', id: 0, result: { tools: [] } } as AnyMessage)

    await expect(pending).rejects.toThrow('Invalid response')

    await rpc.dispose()
    await transports.dispose()
  })

  test('onError receives a frame that could not be validated or routed', async () => {
    const transports = new DirectTransports<AnyMessage, AnyMessage>()
    const onError = vi.fn()
    const rpc = new ContextRPC<TestTypes>({
      onError,
      transport: transports.client,
      validateMessageIn: rejectResponses,
    })
    rpc._handle()

    // No request id 99 is pending, so there is no exchange to fail.
    await transports.server.write({ jsonrpc: '2.0', id: 99, result: {} } as AnyMessage)

    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    expect((onError.mock.calls[0][0] as Error).message).toBe('Invalid message')

    await rpc.dispose()
    await transports.dispose()
  })

  test('onError callback that throws does not prevent the error response reaching the peer', async () => {
    const transports = new DirectTransports<AnyMessage, AnyMessage>()
    const onError = vi.fn(() => {
      throw new Error('onError threw')
    })
    class TestRPC extends ContextRPC<TestTypes> {
      _handleRequest(): Record<string, never> {
        throw new Error('handler failed')
      }
    }
    const rpc = new TestRPC({
      onError,
      transport: transports.client,
      validateMessageIn: passthrough,
    })
    rpc._handle()

    const responses: Array<AnyMessage> = []
    void (async () => {
      for await (const message of transports.server) {
        responses.push(message)
      }
    })()

    await transports.server.write({ jsonrpc: '2.0', id: 1, method: 'test' } as AnyMessage)
    await vi.waitFor(() => expect(responses.length).toBe(1))

    const response = responses[0] as { error?: { code: number } }
    expect(response.error).toBeDefined()
    expect(response.error?.code).toBeDefined()
    expect(onError).toHaveBeenCalledTimes(1)

    await rpc.dispose()
    await transports.dispose()
  })

  test('an invalid inbound response settles its exchange with SettleReason "error"', async () => {
    const transports = new DirectTransports<AnyMessage, AnyMessage>()
    const settles: Array<{ reason: string; error?: Error }> = []
    const rpc = new ContextRPC<TestTypes>({
      transport: transports.client,
      validateMessageIn: rejectResponses,
    })
    rpc._handle()

    const pending = rpc._registerStreamExchange(
      'tools/list',
      {},
      {
        onSettle: (settle) => {
          settles.push(settle)
        },
      },
    )
    await transports.server.write({ jsonrpc: '2.0', id: 0, result: { tools: [] } } as AnyMessage)

    await expect(pending).rejects.toThrow('Invalid response')
    expect(settles).toEqual([
      {
        reason: 'error',
        error: expect.objectContaining({ message: expect.stringContaining('Invalid response') }),
      },
    ])

    await rpc.dispose()
    await transports.dispose()
  })

  test('a cancelled request whose handler rejects on abort does not call onError', async () => {
    // Drives a real *inbound* request (the peer sends it, this RPC's `_handleRequest` runs
    // it), not an outbound `request()` abort: only an inbound handler ever reaches
    // `_handleMessage`'s abort check, which is what this test is meant to guard. An outbound
    // abort never invokes `_handleRequest` at all, so a version of this test that only aborts
    // `rpc.request(...)` cannot fail even if the check is deleted.
    const transports = new DirectTransports<AnyMessage, AnyMessage>()
    const onError = vi.fn()
    const started = defer<AbortSignal>()
    const gate = defer<void>()
    let handlerRan = false

    class TestRPC extends ContextRPC<TestTypes> {
      async _handleRequest(
        request: TestTypes['HandleRequest'],
        signal: AbortSignal,
      ): Promise<Record<string, unknown>> {
        if (request.method !== 'slow') {
          return {}
        }
        handlerRan = true
        started.resolve(signal)
        await gate.promise
        // Mirrors a real handler that notices the abort and rejects instead of returning —
        // the rejection `_handleMessage`'s abort branch must swallow without calling onError.
        signal.throwIfAborted()
        return {}
      }
    }
    const rpc = new TestRPC({
      onError,
      transport: transports.client,
      validateMessageIn: passthrough,
    })
    rpc._handle()

    await transports.server.write({ jsonrpc: '2.0', id: 1, method: 'slow' } as AnyMessage)
    const signal = await started.promise

    await transports.server.write({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId: 1 },
    } as AnyMessage)
    await vi.waitFor(() => expect(signal.aborted).toBe(true))

    // Unblock the handler now that it is aborted: `signal.throwIfAborted()` throws
    // synchronously, exercising the exact rejection path the abort check has to suppress.
    gate.resolve()

    // A second, ordinary request started only now, after the first handler's purely local
    // rejection (no transport I/O) is already in motion: waiting for its full round trip is a
    // real synchronization point on the first request's settlement, not a guessed tick count.
    await transports.server.write({ jsonrpc: '2.0', id: 2, method: 'quick' } as AnyMessage)
    await expect(transports.server.read()).resolves.toEqual({
      done: false,
      value: { jsonrpc: '2.0', id: 2, result: {} },
    })

    expect(handlerRan).toBe(true)
    // onError should not be called for a cancelled request's abort rejection.
    expect(onError).not.toHaveBeenCalled()

    await rpc.dispose()
    await transports.dispose()
  })
})

describe('ContextRPC held responses', () => {
  test('a held response frees its slot and writes only when terminal resolves', async () => {
    const transports = new DirectTransports<AnyMessage, AnyMessage>()
    const terminal = defer<Record<string, unknown>>()
    const beforeCalls: Array<string> = []
    class TestRPC extends ContextRPC<TestTypes> {
      _handleRequest(request: TestTypes['HandleRequest']): unknown {
        if (request.method === 'subscriptions/listen') {
          return this._holdResponse({
            terminal: terminal.promise,
            beforeTerminal: async () => {
              beforeCalls.push('before')
            },
          })
        }
        return { echoed: request.method }
      }
    }
    // maxConcurrent 1 makes the second request's answer proof the held request freed its slot.
    const rpc = new TestRPC({
      maxConcurrentRequests: 1,
      transport: transports.client,
      validateMessageIn: passthrough,
    })
    rpc._handle()

    const responses: Array<{ id?: unknown; result?: unknown }> = []
    void (async () => {
      for await (const message of transports.server) {
        responses.push(message as { id?: unknown; result?: unknown })
      }
    })()

    await transports.server.write({
      jsonrpc: '2.0',
      id: 1,
      method: 'subscriptions/listen',
    } as AnyMessage)
    await transports.server.write({ jsonrpc: '2.0', id: 2, method: 'quick' } as AnyMessage)

    // The second request answers under a concurrency cap of 1 — only possible if the held
    // first request released its slot.
    await vi.waitFor(() =>
      expect(responses).toContainEqual({ jsonrpc: '2.0', id: 2, result: { echoed: 'quick' } }),
    )
    // The held request has written nothing, and beforeTerminal has not run.
    expect(responses.find((response) => response.id === 1)).toBeUndefined()
    expect(beforeCalls).toEqual([])

    terminal.resolve({ ok: true })
    await vi.waitFor(() =>
      expect(responses).toContainEqual({ jsonrpc: '2.0', id: 1, result: { ok: true } }),
    )
    // beforeTerminal ran before the terminal response was written.
    expect(beforeCalls).toEqual(['before'])

    await rpc.dispose()
    await transports.dispose()
  })

  test('cancelling a held request before terminal writes nothing', async () => {
    const transports = new DirectTransports<AnyMessage, AnyMessage>()
    const terminal = defer<Record<string, unknown>>()
    class TestRPC extends ContextRPC<TestTypes> {
      _handleRequest(request: TestTypes['HandleRequest']): unknown {
        if (request.method === 'subscriptions/listen') {
          return this._holdResponse({ terminal: terminal.promise })
        }
        return { echoed: request.method }
      }
    }
    const rpc = new TestRPC({
      maxConcurrentRequests: 1,
      transport: transports.client,
      validateMessageIn: passthrough,
    })
    rpc._handle()

    const responses: Array<{ id?: unknown }> = []
    void (async () => {
      for await (const message of transports.server) {
        responses.push(message as { id?: unknown })
      }
    })()

    await transports.server.write({
      jsonrpc: '2.0',
      id: 1,
      method: 'subscriptions/listen',
    } as AnyMessage)
    await transports.server.write({ jsonrpc: '2.0', id: 2, method: 'quick' } as AnyMessage)
    // The quick answer proves the held request is detached before we cancel it.
    await vi.waitFor(() => expect(responses.find((r) => r.id === 2)).toBeDefined())

    await transports.server.write({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId: 1 },
    } as AnyMessage)
    // Terminal resolves after the cancel — first-settlement-wins means no response is written.
    terminal.resolve({ ok: true })
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(responses.find((response) => response.id === 1)).toBeUndefined()

    await rpc.dispose()
    await transports.dispose()
  })
})

describe('ContextRPC pre-close flush', () => {
  test('_beforeTransportClose lets a held terminal write before the transport is disposed', async () => {
    const transports = new DirectTransports<AnyMessage, AnyMessage>()
    const terminal = defer<Record<string, unknown>>()
    class TestRPC extends ContextRPC<TestTypes> {
      _handleRequest(request: TestTypes['HandleRequest']): unknown {
        if (request.method === 'subscriptions/listen') {
          return this._holdResponse({ terminal: terminal.promise })
        }
        return { echoed: request.method }
      }
      // Resolving the held terminal here proves the hook runs — and is awaited — before the
      // transport is disposed on an explicit `dispose()`.
      _beforeTransportClose(): void {
        terminal.resolve({ ok: true })
      }
    }
    const rpc = new TestRPC({
      maxConcurrentRequests: 1,
      transport: transports.client,
      validateMessageIn: passthrough,
    })
    rpc._handle()

    const writeSpy = vi.spyOn(transports.client, 'write')
    const disposeSpy = vi.spyOn(transports.client, 'dispose')

    const responses: Array<{ id?: unknown; result?: unknown }> = []
    void (async () => {
      for await (const message of transports.server) {
        responses.push(message as { id?: unknown; result?: unknown })
      }
    })()

    await transports.server.write({
      jsonrpc: '2.0',
      id: 1,
      method: 'subscriptions/listen',
    } as AnyMessage)
    await transports.server.write({ jsonrpc: '2.0', id: 2, method: 'quick' } as AnyMessage)
    // The second request answering under a concurrency cap of 1 proves the first is already
    // held/detached — nothing left racing `dispose()` for it to still be scheduled.
    await vi.waitFor(() => expect(responses.find((r) => r.id === 2)).toBeDefined())

    await rpc.dispose()

    // The held terminal's response reached the peer.
    expect(responses).toContainEqual({ jsonrpc: '2.0', id: 1, result: { ok: true } })

    // And it was written to the transport strictly before the transport itself was disposed.
    const writeCallIndex = writeSpy.mock.calls.findIndex(
      ([message]) => (message as { id?: unknown }).id === 1,
    )
    expect(writeCallIndex).toBeGreaterThanOrEqual(0)
    expect(disposeSpy).toHaveBeenCalledTimes(1)
    expect(writeSpy.mock.invocationCallOrder[writeCallIndex]).toBeLessThan(
      disposeSpy.mock.invocationCallOrder[0],
    )

    await transports.dispose()
  })

  test('a peer EOF does not invoke _beforeTransportClose', async () => {
    const transports = new DirectTransports<AnyMessage, AnyMessage>()
    const calls: Array<string> = []
    class TestRPC extends ContextRPC<TestTypes> {
      _beforeTransportClose(): void {
        calls.push('beforeTransportClose')
      }
      override _onTransportClosed(): void {
        calls.push('closed')
      }
    }
    const rpc = new TestRPC({ transport: transports.client, validateMessageIn: passthrough })
    rpc._handle()

    // A write initializes the server-side stream so `dispose()` below actually closes its
    // writer — otherwise the client's read stays pending forever instead of seeing EOF.
    await transports.server.write({ jsonrpc: '2.0', method: 'notifications/ping' } as AnyMessage)
    // A peer hanging up drives the abrupt `#close()` path, not `dispose()`.
    await transports.server.dispose()

    await vi.waitFor(() => expect(calls).toContain('closed'))
    expect(calls).toEqual(['closed'])

    await rpc.dispose()
    await transports.dispose()
  })
})

describe('ContextRPC stream-notification correlator', () => {
  test('routeStreamNotification routes a matching notification to its stream exchange', async () => {
    const transports = new DirectTransports<AnyMessage, AnyMessage>()
    const notified: Array<string> = []
    class TestRPC extends ContextRPC<TestTypes> {
      _handleNotification(notification: { method: string }): void {
        notified.push(notification.method)
      }
    }
    const rpc = new TestRPC({
      transport: transports.client,
      validateMessageIn: passthrough,
      routeStreamNotification: (notification: AnyMessage) => {
        const params = (notification as { params?: { subscriptionId?: unknown; value?: unknown } })
          .params
        if (notification.method !== 'notifications/resource_updated' || params == null) {
          return null
        }
        return {
          id: params.subscriptionId as number,
          frame: { type: 'progress' as const, value: params.value },
        }
      },
    })
    rpc._handle()

    const onProgress = vi.fn()
    // Never settled by this test — a `progress` frame is not terminal — so it rejects with
    // TransportClosedError on dispose below; the catch keeps that an expected non-event.
    rpc._registerStreamExchange('subscriptions/listen', {}, { onProgress }).catch(() => {})

    await transports.server.write({
      jsonrpc: '2.0',
      method: 'notifications/resource_updated',
      params: { subscriptionId: 0, value: { uri: 'file:///x' } },
    } as AnyMessage)

    await vi.waitFor(() => expect(onProgress).toHaveBeenCalledWith({ uri: 'file:///x' }))
    expect(notified).toEqual([])

    await rpc.dispose()
    await transports.dispose()
  })

  test('routeStreamNotification that throws reports the error and does not fall through', async () => {
    const transports = new DirectTransports<AnyMessage, AnyMessage>()
    const onError = vi.fn()
    const notified: Array<string> = []
    class TestRPC extends ContextRPC<TestTypes> {
      _handleNotification(notification: { method: string }): void {
        notified.push(notification.method)
      }
    }
    const rpc = new TestRPC({
      onError,
      transport: transports.client,
      validateMessageIn: passthrough,
      routeStreamNotification: () => {
        throw new Error('correlator failed')
      },
    })
    rpc._handle()

    await transports.server.write({
      jsonrpc: '2.0',
      method: 'notifications/resource_updated',
      params: {},
    } as AnyMessage)

    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    expect((onError.mock.calls[0][0] as Error).message).toBe('correlator failed')
    expect(notified).toEqual([])

    await rpc.dispose()
    await transports.dispose()
  })
})
