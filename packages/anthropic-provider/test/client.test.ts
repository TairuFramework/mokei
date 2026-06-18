import { afterEach, describe, expect, test, vi } from 'vitest'

import { AnthropicClient } from '../src/client.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AnthropicClient.messages providerOptions clobber protection', () => {
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

    const client = new AnthropicClient({ apiKey: 'test' })
    const request = client.messages({
      model: 'claude-real',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      max_tokens: 100,
      system: 'sys',
      stream: true,
      temperature: 0.4,
      providerOptions: {
        temperature: 0.8,
        top_k: 5,
        model: 'evil',
        system: 'hacked',
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

    expect(capturedBody.model).toBe('claude-real')
    expect(capturedBody.system).toEqual([{ type: 'text', text: 'sys' }]) // NOT 'hacked'
    expect(capturedBody.stream).toBe(true) // NOT false
    expect(capturedBody.temperature).toBe(0.8) // providerOptions wins for sampling
    expect(capturedBody.top_k).toBe(5) // extra sampling key passes through
  })
})
