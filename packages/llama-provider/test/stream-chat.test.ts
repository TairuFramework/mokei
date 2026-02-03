import type { MessagePart } from '@mokei/model-provider'
import { describe, expect, test, vi } from 'vitest'

import { LlamaProvider } from '../src/provider.js'
import type { ChatResponseChunk, ToolCall } from '../src/types.js'

// Mock node-llama-cpp
const mockPromptWithMeta = vi.fn()
const mockSessionDispose = vi.fn()
class MockChatSession {
  promptWithMeta = mockPromptWithMeta
  dispose = mockSessionDispose
}

const mockTokenMeter = {
  getState: vi.fn().mockReturnValue({ usedInputTokens: 0, usedOutputTokens: 0 }),
  diff: vi.fn().mockReturnValue({ usedInputTokens: 15, usedOutputTokens: 25 }),
}
const mockGetSequence = vi.fn().mockReturnValue({ tokenMeter: mockTokenMeter })
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
        return {
          responseText: 'Hello World',
          response: ['Hello', ' World'],
          stopReason: 'eogToken',
        }
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

  test('emits tool-call parts when result contains function calls', async () => {
    mockPromptWithMeta.mockImplementation(
      async (_prompt: string, _options: Record<string, unknown>) => {
        return {
          responseText: '',
          stopReason: 'functionCalls',
          response: [{ type: 'functionCall', name: 'get_weather', params: { city: 'London' } }],
        }
      },
    )

    const provider = new LlamaProvider({
      models: { 'test-model': { path: '/models/test.gguf' } },
    })

    const request = provider.streamChat({
      model: 'test-model',
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

    const toolCallParts = parts.filter((p) => p.type === 'tool-call')
    expect(toolCallParts).toHaveLength(1)

    const toolCallPart = toolCallParts[0] as {
      type: 'tool-call'
      toolCalls: Array<{ name: string; arguments: string; id: string; raw: ToolCall }>
    }
    expect(toolCallPart.toolCalls).toHaveLength(1)
    expect(toolCallPart.toolCalls[0].name).toBe('get_weather')
    expect(JSON.parse(toolCallPart.toolCalls[0].arguments)).toEqual({ city: 'London' })
    expect(toolCallPart.toolCalls[0].id).toBeDefined()

    const donePart = parts.find((p) => p.type === 'done') as {
      type: 'done'
      reason: string
    }
    expect(donePart).toBeDefined()
    expect(donePart.reason).toBe('tool_calls')
  })

  test('disposes chat session after prompt completes', async () => {
    mockPromptWithMeta.mockImplementation(
      async (_prompt: string, options: Record<string, unknown>) => {
        const onTextChunk = options.onTextChunk as (chunk: string) => void
        onTextChunk('Hello')
        return { responseText: 'Hello', response: ['Hello'], stopReason: 'eogToken' }
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
    // Consume the stream fully
    let reading = true
    while (reading) {
      const { done } = await reader.read()
      if (done) {
        reading = false
      }
    }

    // The chat session's dispose should have been called via .finally()
    expect(mockSessionDispose).toHaveBeenCalled()
  })

  test('emits token counts from token meter in done event', async () => {
    mockPromptWithMeta.mockImplementation(
      async (_prompt: string, options: Record<string, unknown>) => {
        const onTextChunk = options.onTextChunk as (chunk: string) => void
        onTextChunk('Hello')
        return { responseText: 'Hello', response: ['Hello'], stopReason: 'eogToken' }
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

    const donePart = parts.find((p) => p.type === 'done') as {
      type: 'done'
      inputTokens: number
      outputTokens: number
    }
    expect(donePart).toBeDefined()
    expect(donePart.inputTokens).toBe(15)
    expect(donePart.outputTokens).toBe(25)
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
