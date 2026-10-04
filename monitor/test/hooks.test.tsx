import type { FlowControl, FlowEvent, RunListFilter, RunTrace } from '@mokei/flow-client'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, expect, test, vi } from 'vitest'

import { FlowContext, type FlowContextValue } from '../src/flow/FlowProvider.js'
import { useFlows } from '../src/flow/useFlows.js'
import { useInbox } from '../src/flow/useInbox.js'
import { useInboxItem } from '../src/flow/useInboxItem.js'
import { useRun } from '../src/flow/useRun.js'
import { useRuns } from '../src/flow/useRuns.js'
import { useRunTrace } from '../src/flow/useRunTrace.js'
import type { HostClient } from '../src/host/client.js'
import { deferred, item, run } from './fixtures.js'

function fixture() {
  const listeners = new Set<(event: FlowEvent) => void>()
  const control: FlowControl & {
    runs: FlowControl['runs'] & { trace(runID: string): Promise<RunTrace> }
  } = {
    flows: { list: vi.fn(async () => []), check: vi.fn() },
    runs: {
      list: vi.fn(async () => [run()]),
      get: vi.fn(async () => run()),
      start: vi.fn(),
      cancel: vi.fn(),
      trace: vi.fn(async () => ({ spans: [], logs: [] })),
    },
    inbox: {
      list: vi.fn(async () => [item()]),
      get: vi.fn(async () => item()),
      answer: vi.fn(),
      decline: vi.fn(),
      cancel: vi.fn(),
    },
    subscribe: vi.fn(),
  }
  let value: FlowContextValue = {
    control,
    client: {} as HostClient,
    epoch: 0,
    connected: true,
    restarted: false,
    status: { state: 'ready' },
    on: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <FlowContext value={value}>{children}</FlowContext>
  )
  return {
    control,
    wrapper,
    emit: (event: FlowEvent) => {
      for (const listener of listeners) listener(event)
    },
    epoch: () => {
      value = { ...value, epoch: value.epoch + 1 }
    },
  }
}

afterEach(() => vi.useRealTimers())

test('live run events still update the list after a snapshot read rejects', async () => {
  const f = fixture()
  const error = new Error('Snapshot unavailable')
  vi.mocked(f.control.runs.list).mockRejectedValue(error)
  const { result } = renderHook(() => useRuns(), { wrapper: f.wrapper })
  await waitFor(() => expect(result.current.error).toBe(error))
  act(() => {
    f.emit({ type: 'run:state', data: run('run-1', 'completed') })
  })
  expect(result.current.runs).toEqual([run('run-1', 'completed')])
  expect(result.current.loading).toBe(false)
})

test('refresh keeps the current list until the new snapshot lands', async () => {
  const f = fixture()
  const { result } = renderHook(() => useRuns(), { wrapper: f.wrapper })
  await waitFor(() => expect(result.current.loading).toBe(false))
  const snapshot = deferred<Array<ReturnType<typeof run>>>()
  vi.mocked(f.control.runs.list).mockReturnValue(snapshot.promise)
  act(() => result.current.refresh())
  expect(result.current.runs).toEqual([run()])
  expect(result.current.loading).toBe(true)
  await act(async () => snapshot.resolve([run('run-1', 'cancelled')]))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.runs).toEqual([run('run-1', 'cancelled')])
})

test('a rejected snapshot drains buffered IDs and newer live events win over their reads', async () => {
  const f = fixture()
  const snapshot = deferred<Array<ReturnType<typeof run>>>()
  const affected = deferred<ReturnType<typeof run>>()
  const error = new Error('Snapshot unavailable')
  vi.mocked(f.control.runs.list).mockReturnValue(snapshot.promise)
  vi.mocked(f.control.runs.get).mockReturnValue(affected.promise)
  const { result } = renderHook(() => useRuns(), { wrapper: f.wrapper })
  act(() => {
    f.emit({ type: 'run:state', data: run('run-1', 'input_required') })
  })
  await act(async () => {
    snapshot.reject(error)
  })
  expect(f.control.runs.get).toHaveBeenCalledWith('run-1')
  act(() => {
    f.emit({ type: 'run:state', data: run('run-1', 'completed') })
  })
  await act(async () => {
    affected.resolve(run('run-1', 'working'))
  })
  expect(result.current.runs).toEqual([run('run-1', 'completed')])
  expect(result.current.loading).toBe(false)
  expect(result.current.error).toBe(error)
})

