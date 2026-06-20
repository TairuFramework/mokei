import { LlamaProvider } from '@mokei/llama-provider'
import { describe, expect, test } from 'vitest'

const GGUF = process.env.MOKEI_LLAMA_GGUF
const MODEL = 'integration-model'

type StreamPart = {
  type: string
  text?: string
  toolCalls?: Array<{ name: string }>
}

async function drain(request: ReturnType<LlamaProvider['streamChat']>): Promise<Array<StreamPart>> {
  const stream = await request
  const reader = stream.getReader()
  const parts: Array<StreamPart> = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value as StreamPart)
  }
  return parts
}

// Gated: runs only when MOKEI_LLAMA_GGUF points at a local .gguf file. Not part
// of CI (the root `pnpm test` excludes integration-tests).
describe.skipIf(!GGUF)('LlamaProvider (real GGUF)', () => {
  function makeProvider(): LlamaProvider {
    return new LlamaProvider({ models: { [MODEL]: { path: GGUF as string } } })
  }

  test('listModels returns the registered model', async () => {
    const provider = makeProvider()
    try {
      const models = await provider.listModels()
      expect(models.map((m) => m.id)).toContain(MODEL)
    } finally {
      await provider.dispose()
    }
  })

  test('streamChat yields text deltas and a done part', async () => {
    const provider = makeProvider()
    try {
      const parts = await drain(
        provider.streamChat({
          model: MODEL,
          messages: [{ source: 'client', role: 'user', text: 'Say hello in one word.' }],
        }),
      )
      expect(parts.some((p) => p.type === 'text-delta')).toBe(true)
      expect(parts.some((p) => p.type === 'done')).toBe(true)
    } finally {
      await provider.dispose()
    }
  }, 120_000)

  test('streamChat with tools completes and any tool-call names a provided tool', async () => {
    const provider = makeProvider()
    try {
      const parts = await drain(
        provider.streamChat({
          model: MODEL,
          messages: [{ source: 'client', role: 'user', text: 'What is the weather in London?' }],
          tools: [
            {
              type: 'function',
              function: {
                name: 'get_weather',
                description: 'Get the weather for a city',
                parameters: {
                  type: 'object',
                  properties: { city: { type: 'string' } },
                  required: ['city'],
                },
              },
            },
          ],
        }),
      )
      // The stream must terminate cleanly. Whether a small model actually emits a
      // tool call is model-dependent, so only assert the name when one appears.
      expect(parts.some((p) => p.type === 'done')).toBe(true)
      for (const part of parts.filter((p) => p.type === 'tool-call')) {
        for (const toolCall of part.toolCalls ?? []) {
          expect(toolCall.name).toBe('get_weather')
        }
      }
    } finally {
      await provider.dispose()
    }
  }, 120_000)
})
