import { afterEach, describe, expect, test, vi } from 'vitest'

import { OllamaClient } from '../src/client.js'
import { readErrorBody, streamLineError } from '../src/errors.js'
import { OllamaProvider } from '../src/provider.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

const messages = [{ source: 'client' as const, role: 'user' as const, text: 'hi' }]

describe('Ollama errors', () => {
  test('readErrorBody', () => {
    expect(readErrorBody({ error: 'model "x" not found' })).toEqual({
      message: 'model "x" not found',
    })
    expect(readErrorBody({})).toEqual({})
  })

  test('streamLineError', () => {
    expect(streamLineError({ model: 'm', message: { content: 'x' }, done: false })).toBeUndefined()
    expect(streamLineError({ error: 'runner stopped' })).toMatchObject({
      kind: 'unknown',
      retryable: false,
    })
    expect(streamLineError({ error: 'input exceeds the context length' })?.kind).toBe(
      'context_length',
    )
  })

  test('a missing model is an invalid request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(404, { error: 'model "nope" not found, try pulling it first' }),
      ),
    )
    const provider = new OllamaProvider()
    const error = await provider.streamChat({ model: 'nope', messages }).catch((e: unknown) => e)
    expect(error).toMatchObject({
      name: 'ProviderError',
      kind: 'invalid_request',
      status: 404,
      provider: 'ollama',
      message:
        'ollama request failed with status 404: model "nope" not found, try pulling it first',
    })
  })

  test('a busy server is overloaded and retryable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(503, { error: 'server busy' })),
    )
    const provider = new OllamaProvider()
    const error = await provider.streamChat({ model: 'm', messages }).catch((e: unknown) => e)
    expect(error).toMatchObject({ kind: 'overloaded', retryable: true })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  test('an in-stream error line becomes an error part', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(`${JSON.stringify({ error: 'runner stopped' })}\n`)),
    )
    const provider = new OllamaProvider()
    const stream = await provider.streamChat({ model: 'm', messages })
    const parts = []
    for await (const part of stream) parts.push(part)
    expect(parts).toHaveLength(1)
    expect(parts[0]).toMatchObject({ type: 'error', error: { name: 'ProviderError' } })
  })

  test('embed retries a 503 with Retry-After', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(503, { error: 'busy' }, { 'retry-after': '0' }))
        .mockResolvedValueOnce(jsonResponse(200, { model: 'm', embeddings: [[1]] })),
    )
    const result = await new OllamaClient().embed({ model: 'm', input: 'x' })
    expect(result.embeddings).toEqual([[1]])
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
