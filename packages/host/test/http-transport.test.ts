import { buildHTTPHeaders, type HTTPAuthOptions, HTTPTransport } from '@mokei/http-client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { ContextHost, DEFAULT_HTTP_TIMEOUT } from '../src/index.js'

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('HTTP Context Utilities', () => {
  describe('buildHTTPHeaders', () => {
    test('returns empty object with no arguments', () => {
      const headers = buildHTTPHeaders()
      expect(Object.keys(headers).length).toBe(0)
    })

    test('merges custom headers', () => {
      const headers = buildHTTPHeaders({ 'X-Custom': 'value' })
      expect(headers['X-Custom']).toBe('value')
    })

    test('adds bearer auth header', () => {
      const auth: HTTPAuthOptions = { type: 'bearer', token: 'my-token' }
      const headers = buildHTTPHeaders(undefined, auth)
      expect(headers.Authorization).toBe('Bearer my-token')
    })

    test('adds basic auth header', () => {
      const auth: HTTPAuthOptions = { type: 'basic', username: 'user', password: 'pass' }
      const headers = buildHTTPHeaders(undefined, auth)
      // btoa('user:pass') = 'dXNlcjpwYXNz'
      expect(headers.Authorization).toBe('Basic dXNlcjpwYXNz')
    })

    test('adds custom header auth', () => {
      const auth: HTTPAuthOptions = { type: 'header', name: 'X-API-Key', value: 'secret' }
      const headers = buildHTTPHeaders(undefined, auth)
      expect(headers['X-API-Key']).toBe('secret')
    })
  })

  test('DEFAULT_HTTP_TIMEOUT is 30 seconds', () => {
    expect(DEFAULT_HTTP_TIMEOUT).toBe(30000)
  })
})

describe('HTTPTransport', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test('creates transport with URL', () => {
    const transport = new HTTPTransport({
      url: 'https://mcp.example.com/api',
    })

    expect(transport).toBeDefined()
    expect(transport.sessionID).toBeNull()
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
