import { defer } from '@enkaku/async'
import { describe, expect, test, vi } from 'vitest'

import { RPCError } from '../src/error.js'
import { ExchangeRegistry } from '../src/exchange.js'

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
    expect(onSettle).toHaveBeenCalledTimes(1)
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
    expect(onSettle).toHaveBeenCalledTimes(1)
  })

  test('routeResponse terminates a stream exchange and calls onSettle', async () => {
    const registry = new ExchangeRegistry()
    const controller = makeController()
    const onSettle = vi.fn()
    registry.registerStream(1, controller, { onSettle })
    registry.routeResponse(1, { jsonrpc: '2.0', id: 1, result: 'r' })
    await expect(controller.promise).resolves.toBe('r')
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
})
