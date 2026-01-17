import { describe, expect, test } from 'vitest'

import {
  ContextHost,
  createLocalToolID,
  createToolFromDefinition,
  getLocalToolName,
  isLocalToolID,
  LOCAL_TOOL_NAMESPACE,
  type LocalToolDefinition,
} from '../src/index.js'

describe('Local Tools Utilities', () => {
  describe('isLocalToolID', () => {
    test('returns true for local tool IDs', () => {
      expect(isLocalToolID('local:calculate')).toBe(true)
      expect(isLocalToolID('local:my_tool')).toBe(true)
    })

    test('returns false for context tool IDs', () => {
      expect(isLocalToolID('sqlite:query')).toBe(false)
      expect(isLocalToolID('fetch:get')).toBe(false)
    })

    test('returns false for malformed IDs', () => {
      expect(isLocalToolID('calculate')).toBe(false)
      expect(isLocalToolID('localcalculate')).toBe(false)
    })
  })

  describe('getLocalToolName', () => {
    test('extracts tool name from local tool ID', () => {
      expect(getLocalToolName('local:calculate')).toBe('calculate')
      expect(getLocalToolName('local:my_complex_tool')).toBe('my_complex_tool')
    })

    test('throws for non-local tool IDs', () => {
      expect(() => getLocalToolName('sqlite:query')).toThrow('Not a local tool ID')
    })
  })

  describe('createLocalToolID', () => {
    test('creates namespaced tool ID', () => {
      expect(createLocalToolID('calculate')).toBe('local:calculate')
      expect(createLocalToolID('fetch_url')).toBe('local:fetch_url')
    })
  })

  describe('createToolFromDefinition', () => {
    test('creates Tool from LocalToolDefinition', () => {
      const definition: LocalToolDefinition = {
        name: 'calculate',
        description: 'Evaluate a math expression',
        inputSchema: {
          type: 'object',
          properties: {
            expression: { type: 'string' },
          },
          required: ['expression'],
        },
        execute: async () => ({ content: [{ type: 'text', text: '42' }] }),
      }

      const tool = createToolFromDefinition(definition)

      expect(tool.name).toBe('calculate')
      expect(tool.description).toBe('Evaluate a math expression')
      expect(tool.inputSchema).toEqual(definition.inputSchema)
    })

    test('includes annotations if provided', () => {
      const definition: LocalToolDefinition = {
        name: 'safe_read',
        inputSchema: { type: 'object' },
        annotations: {
          readOnlyHint: true,
          title: 'Safe Read Operation',
        },
        execute: async () => ({ content: [{ type: 'text', text: 'done' }] }),
      }

      const tool = createToolFromDefinition(definition)

      expect(tool.annotations).toEqual({
        readOnlyHint: true,
        title: 'Safe Read Operation',
      })
    })
  })

  test('LOCAL_TOOL_NAMESPACE is "local"', () => {
    expect(LOCAL_TOOL_NAMESPACE).toBe('local')
  })
})

