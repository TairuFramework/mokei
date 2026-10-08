import type { HostEvent } from '@mokei/host-protocol'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, expect, test, vi } from 'vitest'

import { createHostClient } from '../src/host/client.js'
import { HostConnectionProvider } from '../src/host/HostConnectionProvider.js'
import { useHostConnection } from '../src/host/useHostConnection.js'
import { deferred, run } from './fixtures.js'
import { clientFixture } from './host-connection-fixture.js'

vi.mock('../src/host/client.js', () => ({ createHostClient: vi.fn() }))

const wrapper = ({ children }: { children: ReactNode }) => (
  <HostConnectionProvider>{children}</HostConnectionProvider>
)
const event: HostEvent = {
  type: 'run:state',
  data: run(),
  meta: { eventID: 'run-event', time: 1 },
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

test('opens one events stream and dispatches by type', async () => {
  const fixture = clientFixture()
  vi.mocked(createHostClient).mockReturnValue(fixture.client)
  const { result } = renderHook(useHostConnection, { wrapper })
  await waitFor(() => expect(result.current.connected).toBe(true))
  const runs = vi.fn()
  const inbox = vi.fn()
  const off = result.current.subscribe(['run:state'], runs)
  result.current.subscribe(['inbox:added', 'inbox:settled'], inbox)
  await act(async () => fixture.streams[0].enqueue(event))
  expect(runs).toHaveBeenCalledWith(event, 0)
  expect(inbox).not.toHaveBeenCalled()
  expect(fixture.client.createStream).toHaveBeenCalledTimes(1)
  expect(fixture.request).toHaveBeenCalledTimes(1)
  expect(result.current.info?.flowService.state).toBe('ready')
  off()
  await act(async () => fixture.streams[0].enqueue(event))
  expect(runs).toHaveBeenCalledTimes(1)
})

test('reconnect increments epoch and reopens one stream', async () => {
  const first = clientFixture()
  const second = clientFixture()
  vi.mocked(createHostClient).mockReturnValueOnce(first.client).mockReturnValue(second.client)
  const { result } = renderHook(useHostConnection, { wrapper })
  await waitFor(() => expect(result.current.connected).toBe(true))
  act(() => first.streams[0].close())
  await waitFor(() => expect(result.current.epoch).toBe(1))
  await waitFor(() => expect(result.current.connected).toBe(true))
  expect(first.client.dispose).toHaveBeenCalledOnce()
  expect(second.client.createStream).toHaveBeenCalledTimes(1)
  const listener = vi.fn()
  result.current.subscribe(['run:state'], listener)
  await act(async () => second.streams[0].enqueue(event))
  expect(listener).toHaveBeenCalledWith(event, 1)
})

test('events from a previous epoch are not delivered after reconnect', async () => {
  const first = clientFixture()
  const second = clientFixture()
  vi.mocked(createHostClient).mockReturnValueOnce(first.client).mockReturnValue(second.client)
  const { result } = renderHook(useHostConnection, { wrapper })
  await waitFor(() => expect(result.current.connected).toBe(true))
  const listener = vi.fn()
  result.current.subscribe(['run:state', 'service:status'], listener)
  const staleStatus: HostEvent = {
    type: 'service:status',
    data: { service: 'flow', status: { state: 'starting' } },
    meta: { eventID: 'old-status', time: 1 },
  }
  act(() => {
    for (const fail of first.events.get('transportError') ?? []) fail()
    first.streams[0].enqueue(staleStatus)
  })
  await waitFor(() => expect(result.current.epoch).toBe(1))
  await waitFor(() => expect(result.current.connected).toBe(true))
  await act(async () => first.streams[0].enqueue(event))
  expect(listener).not.toHaveBeenCalled()
  expect(result.current.info?.flowService.state).toBe('ready')
  await act(async () => second.streams[0].enqueue(event))
  expect(listener).toHaveBeenCalledExactlyOnceWith(event, 1)
})

test('buffers events until the info barrier resolves', async () => {
  const info = deferred<{ flowService: { state: string } }>()
  const fixture = clientFixture(info.promise)
  vi.mocked(createHostClient).mockReturnValue(fixture.client)
  const { result } = renderHook(useHostConnection, { wrapper })
  await waitFor(() => expect(fixture.request).toHaveBeenCalledOnce())
  const listener = vi.fn()
  result.current.subscribe(['run:state'], listener)
  await act(async () => fixture.streams[0].enqueue(event))
  expect(listener).not.toHaveBeenCalled()
  expect(result.current.connected).toBe(false)
  expect(fixture.client.createStream).toHaveBeenCalledBefore(fixture.request)
  await act(async () => info.resolve({ flowService: { state: 'ready' } }))
  expect(result.current.connected).toBe(true)
  expect(listener).toHaveBeenCalledExactlyOnceWith(event, 0)
})

test('ignores an old info reply and its buffered events after reconnect', async () => {
  const info = deferred<{ flowService: { state: string } }>()
  const first = clientFixture(info.promise)
  const second = clientFixture()
  vi.mocked(createHostClient).mockReturnValueOnce(first.client).mockReturnValue(second.client)
  const { result } = renderHook(useHostConnection, { wrapper })
  await waitFor(() => expect(first.request).toHaveBeenCalledOnce())
  const listener = vi.fn()
  result.current.subscribe(['run:state'], listener)
  await act(async () => first.streams[0].enqueue(event))
  act(() => {
    for (const fail of first.events.get('writeFailed') ?? []) fail()
  })
  await waitFor(() => expect(result.current.epoch).toBe(1))
  await waitFor(() => expect(result.current.connected).toBe(true))
  await act(async () => info.resolve({ flowService: { state: 'starting' } }))
  expect(listener).not.toHaveBeenCalled()
  expect(result.current.info?.flowService.state).toBe('ready')
})

test('unmount closes the stream and cancels reconnect', async () => {
  vi.useFakeTimers()
  const fixture = clientFixture()
  vi.mocked(createHostClient).mockReturnValue(fixture.client)
  const { unmount } = renderHook(useHostConnection, { wrapper })
  await act(async () => {})
  act(() => fixture.streams[0].error(new Error('Disconnected')))
  await act(async () => {})
  unmount()
  await act(async () => vi.advanceTimersByTimeAsync(20_000))
  expect(fixture.close).toHaveBeenCalledOnce()
  expect(fixture.client.dispose).toHaveBeenCalledOnce()
  expect(createHostClient).toHaveBeenCalledOnce()
  expect([...fixture.events.values()].every((listeners) => listeners.size === 0)).toBe(true)
})
