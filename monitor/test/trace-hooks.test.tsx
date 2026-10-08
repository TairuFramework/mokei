import type {
  HostEvent,
  OpenSpan,
  StoredSpan,
  TraceLog,
  TraceSummary,
  TracesGetResult,
  TracesListResult,
} from '@mokei/host-protocol'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { expect, test, vi } from 'vitest'

import { type HostConnection, HostConnectionContext } from '../src/host/HostConnectionProvider.js'
import { useTrace } from '../src/traces/useTrace.js'
import { useTraceList } from '../src/traces/useTraceList.js'
import { clientFixture } from './host-connection-fixture.js'

const summary: TraceSummary = {
  traceID: 'trace-a',
  rootSpanID: 'root-a',
  kind: 'flow',
  name: 'Example',
  active: true,
  outcome: null,
  startTime: 100,
  attributes: {},
  spanCount: 0,
  errorCount: 0,
  droppedCount: 0,
  revision: 1,
}
const open: OpenSpan = {
  traceID: summary.traceID,
  spanID: summary.rootSpanID,
  name: 'flow.run',
  kind: 0,
  startTime: 100,
  attributes: {},
  links: [],
}
const ended: StoredSpan = { ...open, endTime: 200, status: { code: 1 }, events: [] }
const log: TraceLog = {
  logID: 'log-a',
  traceID: summary.traceID,
  spanID: open.spanID,
  timestamp: 150,
  level: 'info',
  category: ['mokei'],
  message: 'Hello',
  properties: {},
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function setup() {
  const fixture = clientFixture()
  const listeners = new Set<(event: HostEvent, epoch: number) => void>()
  const subscribe = vi.fn<HostConnection['subscribe']>((types, listener) => {
    const dispatch = (event: HostEvent, epoch: number) => {
      if (types.includes(event.type as never)) listener(event as never, epoch)
    }
    listeners.add(dispatch)
    return () => {
      listeners.delete(dispatch)
    }
  })
  let connection: HostConnection = {
    client: fixture.client,
    epoch: 0,
    connected: true,
    restarted: false,
    subscribe,
    info: undefined,
  }
  return {
    fixture,
    subscribe,
    wrapper: ({ children }: { children: ReactNode }) => (
      <HostConnectionContext value={connection}>{children}</HostConnectionContext>
    ),
    epoch: (epoch: number) => {
      connection = { ...connection, epoch }
    },
    emit: (event: HostEvent, epoch = connection.epoch) =>
      act(() => {
        for (const listener of listeners) listener(event, epoch)
      }),
  }
}
const meta = { eventID: 'event-a', time: 150 }
const snapshot: TracesGetResult = { summary, spans: [open], logs: [], logsTruncated: false }

test('initial list failures expose an error and retry reconciles buffered summaries', async () => {
  const env = setup()
  const initial = deferred<TracesListResult>()
  const retry = deferred<TracesListResult>()
  const error = new Error('List unavailable')
  env.fixture.request
    .mockReturnValueOnce(initial.promise as never)
    .mockReturnValueOnce(retry.promise as never)
  const hook = renderHook(() => useTraceList({ kind: 'flow' }), { wrapper: env.wrapper })
  env.emit({ type: 'trace:summary', meta, data: { ...summary, revision: 2 } })
  await act(async () => initial.reject(error))
  expect(hook.result.current.error).toBe(error)
  expect(hook.result.current.loading).toBe(false)
  act(() => {
    hook.result.current.retry()
    hook.result.current.retry()
  })
  expect(hook.result.current.loading).toBe(true)
  expect(hook.result.current.error).toBeUndefined()
  expect(env.fixture.request).toHaveBeenCalledTimes(2)
  expect(env.fixture.request).toHaveBeenLastCalledWith('traces.list', {
    param: { kind: 'flow', limit: 50 },
  })
  env.emit({ type: 'trace:summary', meta, data: { ...summary, revision: 3 } })
  await act(async () => retry.resolve({ traces: [summary] }))
  expect(hook.result.current.traces).toEqual([{ ...summary, revision: 3 }])
  expect(hook.result.current.loading).toBe(false)
  expect(hook.result.current.error).toBeUndefined()
})

test('list retry repeats the failed page and preserves previously loaded summaries', async () => {
  const env = setup()
  env.fixture.request
    .mockResolvedValueOnce({ traces: [summary], cursor: 'next' } as never)
    .mockRejectedValueOnce('Page unavailable')
    .mockResolvedValueOnce({ traces: [{ ...summary, traceID: 'trace-b' }] } as never)
  const hook = renderHook(() => useTraceList({}), { wrapper: env.wrapper })
  await act(async () => {})
  await act(async () => hook.result.current.loadMore())
  expect(hook.result.current.error).toBeInstanceOf(Error)
  expect(hook.result.current.error?.message).toBe('Page unavailable')
  expect(hook.result.current.traces).toEqual([summary])
  await act(async () => hook.result.current.retry())
  expect(env.fixture.request).toHaveBeenLastCalledWith('traces.list', {
    param: { limit: 50, cursor: 'next' },
  })
  expect(hook.result.current.traces.map((trace) => trace.traceID)).toEqual(['trace-a', 'trace-b'])
  expect(hook.result.current.error).toBeUndefined()
  act(() => hook.result.current.retry())
  expect(env.fixture.request).toHaveBeenCalledTimes(3)
})

test('selected trace failures expose an error and retry merges the snapshot with live events', async () => {
  const env = setup()
  const initial = deferred<TracesGetResult>()
  const retry = deferred<TracesGetResult>()
  const error = new Error('Snapshot unavailable')
  env.fixture.request
    .mockReturnValueOnce(initial.promise as never)
    .mockReturnValueOnce(retry.promise as never)
  const hook = renderHook(() => useTrace(summary.traceID), { wrapper: env.wrapper })
  env.emit({ type: 'span:end', meta, data: ended })
  await act(async () => initial.reject(error))
  expect(hook.result.current.error).toBe(error)
  expect(hook.result.current.loading).toBe(false)
  expect(hook.result.current.notFound).toBe(false)
  expect(hook.result.current.state?.summary).toBeUndefined()
  act(() => {
    hook.result.current.retry()
    hook.result.current.retry()
  })
  expect(hook.result.current.loading).toBe(true)
  expect(hook.result.current.error).toBeUndefined()
  expect(env.fixture.request).toHaveBeenCalledTimes(2)
  expect(env.fixture.request).toHaveBeenLastCalledWith('traces.get', {
    param: { traceID: summary.traceID },
  })
  env.emit({ type: 'log', meta, data: log })
  env.emit({ type: 'trace:summary', meta, data: { ...summary, revision: 2 } })
  await act(async () => retry.resolve(snapshot))
  expect(hook.result.current.state?.summary?.revision).toBe(2)
  expect(hook.result.current.state?.spans.get(open.spanID)).toEqual(ended)
  expect(hook.result.current.state?.logs.get(log.logID)).toEqual(log)
  expect(hook.result.current.loading).toBe(false)
  expect(hook.result.current.error).toBeUndefined()
})

test('selected trace errors without events reset on selection change and stale retries are ignored', async () => {
  const env = setup()
  const retry = deferred<TracesGetResult>()
  const fresh = deferred<TracesGetResult>()
  const error = new Error('Snapshot unavailable')
  env.fixture.request
    .mockRejectedValueOnce(error)
    .mockReturnValueOnce(retry.promise as never)
    .mockReturnValueOnce(fresh.promise as never)
  const hook = renderHook(({ traceID }) => useTrace(traceID), {
    initialProps: { traceID: summary.traceID },
    wrapper: env.wrapper,
  })
  await act(async () => {})
  expect(hook.result.current.error).toBe(error)
  expect(hook.result.current.state).toBeUndefined()
  expect(hook.result.current.loading).toBe(false)
  expect(hook.result.current.notFound).toBe(false)
  act(() => hook.result.current.retry())
  hook.rerender({ traceID: 'trace-b' })
  expect(hook.result.current.error).toBeUndefined()
  await act(async () => retry.reject(error))
  expect(hook.result.current.error).toBeUndefined()
  expect(hook.result.current.loading).toBe(true)
  await act(async () =>
    fresh.resolve({ ...snapshot, summary: { ...summary, traceID: 'trace-b' }, spans: [] }),
  )
  expect(hook.result.current.state?.summary?.traceID).toBe('trace-b')
})

test('list events received before the query resolves are applied after it', async () => {
  const env = setup()
  const read = deferred<TracesListResult>()
  env.fixture.request.mockReturnValue(read.promise as never)
  const hook = renderHook(() => useTraceList({}), { wrapper: env.wrapper })
  expect(env.subscribe.mock.invocationCallOrder[0]).toBeLessThan(
    env.fixture.request.mock.invocationCallOrder[0],
  )
  env.emit({ type: 'trace:summary', meta, data: { ...summary, revision: 2 } })
  expect(hook.result.current.traces).toEqual([])
  await act(async () => read.resolve({ traces: [summary] }))
  expect(hook.result.current.traces[0].revision).toBe(2)
  expect(hook.result.current.loading).toBe(false)
})

test('a query result from a previous epoch is ignored', async () => {
  const env = setup()
  const old = deferred<TracesListResult>()
  const fresh = deferred<TracesListResult>()
  env.fixture.request
    .mockReturnValueOnce(old.promise as never)
    .mockReturnValueOnce(fresh.promise as never)
  const hook = renderHook(() => useTraceList({}), { wrapper: env.wrapper })
  env.epoch(1)
  hook.rerender()
  await act(async () => old.resolve({ traces: [summary] }))
  expect(hook.result.current.traces).toEqual([])
  env.emit({ type: 'trace:summary', meta, data: { ...summary, revision: 100 } }, 0)
  await act(async () => fresh.resolve({ traces: [] }))
  expect(hook.result.current.traces).toEqual([])
})

test('epoch change clears summaries even if old revisions were higher', async () => {
  const env = setup()
  const fresh = deferred<TracesListResult>()
  env.fixture.request
    .mockResolvedValueOnce({ traces: [{ ...summary, revision: 100 }] } as never)
    .mockReturnValueOnce(fresh.promise as never)
  const hook = renderHook(() => useTraceList({}), { wrapper: env.wrapper })
  await act(async () => {})
  expect(hook.result.current.traces[0].revision).toBe(100)
  env.epoch(1)
  hook.rerender()
  expect(hook.result.current.traces).toEqual([])
  await act(async () => fresh.resolve({ traces: [summary] }))
  expect(hook.result.current.traces[0].revision).toBe(1)
})

test('list pages with 50, sorts active first, and filters live summaries after updates', async () => {
  const env = setup()
  env.fixture.request
    .mockResolvedValueOnce({ traces: [{ ...summary, active: false }], cursor: 'next' } as never)
    .mockResolvedValueOnce({ traces: [{ ...summary, traceID: 'trace-b', startTime: 50 }] } as never)
  const hook = renderHook(() => useTraceList({ kind: 'flow', name: 'Exam' }), {
    wrapper: env.wrapper,
  })
  await act(async () => {})
  await act(async () => hook.result.current.loadMore())
  expect(env.fixture.request).toHaveBeenLastCalledWith('traces.list', {
    param: { kind: 'flow', name: 'Exam', limit: 50, cursor: 'next' },
  })
  expect(hook.result.current.traces.map((trace) => trace.traceID)).toEqual([
    'trace-b',
    summary.traceID,
  ])
  env.emit({ type: 'trace:summary', meta, data: { ...summary, revision: 2, kind: 'context' } })
  expect(hook.result.current.traces.map((trace) => trace.traceID)).toEqual(['trace-b'])
})

test('selected trace buffers matching events and merges them after the snapshot', async () => {
  const env = setup()
  const read = deferred<TracesGetResult>()
  env.fixture.request.mockReturnValue(read.promise as never)
  const hook = renderHook(() => useTrace(summary.traceID), { wrapper: env.wrapper })
  env.emit({ type: 'span:end', meta, data: ended })
  env.emit({ type: 'log', meta, data: log })
  env.emit({ type: 'span:start', meta, data: { ...open, traceID: 'other', spanID: 'other' } })
  await act(async () => read.resolve(snapshot))
  expect([...(hook.result.current.state?.spans.values() ?? [])]).toEqual([ended])
  expect([...(hook.result.current.state?.logs.values() ?? [])]).toEqual([log])
})

test('selection change discards the previous trace and ignores its pending query', async () => {
  const env = setup()
  const old = deferred<TracesGetResult>()
  const fresh = deferred<TracesGetResult>()
  env.fixture.request
    .mockReturnValueOnce(old.promise as never)
    .mockReturnValueOnce(fresh.promise as never)
  const hook = renderHook(({ traceID }) => useTrace(traceID), {
    initialProps: { traceID: summary.traceID },
    wrapper: env.wrapper,
  })
  env.emit({ type: 'span:end', meta, data: ended })
  hook.rerender({ traceID: 'trace-b' })
  await act(async () => old.resolve(snapshot))
  expect(hook.result.current.state).toBeUndefined()
  await act(async () =>
    fresh.resolve({ ...snapshot, summary: { ...summary, traceID: 'trace-b' }, spans: [] }),
  )
  expect(hook.result.current.state?.spans.size).toBe(0)
})

test('selected trace resets on epoch change and rejects stale snapshots and events', async () => {
  const env = setup()
  const old = deferred<TracesGetResult>()
  const fresh = deferred<TracesGetResult>()
  env.fixture.request
    .mockReturnValueOnce(old.promise as never)
    .mockReturnValueOnce(fresh.promise as never)
  const hook = renderHook(() => useTrace(summary.traceID), { wrapper: env.wrapper })
  env.epoch(1)
  hook.rerender()
  await act(async () => old.resolve(snapshot))
  env.emit({ type: 'span:end', meta, data: ended }, 0)
  expect(hook.result.current.state).toBeUndefined()
  await act(async () => fresh.resolve({ ...snapshot, spans: [] }))
  expect(hook.result.current.state?.spans.size).toBe(0)
})

test('undefined selection does not query and missing traces set notFound', async () => {
  const env = setup()
  const hook = renderHook(({ traceID }) => useTrace(traceID), {
    initialProps: { traceID: undefined as string | undefined },
    wrapper: env.wrapper,
  })
  expect(env.fixture.request).not.toHaveBeenCalled()
  expect(hook.result.current.loading).toBe(false)
  env.fixture.request.mockRejectedValueOnce({ code: 'TRACE_NOT_FOUND' })
  hook.rerender({ traceID: 'missing' })
  await act(async () => {})
  expect(hook.result.current.notFound).toBe(true)
})

test('events delivered as a selected-trace query settles are not lost', async () => {
  const env = setup()
  const read = deferred<TracesGetResult>()
  env.fixture.request.mockReturnValue(read.promise as never)
  const hook = renderHook(() => useTrace(summary.traceID), { wrapper: env.wrapper })
  void read.promise.then(() => env.emit({ type: 'log', meta, data: log }))
  await act(async () => read.resolve(snapshot))
  expect(hook.result.current.state?.logs.get(log.logID)).toEqual(log)
})

test('changing a loaded selection clears spans, logs, summary and truncation', async () => {
  const env = setup()
  const fresh = deferred<TracesGetResult>()
  env.fixture.request
    .mockResolvedValueOnce({
      ...snapshot,
      spans: [ended],
      logs: [log],
      logsTruncated: true,
    } as never)
    .mockReturnValueOnce(fresh.promise as never)
  const hook = renderHook(({ traceID }) => useTrace(traceID), {
    initialProps: { traceID: summary.traceID },
    wrapper: env.wrapper,
  })
  await act(async () => {})
  expect(hook.result.current.state?.logsTruncated).toBe(true)
  hook.rerender({ traceID: 'trace-b' })
  expect(hook.result.current.state).toBeUndefined()
  expect(hook.result.current.loading).toBe(true)
  await act(async () =>
    fresh.resolve({ ...snapshot, summary: { ...summary, traceID: 'trace-b' }, spans: [] }),
  )
  expect(hook.result.current.state?.logs.size).toBe(0)
  expect(hook.result.current.state?.logsTruncated).toBe(false)
})

test('list buffers page updates, prevents concurrent paging and stops at the last page', async () => {
  const env = setup()
  const page = deferred<TracesListResult>()
  env.fixture.request
    .mockResolvedValueOnce({ traces: [summary], cursor: 'next' } as never)
    .mockReturnValueOnce(page.promise as never)
  const hook = renderHook(() => useTraceList({}), { wrapper: env.wrapper })
  await act(async () => {})
  act(() => {
    hook.result.current.loadMore()
    hook.result.current.loadMore()
  })
  expect(env.fixture.request).toHaveBeenCalledTimes(2)
  env.emit({ type: 'trace:summary', meta, data: { ...summary, revision: 5 } })
  await act(async () => page.resolve({ traces: [{ ...summary, revision: 3 }] }))
  expect(hook.result.current.traces[0].revision).toBe(5)
  act(() => hook.result.current.loadMore())
  expect(env.fixture.request).toHaveBeenCalledTimes(2)
})

test('filter changes reset the list and reject the previous pending query', async () => {
  const env = setup()
  const old = deferred<TracesListResult>()
  env.fixture.request
    .mockReturnValueOnce(old.promise as never)
    .mockResolvedValueOnce({ traces: [] } as never)
  const hook = renderHook(({ kind }) => useTraceList({ kind }), {
    initialProps: { kind: 'flow' as TraceSummary['kind'] },
    wrapper: env.wrapper,
  })
  hook.rerender({ kind: 'context' })
  await act(async () => old.resolve({ traces: [summary] }))
  expect(hook.result.current.traces).toEqual([])
  env.emit({ type: 'trace:summary', meta, data: { ...summary, kind: 'context' } })
  expect(hook.result.current.traces[0].kind).toBe('context')
})
