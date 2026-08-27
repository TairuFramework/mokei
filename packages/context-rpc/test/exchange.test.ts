import { INTERNAL_ERROR, type Response } from '@mokei/context-protocol'
import { defer } from '@sozai/async'
import { describe, expect, test, vi } from 'vitest'

import { RPCError } from '../src/error.js'
import { ExchangeRegistry, type StreamFrame } from '../src/exchange.js'

function makeController() {
  return Object.assign(new AbortController(), defer())
}

describe('ExchangeRegistry once', () => {
  test('routeResponse resolves a once exchange on result then removes it', async () => {
    const registry = new ExchangeRegistry()
    const controller = makeController()
    registry.registerOnce(1, controller)
    registry.routeResponse(1, { jsonrpc: '2.0', id: 1, result: { ok: true } })
    await expect(controller.promise).resolves.toEqual({ ok: true })
    expect(registry.has(1)).toBe(false)
  })

  test('routeResponse rejects a once exchange on error', async () => {
    const registry = new ExchangeRegistry()
    const controller = makeController()
    registry.registerOnce(1, controller)
    registry.routeResponse(1, { jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'nope' } })
    await expect(controller.promise).rejects.toBeInstanceOf(RPCError)
  })

  test('routeResponse on an unknown id is a no-op', () => {
    const registry = new ExchangeRegistry()
    expect(() => registry.routeResponse(99, { jsonrpc: '2.0', id: 99, result: {} })).not.toThrow()
  })

  test('cancel rejects and removes a once exchange', async () => {
    const registry = new ExchangeRegistry()
    const controller = makeController()
    registry.registerOnce(1, controller)
    const reason = new Error('Cancelled')
    registry.cancel(1, reason)
    await expect(controller.promise).rejects.toBe(reason)
    expect(registry.has(1)).toBe(false)
  })

  test('endAll rejects every pending exchange', async () => {
    const registry = new ExchangeRegistry()
    const a = makeController()
    const b = makeController()
    registry.registerOnce(1, a)
    registry.registerOnce(2, b)
    const reason = new Error('closed')
    registry.endAll(reason)
    await expect(a.promise).rejects.toBe(reason)
    await expect(b.promise).rejects.toBe(reason)
    expect(registry.has(1)).toBe(false)
    expect(registry.has(2)).toBe(false)
  })

  test('a response carrying neither result nor error settles as an internal error', async () => {
    const registry = new ExchangeRegistry()
    const controller = makeController()
    registry.registerOnce(1, controller)
    registry.routeResponse(1, { jsonrpc: '2.0', id: 1 } as Response)
    await expect(controller.promise).rejects.toMatchObject({
      code: INTERNAL_ERROR,
      message: 'Malformed response',
    })
    expect(registry.has(1)).toBe(false)
  })

  test('a malformed error object is not read as an error response', async () => {
    const registry = new ExchangeRegistry()
    const noCode = makeController()
    registry.registerOnce(1, noCode)
    registry.routeResponse(1, { jsonrpc: '2.0', id: 1, error: { message: 'nope' } } as Response)
    await expect(noCode.promise).rejects.toMatchObject({ message: 'Malformed response' })

    const nullError = makeController()
    registry.registerOnce(2, nullError)
    registry.routeResponse(2, { jsonrpc: '2.0', id: 2, error: null } as unknown as Response)
    await expect(nullError.promise).rejects.toMatchObject({ message: 'Malformed response' })
  })
})

