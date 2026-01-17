import { describe, expect, test, vi } from 'vitest'

import { type LocalToolDefinition, Session } from '../src/index.js'

describe('Session Local Tools', () => {
  describe('constructor with localTools', () => {
    test('registers local tools on creation', () => {
      const localTools: Array<LocalToolDefinition> = [
        {
          name: 'calculate',
          description: 'Calculate expression',
          inputSchema: { type: 'object', properties: { expr: { type: 'string' } } },
          execute: async () => ({ content: [{ type: 'text', text: '42' }] }),
        },
        {
          name: 'echo',
          inputSchema: { type: 'object', properties: { msg: { type: 'string' } } },
          execute: async ({ msg }) => ({ content: [{ type: 'text', text: msg as string }] }),
        },
      ]

      const session = new Session({ localTools })

      expect(session.contextHost.hasLocalTool('calculate')).toBe(true)
      expect(session.contextHost.hasLocalTool('echo')).toBe(true)
    })

    test('local tools appear in getToolsForProvider', () => {
      const mockProvider = {
        toolFromMCP: vi.fn((tool) => ({ name: tool.name, type: 'function' })),
        streamChat: vi.fn(),
        listModels: vi.fn(),
        aggregateMessage: vi.fn(),
        embed: vi.fn(),
      }

      const session = new Session({
        providers: { test: mockProvider as any },
        localTools: [
          {
            name: 'myTool',
            inputSchema: { type: 'object' },
            execute: async () => ({ content: [] }),
          },
        ],
      })

      const tools = session.getToolsForProvider(mockProvider as any)

      expect(tools).toHaveLength(1)
      // toolFromMCP is called with (tool, index, array) from map
      expect(mockProvider.toolFromMCP.mock.calls[0][0]).toMatchObject({
        name: 'local:myTool',
      })
    })
  })

  describe('addLocalTool', () => {
    test('adds local tool after construction', () => {
      const session = new Session()

      session.addLocalTool({
        name: 'laterTool',
        inputSchema: { type: 'object' },
        execute: async () => ({ content: [] }),
      })

      expect(session.contextHost.hasLocalTool('laterTool')).toBe(true)
    })
  })

  describe('addLocalTools', () => {
    test('adds multiple local tools', () => {
      const session = new Session()

      session.addLocalTools([
        {
          name: 'tool1',
          inputSchema: { type: 'object' },
          execute: async () => ({ content: [] }),
        },
        {
          name: 'tool2',
          inputSchema: { type: 'object' },
          execute: async () => ({ content: [] }),
        },
      ])

      expect(session.contextHost.hasLocalTool('tool1')).toBe(true)
      expect(session.contextHost.hasLocalTool('tool2')).toBe(true)
    })
  })

  describe('removeLocalTool', () => {
    test('removes local tool', () => {
      const session = new Session({
        localTools: [
          {
            name: 'removable',
            inputSchema: { type: 'object' },
            execute: async () => ({ content: [] }),
          },
        ],
      })

      expect(session.contextHost.hasLocalTool('removable')).toBe(true)

      const removed = session.removeLocalTool('removable')

      expect(removed).toBe(true)
      expect(session.contextHost.hasLocalTool('removable')).toBe(false)
    })

    test('returns false for non-existent tool', () => {
      const session = new Session()
      expect(session.removeLocalTool('nonexistent')).toBe(false)
    })
  })

  describe('executeToolCall with local tools', () => {
    test('executes local tool via executeToolCall', async () => {
      const executeFn = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'executed!' }],
      })

      const session = new Session({
        localTools: [
          {
            name: 'testTool',
            inputSchema: { type: 'object', properties: { input: { type: 'string' } } },
            execute: executeFn,
          },
        ],
      })

      const result = await session.executeToolCall({
        id: 'call-1',
        name: 'local:testTool',
        arguments: JSON.stringify({ input: 'hello' }),
        raw: {},
      })

      expect(executeFn).toHaveBeenCalledWith({ input: 'hello' })
      expect(result.content).toEqual([{ type: 'text', text: 'executed!' }])
    })

    test('handles local tool execution errors', async () => {
      const session = new Session({
        localTools: [
          {
            name: 'failingTool',
            inputSchema: { type: 'object' },
            execute: async () => {
              throw new Error('Tool failed')
            },
          },
        ],
      })

      const result = await session.executeToolCall({
        id: 'call-2',
        name: 'local:failingTool',
        arguments: '{}',
        raw: {},
      })

      expect(result.isError).toBe(true)
      expect(result.content[0]).toEqual({ type: 'text', text: 'Tool failed' })
    })
  })
})
