import { describe, expect, test } from 'vitest'

import { OpenAIClient } from '../src/client.js'
import { OpenAIProvider } from '../src/provider.js'

function captureChat() {
  const calls: Array<Record<string, unknown>> = []
  const client = new OpenAIClient({ apiKey: 'test' })
  ;(client as unknown as { chat: (p: Record<string, unknown>) => unknown }).chat = (p) => {
    calls.push(p)
    const controller = new AbortController()
    return Object.assign(Promise.resolve(new ReadableStream({ start: (c) => c.close() })), {
      abort: () => controller.abort(),
      signal: controller.signal,
    })
  }
  return { client, calls }
}

describe('OpenAIProvider sampling params', () => {
  test('forwards temperature/maxTokens/topP and providerOptions as a field', async () => {
    const { client, calls } = captureChat()
    const provider = new OpenAIProvider({ client })
    await provider.streamChat({
      model: 'gpt-x',
      messages: [{ source: 'client', role: 'user', text: 'hi' }],
      temperature: 0.3,
      maxTokens: 256,
      topP: 0.8,
      providerOptions: { seed: 7, temperature: 0.9 },
    })
    const body = calls[0]
    // Typed fields are forwarded mapped
    expect(body.temperature).toBe(0.3)
    expect(body.top_p).toBe(0.8)
    expect(body.max_tokens).toBe(256)
    // Raw bag forwarded intact as a field; client owns the spread into the JSON body
    expect(body.providerOptions).toEqual({ seed: 7, temperature: 0.9 })
  })
})
