import type { ContextTool } from '@mokei/host'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { Session } from '../src/session.js'

describe('Session.addHTTPContext', () => {
  let session: Session | undefined

  afterEach(async () => {
    await session?.dispose()
    session = undefined
  })

  test('registers the HTTP context then sets it up, returning the tools and emitting context-added', async () => {
    session = new Session()
    const tool = { id: 'remote:echo', tool: { name: 'echo' }, enabled: true } as ContextTool
    const addHTTPContextSpy = vi
      .spyOn(session.contextHost, 'addHTTPContext')
      .mockResolvedValue({} as never)
    const setupSpy = vi.spyOn(session.contextHost, 'setup').mockResolvedValue([tool])

    const onContextAdded = vi.fn()
    session.events.on('context-added', onContextAdded)

    const tools = await session.addHTTPContext({
      key: 'remote',
      url: 'https://mcp.example.com/mcp',
      protocolVersion: 'auto',
    })

    expect(addHTTPContextSpy).toHaveBeenCalledWith({
      key: 'remote',
      url: 'https://mcp.example.com/mcp',
      headers: undefined,
      auth: undefined,
      timeout: undefined,
      protocolVersion: 'auto',
      fetchMiddleware: undefined,
    })
    expect(setupSpy).toHaveBeenCalledWith({
      key: 'remote',
      enableTools: undefined,
      signal: undefined,
    })
    expect(tools).toEqual([tool])
    expect(onContextAdded).toHaveBeenCalledWith({ key: 'remote', tools: [tool] })
  })

  test('forwards fetchMiddleware to the host', async () => {
    session = new Session()
    const addHTTPContextSpy = vi
      .spyOn(session.contextHost, 'addHTTPContext')
      .mockResolvedValue({} as never)
    vi.spyOn(session.contextHost, 'setup').mockResolvedValue([])

    const fetchMiddleware = (next: unknown) => next
    await session.addHTTPContext({
      key: 'remote',
      url: 'https://mcp.example.com/mcp',
      protocolVersion: 'auto',
      // biome-ignore lint/suspicious/noExplicitAny: minimal middleware stand-in for the test
      fetchMiddleware: fetchMiddleware as any,
    })

    expect(addHTTPContextSpy).toHaveBeenCalledWith(expect.objectContaining({ fetchMiddleware }))
  })

  test('H1: removes the context it just registered when setup() rejects (no signal)', async () => {
    session = new Session()
    vi.spyOn(session.contextHost, 'addHTTPContext').mockResolvedValue({} as never)
    vi.spyOn(session.contextHost, 'setup').mockRejectedValue(new Error('setup failed'))

    await expect(session.addHTTPContext({ key: 'k', url: 'https://x/mcp' })).rejects.toThrow(
      'setup failed',
    )

    expect(session.contextHost.getContextKeys()).not.toContain('k')
  })

  test('H2: a duplicate-key rejection from addHTTPContext must not remove the pre-existing context', async () => {
    session = new Session()
    const addHTTPContextSpy = vi.spyOn(session.contextHost, 'addHTTPContext')
    const setupSpy = vi.spyOn(session.contextHost, 'setup')

    // Register the pre-existing context under key 'dup'.
    addHTTPContextSpy.mockResolvedValueOnce({} as never)
    setupSpy.mockResolvedValueOnce([])
    await session.addHTTPContext({ key: 'dup', url: 'https://x/mcp' })

    // Now simulate a duplicate add: the host rejects because 'dup' already exists.
    addHTTPContextSpy.mockRejectedValueOnce(new Error('Context dup already exists'))
    const removeSpy = vi.spyOn(session.contextHost, 'remove')

    await expect(
      session.addHTTPContext({
        key: 'dup',
        url: 'https://x/mcp',
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('Context dup already exists')

    expect(removeSpy).not.toHaveBeenCalledWith('dup')
  })
})