describe('ContextHost Local Tools', () => {
  describe('addLocalTool', () => {
    test('registers a local tool', () => {
      const host = new ContextHost()

      host.addLocalTool({
        name: 'calculate',
        description: 'Calculate expression',
        inputSchema: { type: 'object', properties: { expr: { type: 'string' } } },
        execute: async ({ expr }) => ({
          content: [{ type: 'text', text: `calculated: ${expr}` }],
        }),
      })

      expect(host.hasLocalTool('calculate')).toBe(true)
      expect(host.localTools.size).toBe(1)
    })

    test('throws when adding duplicate tool', () => {
      const host = new ContextHost()

      host.addLocalTool({
        name: 'test',
        inputSchema: { type: 'object' },
        execute: async () => ({ content: [] }),
      })

      expect(() =>
        host.addLocalTool({
          name: 'test',
          inputSchema: { type: 'object' },
          execute: async () => ({ content: [] }),
        }),
      ).toThrow('Local tool "test" already exists')
    })
  })

  describe('addLocalTools', () => {
    test('registers multiple local tools', () => {
      const host = new ContextHost()

      host.addLocalTools([
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

      expect(host.localTools.size).toBe(2)
      expect(host.hasLocalTool('tool1')).toBe(true)
      expect(host.hasLocalTool('tool2')).toBe(true)
    })
  })

  describe('removeLocalTool', () => {
    test('removes a local tool', () => {
      const host = new ContextHost()

      host.addLocalTool({
        name: 'test',
        inputSchema: { type: 'object' },
        execute: async () => ({ content: [] }),
      })

      expect(host.removeLocalTool('test')).toBe(true)
      expect(host.hasLocalTool('test')).toBe(false)
    })

    test('returns false for non-existent tool', () => {
      const host = new ContextHost()
      expect(host.removeLocalTool('nonexistent')).toBe(false)
    })
  })

  describe('getLocalTool', () => {
    test('returns the local tool', () => {
      const host = new ContextHost()

      host.addLocalTool({
        name: 'test',
        description: 'A test tool',
        inputSchema: { type: 'object' },
        execute: async () => ({ content: [] }),
      })

      const tool = host.getLocalTool('test')
      expect(tool).toBeDefined()
      expect(tool?.tool.name).toBe('test')
      expect(tool?.tool.description).toBe('A test tool')
    })

    test('returns undefined for non-existent tool', () => {
      const host = new ContextHost()
      expect(host.getLocalTool('nonexistent')).toBeUndefined()
    })
  })

  describe('getCallableTools', () => {
    test('includes local tools with namespaced names', () => {
      const host = new ContextHost()

      host.addLocalTool({
        name: 'calculate',
        description: 'Calculate',
        inputSchema: { type: 'object' },
        execute: async () => ({ content: [] }),
      })

      const tools = host.getCallableTools()
      expect(tools).toHaveLength(1)
      expect(tools[0].name).toBe('local:calculate')
      expect(tools[0].description).toBe('Calculate')
    })

    test('includes both context and local tools', async () => {
      const host = new ContextHost()

      // Add local tool
      host.addLocalTool({
        name: 'local_tool',
        inputSchema: { type: 'object' },
        execute: async () => ({ content: [] }),
      })

      // Note: We can't easily test context tools without setting up a real MCP server
      // Just verify local tools are included
      const tools = host.getCallableTools()
      expect(tools.some((t) => t.name === 'local:local_tool')).toBe(true)
    })
  })

  describe('callLocalTool', () => {
    test('executes local tool and returns result', async () => {
      const host = new ContextHost()

      host.addLocalTool({
        name: 'greet',
        inputSchema: {
          type: 'object',
          properties: { name: { type: 'string' } },
        },
        execute: async ({ name }) => ({
          content: [{ type: 'text', text: `Hello, ${name}!` }],
        }),
      })

      const result = await host.callLocalTool('greet', { name: 'World' })

      expect(result.content).toHaveLength(1)
      expect(result.content[0]).toEqual({ type: 'text', text: 'Hello, World!' })
    })

    test('handles execution errors gracefully', async () => {
      const host = new ContextHost()

      host.addLocalTool({
        name: 'failing_tool',
        inputSchema: { type: 'object' },
        execute: async () => {
          throw new Error('Something went wrong')
        },
      })

      const result = await host.callLocalTool('failing_tool', {})

      expect(result.isError).toBe(true)
      expect(result.content[0]).toEqual({ type: 'text', text: 'Something went wrong' })
    })

    test('throws for non-existent tool', () => {
      const host = new ContextHost()

      // The error is thrown synchronously before the promise is created
      expect(() => host.callLocalTool('nonexistent', {})).toThrow(
        'Local tool "nonexistent" does not exist',
      )
    })
  })

  describe('callNamespacedTool', () => {
    test('routes local: prefixed tools to callLocalTool', async () => {
      const host = new ContextHost()

      host.addLocalTool({
        name: 'echo',
        inputSchema: {
          type: 'object',
          properties: { message: { type: 'string' } },
        },
        execute: async ({ message }) => ({
          content: [{ type: 'text', text: message as string }],
        }),
      })

      const result = await host.callNamespacedTool('local:echo', { message: 'test' })

      expect(result.content).toHaveLength(1)
      expect(result.content[0]).toEqual({ type: 'text', text: 'test' })
    })
  })

  describe('_dispose', () => {
    test('clears local tools when _dispose is called directly', async () => {
      const host = new ContextHost()

      host.addLocalTool({
        name: 'test',
        inputSchema: { type: 'object' },
        execute: async () => ({ content: [] }),
      })

      expect(host.localTools.size).toBe(1)

      // Note: _dispose is intended to be called by subclasses or internal cleanup
      // The public dispose() method from Disposer doesn't automatically call _dispose
      await host._dispose()

      expect(host.localTools.size).toBe(0)
    })
  })
})
