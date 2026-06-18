import type { MessagePart } from '@mokei/model-provider'
import { describe, expect, test, vi } from 'vitest'

import { LlamaProvider } from '../src/provider.js'
import type { ChatResponseChunk, ToolCall } from '../src/types.js'

// Mock node-llama-cpp
const mockPromptWithMeta = vi.fn()
const mockSessionDispose = vi.fn()
const mockSetChatHistory = vi.fn()
class MockChatSession {
  promptWithMeta = mockPromptWithMeta
  dispose = mockSessionDispose
  setChatHistory = mockSetChatHistory
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

const mockGrammar = { type: 'grammar' }
const mockCreateGrammarForJsonSchema = vi.fn().mockResolvedValue(mockGrammar)

vi.mock('node-llama-cpp', () => ({
  getLlama: vi.fn().mockResolvedValue({
    loadModel: mockLoadModel,
    dispose: vi.fn().mockResolvedValue(undefined),
    createGrammarForJsonSchema: mockCreateGrammarForJsonSchema,
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

  test('throws when both output and tools are provided', async () => {
    const provider = new LlamaProvider({
      models: { 'test-model': { path: '/models/test.gguf' } },
    })

    const request = provider.streamChat({
      model: 'test-model',
      messages: [{ source: 'client', role: 'user', text: 'Hi' }],
      output: {
        schema: { type: 'object', properties: { name: { type: 'string' } } },
      },
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get weather',
            parameters: { type: 'object', properties: {} },
          },
        },
      ],
    })

    await expect(request).rejects.toThrow(
      'Structured output (grammar) and tool calling (functions) cannot be used together',
    )
  })

  test('passes grammar to promptWithMeta when output schema is provided', async () => {
    mockCreateGrammarForJsonSchema.mockClear()

    mockPromptWithMeta.mockImplementation(
      async (_prompt: string, options: Record<string, unknown>) => {
        const onTextChunk = options.onTextChunk as (chunk: string) => void
        onTextChunk('{"name":"test"}')
        return {
          responseText: '{"name":"test"}',
          response: ['{"name":"test"}'],
          stopReason: 'eogToken',
        }
      },
    )

    const provider = new LlamaProvider({
      models: { 'test-model': { path: '/models/test.gguf' } },
    })

    const request = provider.streamChat({
      model: 'test-model',
      messages: [{ source: 'client', role: 'user', text: 'Give me a name' }],
      output: {
        schema: { type: 'object', properties: { name: { type: 'string' } } },
      },
    })

    const stream = await request
    const reader = stream.getReader()
    let reading = true
    while (reading) {
      const { done } = await reader.read()
      if (done) reading = false
    }

    // Verify grammar was created from schema
    expect(mockCreateGrammarForJsonSchema).toHaveBeenCalledWith({
      type: 'object',
      properties: { name: { type: 'string' } },
    })

    // Verify grammar was passed to promptWithMeta
    expect(mockPromptWithMeta).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ grammar: mockGrammar }),
    )

    // Verify functions were NOT passed
    const lastCallIdx = mockPromptWithMeta.mock.calls.length - 1
    const callArgs = mockPromptWithMeta.mock.calls[lastCallIdx][1] as Record<string, unknown>
    expect(callArgs).not.toHaveProperty('functions')
  })

  test('does not create grammar when no output is provided', async () => {
    mockCreateGrammarForJsonSchema.mockClear()
    mockPromptWithMeta.mockClear()

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
    let reading = true
    while (reading) {
      const { done } = await reader.read()
      if (done) reading = false
    }

    // Verify grammar was NOT passed
    const callArgs = mockPromptWithMeta.mock.calls[0][1] as Record<string, unknown>
    expect(callArgs).not.toHaveProperty('grammar')
  })

  test('converts full message history and sets chat history on session', async () => {
    mockPromptWithMeta.mockClear()
    mockSetChatHistory.mockClear()
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
      messages: [
        { source: 'client', role: 'system', text: 'You are helpful' },
        { source: 'client', role: 'user', text: 'Hello' },
        {
          source: 'aggregated',
          role: 'assistant',
          text: 'Hi there!',
          toolCalls: [],
          doneReason: 'stop',
          inputTokens: 10,
          outputTokens: 5,
        },
        { source: 'client', role: 'user', text: 'How are you?' },
      ],
    })

    const stream = await request
    const reader = stream.getReader()
    let reading = true
    while (reading) {
      const { done } = await reader.read()
      if (done) reading = false
    }

    // Verify prompt is the last user message
    expect(mockPromptWithMeta).toHaveBeenCalledWith('How are you?', expect.any(Object))

    // Verify setChatHistory was called with converted history
    expect(mockSetChatHistory).toHaveBeenCalledWith([
      { type: 'system', text: 'You are helpful' },
      { type: 'user', text: 'Hello' },
      { type: 'model', response: ['Hi there!'] },
    ])
  })

  test('attaches tool results to preceding model function calls', async () => {
    mockPromptWithMeta.mockClear()
    mockSetChatHistory.mockClear()
    mockPromptWithMeta.mockImplementation(
      async (_prompt: string, options: Record<string, unknown>) => {
        const onTextChunk = options.onTextChunk as (chunk: string) => void
        onTextChunk('The weather is sunny')
        return {
          responseText: 'The weather is sunny',
          response: ['The weather is sunny'],
          stopReason: 'eogToken',
        }
      },
    )

    const provider = new LlamaProvider({
      models: { 'test-model': { path: '/models/test.gguf' } },
    })

    const request = provider.streamChat({
      model: 'test-model',
      messages: [
        { source: 'client', role: 'user', text: 'What is the weather?' },
        {
          source: 'aggregated',
          role: 'assistant',
          text: '',
          toolCalls: [
            {
              name: 'get_weather',
              id: 'call-1',
              arguments: '{"city":"London"}',
              raw: { function: { name: 'get_weather', arguments: { city: 'London' } } },
            },
          ],
          doneReason: 'tool_calls',
          inputTokens: 10,
          outputTokens: 5,
        },
        {
          source: 'client',
          role: 'tool',
          toolCallID: 'call-1',
          toolCallName: 'get_weather',
          text: 'Sunny, 22°C',
        },
        { source: 'client', role: 'user', text: 'Tell me more' },
      ],
    })

    const stream = await request
    const reader = stream.getReader()
    let reading = true
    while (reading) {
      const { done } = await reader.read()
      if (done) reading = false
    }

    // Verify setChatHistory was called
    expect(mockSetChatHistory).toHaveBeenCalledWith([
      { type: 'user', text: 'What is the weather?' },
      {
        type: 'model',
        response: [
          {
            type: 'functionCall',
            name: 'get_weather',
            params: { city: 'London' },
            result: 'Sunny, 22°C',
          },
        ],
      },
    ])

    // Verify prompt is the last user message
    expect(mockPromptWithMeta).toHaveBeenCalledWith('Tell me more', expect.any(Object))
  })

  test('handles single user message without setting chat history', async () => {
    mockPromptWithMeta.mockClear()
    mockSetChatHistory.mockClear()
    mockPromptWithMeta.mockImplementation(
      async (_prompt: string, options: Record<string, unknown>) => {
        const onTextChunk = options.onTextChunk as (chunk: string) => void
        onTextChunk('Hi')
        return { responseText: 'Hi', response: ['Hi'], stopReason: 'eogToken' }
      },
    )

    const provider = new LlamaProvider({
      models: { 'test-model': { path: '/models/test.gguf' } },
    })

    const request = provider.streamChat({
      model: 'test-model',
      messages: [{ source: 'client', role: 'user', text: 'Hello' }],
    })

    const stream = await request
    const reader = stream.getReader()
    let reading = true
    while (reading) {
      const { done } = await reader.read()
      if (done) reading = false
    }

    // Verify setChatHistory was NOT called (no history to set)
    expect(mockSetChatHistory).not.toHaveBeenCalled()

    // Verify prompt is the user message
    expect(mockPromptWithMeta).toHaveBeenCalledWith('Hello', expect.any(Object))
  })
})

describe('LlamaProvider.streamChat cancellation', () => {
  test('cancelling the reader aborts the prompt signal', async () => {
    // Use a never-resolving promptWithMeta so the stream stays open for cancellation
    mockPromptWithMeta.mockImplementation(
      () =>
        new Promise(() => {
          /* never resolves */
        }),
    )

    const provider = new LlamaProvider({ models: { m: { path: '/m.gguf' } } })
    const request = provider.streamChat({
      model: 'm',
      messages: [{ source: 'client', role: 'user', text: 'hi' }],
    })
    const stream = await request
    const reader = stream.getReader()
    expect(request.signal.aborted).toBe(false)
    await reader.cancel()
    expect(request.signal.aborted).toBe(true)
  })
})
