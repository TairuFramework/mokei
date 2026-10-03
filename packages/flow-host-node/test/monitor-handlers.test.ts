import { Client } from '@enkaku/client'
import type { AnyClientMessageOf, AnyServerMessageOf } from '@enkaku/protocol'
import { serve } from '@enkaku/server'
import { DirectTransports } from '@enkaku/transport'
import { randomIdentity } from '@kokuin/token'
import type { MonitorProcedure, Protocol } from '@mokei/host-protocol'
import { protocol } from '@mokei/host-protocol'
import { afterEach, expect, test, vi } from 'vitest'

import { createMonitorHandlers } from '../src/monitor-handlers.js'
import { createMonitorPresence } from '../src/monitor-presence.js'

type MonitorProtocol = Pick<Protocol, MonitorProcedure>
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})
function setup(endReadable = false) {
  const presence = createMonitorPresence()
  const pair = new DirectTransports<
    AnyServerMessageOf<MonitorProtocol>,
    AnyClientMessageOf<MonitorProtocol>
  >()
  const identity = randomIdentity()
  const server = serve<MonitorProtocol>({
    protocol: {
      'monitor.attach': protocol['monitor.attach'],
      'monitor.presence': protocol['monitor.presence'],
    },
    handlers: {
      ...createMonitorHandlers(presence),
      'monitor.presence': (context) =>
        createMonitorHandlers(presence)['monitor.presence']({
          ...context,
          readable: endReadable
            ? new ReadableStream({ start: (controller) => controller.close() })
            : context.readable,
        }),
    },
    identity,
    accessRules: { '*': { allow: true } },
    transport: pair.server,
  })
  const client = new Client<MonitorProtocol>({
    transport: pair.client,
    identity: randomIdentity(),
    serverID: identity.id,
  })
  cleanups.push(async () => {
    presence.dispose()
    await client.dispose()
    await server.dispose()
    await pair.dispose()
  })
  return { client, presence }
}

test('attach rejects invalid URLs with INVALID_PARAMS', async () => {
  const { client, presence } = setup()
  await expect(
    client.createStream('monitor.attach', { param: { url: 'http://localhost:4000/' } }),
  ).rejects.toMatchObject({ code: 'INVALID_PARAMS' })
  expect(presence.currentURL()).toBeUndefined()
})

test('attach emits attached and keeps registration until abort', async () => {
  const { client, presence } = setup()
  const controller = new AbortController()
  const stream = client.createStream('monitor.attach', {
    param: { url: 'http://127.0.0.1:4000/' },
    signal: controller.signal,
  })
  void stream.catch(() => {})
  const reader = stream.readable.getReader()
  const first = await reader.read()
  expect(first.value).toMatchObject({ type: 'attached', attachmentID: expect.any(String) })
  expect(presence.currentURL()?.port).toBe('4000')
  controller.abort()
  await vi.waitFor(() => expect(presence.currentURL()).toBeUndefined())
})

test('presence rejects unknown attachments', async () => {
  const { client } = setup()
  await expect(
    client.createChannel('monitor.presence', { param: { attachmentID: 'missing' } }),
  ).rejects.toMatchObject({ code: 'MONITOR_ATTACHMENT_NOT_FOUND' })
})

test('presence forwards state, ping and pong and disconnects on abort', async () => {
  const { client, presence } = setup()
  const attachment = presence.attach('http://127.0.0.1:4000/')
  const controller = new AbortController()
  const channel = client.createChannel('monitor.presence', {
    param: { attachmentID: attachment.attachmentID },
    signal: controller.signal,
  })
  void channel.catch(() => {})
  const writer = channel.writable.getWriter()
  const reader = channel.readable.getReader()
  await writer.write({ type: 'state', visible: true, canNotify: true })
  await vi.waitFor(() => expect(presence.status()).toBe('attended'))
  const ping = presence.isAttended(new AbortController().signal)
  const next = await reader.read()
  if (next.value?.type !== 'ping') throw new Error('Expected ping')
  await writer.write({ type: 'pong', nonce: next.value.nonce })
  expect(await ping).toBe(true)
  controller.abort()
  await vi.waitFor(() => expect(presence.tabs()).toEqual([]))
})

test('presence disconnects when readable ends', async () => {
  const { client, presence } = setup(true)
  const attachment = presence.attach('http://127.0.0.1:4000/')
  await client.createChannel('monitor.presence', {
    param: { attachmentID: attachment.attachmentID },
  })
  expect(presence.tabs()).toEqual([])
})

test('detach closes the presence channel', async () => {
  const { client, presence } = setup()
  const attachment = presence.attach('http://127.0.0.1:4000/')
  const channel = client.createChannel('monitor.presence', {
    param: { attachmentID: attachment.attachmentID },
  })
  void channel.catch(() => {})
  const reader = channel.readable.getReader()
  await vi.waitFor(() => expect(presence.tabs()).toHaveLength(1))
  attachment.detach()
  expect((await reader.read()).done).toBe(true)
  await channel
})
