import { describe, expect, test } from 'vitest'

import {
  isRetryableProviderError,
  kindFromStatus,
  mapStreamErrors,
  ProviderError,
  parseRetryAfter,
  providerErrorFromResponse,
  providerErrorFromTransport,
  toProviderError,
} from '../src/index.js'

describe('ProviderError', () => {
  test('defaults retryable from kind', () => {
    for (const kind of ['rate_limit', 'overloaded', 'server', 'network', 'timeout'] as const) {
      expect(new ProviderError({ message: 'x', kind, provider: 'p' }).retryable).toBe(true)
    }
    for (const kind of ['auth', 'invalid_request', 'context_length', 'unknown'] as const) {
      expect(new ProviderError({ message: 'x', kind, provider: 'p' }).retryable).toBe(false)
    }
  })

  test('explicit retryable wins and fields are exposed', () => {
    const cause = new Error('raw')
    const error = new ProviderError({
      message: 'boom',
      kind: 'server',
      provider: 'openai',
      retryable: false,
      status: 500,
      code: 'server_error',
      retryAfterMs: 10,
      cause,
    })
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('ProviderError')
    expect(error.retryable).toBe(false)
    expect(error.status).toBe(500)
    expect(error.code).toBe('server_error')
    expect(error.retryAfterMs).toBe(10)
    expect(error.provider).toBe('openai')
    expect(error.cause).toBe(cause)
    expect(isRetryableProviderError(error)).toBe(false)
    expect(isRetryableProviderError(new Error('plain'))).toBe(false)
  })
})

describe('kindFromStatus', () => {
  test.each([
    [429, 'rate_limit'],
    [503, 'overloaded'],
    [529, 'overloaded'],
    [500, 'server'],
    [502, 'server'],
    [408, 'timeout'],
    [401, 'auth'],
    [403, 'auth'],
    [413, 'invalid_request'],
    [400, 'invalid_request'],
    [404, 'invalid_request'],
  ])('%i is %s', (status, kind) => {
    expect(kindFromStatus(status)).toBe(kind)
  })

  test('success is not a failure', () => {
    expect(kindFromStatus(200)).toBeUndefined()
  })
})

describe('parseRetryAfter', () => {
  const headers = (values: Record<string, string>) => new Headers(values)

  test('seconds', () => {
    expect(parseRetryAfter(headers({ 'retry-after': '3' }))).toBe(3000)
  })

  test('retry-after-ms wins', () => {
    expect(parseRetryAfter(headers({ 'retry-after': '3', 'retry-after-ms': '250' }))).toBe(250)
  })

  test('HTTP date', () => {
    const now = Date.parse('2026-11-05T00:00:00Z')
    const value = parseRetryAfter(headers({ 'retry-after': 'Thu, 05 Nov 2026 00:00:05 GMT' }), now)
    expect(value).toBe(5000)
  })

  test('absent or invalid', () => {
    expect(parseRetryAfter(headers({}))).toBeUndefined()
    expect(parseRetryAfter(headers({ 'retry-after': 'soon' }))).toBeUndefined()
    expect(parseRetryAfter(headers({ 'retry-after': '-1' }))).toBeUndefined()
  })
})

describe('providerErrorFromResponse', () => {
  test('reads status, code and retry-after', () => {
    const error = providerErrorFromResponse({
      provider: 'anthropic',
      status: 429,
      headers: new Headers({ 'retry-after': '2' }),
      code: 'rate_limit_error',
      message: 'slow down',
    })
    expect(error.kind).toBe('rate_limit')
    expect(error.retryable).toBe(true)
    expect(error.retryAfterMs).toBe(2000)
    expect(error.message).toBe('anthropic request failed with status 429: slow down')
  })

  test('detects context length on a 400', () => {
    const error = providerErrorFromResponse({
      provider: 'openai',
      status: 400,
      code: 'context_length_exceeded',
    })
    expect(error.kind).toBe('context_length')
    expect(error.retryable).toBe(false)
  })

  test('explicit kind wins', () => {
    const error = providerErrorFromResponse({ provider: 'p', status: 500, kind: 'overloaded' })
    expect(error.kind).toBe('overloaded')
  })
})

