/// <reference types="node" />
import { AsyncLocalStorage } from 'node:async_hooks'
import type { LogRecord } from '@logtape/logtape'
import { configure, getLogger, reset } from '@logtape/logtape'
import type { Context } from '@opentelemetry/api'
import { context, ROOT_CONTEXT, trace } from '@opentelemetry/api'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { createTraceStoreLogSink } from '../src/index.js'
import type { StoredLog } from '../src/trace-store.js'
import { createMemoryTraceStore } from '../src/trace-store.js'

const storage = new AsyncLocalStorage<Context>()
beforeEach(() => {
  context.setGlobalContextManager({
    active: () => storage.getStore() ?? ROOT_CONTEXT,
    with: <A extends Array<unknown>, F extends (...args: A) => ReturnType<F>>(
      ctx: Context,
      fn: F,
      thisArg?: ThisParameterType<F>,
      ...args: A
    ): ReturnType<F> => storage.run(ctx, () => fn.call(thisArg, ...args)),
    bind: <T>(_ctx: Context, target: T): T => target,
    enable() {
      return this
    },
    disable() {
      storage.disable()
      return this
    },
  })
})
afterEach(async () => {
  await reset()
  context.disable()
  trace.disable()
  vi.restoreAllMocks()
})
function record(message: string, properties: Record<string, unknown> = {}): LogRecord {
  return {
    category: ['app'],
    timestamp: 1234,
    level: 'info',
    rawMessage: message,
    message: [message],
    properties,
  }
}
function active<T>(fn: () => T, traceID = 'a'.repeat(32), spanID = 'b'.repeat(16)): T {
  return context.with(
    trace.setSpanContext(ROOT_CONTEXT, { traceId: traceID, spanId: spanID, traceFlags: 1 }),
    fn,
  )
}
test('skips uncorrelated invalid and capture logs', async () => {
  const store = createMemoryTraceStore()
  const addLogs = vi.spyOn(store, 'addLogs')
  const sink = createTraceStoreLogSink(store)
  sink(record('absent'))
  active(() => sink(record('invalid trace')), '0'.repeat(32))
  active(() => sink(record('invalid span')), undefined, '0'.repeat(16))
  for (const category of [
    ['mokei', 'flow-host', 'capture'],
    ['mokei', 'flow-host', 'capture', 'child'],
  ]) {
    active(() => sink({ ...record('capture'), category }))
  }
  await sink.flush()
  expect(addLogs).not.toHaveBeenCalled()
})
test('copies log properties and correlation at emit time', async () => {
  const store = createMemoryTraceStore()
  const addLogs = vi.spyOn(store, 'addLogs')
  const sink = createTraceStoreLogSink(store)
  const properties = { nested: { value: 1 }, bigint: 12n, absent: undefined }
  const category = ['app']
  active(() => sink({ ...record('original', properties), category }))
  properties.nested.value = 2
  category.push('mutated')
  await active(() => sink.flush(), 'c'.repeat(32), 'd'.repeat(16))
  expect(addLogs).toHaveBeenCalledExactlyOnceWith([
    {
      traceID: 'a'.repeat(32),
      spanID: 'b'.repeat(16),
      timestamp: 1234,
      level: 'info',
      category: ['app'],
      message: 'original',
      properties: { nested: { value: 1 }, bigint: '12', absent: 'undefined' },
    },
  ])
})
test('serialises batches and drains concurrent flush emissions', async () => {
  const store = createMemoryTraceStore()
  const persistedMessages: Array<string> = []
  let release!: () => void
  let concurrentWrites = 0
  let maxConcurrentWrites = 0
  const addLogs = vi.spyOn(store, 'addLogs').mockImplementation(async (batch) => {
    concurrentWrites++
    maxConcurrentWrites = Math.max(maxConcurrentWrites, concurrentWrites)
    if (addLogs.mock.calls.length === 1)
      await new Promise<void>((resolve) => {
        release = resolve
      })
    persistedMessages.push(...batch.map((log) => log.message))
    concurrentWrites--
  })
  const sink = createTraceStoreLogSink(store)
  active(() => sink(record('first')))
  await Promise.resolve()
  active(() => sink(record('second')))
  let flushed = false
  const firstFlush = sink.flush().then(() => {
    flushed = true
  })
  const secondFlush = sink.flush()
  active(() => sink(record('during flush')))
  expect(addLogs).toHaveBeenCalledTimes(1)
  expect(flushed).toBe(false)
  release()
  await Promise.all([firstFlush, secondFlush])
  expect(maxConcurrentWrites).toBe(1)
  expect(persistedMessages).toEqual(['first', 'second', 'during flush'])
  expect(addLogs).toHaveBeenCalledTimes(2)
  await sink.flush()
})
test('drops a failed batch once and continues without recursive capture', async () => {
  const store = createMemoryTraceStore()
  const persisted: Array<StoredLog> = []
  const addLogs = vi.spyOn(store, 'addLogs').mockRejectedValue(new Error('store unavailable'))
  const sink = createTraceStoreLogSink(store)
  const reports = vi.fn()
  await configure({
    sinks: { capture: sink, reports },
    loggers: [{ category: [], lowestLevel: 'info', sinks: ['capture', 'reports'] }],
  })
  await active(async () => {
    for (let batch = 0; batch < 3; batch++) {
      getLogger(['app']).info('failed batch')
      await sink.flush()
    }
    addLogs.mockImplementation(async (batch) => {
      persisted.push(...batch)
    })
    getLogger(['app']).info('recovered')
    await sink.flush()
  })
  expect(
    reports.mock.calls.filter(([log]) => log.category.join(':') === 'mokei:flow-host:capture'),
  ).toHaveLength(3)
  expect(addLogs).toHaveBeenCalledTimes(4)
  expect(persisted.map((log) => log.message)).toEqual(['recovered'])
})
