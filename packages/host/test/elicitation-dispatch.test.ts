import { describe, expect, test } from 'vitest'

import { ContextHost, type HostElicitRequest } from '../src/index.js'

class TestContextHost extends ContextHost {
  createHandler(key: string) {
    return this.createElicitHandler({ key })
  }
}

const params = {
  message: 'Please provide a value',
  requestedSchema: { properties: {}, type: 'object' as const },
}

function request(signal = new AbortController().signal): HostElicitRequest {
  return { key: 'tools', params, signal }
}

describe('ContextHost elicitation dispatch', () => {
  test('routes an override before the base handler', async () => {
    const baseResult = { action: 'accept' as const }
    const overrideResult = { action: 'cancel' as const }
    let baseCalls = 0
    const host = new TestContextHost({
      elicit: (received) => {
        baseCalls += 1
        expect(received.key).toBe('tools')
        return baseResult
      },
    })
    const handler = host.createHandler('tools')
    const received = request()
    const remove = host.handleElicitation(async (current) => {
      expect(current).toEqual(received)
      return overrideResult
    })

    await expect(handler?.({ params: received.params, signal: received.signal })).resolves.toBe(
      overrideResult,
    )
    expect(baseCalls).toBe(0)
    remove()
    await host.dispose()
  })

  test('fallback uses the base handler and replaces its signal', async () => {
    const result = { action: 'accept' as const }
    const original = request()
    const replacement = new AbortController().signal
    let receivedKey: string | undefined
    let receivedParams: HostElicitRequest['params'] | undefined
    let receivedSignal: AbortSignal | undefined
    let useReplacementSignal = true
    const host = new TestContextHost({
      elicit: ({ key, params: requestParams, signal }) => {
        receivedKey = key
        receivedParams = requestParams
        receivedSignal = signal
        return result
      },
    })
    const handler = host.createHandler('tools')
    host.handleElicitation((_current, fallback) =>
      useReplacementSignal ? fallback({ signal: replacement }) : fallback(),
    )

    await expect(handler?.({ params: original.params, signal: original.signal })).resolves.toBe(
      result,
    )
    expect(receivedKey).toBe(original.key)
    expect(receivedParams).toBe(original.params)
    expect(receivedSignal).toBe(replacement)

    useReplacementSignal = false
    await expect(handler?.({ params: original.params, signal: original.signal })).resolves.toBe(
      result,
    )
    expect(receivedSignal).toBe(original.signal)
    await host.dispose()
  })

  test('fallback rejects when the base handler throws synchronously', async () => {
    const error = new Error('Base handler failed')
    const result = { action: 'decline' as const }
    const host = new TestContextHost({
      elicit: () => {
        throw error
      },
    })
    const handler = host.createHandler('tools')
    host.handleElicitation((_current, fallback) =>
      fallback().catch((caught) => {
        expect(caught).toBe(error)
        return result
      }),
    )

    await expect(handler?.({ params, signal: request().signal })).resolves.toBe(result)
    await host.dispose()
  })

  test('fallback declines when no base handler exists', async () => {
    const host = new TestContextHost({ elicit: true })
    const handler = host.createHandler('tools')
    const remove = host.handleElicitation((_current, fallback) => fallback())

    await expect(handler?.({ params, signal: request().signal })).resolves.toEqual({
      action: 'decline',
    })
    remove()
    await host.dispose()
  })

  test('true declines before and after an override', async () => {
    const host = new TestContextHost({ elicit: true })
    const handler = host.createHandler('tools')
    const received = request()
    await expect(handler?.({ params: received.params, signal: received.signal })).resolves.toEqual({
      action: 'decline',
    })

    const remove = host.handleElicitation(() => ({ action: 'accept' }))
    expect(await handler?.({ params: received.params, signal: received.signal })).toEqual({
      action: 'accept',
    })
    remove()
    await expect(handler?.({ params: received.params, signal: received.signal })).resolves.toEqual({
      action: 'decline',
    })
    await host.dispose()
  })

  test('rejects a second override and a disabled host', () => {
    const enabled = new TestContextHost({ elicit: true })
    const remove = enabled.handleElicitation(() => ({ action: 'decline' }))
    expect(() => enabled.handleElicitation(() => ({ action: 'decline' }))).toThrow(
      'Elicitation handler already installed',
    )
    remove()
    void enabled.dispose()

    const disabled = new TestContextHost()
    expect(disabled.elicitationEnabled).toBe(false)
    expect(() => disabled.handleElicitation(() => ({ action: 'decline' }))).toThrow(
      'Elicitation is not enabled for this host',
    )
    void disabled.dispose()
  })

  test('removal is idempotent and disposal clears the override', async () => {
    const host = new TestContextHost({ elicit: true })
    const handler = host.createHandler('tools')
    const remove = host.handleElicitation(() => ({ action: 'accept' }))
    remove()
    remove()
    await expect(handler?.({ params, signal: request().signal })).resolves.toEqual({
      action: 'decline',
    })

    host.handleElicitation(() => ({ action: 'accept' }))
    await host.dispose()
    expect(() => host.handleElicitation(() => ({ action: 'decline' }))).not.toThrow()
    await host.dispose()
  })

  test('stale override removal leaves replacement installed', async () => {
    const host = new TestContextHost({ elicit: true })
    const handler = host.createHandler('tools')
    const removeA = host.handleElicitation(() => ({ action: 'decline' }))
    removeA()
    const removeB = host.handleElicitation(() => ({ action: 'accept' }))
    removeA()

    expect(await handler?.({ params, signal: request().signal })).toEqual({ action: 'accept' })
    removeB()
    await host.dispose()
  })
})
