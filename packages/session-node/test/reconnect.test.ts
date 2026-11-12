import { fileURLToPath } from 'node:url'
import type { HostedContext } from '@mokei/host'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { NodeSession } from '../src/node-session.js'

const ECHO_SERVER = fileURLToPath(new URL('./fixtures/echo-server.mjs', import.meta.url))
const server = { command: process.execPath, args: [ECHO_SERVER] }

describe('NodeSession.addContext reconnect', () => {
  let session: NodeSession | undefined

  afterEach(async () => {
    await session?.dispose()
    session = undefined
  })

  test('passes reconnect to the host', async () => {
    session = new NodeSession()
    const addLocalContextSpy = vi.spyOn(session.contextHost, 'addLocalContext')

    await session.addContext({ key: 'echo', ...server, reconnect: true })

    expect(addLocalContextSpy).toHaveBeenCalledWith(expect.objectContaining({ reconnect: true }))
  })

  test('failed setup cleanup compares the registration, which a reconnect keeps', async () => {
    session = new NodeSession()
    let registration: HostedContext | undefined
    vi.spyOn(session.contextHost, 'setup').mockImplementation(async ({ key }) => {
      registration = session?.contextHost.getContext(key)
      if (registration != null) registration.client = { id: 'swapped' } as never
      throw new Error('aborted')
    })

    await expect(session.addContext({ key: 'echo', ...server })).rejects.toThrow('aborted')

    expect(session.contextHost.getContextKeys()).not.toContain('echo')
  })

  test('failed setup does not remove a replacement registration', async () => {
    session = new NodeSession()
    const host = session.contextHost
    vi.spyOn(host, 'setup').mockImplementation(async ({ key }) => {
      await host.remove(key)
      await host.addLocalContext({ key, ...server })
      throw new Error('aborted')
    })

    await expect(session.addContext({ key: 'echo', ...server })).rejects.toThrow('aborted')

    expect(host.getContextKeys()).toContain('echo')
  })
})
