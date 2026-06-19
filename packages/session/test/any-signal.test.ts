import { describe, expect, test, vi } from 'vitest'

import { anySignal } from '../src/agent-session.js'

describe('anySignal', () => {
  test('does not accumulate listeners on a shared long-lived signal', () => {
    const longLived = new AbortController().signal
    const addSpy = vi.spyOn(longLived, 'addEventListener')

    for (let i = 0; i < 50; i++) {
      const perCall = new AbortController()
      anySignal([longLived, perCall.signal])
      perCall.abort()
    }

    // AbortSignal.any manages listeners internally and weakly; our wrapper must
    // not register 50 persistent listeners on the long-lived signal.
    // Allow a small constant but not linear growth.
    expect(addSpy.mock.calls.length).toBeLessThan(5)
  })

  test('aborts when any input signal aborts', () => {
    const a = new AbortController()
    const b = new AbortController()
    const combined = anySignal([a.signal, b.signal])
    expect(combined.aborted).toBe(false)
    b.abort(new Error('boom'))
    expect(combined.aborted).toBe(true)
  })
})
