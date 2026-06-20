import { describe, expect, test, vi } from 'vitest'

import { ContinuationStore } from '../src/continuation.js'

describe('ContinuationStore', () => {
  test('route resolves a registered token then removes it', () => {
    const store = new ContinuationStore()
    const resolve = vi.fn()
    store.register('t1', { exchangeID: 1, resolve, reject: () => {} })
    store.route('t1', { value: 'ok' })
    expect(resolve).toHaveBeenCalledWith('ok')
    // token removed: a second route is a no-op
    store.route('t1', { value: 'again' })
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  test('route rejects on an error result', () => {
    const store = new ContinuationStore()
    const reject = vi.fn()
    store.register('t1', { exchangeID: 1, resolve: () => {}, reject })
    const error = new Error('boom')
    store.route('t1', { error })
    expect(reject).toHaveBeenCalledWith(error)
  })

  test('route on an unknown token is a no-op', () => {
    const store = new ContinuationStore()
    expect(() => store.route('missing', { value: 1 })).not.toThrow()
  })

  test('clearForExchange rejects only the matching exchange tokens', () => {
    const store = new ContinuationStore()
    const rejectA = vi.fn()
    const rejectB = vi.fn()
    store.register('a', { exchangeID: 1, resolve: () => {}, reject: rejectA })
    store.register('b', { exchangeID: 2, resolve: () => {}, reject: rejectB })
    const reason = new Error('settled')
    store.clearForExchange(1, reason)
    expect(rejectA).toHaveBeenCalledWith(reason)
    expect(rejectB).not.toHaveBeenCalled()
  })

  test('clearAll rejects every entry', () => {
    const store = new ContinuationStore()
    const rejectA = vi.fn()
    const rejectB = vi.fn()
    store.register('a', { exchangeID: 1, resolve: () => {}, reject: rejectA })
    store.register('b', { exchangeID: 2, resolve: () => {}, reject: rejectB })
    const reason = new Error('closed')
    store.clearAll(reason)
    expect(rejectA).toHaveBeenCalledWith(reason)
    expect(rejectB).toHaveBeenCalledWith(reason)
  })
})
