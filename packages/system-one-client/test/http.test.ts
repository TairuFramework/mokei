import { afterEach, describe, expect, test, vi } from 'vitest'

import { createSystemOneClient } from '../src/client.js'
import {
  SystemOneAuthError,
  SystemOneConnectionError,
  SystemOneModelError,
  SystemOneResponseError,
} from '../src/errors.js'
import { HTTPSystemOneBackend } from '../src/http.js'

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

describe('HTTPSystemOneBackend', () => {
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
    const backend = new HTTPSystemOneBackend({ url: 'http://localhost:8000', apiKey: 'secret' })
    const res = await backend.predict({ state: 'hi', questions, model: 'english' })
    const req = (globalThis as Record<string, unknown>).__lastRequest as Request
    expect(req.url).toBe('http://localhost:8000/v1/systemone')
    expect(req.headers.get('authorization')).toBe('Bearer secret')
    expect(res.model).toBe('english')
  })

  test('maps 401 to SystemOneAuthError', async () => {
    stubJSON({ error: 'unauthorized' }, { status: 401 })
    const backend = new HTTPSystemOneBackend({ url: 'http://localhost:8000' })
    await expect(backend.predict({ state: 'hi', questions, model: 'english' })).rejects.toThrow(
      SystemOneAuthError,
    )
  })

  test('maps 403 to SystemOneAuthError', async () => {
    stubJSON({ error: 'forbidden' }, { status: 403 })
    const backend = new HTTPSystemOneBackend({ url: 'http://localhost:8000' })
    await expect(backend.predict({ state: 'hi', questions, model: 'english' })).rejects.toThrow(
      SystemOneAuthError,
    )
  })

  test('maps 404 to SystemOneModelError', async () => {
    stubJSON({ error: 'not found' }, { status: 404 })
    const backend = new HTTPSystemOneBackend({ url: 'http://localhost:8000' })
    await expect(backend.predict({ state: 'hi', questions, model: 'english' })).rejects.toThrow(
      SystemOneModelError,
    )
  })

  test('maps 500 to SystemOneConnectionError', async () => {
    stubJSON({ error: 'boom' }, { status: 500 })
    const backend = new HTTPSystemOneBackend({ url: 'http://localhost:8000' })
    await expect(backend.predict({ state: 'hi', questions, model: 'english' })).rejects.toThrow(
      SystemOneConnectionError,
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
    const backend = new HTTPSystemOneBackend({ url: 'http://localhost:8000' })
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

describe('HTTPSystemOneBackend batch opt-in', () => {
  test('batch is undefined by default', () => {
    const backend = new HTTPSystemOneBackend({ url: 'http://localhost:8000' })
    expect(backend.batch).toBeUndefined()
  })

  test('batch is defined when constructed with batch: true', () => {
    const backend = new HTTPSystemOneBackend({ url: 'http://localhost:8000', batch: true })
    expect(backend.batch).toBeDefined()
  })

  test('predictBatch falls back to sequential /v1/systemone calls when batch is not enabled', async () => {
    const urls: Array<string> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: Request | string) => {
        const req = input instanceof Request ? input : new Request(input)
        urls.push(req.url)
        return new Response(
          JSON.stringify({
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
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }),
    )
    const client = createSystemOneClient({ url: 'http://localhost:8000', defaultModel: 'english' })
    const results = await client.predictBatch({ states: ['a', 'b'], questions })
    expect(results).toHaveLength(2)
    expect(urls).toHaveLength(2)
    for (const url of urls) {
      expect(url).toBe('http://localhost:8000/v1/systemone')
    }
  })
})

describe('HTTPSystemOneBackend headers', () => {
  test('a caller-supplied lowercase authorization header is replaced, not appended to, by apiKey', async () => {
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
    const backend = new HTTPSystemOneBackend({
      url: 'http://localhost:8000',
      apiKey: 'secret',
      headers: { authorization: 'custom' },
    })
    await backend.predict({ state: 'hi', questions, model: 'english' })
    const req = (globalThis as Record<string, unknown>).__lastRequest as Request
    expect(req.headers.get('authorization')).toBe('Bearer secret')
  })
})

describe('HTTPSystemOneBackend batch envelope validation', () => {
  test('rejects with SystemOneResponseError when the batch body has no results array', async () => {
    stubJSON({})
    const backend = new HTTPSystemOneBackend({ url: 'http://localhost:8000', batch: true })
    await expect(
      backend.batch?.({ states: ['a', 'b'], questions, model: 'english' }),
    ).rejects.toThrow(SystemOneResponseError)
  })

  test('rejects with SystemOneResponseError when the result count does not match the states count', async () => {
    stubJSON({
      results: [
        {
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
        },
      ],
    })
    const backend = new HTTPSystemOneBackend({ url: 'http://localhost:8000', batch: true })
    await expect(
      backend.batch?.({ states: ['a', 'b'], questions, model: 'english' }),
    ).rejects.toThrow(SystemOneResponseError)
  })
})
