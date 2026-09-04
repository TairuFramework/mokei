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
    // addHTTPContext resolves (the context is registered), then setup() fails. The fix must
    // remove the context THIS call registered so a retry does not hit "already exists" and the
    // transport is not orphaned. Spy `remove` call-through and assert it ran for the key: the
    // pre-fix `#setupHTTPContext` had no try/catch and never called `remove` here, so this
    // assertion fails on the regression and passes on the fix.
    const client = {}
    vi.spyOn(session.contextHost, 'addHTTPContext').mockResolvedValue(client as never)
    // I1: cleanup is identity-aware -- it only removes when the context currently registered
    // under the key is still the one this call created. `getContext` isn't backed by a real
    // registration here (addHTTPContext is mocked), so spy it to report the same client back.
    vi.spyOn(session.contextHost, 'getContext').mockReturnValue({ client } as never)
    vi.spyOn(session.contextHost, 'setup').mockRejectedValue(new Error('setup failed'))
    const removeSpy = vi.spyOn(session.contextHost, 'remove')

    await expect(session.addHTTPContext({ key: 'k', url: 'https://x/mcp' })).rejects.toThrow(
      'setup failed',
    )

    expect(removeSpy).toHaveBeenCalledWith('k')
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

  test('I1: does not remove a concurrently re-added context when the registered client differs', async () => {
    session = new Session()
    const clientA = { id: 'A' }
    const clientB = { id: 'B' }
    // This call's addHTTPContext resolves with client A, then setup() fails. Meanwhile (in the
    // fiction this simulates) the caller removed key 'k' and re-added it with a different
    // client, B -- so by the time our catch runs, `getContext('k')` reports B, not A.
    vi.spyOn(session.contextHost, 'addHTTPContext').mockResolvedValue(clientA as never)
    vi.spyOn(session.contextHost, 'getContext').mockReturnValue({ client: clientB } as never)
    vi.spyOn(session.contextHost, 'setup').mockRejectedValue(new Error('setup failed'))
    const removeSpy = vi.spyOn(session.contextHost, 'remove')

    await expect(session.addHTTPContext({ key: 'k', url: 'https://x/mcp' })).rejects.toThrow(
      'setup failed',
    )

    expect(removeSpy).not.toHaveBeenCalled()
  })

  test('I1: removes the context when the registered client is still this call\'s (getContext throwing counts as "not ours")', async () => {
    session = new Session()
    const clientA = { id: 'A' }
    vi.spyOn(session.contextHost, 'addHTTPContext').mockResolvedValue(clientA as never)
    vi.spyOn(session.contextHost, 'getContext').mockReturnValue({ client: clientA } as never)
    vi.spyOn(session.contextHost, 'setup').mockRejectedValue(new Error('setup failed'))
    const removeSpy = vi.spyOn(session.contextHost, 'remove')

    await expect(session.addHTTPContext({ key: 'k', url: 'https://x/mcp' })).rejects.toThrow(
      'setup failed',
    )

    expect(removeSpy).toHaveBeenCalledWith('k')
  })

  test('I1: does not remove when getContext throws (key already gone) instead of returning undefined', async () => {
    session = new Session()
    const clientA = { id: 'A' }
    vi.spyOn(session.contextHost, 'addHTTPContext').mockResolvedValue(clientA as never)
    vi.spyOn(session.contextHost, 'getContext').mockImplementation(() => {
      throw new Error('Context k does not exist')
    })
    vi.spyOn(session.contextHost, 'setup').mockRejectedValue(new Error('setup failed'))
    const removeSpy = vi.spyOn(session.contextHost, 'remove')

    await expect(session.addHTTPContext({ key: 'k', url: 'https://x/mcp' })).rejects.toThrow(
      'setup failed',
    )

    expect(removeSpy).not.toHaveBeenCalled()
  })
})
