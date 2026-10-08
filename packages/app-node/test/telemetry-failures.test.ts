import { context, trace } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import type * as TraceSDK from '@opentelemetry/sdk-trace-base'
import * as logging from '@sozai/log'
import { createFileSink } from '@tejika/log'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import type * as Telemetry from '../src/telemetry.js'
import { useTestStores } from './support/stores.js'

const stores = useTestStores()

let setupMokeiTelemetry: typeof Telemetry.setupMokeiTelemetry

beforeEach(async () => {
  vi.resetModules()
  setupMokeiTelemetry = (await import('../src/telemetry.js')).setupMokeiTelemetry
})

const owned = vi.hoisted(() => ({
  forceFlush: vi.fn(async () => {}),
  shutdown: vi.fn(async () => {}),
  fileDispose: vi.fn(),
}))
vi.mock('@opentelemetry/sdk-trace-base', async (importOriginal) => {
  const actual = await importOriginal<typeof TraceSDK>()
  return {
    ...actual,
    BasicTracerProvider: vi.fn(function createProvider() {
      return {
        forceFlush: owned.forceFlush,
        shutdown: owned.shutdown,
        getTracer: vi.fn(),
      }
    }),
  }
})
vi.mock('@sozai/log', { spy: true })
vi.mock('@tejika/log', () => ({
  createFileSink: vi.fn(() => Object.assign(vi.fn(), { [Symbol.dispose]: owned.fileDispose })),
}))
afterEach(() => {
  vi.restoreAllMocks()
  logging.reset()
  trace.disable()
  context.disable()
  vi.clearAllMocks()
})

function thrownBy(action: () => unknown): unknown {
  try {
    action()
  } catch (error) {
    return error
  }
  throw new Error('Expected setup to throw')
}

test('rolls back rejected context registration without touching existing registrations', async () => {
  const { db } = await stores()
  const order: Array<string> = []
  const rival = new AsyncLocalStorageContextManager().enable()
  const register = context.setGlobalContextManager.bind(context)
  vi.spyOn(context, 'setGlobalContextManager').mockImplementation(() => {
    register(rival)
    return false
  })
  const disable = vi
    .spyOn(AsyncLocalStorageContextManager.prototype, 'disable')
    .mockImplementation(function (this: AsyncLocalStorageContextManager) {
      order.push('manager.disable')
      return this
    })
  owned.shutdown.mockImplementationOnce(async () => {
    order.push('shutdown')
  })
  const globalDisable = vi.spyOn(context, 'disable')
  expect(() => setupMokeiTelemetry({ provider: db })).toThrow(/context/i)
  expect(order).toEqual(['manager.disable', 'shutdown'])
  expect(disable.mock.instances[0]).not.toBe(rival)
  expect(globalDisable).not.toHaveBeenCalled()
  expect(createFileSink).not.toHaveBeenCalled()
  const key = Symbol('rival')
  context.with(context.active().setValue(key, true), () =>
    expect(context.active().getValue(key)).toBe(true),
  )
})

test('rolls back rejected provider registration without disabling the competing provider', async () => {
  const { db } = await stores()
  const order: Array<string> = []
  const rivalTracer = trace.getTracer('rival')
  const register = trace.setGlobalTracerProvider.bind(trace)
  vi.spyOn(trace, 'setGlobalTracerProvider').mockImplementation(() => {
    register({ getTracer: () => rivalTracer })
    return false
  })
  vi.spyOn(context, 'disable').mockImplementation(() => {
    order.push('context.disable')
  })
  const disable = vi.spyOn(trace, 'disable')
  owned.shutdown.mockImplementationOnce(async () => {
    order.push('shutdown')
  })
  expect(() => setupMokeiTelemetry({ provider: db })).toThrow(/provider/i)
  expect(order).toEqual(['context.disable', 'shutdown'])
  expect(disable).not.toHaveBeenCalled()
  expect(trace.getTracer('rival')).toBe(rivalTracer)
  expect(createFileSink).not.toHaveBeenCalled()
})

test('preserves a file factory error while reversing owned registrations', async () => {
  const { db } = await stores()
  const failure = new Error('file creation failed')
  const order: Array<string> = []
  vi.mocked(createFileSink).mockImplementationOnce(() => {
    throw failure
  })
  vi.spyOn(trace, 'disable').mockImplementation(() => {
    order.push('trace.disable')
  })
  vi.spyOn(context, 'disable').mockImplementation(() => {
    order.push('context.disable')
  })
  owned.shutdown.mockImplementationOnce(async () => {
    order.push('shutdown')
    throw new Error('cleanup failed')
  })
  expect(thrownBy(() => setupMokeiTelemetry({ provider: db }))).toBe(failure)
  expect(order).toEqual(['trace.disable', 'context.disable', 'shutdown'])
  expect(logging.reset).not.toHaveBeenCalled()
})

test('preserves a logging setup error and disposes the uninstalled file sink', async () => {
  const { db } = await stores()
  const failure = new Error('logging setup failed')
  const order: Array<string> = []
  vi.mocked(logging.setup).mockImplementationOnce(() => {
    throw failure
  })
  vi.mocked(logging.reset).mockImplementationOnce(() => {
    order.push('reset')
  })
  owned.fileDispose.mockImplementationOnce(() => {
    order.push('file.dispose')
  })
  vi.spyOn(trace, 'disable').mockImplementation(() => {
    order.push('trace.disable')
  })
  vi.spyOn(context, 'disable').mockImplementation(() => {
    order.push('context.disable')
  })
  owned.shutdown.mockImplementationOnce(async () => {
    order.push('shutdown')
  })
  expect(thrownBy(() => setupMokeiTelemetry({ provider: db }))).toBe(failure)
  expect(order).toEqual(['reset', 'file.dispose', 'trace.disable', 'context.disable', 'shutdown'])
  expect(owned.fileDispose).toHaveBeenCalledOnce()
})

