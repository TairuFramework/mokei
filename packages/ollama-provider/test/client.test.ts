import { afterEach, describe, expect, test, vi } from 'vitest'

import { OllamaClient } from '../src/client.js'
import { OllamaProvider } from '../src/provider.js'

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

describe('OllamaProvider telemetry', () => {
  test('defaults to localhost:11434', () => {
    expect(new OllamaProvider().telemetry).toEqual({
      providerName: 'ollama',
      serverAddress: 'localhost',
      serverPort: 11434,
      syntheticToolCallIDs: true,
    })
  })

  test('derives address and port from the configured base URL', () => {
    const provider = new OllamaProvider({ client: { baseURL: 'http://gpu.example.com:8080/api' } })
    expect(provider.telemetry).toMatchObject({
      providerName: 'ollama',
      serverAddress: 'gpu.example.com',
      serverPort: 8080,
      syntheticToolCallIDs: true,
    })
  })

  test('done part carries responseModel', async () => {
    const line = JSON.stringify({
      model: 'llama3:8b',
      created_at: '2026-01-01T00:00:00Z',
      message: { role: 'assistant', content: 'hi' },
      done: true,
      done_reason: 'stop',
      prompt_eval_count: 3,
      eval_count: 4,
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(`${line}\n`)),
    )
    const provider = new OllamaProvider()
    const stream = await provider.streamChat({
      model: 'llama3',
      messages: [{ source: 'client', role: 'user', text: 'hi' }],
    })
    const parts = []
    for await (const part of stream) parts.push(part)
    expect(parts.find((p) => p.type === 'done')).toMatchObject({
      type: 'done',
      responseModel: 'llama3:8b',
      inputTokens: 3,
      outputTokens: 4,
    })
  })
})
