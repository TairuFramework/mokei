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
})
