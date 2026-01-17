import type { Tool as ContextTool } from '@mokei/context-protocol'
import type { ServerMessage } from '@mokei/model-provider'
import { describe, expect, test } from 'vitest'

import { AnthropicClient, KNOWN_MODELS } from '../src/client.js'
import { AnthropicProvider } from '../src/provider.js'
import type { StreamEvent, ToolCall } from '../src/types.js'

describe('AnthropicProvider', () => {
  describe('fromConfig', () => {
    test('creates provider from valid config', () => {
      const provider = AnthropicProvider.fromConfig({
        apiKey: 'test-api-key',
      })
      expect(provider).toBeInstanceOf(AnthropicProvider)
    })

    test('creates provider with custom baseURL', () => {
      const provider = AnthropicProvider.fromConfig({
        apiKey: 'test-api-key',
        baseURL: 'https://custom.anthropic.com/v1',
      })
      expect(provider).toBeInstanceOf(AnthropicProvider)
    })
  })

  describe('constructor', () => {
    test('accepts AnthropicClient instance', () => {
      const client = new AnthropicClient({ apiKey: 'test-key' })
      const provider = new AnthropicProvider({ client })
      expect(provider).toBeInstanceOf(AnthropicProvider)
    })

    test('accepts client params', () => {
      const provider = new AnthropicProvider({
        client: { apiKey: 'test-key' },
      })
      expect(provider).toBeInstanceOf(AnthropicProvider)
    })

    test('accepts default max tokens', () => {
      const provider = new AnthropicProvider({
        client: { apiKey: 'test-key' },
        defaultMaxTokens: 8192,
      })
      expect(provider).toBeInstanceOf(AnthropicProvider)
    })
  })

  describe('listModels', () => {
    test('returns known Claude models', async () => {
      const provider = new AnthropicProvider({ client: { apiKey: 'test-key' } })
      const models = await provider.listModels()

      expect(models.length).toBeGreaterThan(0)
      expect(models.every((m) => m.id && m.raw)).toBe(true)

      // Check for expected models
      const modelIds = models.map((m) => m.id)
      expect(modelIds).toContain('claude-sonnet-4-20250514')
      expect(modelIds).toContain('claude-3-5-sonnet-20241022')
    })
  })

  describe('embed', () => {
    test('throws error (Anthropic does not support embeddings)', async () => {
      const provider = new AnthropicProvider({ client: { apiKey: 'test-key' } })

      await expect(provider.embed({ model: 'any', input: 'test' })).rejects.toThrow(
        'Anthropic does not support embeddings',
      )
    })
  })

  describe('aggregateMessage', () => {
    test('aggregates text parts', () => {
      const provider = new AnthropicProvider({ client: { apiKey: 'test-key' } })

      const parts: Array<ServerMessage<StreamEvent, ToolCall>> = [
        { source: 'server', role: 'assistant', text: 'Hello', raw: {} as StreamEvent },
        { source: 'server', role: 'assistant', text: ' World', raw: {} as StreamEvent },
        {
          source: 'server',
          role: 'assistant',
          inputTokens: 10,
          outputTokens: 5,
          raw: {} as StreamEvent,
        },
      ]

      const result = provider.aggregateMessage(parts)

      expect(result.text).toBe('Hello World')
      expect(result.role).toBe('assistant')
      expect(result.source).toBe('aggregated')
      expect(result.inputTokens).toBe(10)
      expect(result.outputTokens).toBe(5)
    })

    test('aggregates reasoning parts (extended thinking)', () => {
      const provider = new AnthropicProvider({ client: { apiKey: 'test-key' } })

      const parts: Array<ServerMessage<StreamEvent, ToolCall>> = [
        { source: 'server', role: 'assistant', reasoning: 'Thinking...', raw: {} as StreamEvent },
        {
          source: 'server',
          role: 'assistant',
          reasoning: ' more thoughts',
          raw: {} as StreamEvent,
        },
        { source: 'server', role: 'assistant', text: 'My answer', raw: {} as StreamEvent },
      ]

      const result = provider.aggregateMessage(parts)

      expect(result.text).toBe('My answer')
      expect(result.reasoning).toBe('Thinking... more thoughts')
    })

    test('aggregates tool calls', () => {
      const provider = new AnthropicProvider({ client: { apiKey: 'test-key' } })

      const toolCall1: ToolCall = { id: 'call-1', name: 'get_weather', input: {} }

      const parts: Array<ServerMessage<StreamEvent, ToolCall>> = [
        { source: 'server', role: 'assistant', text: 'Let me check', raw: {} as StreamEvent },
        {
          source: 'server',
          role: 'assistant',
          toolCalls: [{ id: 'call-1', name: 'get_weather', arguments: '{"city":', raw: toolCall1 }],
          raw: {} as StreamEvent,
        },
        {
          source: 'server',
          role: 'assistant',
          toolCalls: [
            { id: 'call-1', name: 'get_weather', arguments: '"London"}', raw: toolCall1 },
          ],
          raw: {} as StreamEvent,
        },
      ]

      const result = provider.aggregateMessage(parts)

      expect(result.toolCalls).toHaveLength(1)
      expect(result.toolCalls[0].name).toBe('get_weather')
      expect(result.toolCalls[0].arguments).toBe('{"city":"London"}')
    })

    test('handles done reason', () => {
      const provider = new AnthropicProvider({ client: { apiKey: 'test-key' } })

      const parts: Array<ServerMessage<StreamEvent, ToolCall>> = [
        { source: 'server', role: 'assistant', text: 'Done', raw: {} as StreamEvent },
        { source: 'server', role: 'assistant', doneReason: 'end_turn', raw: {} as StreamEvent },
      ]

      const result = provider.aggregateMessage(parts)

      expect(result.doneReason).toBe('end_turn')
    })
  })

  describe('toolFromMCP', () => {
    test('converts MCP tool to Anthropic format', () => {
      const provider = new AnthropicProvider({ client: { apiKey: 'test-key' } })

      const mcpTool: ContextTool = {
        name: 'query_database',
        description: 'Query the database',
        inputSchema: {
          type: 'object',
          properties: {
            sql: { type: 'string', description: 'SQL query' },
          },
          required: ['sql'],
        },
      }

      const anthropicTool = provider.toolFromMCP(mcpTool)

      expect(anthropicTool.name).toBe('query_database')
      expect(anthropicTool.description).toBe('Query the database')
      expect(anthropicTool.input_schema).toEqual({
        type: 'object',
        properties: {
          sql: { type: 'string', description: 'SQL query' },
        },
        required: ['sql'],
      })
    })

    test('handles tool without description', () => {
      const provider = new AnthropicProvider({ client: { apiKey: 'test-key' } })

      const mcpTool: ContextTool = {
        name: 'simple_tool',
        inputSchema: { type: 'object' },
      }

      const anthropicTool = provider.toolFromMCP(mcpTool)

      expect(anthropicTool.name).toBe('simple_tool')
      expect(anthropicTool.description).toBe('')
    })
  })

  describe('KNOWN_MODELS', () => {
    test('contains expected models', () => {
      expect(KNOWN_MODELS.length).toBeGreaterThan(0)

      for (const model of KNOWN_MODELS) {
        expect(model.id).toBeTruthy()
        expect(model.type).toBe('model')
        expect(model.display_name).toBeTruthy()
      }
    })

    test('includes Claude Sonnet 4', () => {
      const sonnet4 = KNOWN_MODELS.find((m) => m.id === 'claude-sonnet-4-20250514')
      expect(sonnet4).toBeDefined()
      expect(sonnet4?.display_name).toBe('Claude Sonnet 4')
    })
  })
})
