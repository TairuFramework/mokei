import { describe, expect, test } from 'vitest'

import { AnthropicClient } from '../src/client.js'
import { AnthropicProvider } from '../src/provider.js'

function captureMessages(provider: { client: AnthropicClient }) {
  const calls: Array<Record<string, unknown>> = []
  ;(provider.client as unknown as { messages: (p: Record<string, unknown>) => unknown }).messages =
    (p) => {
      calls.push(p)
      const controller = new AbortController()
      return Object.assign(Promise.resolve(new ReadableStream({ start: (c) => c.close() })), {
        abort: () => controller.abort(),
        signal: controller.signal,
      })
    }
  return calls
}

describe('AnthropicProvider sampling params', () => {
  test('forwards sampling, falls back to defaultMaxTokens, and providerOptions as a field', async () => {
    const client = new AnthropicClient({ apiKey: 'test' })
    const provider = new AnthropicProvider({ client, defaultMaxTokens: 4096 })
    const calls = captureMessages({ client })

    await provider.streamChat({
      model: 'claude-x',
      messages: [{ source: 'client', role: 'user', text: 'hi' }],
      temperature: 0.4,
      topP: 0.7,
      providerOptions: { top_k: 5 },
    })
    const body = calls[0]
    expect(body.temperature).toBe(0.4)
    expect(body.top_p).toBe(0.7)
    expect(body.max_tokens).toBe(4096) // falls back when maxTokens unset
    // Raw bag forwarded intact as a field; client owns the spread into the JSON body
    expect(body.providerOptions).toEqual({ top_k: 5 })
  })

  test('fromConfig accepts maxTokens without throwing', () => {
    const provider = AnthropicProvider.fromConfig({ apiKey: 'test', maxTokens: 1024 })
    expect(provider).toBeInstanceOf(AnthropicProvider)
  })
})
