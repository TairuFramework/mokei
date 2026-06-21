import { DirectTransports, type TransportType } from '@enkaku/transport'
import type { AnyMessage } from '@mokei/context-protocol'
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

  test('resolves a request on response and sends no cancel afterwards', async () => {
    const transports = new DirectTransports<AnyMessage, AnyMessage>()
    const rpc = makeRPC(transports.client)
    rpc._handle()
    const notifySpy = vi.spyOn(rpc, 'notify')

    const pending = rpc.request('tools/list', {})
    // Reply from the server side; request id starts at 0.
    await transports.server.write({ jsonrpc: '2.0', id: 0, result: { tools: [] } } as AnyMessage)
    await expect(pending).resolves.toEqual({ tools: [] })

    // Cancelling an already-settled request must NOT emit notifications/cancelled.
    pending.cancel()
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

  test('cancel() on a pending request rejects it and notifies cancellation', async () => {
    const transports = new DirectTransports<AnyMessage, AnyMessage>()
    const rpc = makeRPC(transports.client)
    rpc._handle()
    const notifySpy = vi.spyOn(rpc, 'notify')

    const pending = rpc.request('tools/list', {})
    pending.cancel()
    await expect(pending).rejects.toThrow('Cancelled')
    expect(notifySpy).toHaveBeenCalledWith('cancelled', { requestId: 0 })

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
})
