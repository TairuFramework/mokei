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
})
