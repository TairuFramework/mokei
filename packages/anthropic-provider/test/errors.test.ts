import { ProviderError } from '@mokei/model-provider'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { readErrorBody, streamEventError } from '../src/errors.js'
import { AnthropicProvider } from '../src/provider.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function sseResponse(events: Array<{ type: string } & Record<string, unknown>>) {
  const body = events
    .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join('')
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

const messages = [{ source: 'client' as const, role: 'user' as const, text: 'hi' }]

describe('readErrorBody', () => {
  test('maps Anthropic error types', () => {
    expect(
      readErrorBody({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }),
    ).toEqual({ code: 'overloaded_error', message: 'Overloaded', kind: 'overloaded' })
    expect(readErrorBody({ type: 'error', error: { type: 'invalid_request_error' } }).kind).toBe(
      undefined,
    )
    expect(readErrorBody('upstream connect error')).toEqual({ message: 'upstream connect error' })
  })
})

describe('streamEventError', () => {
  test('classifies stream error events', () => {
    const error = streamEventError({ type: 'overloaded_error', message: 'Overloaded' }, null)
    expect(error).toBeInstanceOf(ProviderError)
    expect(error).toMatchObject({ kind: 'overloaded', retryable: true, code: 'overloaded_error' })
    expect(error.message).toBe('overloaded_error: Overloaded')
    expect(streamEventError({ type: 'mystery' }, null).kind).toBe('unknown')
  })
})

describe('Anthropic request errors', () => {
  test('529 overloaded rejects with a retryable ProviderError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(529, {
          type: 'error',
          error: { type: 'overloaded_error', message: 'Overloaded' },
        }),
      ),
    )
    const provider = new AnthropicProvider({ client: { apiKey: 'k' } })
    const error = await provider.streamChat({ model: 'm', messages }).catch((e: unknown) => e)
    expect(error).toMatchObject({
      name: 'ProviderError',
      kind: 'overloaded',
      status: 529,
      retryable: true,
      provider: 'anthropic',
    })
  })

  test('429 carries retry-after', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          429,
          { type: 'error', error: { type: 'rate_limit_error', message: 'slow' } },
          { 'retry-after': '12' },
        ),
      ),
    )
    const provider = new AnthropicProvider({ client: { apiKey: 'k' } })
    const error = await provider.streamChat({ model: 'm', messages }).catch((e: unknown) => e)
    expect(error).toMatchObject({ kind: 'rate_limit', retryAfterMs: 12_000 })
  })

  test('a prompt that is too long is a context-length error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(400, {
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message: 'prompt is too long: 210000 tokens > 200000 maximum',
          },
        }),
      ),
    )
    const provider = new AnthropicProvider({ client: { apiKey: 'k' } })
    const error = await provider.streamChat({ model: 'm', messages }).catch((e: unknown) => e)
    expect(error).toMatchObject({ kind: 'context_length', retryable: false })
  })

  test('an in-stream overloaded error becomes a ProviderError part', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
        ]),
      ),
    )
    const provider = new AnthropicProvider({ client: { apiKey: 'k' } })
    const stream = await provider.streamChat({ model: 'm', messages })
    const parts = []
    for await (const part of stream) parts.push(part)
    expect(parts).toHaveLength(1)
    expect(parts[0]).toMatchObject({ type: 'error', error: { kind: 'overloaded' } })
  })
})
