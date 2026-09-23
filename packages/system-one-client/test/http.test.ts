import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  SystemOneAuthError,
  SystemOneConnectionError,
  SystemOneInputError,
  SystemOneModelError,
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

const questions = {
  dept: { type: 'choice', instructions: 'Which team?', criteria: { billing: 'x' } },
} as const

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
    const request = backend.predict({ state: 'hi', questions, model: 'english' })
    await expect(request).rejects.toThrow(SystemOneConnectionError)
    await expect(request).rejects.toThrow('System One backend returned 500')
  })

  test.each([
    [
      'a FastAPI detail string',
      { detail: "question 'dept': no 'instructions'" },
      "question 'dept': no 'instructions'",
      [{ message: "question 'dept': no 'instructions'" }],
    ],
    [
      'a FastAPI validation list',
      {
        detail: [
          { loc: ['body', 'state'], msg: 'Field required' },
          { msg: 'Input should be a string' },
        ],
      },
      'Field required; Input should be a string',
      [
        { message: 'Field required', path: ['body', 'state'] },
        { message: 'Input should be a string' },
      ],
    ],
    [
      'a message field',
      { message: 'criteria must have 2 to 10 levels' },
      'criteria must have 2 to 10 levels',
      [{ message: 'criteria must have 2 to 10 levels' }],
    ],
    [
      'an error object',
      { error: { message: 'unknown model' } },
      'unknown model',
      [{ message: 'unknown model' }],
    ],
    [
      'an error string',
      { error: 'unknown model' },
      'unknown model',
      [{ message: 'unknown model' }],
    ],
    ['an empty body', {}, null, []],
  ])('maps a 422 with %s to SystemOneInputError', async (_label, body, detail, issues) => {
    stubJSON(body, { status: 422 })
    const backend = new HTTPSystemOneBackend({ url: 'http://localhost:8000' })
    const error = await backend
      .predict({ state: 'hi', questions, model: 'english' })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SystemOneInputError)
    const message = 'System One backend rejected the request (422)'
    expect((error as SystemOneInputError).message).toBe(
      detail == null ? message : `${message}: ${detail}`,
    )
    expect((error as SystemOneInputError).issues).toEqual(issues)
  })

  test('includes an error body reason in other non-2xx messages', async () => {
    stubJSON({ detail: 'model crashed' }, { status: 500 })
    const backend = new HTTPSystemOneBackend({ url: 'http://localhost:8000' })
    const request = backend.predict({ state: 'hi', questions, model: 'english' })
    await expect(request).rejects.toThrow(SystemOneConnectionError)
    await expect(request).rejects.toThrow('System One backend returned 500: model crashed')
  })

  test('includes a plain-text error body in the error message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('model is loading', { status: 503 })),
    )
    const backend = new HTTPSystemOneBackend({ url: 'http://localhost:8000' })
    await expect(backend.predict({ state: 'hi', questions, model: 'english' })).rejects.toThrow(
      'System One backend returned 503: model is loading',
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
