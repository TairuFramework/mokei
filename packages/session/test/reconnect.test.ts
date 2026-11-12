import type { HostedContext } from '@mokei/host'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { Session } from '../src/session.js'

describe('Session.addHTTPContext reconnect', () => {
  let session: Session | undefined

  afterEach(async () => {
    await session?.dispose()
    session = undefined
  })

  test('passes reconnect to the host', async () => {
    session = new Session()
    const addHTTPContextSpy = vi
      .spyOn(session.contextHost, 'addHTTPContext')
      .mockResolvedValue({} as never)
    vi.spyOn(session.contextHost, 'setup').mockResolvedValue([])

    await session.addHTTPContext({
      key: 'remote',
      url: 'https://mcp.example.com/mcp',
      reconnect: true,
    })

    expect(addHTTPContextSpy).toHaveBeenCalledWith(expect.objectContaining({ reconnect: true }))
  })

  test('failed setup cleanup compares the registration, which a reconnect keeps', async () => {
    session = new Session()
    const registration = { client: { id: 'first' } } as unknown as HostedContext
    vi.spyOn(session.contextHost, 'addHTTPContext').mockResolvedValue(registration.client as never)
    vi.spyOn(session.contextHost, 'getContext').mockReturnValue(registration as never)
    vi.spyOn(session.contextHost, 'setup').mockImplementation(async () => {
      registration.client = { id: 'second' } as never
      throw new Error('aborted')
    })
    const removeSpy = vi.spyOn(session.contextHost, 'remove').mockResolvedValue(undefined)

    await expect(
      session.addHTTPContext({ key: 'remote', url: 'https://mcp.example.com/mcp' }),
    ).rejects.toThrow('aborted')

    expect(removeSpy).toHaveBeenCalledWith('remote')
  })

  test('abort after setup does not remove a replacement registration', async () => {
    session = new Session()
    const ours = { client: { id: 'first' } } as unknown as HostedContext
    const replacement = { client: { id: 'first' } } as unknown as HostedContext
    vi.spyOn(session.contextHost, 'addHTTPContext').mockResolvedValue(ours.client as never)
    const getContextSpy = vi.spyOn(session.contextHost, 'getContext').mockReturnValue(ours as never)
    vi.spyOn(session.contextHost, 'setup').mockImplementation(async () => {
      getContextSpy.mockReturnValue(replacement as never)
      throw new Error('aborted')
    })
    const removeSpy = vi.spyOn(session.contextHost, 'remove').mockResolvedValue(undefined)

    await expect(
      session.addHTTPContext({ key: 'remote', url: 'https://mcp.example.com/mcp' }),
    ).rejects.toThrow('aborted')

    expect(removeSpy).not.toHaveBeenCalled()
  })
})
