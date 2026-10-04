import type { StreamCall } from '@enkaku/client'
import { EnkakuProvider } from '@enkaku/react'
import type { HostEvent } from '@mokei/host-protocol'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import type { ReactNode } from 'react'
import { expect, test, vi } from 'vitest'

import { FlowContext, type FlowContextValue } from '../src/flow/FlowProvider.js'
import { useHostEvents } from '../src/hooks.js'
import type { HostClient } from '../src/host/client.js'
import { hostEventsAtom } from '../src/state.js'

function fixture() {
  const store = createStore()
  const streams: Array<{
    controller: ReadableStreamDefaultController<HostEvent>
    call: StreamCall<HostEvent, void>
  }> = []
  const createStream = vi.fn(() => {
    let controller!: ReadableStreamDefaultController<HostEvent>
    const call = Object.assign(new Promise<void>(() => {}), {
      readable: new ReadableStream<HostEvent>({
        start(value) {
          controller = value
        },
      }),
      type: 'stream' as const,
      procedure: 'events',
      id: 'events-call',
      signal: new AbortController().signal,
      abort: vi.fn(),
      close: vi.fn(),
      dispose: vi.fn(async () => {}),
    }) satisfies StreamCall<HostEvent, void>
    streams.push({ controller, call })
    return call
  })
  let flow = {
    client: { createStream } as unknown as HostClient,
    connected: true,
    epoch: 0,
  } as FlowContextValue
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>
      <FlowContext value={flow}>
        <EnkakuProvider client={flow.client}>{children}</EnkakuProvider>
      </FlowContext>
    </Provider>
  )
  return {
    store,
    streams,
    createStream,
    wrapper,
    disconnect: () => {
      flow = { ...flow, connected: false }
    },
    reconnect: () => {
      flow = {
        ...flow,
        client: { createStream } as unknown as HostClient,
        connected: true,
        epoch: flow.epoch + 1,
      }
    },
  }
}

function event(eventID: string): HostEvent {
  return {
    type: 'context:stop',
    meta: { eventID, contextID: 'context-1', time: 1 },
  }
}

test('events accumulate across client replacements and stay available while disconnected', async () => {
  const f = fixture()
  const { result, rerender } = renderHook(useHostEvents, { wrapper: f.wrapper })
  await waitFor(() => expect(f.streams[0]?.call.readable.locked).toBe(true))
  await act(async () => {
    f.streams[0].controller.enqueue(event('first'))
  })
  expect(result.current).toEqual([event('first')])
  f.disconnect()
  rerender()
  await act(async () => {})
  expect(f.createStream).toHaveBeenCalledOnce()
  expect(result.current).toEqual([event('first')])
  f.reconnect()
  rerender()
  await waitFor(() => expect(f.streams[1]?.call.readable.locked).toBe(true))
  await act(async () => {
    f.streams[1].controller.enqueue(event('second'))
  })
  expect(result.current).toEqual([event('first'), event('second')])
})

test('the event reader continues collecting after the events page unmounts', async () => {
  const f = fixture()
  const { unmount } = renderHook(useHostEvents, { wrapper: f.wrapper })
  await waitFor(() => expect(f.streams[0]?.call.readable.locked).toBe(true))
  unmount()
  await act(async () => {
    f.streams[0].controller.enqueue(event('while-away'))
  })
  expect(f.store.get(hostEventsAtom)).toEqual([event('while-away')])
  expect(f.streams[0].call.abort).not.toHaveBeenCalled()
  expect(f.streams[0].call.close).not.toHaveBeenCalled()
})

test('a disconnected page waits for the replacement client before opening events', async () => {
  const f = fixture()
  f.disconnect()
  const { result, rerender } = renderHook(useHostEvents, { wrapper: f.wrapper })
  await act(async () => {})
  expect(f.createStream).not.toHaveBeenCalled()
  expect(result.current).toEqual([])
  f.reconnect()
  rerender()
  await waitFor(() => expect(f.streams[0]?.call.readable.locked).toBe(true))
  await act(async () => {
    f.streams[0].controller.enqueue(event('connected'))
  })
  expect(result.current).toEqual([event('connected')])
})
