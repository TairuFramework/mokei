import { RetryExhaustedError } from '@sozai/async'
import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  SystemOneAuthError,
  SystemOneConnectionError,
  SystemOneInputError,
  SystemOneModelError,
  SystemOneOverloadedError,
  SystemOneRateLimitError,
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

async function flushMicrotasks() {
  for (let turn = 0; turn < 10; turn += 1) {
    await Promise.resolve()
  }
}

const questions = {
  dept: { type: 'choice', instructions: 'Which team?', criteria: { billing: 'x' } },
} as const

const rawResult = {
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
}

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

  test.each([undefined, 'english'])(
    'the request body includes model only when given (%s)',
    async (model) => {
      let body: Record<string, unknown> = {}
      const fetcher: typeof fetch = async (input) => {
        body = await (input as Request).json()
        return Response.json(rawResult)
      }
      const backend = new HTTPSystemOneBackend({ url: 'http://localhost:8000', fetch: fetcher })
      await backend.predict({ state: 'hi', questions, ...(model === undefined ? {} : { model }) })
      expect(body).toEqual({ state: 'hi', questions, ...(model === undefined ? {} : { model }) })
      expect(Object.hasOwn(body, 'model')).toBe(model !== undefined)
    },
  )

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

  test('maps a llama.cpp 400 to SystemOneInputError', async () => {
    stubJSON(
      {
        error: {
          code: 400,
          message: 'questions.department: "instructions" must be provided',
          type: 'invalid_request_error',
        },
      },
      { status: 400 },
    )
    const backend = new HTTPSystemOneBackend({ url: 'http://localhost:8000' })
    const error = await backend
      .predict({ state: 'hi', questions, model: 'english' })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SystemOneInputError)
    expect((error as SystemOneInputError).message).toBe(
      'System One backend rejected the request (400): questions.department: "instructions" must be provided',
    )
    expect((error as SystemOneInputError).issues).toEqual([
      { message: 'questions.department: "instructions" must be provided' },
    ])
  })

  test.each([
    [429, SystemOneRateLimitError, 'SystemOneRateLimitError', 'rate limited'],
    [529, SystemOneOverloadedError, 'SystemOneOverloadedError', 'overloaded'],
  ] as const)(
    'maps %i to %s with status and Retry-After',
    async (status, ErrorClass, name, detail) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(JSON.stringify({ detail }), {
              status,
              headers: { 'content-type': 'application/json', 'retry-after': '7' },
            }),
        ),
      )
      const backend = new HTTPSystemOneBackend({ url: 'http://localhost:8000' })
      const error = await backend
        .predict({ state: 'hi', questions, model: 'english' })
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(ErrorClass)
      // Both stay catchable as connection errors.
      expect(error).toBeInstanceOf(SystemOneConnectionError)
      const e = error as SystemOneRateLimitError
      expect(e.name).toBe(name)
      expect(e.status).toBe(status)
      expect(e.retryAfterMs).toBe(7000)
      expect(e.message).toBe(`System One backend returned ${status}: ${detail}`)
    },
  )

  test('parses an HTTP-date Retry-After and ignores an invalid one', async () => {
    const at = new Date(Date.now() + 60_000).toUTCString()
    for (const [header, expected] of [
      [at, 'positive'],
      ['soon', undefined],
    ] as const) {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () => new Response('busy', { status: 429, headers: { 'retry-after': header } }),
        ),
      )
      const backend = new HTTPSystemOneBackend({ url: 'http://localhost:8000' })
      const error = (await backend
        .predict({ state: 'hi', questions, model: 'english' })
        .catch((e: unknown) => e)) as SystemOneRateLimitError
      if (expected == null) {
        expect(error.retryAfterMs).toBeUndefined()
      } else {
        expect(error.retryAfterMs).toBeGreaterThan(50_000)
        expect(error.retryAfterMs).toBeLessThanOrEqual(60_000)
      }
    }
  })

  test('sets status on other HTTP connection errors, not on network failures', async () => {
    stubJSON({ error: 'boom' }, { status: 500 })
    const backend = new HTTPSystemOneBackend({ url: 'http://localhost:8000' })
    const httpError = (await backend
      .predict({ state: 'hi', questions, model: 'english' })
      .catch((e: unknown) => e)) as SystemOneConnectionError
    expect(httpError).not.toBeInstanceOf(SystemOneRateLimitError)
    expect(httpError.status).toBe(500)

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    )
    const networkError = (await backend
      .predict({ state: 'hi', questions, model: 'english' })
      .catch((e: unknown) => e)) as SystemOneConnectionError
    expect(networkError).toBeInstanceOf(SystemOneConnectionError)
    expect(networkError.status).toBeUndefined()
  })

  test('truncates a long error body in the message', async () => {
    const page = `<html><body>${'x'.repeat(5000)}</body></html>`
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(page, { status: 502 })),
    )
    const backend = new HTTPSystemOneBackend({ url: 'http://localhost:8000' })
    const error = (await backend
      .predict({ state: 'hi', questions, model: 'english' })
      .catch((e: unknown) => e)) as SystemOneConnectionError
    expect(error.message.length).toBeLessThan(400)
    expect(error.message.startsWith('System One backend returned 502: <html>')).toBe(true)
    expect(error.message.endsWith('…')).toBe(true)
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

  test('without retry, 503 fails after one request', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response('busy', { status: 503, headers: { 'content-type': 'application/json' } }),
    )
    const backend = new HTTPSystemOneBackend({ url: 'http://localhost:8000', fetch: fetcher })
    const error = await backend
      .predict({ state: 'hi', questions, model: 'english' })
      .catch((e: unknown) => e)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(error).toBeInstanceOf(SystemOneConnectionError)
    expect((error as SystemOneConnectionError).status).toBe(503)
  })

  test('503 then success makes two requests', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('busy', { status: 503, headers: { 'content-type': 'application/json' } }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(rawResult), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    const backend = new HTTPSystemOneBackend({
      url: 'http://localhost:8000',
      fetch: fetcher,
      retry: { maxAttempts: 2 },
    })
    expect((await backend.predict({ state: 'hi', questions, model: 'english' })).model).toBe(
      'english',
    )
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  test('401 under retry is not retried', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response('unauthorized', {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const backend = new HTTPSystemOneBackend({
      url: 'http://localhost:8000',
      fetch: fetcher,
      retry: { maxAttempts: 3 },
    })
    await expect(backend.predict({ state: 'hi', questions, model: 'english' })).rejects.toThrow(
      SystemOneAuthError,
    )
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  test('exhausted 503s rethrow the last mapped error', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response('busy', { status: 503, headers: { 'content-type': 'application/json' } }),
    )
    const backend = new HTTPSystemOneBackend({
      url: 'http://localhost:8000',
      fetch: fetcher,
      retry: { maxAttempts: 2 },
    })
    const error = await backend
      .predict({ state: 'hi', questions, model: 'english' })
      .catch((e: unknown) => e)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(error).toBeInstanceOf(SystemOneConnectionError)
    expect(error).not.toBeInstanceOf(RetryExhaustedError)
    expect((error as SystemOneConnectionError).status).toBe(503)
  })

  test('429 Retry-After waits before retrying', async () => {
    vi.useFakeTimers()
    try {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(
          new Response('busy', {
            status: 429,
            headers: { 'content-type': 'application/json', 'retry-after': '1' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify(rawResult), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        )
      const backend = new HTTPSystemOneBackend({
        url: 'http://localhost:8000',
        fetch: fetcher,
        retry: { maxAttempts: 2 },
      })
      const pending = backend.predict({ state: 'hi', questions, model: 'english' })
      await flushMicrotasks()
      expect(fetcher).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(999)
      expect(fetcher).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      await pending
      expect(fetcher).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  test('attempt timeouts abort each request and map exhaustion', async () => {
    vi.useFakeTimers()
    try {
      let abortedAttempts = 0
      const fetcher = vi.fn<typeof fetch>((input, opts) => {
        const signal = input instanceof Request ? input.signal : opts?.signal
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => {
              abortedAttempts += 1
              reject(signal.reason)
            },
            { once: true },
          )
        })
      })
      const backend = new HTTPSystemOneBackend({
        url: 'http://localhost:8000',
        fetch: fetcher,
        retry: { maxAttempts: 2, attemptTimeoutMs: 20 },
      })
      const errorPromise = backend
        .predict({ state: 'hi', questions, model: 'english' })
        .catch((error: unknown) => error)
      await flushMicrotasks()
      expect(fetcher).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(20)
      await flushMicrotasks()
      await vi.advanceTimersByTimeAsync(1)
      await flushMicrotasks()
      expect(fetcher).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(20)
      await flushMicrotasks()
      const error = await errorPromise
      expect(fetcher).toHaveBeenCalledTimes(2)
      expect(abortedAttempts).toBe(2)
      expect(error).toBeInstanceOf(SystemOneConnectionError)
      expect((error as Error).message).toBe('System One request timed out')
      expect((error as Error).cause).toBeInstanceOf(RetryExhaustedError)
    } finally {
      vi.useRealTimers()
    }
  })

  test('total timeout during a hanging request maps the retry budget error', async () => {
    vi.useFakeTimers()
    try {
      const fetcher = vi.fn<typeof fetch>(
        (input) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = input instanceof Request ? input.signal : undefined
            signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
          }),
      )
      const backend = new HTTPSystemOneBackend({
        url: 'http://localhost:8000',
        fetch: fetcher,
        retry: { maxAttempts: 3, totalTimeoutMs: 20 },
      })
      const errorPromise = backend
        .predict({ state: 'hi', questions, model: 'english' })
        .catch((error: unknown) => error)
      await flushMicrotasks()
      expect(fetcher).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(20)
      await flushMicrotasks()
      const error = await errorPromise
      expect(error).toBeInstanceOf(SystemOneConnectionError)
      expect((error as Error).message).toBe(
        'System One request did not complete within the retry budget',
      )
      expect((error as Error).cause).toBeInstanceOf(RetryExhaustedError)
    } finally {
      vi.useRealTimers()
    }
  })

  test('total timeout prevents a retry when backoff crosses the budget', async () => {
    vi.useFakeTimers()
    try {
      const fetcher = vi.fn(
        async () =>
          new Response('busy', { status: 503, headers: { 'content-type': 'application/json' } }),
      )
      const backend = new HTTPSystemOneBackend({
        url: 'http://localhost:8000',
        fetch: fetcher,
        retry: { maxAttempts: 3, totalTimeoutMs: 20, backoff: { initialMs: 30 } },
      })
      const errorPromise = backend
        .predict({ state: 'hi', questions, model: 'english' })
        .catch((error: unknown) => error)
      await flushMicrotasks()
      const error = await errorPromise
      expect(fetcher).toHaveBeenCalledTimes(1)
      expect((error as Error).message).toBe(
        'System One request did not complete within the retry budget',
      )
      expect((error as Error).cause).toBeInstanceOf(RetryExhaustedError)
    } finally {
      vi.useRealTimers()
    }
  })

  test('aborting an in-flight retry rejects with the abort reason', async () => {
    const reason = new Error('stop')
    const fetcher = vi.fn<typeof fetch>(
      (input) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = input instanceof Request ? input.signal : undefined
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
        }),
    )
    const backend = new HTTPSystemOneBackend({
      url: 'http://localhost:8000',
      fetch: fetcher,
      retry: { maxAttempts: 2 },
    })
    const controller = new AbortController()
    const errorPromise = backend
      .predict({ state: 'hi', questions, model: 'english', signal: controller.signal })
      .catch((error: unknown) => error)
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    controller.abort(reason)
    const error = await errorPromise
    expect(error).toBe(reason)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  test('aborting during backoff rejects with the abort reason and does not retry', async () => {
    vi.useFakeTimers()
    try {
      const reason = new Error('stop')
      const fetcher = vi.fn(
        async () =>
          new Response('busy', { status: 503, headers: { 'content-type': 'application/json' } }),
      )
      const backend = new HTTPSystemOneBackend({
        url: 'http://localhost:8000',
        fetch: fetcher,
        retry: { maxAttempts: 2, backoff: { initialMs: 1000 } },
      })
      const controller = new AbortController()
      const errorPromise = backend
        .predict({ state: 'hi', questions, model: 'english', signal: controller.signal })
        .catch((error: unknown) => error)
      for (let turn = 0; turn < 100 && vi.getTimerCount() === 0; turn += 1) {
        await Promise.resolve()
      }
      expect(vi.getTimerCount()).toBeGreaterThan(0)
      expect(fetcher).toHaveBeenCalledTimes(1)
      controller.abort(reason)
      await vi.advanceTimersByTimeAsync(1000)
      const error = await errorPromise
      expect(error).toBe(reason)
      expect(fetcher).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
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
