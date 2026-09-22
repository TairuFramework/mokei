import { afterEach, describe, expect, test, vi } from 'vitest'

import { LayaAuthError, LayaConnectionError, LayaModelError } from '../src/errors.js'
import { HTTPLayaBackend } from '../src/http.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubJSON(body: unknown, init: { status?: number } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: Request | string) => {
      const req = input instanceof Request ? input : new Request(input)
      ;(globalThis as Record<string, unknown>).__lastRequest = req
      return new Response(JSON.stringify(body), {
        status: init.status ?? 200,
        headers: { 'content-type': 'application/json' },
      })
    }),
  )
}

const questions = { dept: { type: 'choice', criteria: { billing: 'x' } } } as const

describe('HTTPLayaBackend', () => {
  test('predict posts to /v1/systemone with a Bearer header and returns the raw envelope', async () => {
    stubJSON({
      model: 'english',
      answers: {
        dept: {
          type: 'choice',
          choice: 'billing',
          confidence: 0.9,
          probabilities: { billing: 0.9 },
        },
      },
      usage: { input_tokens: 1, output_tokens: 1 },
    })
    const backend = new HTTPLayaBackend({ url: 'http://localhost:8000', apiKey: 'secret' })
    const res = await backend.predict({ state: 'hi', questions, model: 'english' })
    const req = (globalThis as Record<string, unknown>).__lastRequest as Request
    expect(req.url).toBe('http://localhost:8000/v1/systemone')
    expect(req.headers.get('authorization')).toBe('Bearer secret')
    expect(res.model).toBe('english')
  })

  test('maps 401 to LayaAuthError', async () => {
    stubJSON({ error: 'unauthorized' }, { status: 401 })
    const backend = new HTTPLayaBackend({ url: 'http://localhost:8000' })
    await expect(backend.predict({ state: 'hi', questions, model: 'english' })).rejects.toThrow(
      LayaAuthError,
    )
  })

  test('maps 403 to LayaAuthError', async () => {
    stubJSON({ error: 'forbidden' }, { status: 403 })
    const backend = new HTTPLayaBackend({ url: 'http://localhost:8000' })
    await expect(backend.predict({ state: 'hi', questions, model: 'english' })).rejects.toThrow(
      LayaAuthError,
    )
  })

  test('maps 404 to LayaModelError', async () => {
    stubJSON({ error: 'not found' }, { status: 404 })
    const backend = new HTTPLayaBackend({ url: 'http://localhost:8000' })
    await expect(backend.predict({ state: 'hi', questions, model: 'english' })).rejects.toThrow(
      LayaModelError,
    )
  })

  test('maps 500 to LayaConnectionError', async () => {
    stubJSON({ error: 'boom' }, { status: 500 })
    const backend = new HTTPLayaBackend({ url: 'http://localhost:8000' })
    await expect(backend.predict({ state: 'hi', questions, model: 'english' })).rejects.toThrow(
      LayaConnectionError,
    )
  })

  test('an aborted request rejects and does not hang', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: Request | string, opts?: { signal?: AbortSignal }) => {
        const signal = input instanceof Request ? input.signal : opts?.signal
        return new Promise((_resolve, reject) => {
          if (signal?.aborted) {
            reject(new DOMException('aborted', 'AbortError'))
            return
          }
          signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        })
      }),
    )
    const backend = new HTTPLayaBackend({ url: 'http://localhost:8000' })
    const controller = new AbortController()
    const pending = backend.predict({
      state: 'hi',
      questions,
      model: 'english',
      signal: controller.signal,
    })
    controller.abort()
    await expect(pending).rejects.toThrow(DOMException)
  })
})
