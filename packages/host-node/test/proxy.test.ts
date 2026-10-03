import type { ClientMessage, ServerMessage } from '@mokei/context-protocol'
import { expect, test, vi } from 'vitest'

import type { HostClient } from '../src/daemon.js'
import { ProxyHost } from '../src/proxy.js'

test('writes MCP traffic before the daemon channel finishes', async () => {
  const sent: Array<ClientMessage> = []
  let rejectChannel!: (reason: Error) => void
  let incoming!: ReadableStreamDefaultController<ServerMessage>
  // Enkaku channels are Promises augmented with streams, and remain pending while open.
  const result = new Promise<void>((_, reject) => {
    rejectChannel = reject
  })
  void result.catch(() => {})
  const channel = Object.assign(result, {
    readable: new ReadableStream<ServerMessage>({
      start: (controller) => {
        incoming = controller
      },
    }),
    writable: new WritableStream<ClientMessage>({
      write: (message) => {
        sent.push(message)
      },
    }),
    close: () => {},
  })
  const proxy = new ProxyHost({
    client: { createChannel: () => channel, dispose: async () => {} } as unknown as HostClient,
  })
  const client = await proxy.spawn({ key: 'echo', command: 'echo-server' })
  const request = client.listTools().catch(() => {})
  try {
    await vi.waitFor(
      () => {
        expect(sent).toContainEqual(expect.objectContaining({ method: 'server/discover' }))
      },
      { timeout: 1000 },
    )
  } finally {
    const reason = new Error('Fixture closed')
    rejectChannel(reason)
    incoming.error(reason)
    await request
    await proxy.dispose()
  }
})