test('attempts all disposal steps after failures', async () => {
  const { db } = await stores()
  const order: Array<string> = []
  const failures = ['flush', 'shutdown', 'recorder', 'reset', 'trace', 'context'].map(
    (step) => new Error(`${step} failed`),
  )
  const handle = setupMokeiTelemetry({ provider: db, logs: { file: false } })
  owned.forceFlush.mockImplementationOnce(async () => {
    order.push('forceFlush')
    throw failures[0]
  })
  owned.shutdown.mockImplementationOnce(async () => {
    order.push('shutdown')
    throw failures[1]
  })
  const recorderShutdown = vi
    .spyOn(handle.recorder, 'shutdown')
    .mockImplementationOnce(async () => {
      order.push('recorder.shutdown')
      throw failures[2]
    })
  vi.mocked(logging.reset).mockImplementationOnce(() => {
    order.push('reset')
    throw failures[3]
  })
  vi.spyOn(trace, 'disable').mockImplementationOnce(() => {
    order.push('trace.disable')
    throw failures[4]
  })
  vi.spyOn(context, 'disable').mockImplementationOnce(() => {
    order.push('context.disable')
    throw failures[5]
  })
  const disposal = handle.dispose()
  expect(handle.dispose()).toBe(disposal)
  await expect(disposal).rejects.toBeInstanceOf(AggregateError)
  await expect(disposal).rejects.toMatchObject({ errors: failures })
  expect(order).toEqual([
    'forceFlush',
    'shutdown',
    'recorder.shutdown',
    'reset',
    'trace.disable',
    'context.disable',
  ])
  expect(handle.dispose()).toBe(disposal)
  expect(owned.forceFlush).toHaveBeenCalledOnce()
  expect(owned.shutdown).toHaveBeenCalledOnce()
  expect(recorderShutdown).toHaveBeenCalledOnce()
  expect(() => setupMokeiTelemetry({ provider: db })).toThrow()
  recorderShutdown.mockRestore()
  await handle.recorder.shutdown()
})

test('bounds a stalled exporter shutdown and still drains local logs and registrations', async () => {
  const { db } = await stores()
  vi.useFakeTimers()
  const failure = new Error('remote flush failed')
  owned.forceFlush.mockRejectedValueOnce(failure)
  owned.shutdown.mockImplementationOnce(() => new Promise(() => {}))
  const handle = setupMokeiTelemetry({ provider: db, logs: { file: false } })
  const recorderShutdown = vi.spyOn(handle.recorder, 'shutdown')
  let result: unknown
  const disposal = handle.dispose().catch((error: unknown) => {
    result = error
  })
  try {
    await vi.advanceTimersByTimeAsync(10_000)
    expect(result).toBeInstanceOf(AggregateError)
    expect(result).toMatchObject({
      errors: [
        failure,
        expect.objectContaining({ message: 'Telemetry shutdown timed out after 10000ms' }),
      ],
    })
    expect(recorderShutdown).toHaveBeenCalledOnce()
    expect(logging.reset).toHaveBeenCalledOnce()
    expect(logging.isSetup()).toBe(false)
    await disposal
  } finally {
    vi.useRealTimers()
  }
})

test('reports a log store failure on the errors sink without capturing it', async () => {
  const { db, logStore } = await stores()
  vi.useFakeTimers()
  const write = vi.spyOn(db, 'withTransaction').mockRejectedValue(new Error('log write failed'))
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  const handle = setupMokeiTelemetry({ provider: db, logs: { file: false } })
  const span = trace.wrapSpanContext({
    traceId: '12345678901234567890123456789012',
    spanId: '1234567890123456',
    traceFlags: 1,
  })
  try {
    context.with(trace.setSpan(context.active(), span), () => {
      logging.getLogger(['application']).info('stored record')
    })
    const disposal = handle.dispose()
    await vi.advanceTimersByTimeAsync(6000)
    await disposal
    expect(
      errors.mock.calls.some((args) =>
        args.map(String).join(' ').includes('Dropped trace queue entries'),
      ),
    ).toBe(true)
    expect(write).toHaveBeenCalledTimes(4)
    expect(handle.recorder.info().droppedCount).toBe(1)
    expect(handle.recorder.snapshot().logs).toEqual([])
    expect(await logStore.getTraceLogs(span.spanContext().traceId)).toEqual([])
  } finally {
    await handle.dispose()
    vi.useRealTimers()
  }
})

test('routes report categories to the errors sink without storing them', async () => {
  const { db, logStore } = await stores()
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  const handle = setupMokeiTelemetry({
    provider: db,
    logs: { file: false },
    reportCategories: [['test', 'report']],
  })
  const traceID = '12345678901234567890123456789012'
  const span = trace.wrapSpanContext({
    traceId: traceID,
    spanId: '1234567890123456',
    traceFlags: 1,
  })
  context.with(trace.setSpan(context.active(), span), () => {
    logging.getLogger(['test', 'report']).info('below report level')
    logging.getLogger(['test', 'report']).error('report failure')
    logging.getLogger(['application']).info('application record')
  })
  try {
    await handle.dispose()
    expect(errors).toHaveBeenCalledOnce()
    expect(errors.mock.calls.flat().map(String).join(' ')).toContain('report failure')
    expect(await logStore.getTraceLogs(traceID)).toEqual([
      expect.objectContaining({ category: ['application'], message: 'application record' }),
    ])
  } finally {
    await handle.dispose()
  }
})
