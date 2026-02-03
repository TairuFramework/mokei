import type { MessagePart } from '@mokei/model-provider'
import { describe, expect, test, vi } from 'vitest'

import { LlamaProvider } from '../src/provider.js'
import type { ChatResponseChunk, ToolCall } from '../src/types.js'

// Mock node-llama-cpp
const mockPromptWithMeta = vi.fn()
class MockChatSession {
  promptWithMeta = mockPromptWithMeta
  dispose = vi.fn()
}

const mockGetSequence = vi.fn().mockReturnValue({})
const mockCreateContext = vi.fn().mockResolvedValue({
  dispose: vi.fn().mockResolvedValue(undefined),
  disposed: false,
  contextSize: 4096,
  getSequence: mockGetSequence,
  sequencesLeft: 1,
})
const mockLoadModel = vi.fn().mockResolvedValue({
  dispose: vi.fn().mockResolvedValue(undefined),
  disposed: false,
  createContext: mockCreateContext,
  createEmbeddingContext: vi.fn(),
  trainContextSize: 4096,
})

vi.mock('node-llama-cpp', () => ({
  getLlama: vi.fn().mockResolvedValue({
    loadModel: mockLoadModel,
    dispose: vi.fn().mockResolvedValue(undefined),
  }),
  LlamaChatSession: MockChatSession,
}))

describe('LlamaProvider streamChat', () => {
  test('returns a stream with text deltas and done', async () => {
    mockPromptWithMeta.mockImplementation(
      async (_prompt: string, options: Record<string, unknown>) => {
        const onTextChunk = options.onTextChunk as (chunk: string) => void
        onTextChunk('Hello')
        onTextChunk(' World')
        return { responseText: 'Hello World' }
      },
    )

    const provider = new LlamaProvider({
      models: { 'test-model': { path: '/models/test.gguf' } },
    })

    const request = provider.streamChat({
      model: 'test-model',
      messages: [{ source: 'client', role: 'user', text: 'Hi' }],
    })

    const stream = await request
    const reader = stream.getReader()
    const parts: Array<MessagePart<ChatResponseChunk, ToolCall>> = []
    let reading = true
    while (reading) {
      const { done, value } = await reader.read()
      if (done) {
        reading = false
      } else {
        parts.push(value)
      }
    }

    expect(parts.some((p) => p.type === 'text-delta')).toBe(true)
    expect(parts.some((p) => p.type === 'done')).toBe(true)

    const textParts = parts.filter((p) => p.type === 'text-delta')
    expect(textParts.map((p) => (p as { text: string }).text).join('')).toBe('Hello World')
  })

  test('supports abort signal', async () => {
    const provider = new LlamaProvider({
      models: { 'test-model': { path: '/models/test.gguf' } },
    })

    const request = provider.streamChat({
      model: 'test-model',
      messages: [{ source: 'client', role: 'user', text: 'Hi' }],
    })

    expect(request.signal).toBeDefined()
    expect(typeof request.abort).toBe('function')
  })
})