describe('providerErrorFromTransport', () => {
  test('timeout', () => {
    const cause = Object.assign(new Error('Request timed out'), { name: 'TimeoutError' })
    const error = providerErrorFromTransport('openai', cause)
    expect(error?.kind).toBe('timeout')
    expect(error?.cause).toBe(cause)
  })

  test('network', () => {
    expect(providerErrorFromTransport('openai', new TypeError('fetch failed'))?.kind).toBe(
      'network',
    )
    expect(providerErrorFromTransport('openai', new TypeError('terminated'))?.kind).toBe('network')
  })

  test('aborts and other errors are not classified', () => {
    expect(
      providerErrorFromTransport('openai', new DOMException('aborted', 'AbortError')),
    ).toBeUndefined()
    expect(providerErrorFromTransport('openai', new TypeError('x is undefined'))).toBeUndefined()
    expect(providerErrorFromTransport('openai', 'string')).toBeUndefined()
  })
})

describe('mapStreamErrors', () => {
  test('maps a read failure and passes values through', async () => {
    let sent = false
    const source = new ReadableStream<number>({
      pull(controller) {
        if (!sent) {
          sent = true
          controller.enqueue(1)
        } else {
          controller.error(new TypeError('terminated'))
        }
      },
    })
    const mapped = mapStreamErrors(source, (error) => providerErrorFromTransport('p', error))
    const reader = mapped.getReader()
    expect(await reader.read()).toEqual({ done: false, value: 1 })
    await expect(reader.read()).rejects.toMatchObject({ name: 'ProviderError', kind: 'network' })
  })
})

describe('toProviderError', () => {
  function httpError(status: number, data?: unknown, headers: Record<string, string> = {}) {
    return Object.assign(new Error(`Request failed with status code ${status}`), {
      name: 'HTTPError',
      response: { status, headers: new Headers(headers) },
      data,
    })
  }

  test('maps an HTTP error with its body', () => {
    const cause = httpError(429, { error: { code: 'quota' } }, { 'retry-after': '1' })
    const error = toProviderError({
      provider: 'openai',
      error: cause,
      readBody: (data) => ({ code: (data as { error: { code: string } }).error.code }),
    })
    expect(error).toBeInstanceOf(ProviderError)
    expect(error).toMatchObject({ kind: 'rate_limit', status: 429, code: 'quota' })
    expect((error as ProviderError).retryAfterMs).toBe(1000)
    expect((error as ProviderError).cause).toBe(cause)
  })

  test('body can override kind and retryable', () => {
    const error = toProviderError({
      provider: 'openai',
      error: httpError(429, {}),
      readBody: () => ({ kind: 'rate_limit', retryable: false }),
    })
    expect(error).toMatchObject({ kind: 'rate_limit', retryable: false })
  })

  test('network and timeout errors', () => {
    const network = Object.assign(new Error('Request failed'), { name: 'NetworkError' })
    expect(toProviderError({ provider: 'p', error: network })).toMatchObject({ kind: 'network' })
    const timeout = Object.assign(new Error('Request timed out'), { name: 'TimeoutError' })
    expect(toProviderError({ provider: 'p', error: timeout })).toMatchObject({ kind: 'timeout' })
  })

  test('passes through provider errors, aborts and unknown errors', () => {
    const provider = new ProviderError({ message: 'x', kind: 'auth', provider: 'p' })
    expect(toProviderError({ provider: 'p', error: provider })).toBe(provider)
    const abort = new DOMException('aborted', 'AbortError')
    expect(toProviderError({ provider: 'p', error: abort })).toBe(abort)
    const other = new Error('other')
    expect(toProviderError({ provider: 'p', error: other })).toBe(other)
  })
})
