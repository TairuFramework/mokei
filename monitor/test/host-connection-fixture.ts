import type { HostEvent } from '@mokei/host-protocol'
import { vi } from 'vitest'

import type { HostClient } from '../src/host/client.js'

export function clientFixture(info = Promise.resolve({ flowService: { state: 'ready' } })) {
  const streams: Array<ReadableStreamDefaultController<HostEvent>> = []
  const events = new Map<string, Set<() => void>>()
  const abort = new AbortController()
  const close = vi.fn()
  const request = vi.fn(() => info)
  const client = {
    signal: abort.signal,
    request,
    createStream: vi.fn(() => {
      const readable = new ReadableStream<HostEvent>({
        start: (controller) => streams.push(controller),
      })
      return { readable, close, catch: vi.fn() }
    }),
    dispose: vi.fn(async () => {
      abort.abort()
    }),
    events: {
      on: (name: string, listener: () => void) => {
        const listeners = events.get(name) ?? new Set()
        listeners.add(listener)
        events.set(name, listeners)
        return () => listeners.delete(listener)
      },
    },
  }
  return { client: client as unknown as HostClient, streams, request, events, close }
}
