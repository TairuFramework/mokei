import type { Client } from '@enkaku/client'
import type { Protocol } from '@mokei/host-protocol'
import { describe, expect, test, vi } from 'vitest'

import { createRemoteFlowControl, FlowControlError, type FlowEvent } from '../src/index.js'

type Listener = () => void

type StubStream = {
  push(value: unknown): void
  end(): void
  error(reason: unknown): void
  close: ReturnType<typeof vi.fn>
}

function createStubClient(handlers: Record<string, (config?: unknown) => unknown> = {}) {
  const calls: Array<string> = []
  const listeners = new Set<Listener>()
  const streams: Array<StubStream> = []
  const streamAt = (index: number): StubStream => {
    const stream = streams[index]
    if (stream == null) throw new Error(`no stream ${index}`)
    return stream
  }

  const request = vi.fn((procedure: string, config?: unknown) => {
    calls.push(procedure)
    const handler = handlers[procedure]
    try {
      return Promise.resolve(handler == null ? undefined : handler(config))
    } catch (error) {
      return Promise.reject(error)
    }
  })

  const createStream = vi.fn((procedure: string) => {
    calls.push(`stream:${procedure}`)
    let controller!: ReadableStreamDefaultController<unknown>
    const readable = new ReadableStream<unknown>({
      start(c) {
        controller = c
      },
    })
    let ended = false
    const end = () => {
      if (ended) return
      ended = true
      controller.close()
    }
    const close = vi.fn(() => end())
    const stub: StubStream = {
      push: (value) => controller.enqueue(value),
      end,
      error: (reason) => {
        ended = true
        controller.error(reason)
      },
      close,
    }
    streams.push(stub)
    return Object.assign(new Promise<void>(() => {}), { readable, close })
  })

  const events = {
    on: vi.fn((name: string, listener: Listener) => {
      if (name !== 'transportReplaced') return () => {}
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
  }

  const client = { request, createStream, events } as unknown as Client<Protocol>
  return {
    client,
    request,
    createStream,
    calls,
    streams,
    streamAt,
    listeners,
    replaceTransport: () => {
      for (const listener of [...listeners]) listener()
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const meta = { eventID: 'e1', time: 1 }
const snapshot = { runID: 'r1', state: 'running' } as const
const item = { id: 'i1', runID: 'r1' } as const

async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false
  void promise.then(
    () => {
      done = true
    },
    () => {
      done = true
    },
  )
  await new Promise((resolve) => setTimeout(resolve, 10))
  return done
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected rejection')
}

describe('createRemoteFlowControl', () => {
  test('maps each procedure', async () => {
    const stub = createStubClient({
      'runs.get': () => snapshot,
      'runs.start': () => snapshot,
      'runs.list': () => [snapshot],
      'runs.cancel': () => snapshot,
      'runs.trace': () => ({ spans: [], logs: [] }),
      'flows.list': () => [{ name: 'f' }],
      'flows.check': () => ({ value: {}, warnings: [], formatted: '' }),
      'inbox.list': () => [item],
      'inbox.get': () => item,
      'inbox.answer': () => ({ settled: true }),
      'inbox.decline': () => ({ settled: true }),
      'inbox.cancel': () => ({ settled: true }),
      'inbox.prompt': () => ({ action: 'accept' }),
    })
    const control = createRemoteFlowControl(stub.client)
    const signal = new AbortController().signal

    await expect(control.runs.get('r1')).resolves.toBe(snapshot)
    expect(stub.request).toHaveBeenLastCalledWith('runs.get', { param: { runID: 'r1' } })

    await expect(control.runs.start({ flow: 'f' })).resolves.toBe(snapshot)
    expect(stub.request).toHaveBeenLastCalledWith('runs.start', { param: { flow: 'f' } })

    await expect(control.runs.list({ limit: 2 })).resolves.toEqual([snapshot])
    expect(stub.request).toHaveBeenLastCalledWith('runs.list', { param: { limit: 2 } })
    await control.runs.list()
    expect(stub.request).toHaveBeenLastCalledWith('runs.list', { param: {} })

    await expect(control.runs.cancel('r1')).resolves.toBe(snapshot)
    expect(stub.request).toHaveBeenLastCalledWith('runs.cancel', { param: { runID: 'r1' } })

    await expect(control.runs.trace?.('r1')).resolves.toEqual({ spans: [], logs: [] })
    expect(stub.request).toHaveBeenLastCalledWith('runs.trace', { param: { runID: 'r1' } })

    await expect(control.flows.list()).resolves.toEqual([{ name: 'f' }])
    expect(stub.request).toHaveBeenLastCalledWith('flows.list')

    await control.flows.check({ id: 'x' })
    expect(stub.request).toHaveBeenLastCalledWith('flows.check', {
      param: { definition: { id: 'x' } },
    })

    await expect(control.inbox.list({ runID: 'r1' })).resolves.toEqual([item])
    expect(stub.request).toHaveBeenLastCalledWith('inbox.list', { param: { runID: 'r1' } })
    await control.inbox.list()
    expect(stub.request).toHaveBeenLastCalledWith('inbox.list', { param: {} })

    await expect(control.inbox.get('i1')).resolves.toBe(item)
    expect(stub.request).toHaveBeenLastCalledWith('inbox.get', { param: { id: 'i1' } })

    await expect(control.inbox.answer('i1', { ok: true })).resolves.toBeUndefined()
    expect(stub.request).toHaveBeenLastCalledWith('inbox.answer', {
      param: { id: 'i1', content: { ok: true } },
    })
    await control.inbox.answer('i1')
    expect(stub.request).toHaveBeenLastCalledWith('inbox.answer', { param: { id: 'i1' } })

    await expect(control.inbox.decline('i1', 'no')).resolves.toBeUndefined()
    expect(stub.request).toHaveBeenLastCalledWith('inbox.decline', {
      param: { id: 'i1', reason: 'no' },
    })

    await expect(control.inbox.cancel('i1')).resolves.toBeUndefined()
    expect(stub.request).toHaveBeenLastCalledWith('inbox.cancel', { param: { id: 'i1' } })

    await expect(control.inbox.prompt?.('i1', signal)).resolves.toBe('accept')
    expect(stub.request).toHaveBeenLastCalledWith('inbox.prompt', {
      param: { id: 'i1' },
      signal,
    })
  })

  test('maps handler errors', async () => {
    const stub = createStubClient({
      'runs.get': () => {
        throw { code: 'RUN_NOT_FOUND', message: 'm' }
      },
      'flows.check': () => {
        throw { code: 'FLOW_INVALID', message: 'bad', data: { issues: [{ message: 'i' }] } }
      },
      'inbox.get': () => {
        throw { code: 'RequestTimeout', message: 'slow' }
      },
      'inbox.cancel': () => {
        throw 'TransportDisposed'
      },
    })
    const control = createRemoteFlowControl(stub.client)

    const notFound = await caught(control.runs.get('r1'))
    expect(notFound).toBeInstanceOf(FlowControlError)
    expect(notFound).toMatchObject({ code: 'RUN_NOT_FOUND', message: 'm' })

    const invalid = await caught(control.flows.check({}))
    expect(invalid).toBeInstanceOf(FlowControlError)
    expect((invalid as FlowControlError).code).toBe('FLOW_INVALID')
    expect((invalid as FlowControlError).data).toEqual({ issues: [{ message: 'i' }] })

    const unknown = await caught(control.inbox.get('i1'))
    expect(unknown).toBeInstanceOf(FlowControlError)
    expect((unknown as FlowControlError).code).toBe('INTERNAL_ERROR')

    const lost = await caught(control.inbox.cancel('i1'))
    expect(lost).toBeInstanceOf(FlowControlError)
    expect((lost as FlowControlError).code).toBe('DISCONNECTED')
  })

  test('passes the abort reason through unchanged', async () => {
    const controller = new AbortController()
    const reason = new Error('stop')
    const stub = createStubClient({
      'inbox.prompt': () => {
        controller.abort(reason)
        throw 'AbortError'
      },
    })
    const control = createRemoteFlowControl(stub.client)
    await expect(control.inbox.prompt?.('i1', controller.signal)).rejects.toBe(reason)
  })

  test('subscribe waits for the info barrier', async () => {
    const info = deferred<unknown>()
    const stub = createStubClient({ info: () => info.promise })
    const control = createRemoteFlowControl(stub.client)

    const pending = control.subscribe()
    expect(await settled(pending)).toBe(false)
    expect(stub.calls).toEqual(['stream:events', 'info'])

    info.resolve({})
    const subscription = await pending
    subscription.close()
  })

  test('subscribe buffers and filters', async () => {
    const stub = createStubClient({ info: () => ({}) })
    const control = createRemoteFlowControl(stub.client)
    const subscription = await control.subscribe()
    const stream = stub.streamAt(0)

    const settledEvent = { item, outcome: 'answered' }
    stream.push({ type: 'context:start', meta, data: {} })
    stream.push({ type: 'run:state', meta, data: snapshot })
    stream.push({ type: 'service:status', meta, data: {} })
    stream.push({ type: 'inbox:added', meta, data: item })
    stream.push({ type: 'context:stop', meta })
    stream.push({ type: 'inbox:settled', meta, data: settledEvent })
    await new Promise((resolve) => setTimeout(resolve, 10))

    const received: Array<FlowEvent> = []
    for await (const event of subscription) {
      received.push(event)
      if (received.length === 3) break
    }
    expect(received).toEqual([
      { type: 'run:state', data: snapshot },
      { type: 'inbox:added', data: item },
      { type: 'inbox:settled', data: settledEvent },
    ])
    // Breaking out of the loop closes the subscription.
    expect(stream.close).toHaveBeenCalled()
  })

  test('subscribe ends with DISCONNECTED when the stream errors', async () => {
    const stub = createStubClient({ info: () => ({}) })
    const control = createRemoteFlowControl(stub.client)
    const subscription = await control.subscribe()
    stub.streamAt(0).push({ type: 'run:state', meta, data: snapshot })
    stub.streamAt(0).error(new Error('read failed'))

    const received: Array<FlowEvent> = []
    const error = await caught(
      (async () => {
        for await (const event of subscription) received.push(event)
      })(),
    )
    expect(received).toEqual([{ type: 'run:state', data: snapshot }])
    expect(error).toBeInstanceOf(FlowControlError)
    expect((error as FlowControlError).code).toBe('DISCONNECTED')
  })

  test('subscribe ends with DISCONNECTED when the stream ends on its own', async () => {
    const stub = createStubClient({ info: () => ({}) })
    const control = createRemoteFlowControl(stub.client)
    const subscription = await control.subscribe()
    stub.streamAt(0).end()

    const error = await caught(subscription[Symbol.asyncIterator]().next())
    expect((error as FlowControlError).code).toBe('DISCONNECTED')
  })

  test('subscribe ends with DISCONNECTED on transport replacement', async () => {
    const stub = createStubClient({ info: () => ({}) })
    const control = createRemoteFlowControl(stub.client)
    const subscription = await control.subscribe()
    const iterator = subscription[Symbol.asyncIterator]()
    const next = iterator.next()
    stub.replaceTransport()

    const error = await caught(next)
    expect(error).toBeInstanceOf(FlowControlError)
    expect((error as FlowControlError).code).toBe('DISCONNECTED')
    expect(stub.streamAt(0).close).toHaveBeenCalled()
    expect(stub.listeners.size).toBe(0)
  })

  test('closing after a disconnect discards buffered events and the failure', async () => {
    const stub = createStubClient({ info: () => ({}) })
    const control = createRemoteFlowControl(stub.client)
    const subscription = await control.subscribe()
    stub.streamAt(0).push({ type: 'run:state', meta, data: snapshot })
    await new Promise((resolve) => setTimeout(resolve, 10))
    stub.replaceTransport()
    subscription.close()

    const iterator = subscription[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
    expect(stub.streamAt(0).close).toHaveBeenCalledTimes(1)
  })

  test('a disconnect delivered to a pending read is reported once', async () => {
    const stub = createStubClient({ info: () => ({}) })
    const control = createRemoteFlowControl(stub.client)
    const subscription = await control.subscribe()
    const iterator = subscription[Symbol.asyncIterator]()
    const next = iterator.next()
    stub.replaceTransport()

    expect(((await caught(next)) as FlowControlError).code).toBe('DISCONNECTED')
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
  })

  test('subscribe rejects and closes the stream when the barrier fails', async () => {
    const stub = createStubClient({
      info: () => {
        throw 'TransportDisposed'
      },
    })
    const control = createRemoteFlowControl(stub.client)
    const error = await caught(control.subscribe())
    expect((error as FlowControlError).code).toBe('DISCONNECTED')
    expect(stub.streamAt(0).close).toHaveBeenCalled()
    expect(stub.listeners.size).toBe(0)
  })

  test('close stops iteration', async () => {
    const stub = createStubClient({ info: () => ({}) })
    const control = createRemoteFlowControl(stub.client)
    const subscription = await control.subscribe()
    const iterator = subscription[Symbol.asyncIterator]()
    const next = iterator.next()
    subscription.close()

    await expect(next).resolves.toEqual({ done: true, value: undefined })
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
    expect(stub.streamAt(0).close).toHaveBeenCalled()
    expect(stub.listeners.size).toBe(0)
    // Events and disconnection after close are ignored.
    stub.replaceTransport()
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
  })

  test('aborting the signal closes the subscription', async () => {
    const stub = createStubClient({ info: () => ({}) })
    const control = createRemoteFlowControl(stub.client)
    const controller = new AbortController()
    const subscription = await control.subscribe(controller.signal)
    const next = subscription[Symbol.asyncIterator]().next()
    controller.abort()

    await expect(next).resolves.toEqual({ done: true, value: undefined })
    expect(stub.streamAt(0).close).toHaveBeenCalled()
  })

  test('aborting before the barrier rejects with the abort reason', async () => {
    const info = deferred<unknown>()
    const stub = createStubClient({ info: () => info.promise })
    const control = createRemoteFlowControl(stub.client)
    const controller = new AbortController()
    const reason = new Error('stop')
    const pending = control.subscribe(controller.signal)
    controller.abort(reason)

    await expect(pending).rejects.toBe(reason)
    expect(stub.streamAt(0).close).toHaveBeenCalled()

    const already = await caught(control.subscribe(controller.signal))
    expect(already).toBe(reason)
  })
})
