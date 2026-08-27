import { DirectTransports } from '@enkaku/transport'
import type { ClientMessage, ServerMessage } from '@mokei/context-protocol'
import { describe, expect, test } from 'vitest'

import { ContextServer } from '../src/index.js'

function createTestServer(): ContextServer {
  const transports = new DirectTransports<ServerMessage, ClientMessage>()
  return new ContextServer({
    name: 'test',
    version: '0.0.0',
    protocolVersions: ['2025-11-25'],
    transport: transports.server,
  })
}

describe('producer events', () => {
  test('resourceUpdated delivers its uri payload', async () => {
    const server = createTestServer()
    const seen: Array<string> = []
    server.events.on('resourceUpdated', ({ uri }) => {
      seen.push(uri)
    })

    await server.events.emit('resourceUpdated', { uri: 'file:///a' })

    expect(seen).toEqual(['file:///a'])
    await server.dispose()
  })

  test('toolsListChanged is dataless and notifies listeners', async () => {
    const server = createTestServer()
    let notified = 0
    server.events.on('toolsListChanged', () => {
      notified += 1
    })

    server.events.fire('toolsListChanged')
    await Promise.resolve()

    expect(notified).toBe(1)
    await server.dispose()
  })

  test('promptsListChanged is dataless and notifies listeners', async () => {
    const server = createTestServer()
    let notified = 0
    server.events.on('promptsListChanged', () => {
      notified += 1
    })

    await server.events.emit('promptsListChanged')

    expect(notified).toBe(1)
    await server.dispose()
  })

  test('resourcesListChanged is dataless and notifies listeners', async () => {
    const server = createTestServer()
    let notified = 0
    server.events.on('resourcesListChanged', () => {
      notified += 1
    })

    await server.events.emit('resourcesListChanged')

    expect(notified).toBe(1)
    await server.dispose()
  })
})
