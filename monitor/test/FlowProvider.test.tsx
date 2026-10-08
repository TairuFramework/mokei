import { act, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, expect, test, vi } from 'vitest'

import { FlowProvider, useFlow } from '../src/flow/FlowProvider.js'
import { createHostClient } from '../src/host/client.js'
import { HostConnectionProvider } from '../src/host/HostConnectionProvider.js'
import { deferred, run } from './fixtures.js'
import { clientFixture } from './host-connection-fixture.js'

vi.mock('../src/host/client.js', () => ({ createHostClient: vi.fn() }))

function State() {
  const { epoch, connected, restarted, status } = useFlow()
  return <div>{JSON.stringify({ epoch, connected, restarted, status: status?.state })}</div>
}

function mount() {
  return render(
    <HostConnectionProvider>
      <FlowProvider>
        <State />
      </FlowProvider>
    </HostConnectionProvider>,
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
    first.streams[0].error(new Error('Invalid session ID'))
  })
  await waitFor(() => expect(screen.getByText(/"epoch":1,"connected":true/)).toBeTruthy())
  expect(second.streams.length).toBe(1)
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
    fixture.streams[0].error(new Error('Disconnected'))
  })
  await waitFor(() => expect(screen.getByText(/"connected":false/)).toBeTruthy())
  await act(async () => {
    response.resolve(new Response(null, { status: 403 }))
    await pending
  })
  expect(screen.getByText(/"restarted":true/)).toBeTruthy()
  vi.unstubAllGlobals()
})

test('FlowProvider receives run:state through the connection', async () => {
  const fixture = clientFixture()
  vi.mocked(createHostClient).mockReturnValue(fixture.client)
  const listener = vi.fn()
  function Consumer() {
    const { on } = useFlow()
    useEffect(() => on(listener), [on])
    return <State />
  }
  render(
    <HostConnectionProvider>
      <FlowProvider>
        <Consumer />
      </FlowProvider>
    </HostConnectionProvider>,
  )
  await waitFor(() => expect(screen.getByText(/"connected":true/)).toBeTruthy())
  const data = run()
  await act(async () => {
    fixture.streams[0].enqueue({ type: 'run:state', data, meta: { eventID: 'run-event', time: 1 } })
  })
  expect(listener).toHaveBeenCalledWith({ type: 'run:state', data })
  expect(fixture.client.createStream).toHaveBeenCalledTimes(1)
})
