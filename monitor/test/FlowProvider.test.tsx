import type { HostEvent } from '@mokei/host-protocol'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import { FlowProvider, useFlow } from '../src/flow/FlowProvider.js'
import type { HostClient } from '../src/host/client.js'
import { createHostClient } from '../src/host/client.js'
import { deferred } from './fixtures.js'

vi.mock('../src/host/client.js', () => ({ createHostClient: vi.fn() }))

function clientFixture(info = Promise.resolve({ flowService: { state: 'ready' } })) {
  const streams: Array<ReadableStreamDefaultController<HostEvent>> = []
  const events = new Map<string, Set<() => void>>()
  const abort = new AbortController()
  const request = vi.fn(() => info)
  const client = {
    signal: abort.signal,
    request,
    createStream: vi.fn(() => {
      const readable = new ReadableStream<HostEvent>({
        start: (controller) => streams.push(controller),
      })
      return { readable, close: vi.fn(), catch: vi.fn() }
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
  return { client: client as unknown as HostClient, streams, request, events }
}

function State() {
  const { epoch, connected, restarted, status } = useFlow()
  return <div>{JSON.stringify({ epoch, connected, restarted, status: status?.state })}</div>
}

function mount() {
  return render(
    <FlowProvider>
      <State />
    </FlowProvider>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test('HTTP 403 sets restarted and stops reconnecting', async () => {
  const fixture = clientFixture()
  vi.mocked(createHostClient).mockReturnValue(fixture.client)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 403 })),
  )
  mount()
  await waitFor(() => expect(screen.getByText(/"connected":true/)).toBeTruthy())
  const observedFetch = vi.mocked(createHostClient).mock.calls.at(-1)?.[1]
  expect(observedFetch).toBeTypeOf('function')
  await act(async () => {
    await observedFetch?.('http://localhost/api')
  })
  expect(screen.getByText(/"restarted":true/)).toBeTruthy()
  expect(screen.getByText(/"connected":false/)).toBeTruthy()
  vi.unstubAllGlobals()
})

test('transport failure recreates the client, bumps epoch and resubscribes', async () => {
  const first = clientFixture()
  const second = clientFixture()
  vi.mocked(createHostClient).mockReturnValueOnce(first.client).mockReturnValue(second.client)
  mount()
  await waitFor(() => expect(screen.getByText(/"connected":true/)).toBeTruthy())
  act(() => {
    first.streams[1].error(new Error('Invalid session ID'))
  })
  await waitFor(() => expect(screen.getByText(/"epoch":1,"connected":true/)).toBeTruthy())
  expect(second.streams.length).toBe(2)
  expect(first.client.dispose).toHaveBeenCalled()
})

test('service status received after info was issued wins over the stale info reply', async () => {
  const info = deferred<{ flowService: { state: string } }>()
  const fixture = clientFixture(info.promise)
  vi.mocked(createHostClient).mockReturnValue(fixture.client)
  mount()
  await waitFor(() => expect(fixture.request).toHaveBeenCalled())
  await act(async () => {
    fixture.streams[0].enqueue({
      type: 'service:status',
      data: { service: 'flow', status: { state: 'ready' } },
      meta: { eventID: 'status-event', time: 1 },
    })
  })
  await act(async () => {
    info.resolve({ flowService: { state: 'starting' } })
  })
  await waitFor(() => expect(screen.getByText(/"status":"ready"/)).toBeTruthy())
})

test('a 403 arriving after transport failure still shows the restart state', async () => {
  const fixture = clientFixture()
  vi.mocked(createHostClient).mockReturnValue(fixture.client)
  const response = deferred<Response>()
  vi.stubGlobal(
    'fetch',
    vi.fn(() => response.promise),
  )
  mount()
  await waitFor(() => expect(screen.getByText(/"connected":true/)).toBeTruthy())
  const observedFetch = vi.mocked(createHostClient).mock.calls.at(-1)?.[1]
  const pending = observedFetch?.('http://localhost/api')
  act(() => {
    fixture.streams[1].error(new Error('Disconnected'))
  })
  await waitFor(() => expect(screen.getByText(/"connected":false/)).toBeTruthy())
  await act(async () => {
    response.resolve(new Response(null, { status: 403 }))
    await pending
  })
  expect(screen.getByText(/"restarted":true/)).toBeTruthy()
  vi.unstubAllGlobals()
})