describe('ExchangeRegistry stream', () => {
  test('progress and input-request invoke handlers without settling', () => {
    const registry = new ExchangeRegistry()
    const controller = makeController()
    const onProgress = vi.fn()
    const onInputRequest = vi.fn()
    registry.registerStream(1, controller, { onProgress, onInputRequest })
    registry.routeStreamFrame(1, { type: 'progress', value: 50 })
    registry.routeStreamFrame(1, { type: 'input-request', token: 'tok', value: { q: 1 } })
    expect(onProgress).toHaveBeenCalledWith(50)
    expect(onInputRequest).toHaveBeenCalledWith('tok', { q: 1 })
    expect(registry.has(1)).toBe(true)
  })

  test('result frame resolves the outer promise, settles, and removes it', async () => {
    const registry = new ExchangeRegistry()
    const controller = makeController()
    const onSettle = vi.fn()
    registry.registerStream(1, controller, { onSettle })
    registry.routeStreamFrame(1, { type: 'result', value: 'done' })
    await expect(controller.promise).resolves.toBe('done')
    expect(onSettle).toHaveBeenCalledWith({ reason: 'result', error: undefined })
    expect(registry.has(1)).toBe(false)
  })

  test('error frame rejects the outer promise and settles', async () => {
    const registry = new ExchangeRegistry()
    const controller = makeController()
    const onSettle = vi.fn()
    registry.registerStream(1, controller, { onSettle })
    const error = new Error('stream boom')
    registry.routeStreamFrame(1, { type: 'error', error })
    await expect(controller.promise).rejects.toBe(error)
    expect(onSettle).toHaveBeenCalledWith({ reason: 'error', error })
  })

  test('an error frame carrying a non-Error value is coerced to an Error', async () => {
    const registry = new ExchangeRegistry()
    const controller = makeController()
    registry.registerStream(1, controller)
    registry.routeStreamFrame(1, { type: 'error', error: 'boom' } as unknown as StreamFrame)
    await expect(controller.promise).rejects.toThrow('boom')
  })

  test('routeResponse terminates a stream exchange and calls onSettle', async () => {
    const registry = new ExchangeRegistry()
    const controller = makeController()
    const onSettle = vi.fn()
    registry.registerStream(1, controller, { onSettle })
    registry.routeResponse(1, { jsonrpc: '2.0', id: 1, result: 'r' })
    await expect(controller.promise).resolves.toBe('r')
    expect(onSettle).toHaveBeenCalledWith({ reason: 'result', error: undefined })
  })

  test('an error response settles a stream exchange with the error reason', async () => {
    const registry = new ExchangeRegistry()
    const controller = makeController()
    const onSettle = vi.fn()
    registry.registerStream(1, controller, { onSettle })
    registry.routeResponse(1, { jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'nope' } })
    await expect(controller.promise).rejects.toBeInstanceOf(RPCError)
    expect(onSettle).toHaveBeenCalledWith({ reason: 'error', error: expect.any(RPCError) })
  })

  test('a malformed response settles a stream exchange with the error reason', async () => {
    const registry = new ExchangeRegistry()
    const controller = makeController()
    const onSettle = vi.fn()
    registry.registerStream(1, controller, { onSettle })
    registry.routeResponse(1, { jsonrpc: '2.0', id: 1 } as Response)
    await expect(controller.promise).rejects.toMatchObject({ message: 'Malformed response' })
    expect(onSettle).toHaveBeenCalledWith({
      reason: 'error',
      error: expect.objectContaining({ message: 'Malformed response' }),
    })
  })

  test('cancel settles a stream exchange with the cancel reason', async () => {
    const registry = new ExchangeRegistry()
    const controller = makeController()
    const onSettle = vi.fn()
    registry.registerStream(1, controller, { onSettle })
    const reason = new Error('Cancelled')
    registry.cancel(1, reason)
    await expect(controller.promise).rejects.toBe(reason)
    expect(onSettle).toHaveBeenCalledWith({ reason: 'cancel', error: reason })
    expect(registry.has(1)).toBe(false)
  })

  test('endAll settles every stream exchange with the closed reason', async () => {
    const registry = new ExchangeRegistry()
    const a = makeController()
    const b = makeController()
    const onSettleA = vi.fn()
    const onSettleB = vi.fn()
    registry.registerStream(1, a, { onSettle: onSettleA })
    registry.registerStream(2, b, { onSettle: onSettleB })
    const reason = new Error('closed')
    registry.endAll(reason)
    await expect(a.promise).rejects.toBe(reason)
    await expect(b.promise).rejects.toBe(reason)
    expect(onSettleA).toHaveBeenCalledWith({ reason: 'closed', error: reason })
    expect(onSettleB).toHaveBeenCalledWith({ reason: 'closed', error: reason })
    expect(registry.has(1)).toBe(false)
    expect(registry.has(2)).toBe(false)
  })

  test('onSettle is called once, even when more frames follow', () => {
    const registry = new ExchangeRegistry()
    const controller = makeController()
    const onSettle = vi.fn()
    registry.registerStream(1, controller, { onSettle })
    registry.routeStreamFrame(1, { type: 'result', value: 1 })
    registry.routeStreamFrame(1, { type: 'error', error: new Error('late') })
    registry.cancel(1, new Error('late cancel'))
    registry.endAll(new Error('late close'))
    expect(onSettle).toHaveBeenCalledTimes(1)
  })

  test('frames after a terminal frame are no-ops', () => {
    const registry = new ExchangeRegistry()
    const controller = makeController()
    const onProgress = vi.fn()
    registry.registerStream(1, controller, { onProgress })
    registry.routeStreamFrame(1, { type: 'result', value: 1 })
    registry.routeStreamFrame(1, { type: 'progress', value: 2 })
    expect(onProgress).not.toHaveBeenCalled()
  })

  test('a frame of an unknown type is dropped without settling', () => {
    const registry = new ExchangeRegistry()
    const controller = makeController()
    const onSettle = vi.fn()
    registry.registerStream(1, controller, { onSettle })
    registry.routeStreamFrame(1, { type: 'nonsense' } as unknown as StreamFrame)
    expect(onSettle).not.toHaveBeenCalled()
    expect(registry.has(1)).toBe(true)
  })

  test('stream frames are dropped for a once exchange', () => {
    const registry = new ExchangeRegistry()
    const controller = makeController()
    registry.registerOnce(1, controller)
    registry.routeStreamFrame(1, { type: 'result', value: 1 })
    expect(registry.has(1)).toBe(true)
  })

  test('close settles a single stream exchange with reason "closed" and the error', async () => {
    const registry = new ExchangeRegistry()
    const controller = makeController()
    const settles: Array<{ reason: string; error?: Error }> = []
    registry.registerStream(7, controller, { onSettle: (s) => settles.push(s) })
    const reason = new Error('stream ended')
    registry.close(7, reason)
    await expect(controller.promise).rejects.toBe(reason)
    expect(settles).toEqual([{ reason: 'closed', error: reason }])
    expect(registry.has(7)).toBe(false)
  })
})
