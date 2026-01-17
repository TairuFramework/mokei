import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import {
  buildHttpHeaders,
  ContextHost,
  DEFAULT_HTTP_TIMEOUT,
  type HttpAuthOptions,
  McpHttpTransport,
} from '../src/index.js'

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('HTTP Context Utilities', () => {
  describe('buildHttpHeaders', () => {
    test('includes Content-Type by default', () => {
      const headers = buildHttpHeaders()
      expect(headers['Content-Type']).toBe('application/json')
    })

    test('merges custom headers', () => {
      const headers = buildHttpHeaders({ 'X-Custom': 'value' })
      expect(headers['Content-Type']).toBe('application/json')
      expect(headers['X-Custom']).toBe('value')
    })

    test('adds bearer auth header', () => {
      const auth: HttpAuthOptions = { type: 'bearer', token: 'my-token' }
      const headers = buildHttpHeaders(undefined, auth)
      expect(headers.Authorization).toBe('Bearer my-token')
    })

    test('adds basic auth header', () => {
      const auth: HttpAuthOptions = { type: 'basic', username: 'user', password: 'pass' }
      const headers = buildHttpHeaders(undefined, auth)
      // btoa('user:pass') = 'dXNlcjpwYXNz'
      expect(headers.Authorization).toBe('Basic dXNlcjpwYXNz')
    })

    test('adds custom header auth', () => {
      const auth: HttpAuthOptions = { type: 'header', name: 'X-API-Key', value: 'secret' }
      const headers = buildHttpHeaders(undefined, auth)
      expect(headers['X-API-Key']).toBe('secret')
    })
  })

  test('DEFAULT_HTTP_TIMEOUT is 30 seconds', () => {
    expect(DEFAULT_HTTP_TIMEOUT).toBe(30000)
  })
})

describe('McpHttpTransport', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test('creates transport with URL', () => {
    const transport = new McpHttpTransport({
      url: 'https://mcp.example.com/api',
    })

    expect(transport).toBeDefined()
    expect(transport.sessionId).toBeNull()
  })

  test('sends JSON-RPC message via POST', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => ({ jsonrpc: '2.0', id: 1, result: { tools: [] } }),
    })

    const transport = new McpHttpTransport({
      url: 'https://mcp.example.com/api',
    })

    // Get the writable stream and write a message
    const writer = transport.getWritable().getWriter()
    await writer.write({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    })
    await writer.close()

    expect(mockFetch).toHaveBeenCalledWith(
      'https://mcp.example.com/api',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        }),
        body: expect.any(String),
      }),
    )

    // Verify the body contains the JSON-RPC message
    const call = mockFetch.mock.calls[0]
    const body = JSON.parse(call[1].body)
    expect(body.method).toBe('tools/list')
  })

  test('includes auth headers in requests', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 202,
      headers: new Headers(),
    })

    const transport = new McpHttpTransport({
      url: 'https://mcp.example.com/api',
      auth: { type: 'bearer', token: 'test-token' },
    })

    const writer = transport.getWritable().getWriter()
    await writer.write({ jsonrpc: '2.0', method: 'ping', params: {} })

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      }),
    )
  })

  test('stores session ID from response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({
        'Content-Type': 'application/json',
        'Mcp-Session-Id': 'session-123',
      }),
      json: async () => ({ jsonrpc: '2.0', id: 1, result: {} }),
    })

    const transport = new McpHttpTransport({
      url: 'https://mcp.example.com/api',
    })

    const writer = transport.getWritable().getWriter()
    await writer.write({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })

    expect(transport.sessionId).toBe('session-123')
  })

  test('includes session ID in subsequent requests', async () => {
    // First request returns session ID
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({
        'Content-Type': 'application/json',
        'Mcp-Session-Id': 'session-456',
      }),
      json: async () => ({ jsonrpc: '2.0', id: 1, result: {} }),
    })

    // Second request
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => ({ jsonrpc: '2.0', id: 2, result: { tools: [] } }),
    })

    const transport = new McpHttpTransport({
      url: 'https://mcp.example.com/api',
    })

    const writer = transport.getWritable().getWriter()
    await writer.write({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    await writer.write({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })

    // Second call should include session ID
    const secondCall = mockFetch.mock.calls[1]
    expect(secondCall[1].headers['Mcp-Session-Id']).toBe('session-456')
  })

  test('handles 202 Accepted for notifications', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 202,
      headers: new Headers(),
    })

    const transport = new McpHttpTransport({
      url: 'https://mcp.example.com/api',
    })

    const writer = transport.getWritable().getWriter()
    // Notification (no id)
    await writer.write({ jsonrpc: '2.0', method: 'notifications/cancelled', params: {} })

    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  test('throws on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      headers: new Headers(),
      text: async () => 'Internal Server Error',
    })

    const transport = new McpHttpTransport({
      url: 'https://mcp.example.com/api',
    })

    const writer = transport.getWritable().getWriter()

    await expect(
      writer.write({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    ).rejects.toThrow('HTTP 500')
  })

  test('sends DELETE on dispose with session', async () => {
    // Initial request to get session
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({
        'Content-Type': 'application/json',
        'Mcp-Session-Id': 'session-789',
      }),
      json: async () => ({ jsonrpc: '2.0', id: 1, result: {} }),
    })

    // DELETE request on dispose
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
    })

    const transport = new McpHttpTransport({
      url: 'https://mcp.example.com/api',
    })

    const writer = transport.getWritable().getWriter()
    await writer.write({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })

    await transport.dispose()

    // Should have sent DELETE with session ID
    const deleteCall = mockFetch.mock.calls[1]
    expect(deleteCall[1].method).toBe('DELETE')
    expect(deleteCall[1].headers['Mcp-Session-Id']).toBe('session-789')
  })
})

describe('ContextHost.addHttpContext', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  test('creates HTTP context', async () => {
    const host = new ContextHost()

    // The client creation doesn't make any HTTP calls
    const client = await host.addHttpContext({
      key: 'remote',
      url: 'https://mcp.example.com/api',
    })

    expect(client).toBeDefined()
    expect(host.getContextKeys()).toContain('remote')
  })

  test('throws if context key already exists', async () => {
    const host = new ContextHost()

    await host.addHttpContext({
      key: 'remote',
      url: 'https://mcp.example.com/api',
    })

    await expect(
      host.addHttpContext({
        key: 'remote',
        url: 'https://mcp.example.com/other',
      }),
    ).rejects.toThrow('Context remote already exists')
  })

  test('removes HTTP context', async () => {
    // Mock DELETE for session cleanup
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
    })

    const host = new ContextHost()

    await host.addHttpContext({
      key: 'remote',
      url: 'https://mcp.example.com/api',
    })

    expect(host.getContextKeys()).toContain('remote')

    await host.remove('remote')

    expect(host.getContextKeys()).not.toContain('remote')
  })

  test('supports authentication options', async () => {
    const host = new ContextHost()

    const client = await host.addHttpContext({
      key: 'authenticated',
      url: 'https://mcp.example.com/api',
      auth: { type: 'bearer', token: 'api-key' },
      timeout: 60000,
    })

    expect(client).toBeDefined()
  })
})
