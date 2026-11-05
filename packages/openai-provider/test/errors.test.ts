import { ProviderError } from '@mokei/model-provider'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { OpenAIClient } from '../src/client.js'
import { readErrorBody, streamPayloadError } from '../src/errors.js'
import { OpenAIProvider } from '../src/provider.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function sseResponse(events: Array<unknown>) {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

const messages = [{ source: 'client' as const, role: 'user' as const, text: 'hi' }]

describe('readErrorBody', () => {
  test('reads code and message', () => {
    expect(
      readErrorBody({ error: { message: 'too long', type: 'invalid_request_error', code: 'x' } }),
    ).toEqual({ code: 'x', message: 'too long', retryable: undefined })
  })

  test('a spent quota is not retryable', () => {
    expect(readErrorBody({ error: { type: 'insufficient_quota' } }).retryable).toBe(false)
  })

  test('text and string error bodies', () => {
    expect(readErrorBody('bad gateway')).toEqual({ message: 'bad gateway' })
    expect(readErrorBody({ error: 'nope' })).toEqual({ message: 'nope' })
    expect(readErrorBody({})).toEqual({})
  })
})

describe('streamPayloadError', () => {
  test('ignores normal chunks', () => {
    expect(streamPayloadError({ id: 'x', choices: [] })).toBeUndefined()
  })

  test('classifies error payloads', () => {
    expect(streamPayloadError({ error: { type: 'server_error', message: 'boom' } })).toMatchObject({
      kind: 'server',
      retryable: true,
    })
    expect(streamPayloadError({ error: { code: 'rate_limit_exceeded' } })?.kind).toBe('rate_limit')
    expect(streamPayloadError({ error: { code: 'context_length_exceeded' } })?.kind).toBe(
      'context_length',
    )
  })
})

describe('OpenAI request errors', () => {
  test('chat rejects with a rate-limit ProviderError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          429,
          { error: { message: 'slow down', type: 'requests', code: 'rate_limit_exceeded' } },
          { 'retry-after': '7' },
        ),
      ),
    )
    const provider = new OpenAIProvider({ client: { apiKey: 'k' } })
    const error = await provider.streamChat({ model: 'm', messages }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ProviderError)
    expect(error).toMatchObject({
      kind: 'rate_limit',
      status: 429,
      code: 'rate_limit_exceeded',
      retryAfterMs: 7000,
      provider: 'openai',
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  test('auth and context-length failures are not retryable', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(401, { error: { message: 'bad key' } }))
        .mockResolvedValueOnce(
          jsonResponse(400, { error: { message: 'x', code: 'context_length_exceeded' } }),
        ),
    )
    const provider = new OpenAIProvider({ client: { apiKey: 'k' } })
    const auth = await provider.streamChat({ model: 'm', messages }).catch((e: unknown) => e)
    expect(auth).toMatchObject({ kind: 'auth', retryable: false })
    const context = await provider.streamChat({ model: 'm', messages }).catch((e: unknown) => e)
    expect(context).toMatchObject({ kind: 'context_length', retryable: false })
  })

  test('a network failure becomes a network ProviderError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    )
    const provider = new OpenAIProvider({ client: { apiKey: 'k' } })
    const error = await provider.streamChat({ model: 'm', messages }).catch((e: unknown) => e)
    expect(error).toMatchObject({ name: 'ProviderError', kind: 'network', retryable: true })
  })

  test('an in-stream error payload becomes an error part', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([{ error: { message: 'The server had an error', type: 'server_error' } }]),
      ),
    )
    const provider = new OpenAIProvider({ client: { apiKey: 'k' } })
    const stream = await provider.streamChat({ model: 'm', messages })
    const parts = []
    for await (const part of stream) parts.push(part)
    expect(parts).toHaveLength(1)
    expect(parts[0]).toMatchObject({ type: 'error', error: { kind: 'server' } })
  })

  test('embeddings retry a 503 that gives Retry-After', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse(503, { error: { message: 'busy' } }, { 'retry-after': '0' }),
        )
        .mockResolvedValueOnce(jsonResponse(200, { data: [{ embedding: [1, 2] }] })),
    )
    const client = new OpenAIClient({ apiKey: 'k' })
    const result = await client.embeddings({ model: 'm', input: 'x' })
    expect(result).toEqual([{ embedding: [1, 2] }])
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  test('chat is not retried by the HTTP client', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(503, { error: { message: 'busy' } }, { 'retry-after': '0' })),
    )
    const provider = new OpenAIProvider({ client: { apiKey: 'k' } })
    const error = await provider.streamChat({ model: 'm', messages }).catch((e: unknown) => e)
    expect(error).toMatchObject({ kind: 'overloaded' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