test('a limited working list backfills the older run when the newest completes', async () => {
  const f = fixture()
  const older = run('older', 'working')
  const newest = { ...run('newest', 'working'), createdAt: 3 }
  let population = [newest, older]
  vi.mocked(f.control.runs.list).mockImplementation(async (filter) => {
    const matching = population.filter((entry) => {
      return filter?.states == null || filter.states.includes(entry.state)
    })
    return filter?.limit == null ? matching : matching.slice(0, filter.limit)
  })
  const { result } = renderHook(() => useRuns({ states: ['working'], limit: 1 }), {
    wrapper: f.wrapper,
  })
  await waitFor(() => expect(result.current.runs).toEqual([newest]))
  expect(f.control.runs.list).toHaveBeenCalledWith({ states: ['working'], limit: 1 })
  population = [{ ...newest, state: 'completed' }, older]
  act(() => {
    f.emit({ type: 'run:state', data: { ...newest, state: 'completed' } })
  })
  await waitFor(() => expect(result.current.runs).toEqual([older]))
  expect(f.control.runs.list).toHaveBeenCalledTimes(2)
  expect(f.control.runs.list).toHaveBeenLastCalledWith({ states: ['working'], limit: 1 })
})

test('buffered run events re-read affected IDs rather than replay stale data', async () => {
  const f = fixture()
  const snapshot = deferred<Array<ReturnType<typeof run>>>()
  vi.mocked(f.control.runs.list).mockReturnValue(snapshot.promise)
  vi.mocked(f.control.runs.get).mockResolvedValue(run('run-1', 'completed'))
  const { result } = renderHook(() => useRuns(), { wrapper: f.wrapper })
  act(() => {
    f.emit({ type: 'run:state', data: run('run-1', 'input_required') })
  })
  await act(async () => {
    snapshot.resolve([run()])
  })
  await waitFor(() => expect(result.current.runs[0]?.state).toBe('completed'))
})

test('live run events win over an affected-ID read in flight', async () => {
  const f = fixture()
  const affected = deferred<ReturnType<typeof run>>()
  vi.mocked(f.control.runs.get).mockReturnValue(affected.promise)
  const { result } = renderHook(() => useRun('run-1'), { wrapper: f.wrapper })
  act(() => {
    f.emit({ type: 'run:state', data: run('run-1', 'working') })
  })
  await act(async () => {
    affected.resolve(run())
  })
  await waitFor(() => expect(result.current.loading).toBe(false))
  // A fresh snapshot buffers an event, then re-reads the affected run.
  const read = deferred<ReturnType<typeof run>>()
  const next = deferred<ReturnType<typeof run>>()
  vi.mocked(f.control.runs.get).mockReturnValueOnce(read.promise).mockReturnValueOnce(next.promise)
  act(() => {
    result.current.refresh()
  })
  act(() => {
    f.emit({ type: 'run:state', data: run() })
  })
  await act(async () => {
    read.resolve(run())
  })
  act(() => {
    f.emit({ type: 'run:state', data: run('run-1', 'completed') })
  })
  await act(async () => {
    next.resolve(run())
  })
  expect(result.current.run?.state).toBe('completed')
})

test('filter changes discard an older list and live events respect the filter', async () => {
  const f = fixture()
  const old = deferred<Array<ReturnType<typeof run>>>()
  vi.mocked(f.control.runs.list)
    .mockReturnValueOnce(old.promise)
    .mockResolvedValue([run('run-2', 'completed')])
  const { result, rerender } = renderHook(
    ({ filter }: { filter: RunListFilter }) => useRuns(filter),
    { initialProps: { filter: { states: ['working'] } }, wrapper: f.wrapper },
  )
  rerender({ filter: { states: ['completed'] } })
  await waitFor(() => expect(result.current.runs[0]?.runID).toBe('run-2'))
  await act(async () => {
    old.resolve([run()])
  })
  act(() => {
    f.emit({ type: 'run:state', data: run('run-2', 'working') })
  })
  expect(result.current.runs).toEqual([])
})

test('epoch changes discard an old run detail read', async () => {
  const f = fixture()
  const old = deferred<ReturnType<typeof run>>()
  vi.mocked(f.control.runs.get)
    .mockReturnValueOnce(old.promise)
    .mockResolvedValue(run('run-1', 'completed'))
  const { result, rerender } = renderHook(() => useRun('run-1'), { wrapper: f.wrapper })
  f.epoch()
  rerender()
  await waitFor(() => expect(result.current.run?.state).toBe('completed'))
  await act(async () => {
    old.resolve(run())
  })
  expect(result.current.run?.state).toBe('completed')
})

test('inbox settlement during a snapshot cannot be resurrected on refresh', async () => {
  const f = fixture()
  const snapshot = deferred<Array<ReturnType<typeof item>>>()
  vi.mocked(f.control.inbox.list).mockReturnValueOnce(snapshot.promise).mockResolvedValue([item()])
  const { result } = renderHook(() => useInbox(), { wrapper: f.wrapper })
  act(() => {
    f.emit({ type: 'inbox:settled', data: { item: item(), outcome: 'declined' } })
  })
  await act(async () => {
    snapshot.resolve([item()])
  })
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.items).toEqual([])
  expect(result.current.settled.get('item-1')).toBe('declined')
  act(() => {
    result.current.refresh()
  })
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.items).toEqual([])
})

