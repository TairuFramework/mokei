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
