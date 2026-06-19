import { describe, expect, test } from 'vitest'

import { ContextClient } from '../src/client.js'

// Minimal transport stub: ContextClient only needs a transport object with the
// ClientTransport shape; these tests call _handleNotification directly and never
// initialize, so a no-op transport is sufficient.
function noopTransport() {
  return {
    write: async () => {},
    read: () => new ReadableStream({ start: (c) => c.close() }),
    dispose: async () => {},
    events: { on: () => () => {}, emit: () => {} },
  } as never
}

function makeNotification(n: number) {
  return { jsonrpc: '2.0' as const, method: 'notifications/progress', params: { n } }
}

describe('ContextClient notifications buffering', () => {
  test('drops notifications when no reader is attached', async () => {
    const client = new ContextClient({ transport: noopTransport() })
    for (let i = 0; i < 1000; i++) {
      client._handleNotification(makeNotification(i) as never)
    }
    // Attach a reader now; nothing buffered before attach should be delivered.
    const reader = client.notifications.getReader()
    const first = await Promise.race([
      reader.read(),
      new Promise((resolve) => setTimeout(() => resolve('empty'), 50)),
    ])
    expect(first).toBe('empty')
    reader.releaseLock()
  })

  test('buffers at most the cap once a reader is attached, dropping oldest', async () => {
    const client = new ContextClient({ transport: noopTransport() })
    const reader = client.notifications.getReader()

    // Emit more than the cap without reading.
    for (let i = 0; i < 1000; i++) {
      client._handleNotification(makeNotification(i) as never)
    }

    // Drain what is buffered; count and confirm the newest survived.
    const received: Array<number> = []
    for (let i = 0; i < 256; i++) {
      const { value } = await reader.read()
      received.push((value as { params: { n: number } }).params.n)
    }
    expect(received.length).toBe(256)
    // Oldest dropped: the last received must be the newest emitted (999).
    expect(received[received.length - 1]).toBe(999)
    reader.releaseLock()
  })
})