test('a buffered added inbox item is re-read and detail observes settlement', async () => {
  const f = fixture()
  const snapshot = deferred<ReturnType<typeof item>>()
  vi.mocked(f.control.inbox.get).mockReturnValueOnce(snapshot.promise).mockResolvedValue(item())
  const { result } = renderHook(() => useInboxItem('item-1'), { wrapper: f.wrapper })
  act(() => {
    f.emit({ type: 'inbox:added', data: item() })
  })
  await act(async () => {
    snapshot.resolve(item())
  })
  await waitFor(() => expect(result.current.item?.id).toBe('item-1'))
  act(() => {
    f.emit({ type: 'inbox:settled', data: { item: item(), outcome: 'answered' } })
  })
  expect(result.current.item).toBeUndefined()
  expect(result.current.outcome).toBe('answered')
})

test('flows re-query on an epoch change', async () => {
  const f = fixture()
  const summary = {
    id: 'flow-1',
    name: 'Example',
    version: 1,
    input: {},
    outputs: [],
    outcomes: [],
  }
  const { result, rerender } = renderHook(useFlows, { wrapper: f.wrapper })
  await waitFor(() => expect(result.current.loading).toBe(false))
  vi.mocked(f.control.flows.list).mockResolvedValue([summary])
  f.epoch()
  rerender()
  await waitFor(() => expect(result.current.flows).toEqual([summary]))
})

test('trace polls every two seconds and stops after two matching terminal reads', async () => {
  vi.useFakeTimers()
  const f = fixture()
  const { result } = renderHook(() => useRunTrace('run-1'), { wrapper: f.wrapper })
  await act(async () => {})
  expect(result.current.trace).toEqual({ spans: [], logs: [] })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_000)
  })
  expect(f.control.runs.trace).toHaveBeenCalledTimes(2)
  act(() => {
    f.emit({ type: 'run:state', data: run('run-1', 'completed') })
  })
  await act(async () => {})
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_000)
  })
  const reads = vi.mocked(f.control.runs.trace).mock.calls.length
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000)
  })
  expect(vi.mocked(f.control.runs.trace).mock.calls.length).toBe(reads)
})

test('terminal trace polling stops after ten seconds even if reads differ', async () => {
  vi.useFakeTimers()
  const f = fixture()
  vi.mocked(f.control.runs.get).mockResolvedValue(run('run-1', 'completed'))
  let timestamp = 0
  vi.mocked(f.control.runs.trace).mockImplementation(
    async (): Promise<RunTrace> => ({
      spans: [],
      logs: [
        {
          traceID: 'trace-1',
          spanID: 'span-1',
          timestamp: timestamp++,
          level: 'info',
          category: [],
          message: 'log',
          properties: {},
        },
      ],
    }),
  )
  renderHook(() => useRunTrace('run-1'), { wrapper: f.wrapper })
  await act(async () => {})
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000)
  })
  const reads = vi.mocked(f.control.runs.trace).mock.calls.length
  expect(reads).toBeGreaterThan(2)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000)
  })
  expect(vi.mocked(f.control.runs.trace).mock.calls.length).toBe(reads)
})

test('trace coalesces polling and manual refreshes while a read is in flight', async () => {
  vi.useFakeTimers()
  const f = fixture()
  const pending = deferred<RunTrace>()
  vi.mocked(f.control.runs.trace).mockReturnValueOnce(pending.promise)
  const { result, unmount } = renderHook(() => useRunTrace('run-1'), { wrapper: f.wrapper })
  await act(async () => {})
  await act(async () => {
    await vi.advanceTimersByTimeAsync(4_000)
    result.current.refresh()
    result.current.refresh()
  })
  expect(f.control.runs.trace).toHaveBeenCalledOnce()
  await act(async () => {
    pending.resolve({ spans: [], logs: [] })
  })
  expect(f.control.runs.trace).toHaveBeenCalledTimes(2)
  unmount()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20_000)
  })
  expect(f.control.runs.trace).toHaveBeenCalledTimes(2)
})

test('trace discards an old epoch read and restarts the polling cadence', async () => {
  vi.useFakeTimers()
  const f = fixture()
  const pending = deferred<RunTrace>()
  vi.mocked(f.control.runs.trace).mockReturnValueOnce(pending.promise)
  const { result, rerender } = renderHook(() => useRunTrace('run-1'), { wrapper: f.wrapper })
  await act(async () => {})
  f.epoch()
  rerender()
  await act(async () => {})
  expect(f.control.runs.trace).toHaveBeenCalledTimes(3)
  await act(async () => {
    pending.reject(new Error('Old transport failed'))
    await vi.advanceTimersByTimeAsync(1_999)
  })
  expect(result.current.error).toBeUndefined()
  expect(result.current.trace).toEqual({ spans: [], logs: [] })
  expect(f.control.runs.trace).toHaveBeenCalledTimes(3)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
  })
  expect(f.control.runs.trace).toHaveBeenCalledTimes(4)
})
