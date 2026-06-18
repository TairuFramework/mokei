import { afterEach, describe, expect, test, vi } from 'vitest'

import { OllamaClient } from '../src/client.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OllamaClient.generate cancellation', () => {
  test('returns a working signal + abort that cancels the request', async () => {
    // Hanging fetch that rejects when its signal aborts.
    // NOTE: ky passes a Request object as the first arg (not a plain URL string),
    // with the abort signal embedded in Request.signal rather than opts.signal.
    vi.stubGlobal(
      'fetch',
      vi.fn((input: Request | string, opts?: { signal?: AbortSignal }) => {
        // ky passes a Request object (not URL+opts), with the signal embedded in Request.signal.
        const signal = input instanceof Request ? input.signal : opts?.signal
        return new Promise((_resolve, reject) => {
          // Reject immediately if already aborted (real fetch behaviour), then listen for future aborts.
          if (signal?.aborted) {
            reject(new DOMException('aborted', 'AbortError'))
            return
          }
          signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        })
      }),
    )

    const client = new OllamaClient({ baseURL: 'http://localhost:11434' })
    const request = client.generate({ model: 'llama3', prompt: 'hi', stream: false })

    expect(request.signal).toBeInstanceOf(AbortSignal)
    expect(request.signal.aborted).toBe(false)
    request.abort()
    expect(request.signal.aborted).toBe(true)
    await expect(request).rejects.toThrow()
  })
})
