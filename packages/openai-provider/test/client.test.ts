import { afterEach, describe, expect, test, vi } from 'vitest'

import { OpenAIClient, parseEventData } from '../src/client.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OpenAIClient.chat providerOptions clobber protection', () => {
  test('structural/transport fields cannot be overridden by providerOptions', async () => {
    let capturedBody: Record<string, unknown> = {}
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: Request | string) => {
        const text = input instanceof Request ? await input.clone().text() : ''
        capturedBody = JSON.parse(text) as Record<string, unknown>
        return new Response(new ReadableStream({ start: (c) => c.close() }), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        })
      }),
    )

    const client = new OpenAIClient({ apiKey: 'test' })
    const request = client.chat({
      model: 'gpt-real',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
      temperature: 0.3,
      providerOptions: {
        temperature: 0.9,
        seed: 7,
        model: 'evil',
        messages: [],
        stream: false,
      },
    })
    // Drain the stream
    const stream = await request
    const reader = stream.getReader()
    let done = false
    while (!done) {
      const result = await reader.read()
      done = result.done
    }

    expect(capturedBody.model).toBe('gpt-real')
    expect(capturedBody.messages as Array<unknown>).toHaveLength(1)
    expect(capturedBody.stream).toBe(true)
    expect(capturedBody.temperature).toBe(0.9) // providerOptions wins for sampling
    expect(capturedBody.seed).toBe(7) // extra key passes through
  })
})

describe('parseEventData', () => {
  test('parses valid JSON SSE data', () => {
    expect(parseEventData('{"a":1}')).toEqual({ a: 1 })
  })

  test('returns undefined for [DONE] sentinel', () => {
    expect(parseEventData('[DONE]')).toBeUndefined()
  })

  test('returns undefined for empty / keep-alive lines', () => {
    expect(parseEventData('')).toBeUndefined()
    expect(parseEventData('   ')).toBeUndefined()
  })

  test('returns undefined (no throw) for non-JSON data', () => {
    expect(parseEventData(': keep-alive comment')).toBeUndefined()
    expect(parseEventData('not json')).toBeUndefined()
  })
})
