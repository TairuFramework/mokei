import type { Tool as ContextTool } from '@mokei/context-protocol'
import type { ServerMessage } from '@mokei/model-provider'
import { describe, expect, test } from 'vitest'

import { LlamaProvider } from '../src/provider.js'
import type { ChatResponseChunk, ToolCall } from '../src/types.js'

describe('LlamaProvider', () => {
  describe('fromConfig', () => {
    test('creates provider from valid config', () => {
      const provider = LlamaProvider.fromConfig({
        models: {
          'test-model': { path: '/models/test.gguf' },
        },
      })
      expect(provider).toBeInstanceOf(LlamaProvider)
    })

    test('creates provider with full model options', () => {
      const provider = LlamaProvider.fromConfig({
        models: {
          'test-model': { path: '/models/test.gguf', contextSize: 4096, gpu: 'auto' },
        },
      })
      expect(provider).toBeInstanceOf(LlamaProvider)
    })
  })

  describe('constructor', () => {
    test('accepts model registry', () => {
      const provider = new LlamaProvider({
        models: {
          'test-model': { path: '/models/test.gguf' },
        },
      })
      expect(provider).toBeInstanceOf(LlamaProvider)
    })

    test('defaults to empty model registry', () => {
      const provider = new LlamaProvider()
      expect(provider).toBeInstanceOf(LlamaProvider)
    })
  })

  describe('listModels', () => {
    test('returns registered models', async () => {
      const provider = new LlamaProvider({
        models: {
          'llama-3.2': { path: '/models/llama.gguf' },
          'qwen-coder': { path: '/models/qwen.gguf' },
        },
      })
      const models = await provider.listModels()
      expect(models).toHaveLength(2)
      expect(models.map((m) => m.id)).toEqual(['llama-3.2', 'qwen-coder'])
    })

    test('returns empty list when no models registered', async () => {
      const provider = new LlamaProvider()
      const models = await provider.listModels()
      expect(models).toHaveLength(0)
    })

    test('includes model info as raw', async () => {
      const provider = new LlamaProvider({
        models: {
          'test-model': { path: '/models/test.gguf' },
        },
      })
      const models = await provider.listModels()
      expect(models[0].raw).toEqual({ name: 'test-model', path: '/models/test.gguf' })
    })
  })

  describe('toolFromMCP', () => {
    test('converts MCP tool to function tool format', () => {
      const provider = new LlamaProvider()

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

      const tool = provider.toolFromMCP(mcpTool)

      expect(tool).toEqual({
        type: 'function',
        function: {
          name: 'query_database',
          description: 'Query the database',
          parameters: {
            type: 'object',
            properties: {
              sql: { type: 'string', description: 'SQL query' },
            },
            required: ['sql'],
          },
        },
      })
    })

    test('handles tool without description', () => {
      const provider = new LlamaProvider()

      const mcpTool: ContextTool = {
        name: 'simple_tool',
        inputSchema: { type: 'object' },
      }

      const tool = provider.toolFromMCP(mcpTool)
      expect(tool.function.description).toBe('')
    })
  })

  describe('aggregateMessage', () => {
    test('aggregates text parts', () => {
      const provider = new LlamaProvider()

      const parts: Array<ServerMessage<ChatResponseChunk, ToolCall>> = [
        { source: 'server', role: 'assistant', text: 'Hello', raw: {} as ChatResponseChunk },
        { source: 'server', role: 'assistant', text: ' World', raw: {} as ChatResponseChunk },
        {
          source: 'server',
          role: 'assistant',
          inputTokens: 10,
          outputTokens: 5,
          raw: {} as ChatResponseChunk,
        },
      ]

      const result = provider.aggregateMessage(parts)

      expect(result.text).toBe('Hello World')
      expect(result.role).toBe('assistant')
      expect(result.source).toBe('aggregated')
      expect(result.inputTokens).toBe(10)
      expect(result.outputTokens).toBe(5)
    })

    test('aggregates tool calls', () => {
      const provider = new LlamaProvider()

      const toolCall: ToolCall = {
        function: { name: 'get_weather', arguments: { city: 'London' } },
      }

      const parts: Array<ServerMessage<ChatResponseChunk, ToolCall>> = [
        { source: 'server', role: 'assistant', text: 'Let me check', raw: {} as ChatResponseChunk },
        {
          source: 'server',
          role: 'assistant',
          toolCalls: [
            { id: 'call-1', name: 'get_weather', arguments: '{"city":"London"}', raw: toolCall },
          ],
          raw: {} as ChatResponseChunk,
        },
      ]

      const result = provider.aggregateMessage(parts)

      expect(result.text).toBe('Let me check')
      expect(result.toolCalls).toHaveLength(1)
      expect(result.toolCalls[0].name).toBe('get_weather')
    })

    test('handles done reason', () => {
      const provider = new LlamaProvider()

      const parts: Array<ServerMessage<ChatResponseChunk, ToolCall>> = [
        { source: 'server', role: 'assistant', text: 'Done', raw: {} as ChatResponseChunk },
        {
          source: 'server',
          role: 'assistant',
          doneReason: 'stop',
          raw: {} as ChatResponseChunk,
        },
      ]

      const result = provider.aggregateMessage(parts)
      expect(result.doneReason).toBe('stop')
    })
  })
})
