import { describe, expect, test } from 'vitest'

import { OllamaClient } from '../src/client.js'
import { OllamaProvider } from '../src/provider.js'

describe('OllamaProvider sampling params', () => {
  test('maps sampling into options and spreads providerOptions last', async () => {
    const calls: Array<Record<string, unknown>> = []
    const client = new OllamaClient({ baseURL: 'http://localhost:11434' })
    ;(client as unknown as { chat: (p: Record<string, unknown>) => unknown }).chat = (p) => {
      calls.push(p)
      const controller = new AbortController()
      return Object.assign(Promise.resolve(new ReadableStream({ start: (c) => c.close() })), {
        abort: () => controller.abort(),
        signal: controller.signal,
      })
    }
    const provider = new OllamaProvider({ client })

    await provider.streamChat({
      model: 'llama3',
      messages: [{ source: 'client', role: 'user', text: 'hi' }],
      temperature: 0.5,
      maxTokens: 128,
      topP: 0.6,
      providerOptions: { top_p: 0.95, seed: 1 },
    })
    const options = calls[0].options as Record<string, unknown>
    expect(options.temperature).toBe(0.5)
    expect(options.num_predict).toBe(128)
    expect(options.top_p).toBe(0.95) // providerOptions wins
    expect(options.seed).toBe(1)
  })

  test('structural/transport top-level fields cannot be overridden by providerOptions', async () => {
    const calls: Array<Record<string, unknown>> = []
    const client = new OllamaClient({ baseURL: 'http://localhost:11434' })
    ;(client as unknown as { chat: (p: Record<string, unknown>) => unknown }).chat = (p) => {
      calls.push(p)
      const controller = new AbortController()
      return Object.assign(Promise.resolve(new ReadableStream({ start: (c) => c.close() })), {
        abort: () => controller.abort(),
        signal: controller.signal,
      })
    }
    const provider = new OllamaProvider({ client })

    await provider.streamChat({
      model: 'llama3',
      messages: [{ source: 'client', role: 'user', text: 'hi' }],
      providerOptions: { model: 'evil', stream: false, top_p: 0.95 },
    })

    // top-level structural fields are safe — providerOptions go into options sub-object
    expect(calls[0].model).toBe('llama3') // NOT 'evil'
    expect(calls[0].stream).toBe(true) // NOT false
    const options = calls[0].options as Record<string, unknown>
    expect(options.top_p).toBe(0.95) // sampling key in options passes through
  })
})
