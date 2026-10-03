/// <reference types="node" />

import { AsyncLocalStorage } from 'node:async_hooks'
import type { LogRecord } from '@logtape/logtape'
import { configure, getLogger, reset } from '@logtape/logtape'
import { createMemoryTaskStore } from '@mokei/context-server'
import * as wiringModule from '@mokei/decision-flow-server'
import type { Context } from '@opentelemetry/api'
import { context, ROOT_CONTEXT, trace } from '@opentelemetry/api'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import type { FlowDefinition } from '@sozai/flow-graph'
import { parseTraceparent } from '@sozai/otel'
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'

import { createMemoryRunStore } from '../src/run-store.js'
import type { FlowHost, FlowHostParams } from '../src/types.js'
import { createFixture, echoFlow } from './fixture.js'

const storage = new AsyncLocalStorage<Context>()
const exporter = new InMemorySpanExporter()
const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] })
const fixtures: Array<Awaited<ReturnType<typeof createFixture>>> = []
const logs: Array<{ record: LogRecord; traceID: string | undefined }> = []
const logger = getLogger(['mokei', 'run-context-test'])
beforeAll(() => {
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
      return this
    },
  })
  trace.setGlobalTracerProvider(provider)
})
beforeEach(async () => {
  exporter.reset()
  logs.length = 0
  await configure({
    sinks: {
      capture: (record) => {
        logs.push({ record, traceID: trace.getSpan(context.active())?.spanContext().traceId })
      },
    },
    loggers: [{ category: ['mokei'], lowestLevel: 'debug', sinks: ['capture'] }],
  })
})
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.dispose()
  vi.restoreAllMocks()
  await reset()
})
afterAll(async () => {
  await provider.shutdown()
  trace.disable()
  context.disable()
  storage.disable()
})
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected fixture value')
  return value
}
async function fixture(params: Parameters<typeof createFixture>[0] = {}) {
  const f = await createFixture(params)
  fixtures.push(f)
  return f
}
const inputFlow: FlowDefinition = {
  id: 'input',
  name: 'Input',
  version: 1,
  start: 'ask',
  nodes: {
    ask: {
      kind: 'input',
      prompt: { value: 'Choose' },
      schema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },
      next: 'done',
      decline: { to: 'declined' },
    },
    done: { kind: 'end', outcome: 'done' },
    declined: { kind: 'end', outcome: 'declined' },
  },
}
const listeners: FlowHostParams['listeners'] = {
  'run:state': async (run) => {
    await Promise.resolve()
    logger.info('state', { runID: run.runID, state: run.state })
  },
  'inbox:added': async (item) => {
    await Promise.resolve()
    logger.info('added', { runID: item.runID })
  },
  'inbox:settled': async ({ item }) => {
    await Promise.resolve()
    logger.info('settled', { runID: item.runID })
  },
}
async function pending(host: FlowHost, runID: string) {
  await vi.waitFor(() => expect(host.inbox.list({ runID })).toHaveLength(1))
  return required(host.inbox.list({ runID })[0])
}
async function state(host: FlowHost, runID: string, expected: string) {
  await vi.waitFor(async () => expect((await host.get(runID))?.state).toBe(expected))
}
function correlated(runID: string, traceID: string | undefined) {
  expect(traceID).toBeDefined()
  const markers = logs.filter(({ record }) => record.properties.runID === runID)
  expect(markers.length).toBeGreaterThan(0)
  for (const marker of markers)
    expect(marker.traceID, String(marker.record.rawMessage)).toBe(traceID)
}
function marked(runID: string, message: string) {
  expect(
    logs.some(({ record }) => record.properties.runID === runID && record.rawMessage === message),
  ).toBe(true)
}

test('correlates concurrent watcher inbox and terminal listener work after awaits', async () => {
  const runStore = createMemoryRunStore()
  const f = await fixture({ runStore, listeners })
  const client = f.session.contextHost.getContext('flow').client
  const get = client.tasks.get.bind(client.tasks)
  const update = client.tasks.update.bind(client.tasks)
  const cancel = client.tasks.cancel.bind(client.tasks)
  const owners = new Map<string, string>()
  const readTasks = new Set<string>()
  let failed = false
  let urlCancelled = false
  let urlTaskID: string | undefined
  vi.spyOn(client.tasks, 'get').mockImplementation(async (taskID) => {
    const task = await get(taskID)
    const initial = !readTasks.has(taskID)
    readTasks.add(taskID)
    const runID = owners.get(taskID)
    if (runID !== undefined) {
      logger.info('poll', { runID })
      if (!initial && !failed) {
        failed = true
        throw new Error('Injected poll failure')
      }
      if (taskID === urlTaskID && !urlCancelled && task.status === 'input_required') {
        return {
          ...task,
          inputRequests: {
            url: {
              method: 'elicitation/create',
              params: {
                mode: 'url',
                message: 'Open',
                url: 'https://example.com',
                elicitationId: 'url-input',
              },
            },
          },
        }
      }
    }
    return task
  })
  vi.spyOn(client.tasks, 'update').mockImplementation(async (taskID, responses) => {
    await Promise.resolve()
    const runID = required(owners.get(taskID))
    if ('url' in responses) {
      urlCancelled = true
      logger.info('url update', { runID })
      return { resultType: 'complete' }
    }
    logger.info('answer update', { runID })
    return update(taskID, responses)
  })
  vi.spyOn(client.tasks, 'cancel').mockImplementation(async (taskID) => {
    await Promise.resolve()
    logger.info('cancel task', { runID: required(owners.get(taskID)) })
    return cancel(taskID)
  })
  const [first, second] = await Promise.all([
    f.host.start({ definition: inputFlow }),
    f.host.start({ definition: { ...inputFlow, id: 'other-input' } }),
  ])
  owners.set(required((await runStore.get(first.runID))?.taskID), first.runID)
  urlTaskID = required((await runStore.get(second.runID))?.taskID)
  owners.set(urlTaskID, second.runID)
  await vi.waitFor(() => expect(urlCancelled).toBe(true))
  const a = await pending(f.host, first.runID)
  await pending(f.host, second.runID)
  await Promise.all([f.host.inbox.answer(a.id, { value: 'Ada' }), f.host.cancel(second.runID)])
  await state(f.host, first.runID, 'completed')
  await state(f.host, second.runID, 'cancelled')
  await vi.waitFor(() => {
    for (const run of [first, second]) {
      marked(run.runID, 'state')
      marked(run.runID, 'added')
      marked(run.runID, 'settled')
      expect(
        logs.some(
          ({ record }) =>
            record.properties.runID === run.runID &&
            record.properties.state === (run === first ? 'completed' : 'cancelled'),
        ),
      ).toBe(true)
    }
  })
  marked(first.runID, 'answer update')
  marked(second.runID, 'url update')
  marked(second.runID, 'cancel task')
  expect(logs.some(({ record }) => String(record.rawMessage).startsWith('Task poll failed'))).toBe(
    true,
  )
  expect(logs.some(({ record }) => String(record.rawMessage).startsWith('Cancelling URL'))).toBe(
    true,
  )
  await provider.forceFlush()
  for (const run of [first, second]) {
    const span = required(
      exporter
        .getFinishedSpans()
        .find((span) => span.name === 'flow.run' && span.attributes['run.id'] === run.runID),
    )
    expect(span.ended).toBe(true)
  }
  correlated(first.runID, first.traceID)
  correlated(second.runID, second.traceID)
  logger.info('outside')
  expect(logs.at(-1)).toMatchObject({ record: { rawMessage: 'outside' }, traceID: undefined })
  expect(trace.getSpan(context.active())).toBeUndefined()
})

test('correlates resumed recovery failures and inbox work', async () => {
  const shared = { runStore: createMemoryRunStore(), taskStore: createMemoryTaskStore() }
  const first = await fixture(shared)
  const waiting = await first.host.start({ definition: inputFlow })
  const failing = await first.host.start({ definition: echoFlow })
  await pending(first.host, waiting.runID)
  const stored = required(await shared.runStore.get(waiting.runID))
  const requestMeta = required((await shared.taskStore.get(required(stored.taskID)))?.requestMeta)
  await first.host.dispose()
  const failedRecord = required(await shared.runStore.get(failing.runID))
  await shared.runStore.update(
    failing.runID,
    { state: 'working' },
    { revision: failedRecord.revision },
  )
  const list = shared.taskStore.list.bind(shared.taskStore)
  vi.spyOn(shared.taskStore, 'list').mockImplementation(async (filter) => {
    if (filter.status?.includes('completed')) {
      await Promise.resolve()
      logger.info('recovery lookup', { runID: failing.runID })
      throw new Error('Injected recovery failure')
    }
    return list(filter)
  })
  const add = wiringModule.addDecisionFlow
  vi.spyOn(wiringModule, 'addDecisionFlow').mockImplementation(async (...args) => {
    const wiring = await add(...args)
    const client = args[0].contextHost.getContext(args[1].key).client
    const update = client.tasks.update.bind(client.tasks)
    vi.spyOn(client.tasks, 'update').mockImplementation(async (...updateArgs) => {
      await Promise.resolve()
      logger.info('recovered update', { runID: waiting.runID })
      return update(...updateArgs)
    })
    return wiring
  })
  const before = new Set(exporter.getFinishedSpans())
  logs.length = 0
  const second = await fixture({ ...shared, listeners })
  const item = await pending(second.host, waiting.runID)
  await second.host.inbox.answer(item.id, { value: 'Ada' })
  await state(second.host, waiting.runID, 'completed')
  await state(second.host, failing.runID, 'failed')
  marked(waiting.runID, 'recovered update')
  marked(waiting.runID, 'added')
  marked(waiting.runID, 'settled')
  marked(failing.runID, 'recovery lookup')
  expect(
    logs.some(({ record }) => String(record.rawMessage).startsWith('Run recovery failed')),
  ).toBe(true)
  correlated(waiting.runID, waiting.traceID)
  correlated(failing.runID, failing.traceID)
  await provider.forceFlush()
  const spans = exporter.getFinishedSpans().filter((span) => !before.has(span))
  const resumed = required(
    spans.find(
      (span) => span.name === 'flow.run.resume' && span.attributes['run.id'] === waiting.runID,
    ),
  )
  expect(resumed.parentSpanContext).toMatchObject({
    traceId: waiting.traceID,
    spanId: parseTraceparent(required(stored.traceparent))?.spanID,
    isRemote: true,
  })
  const nodes = spans.filter((span) => span.name === 'flow.node')
  expect(nodes.length).toBeGreaterThan(0)
  for (const node of nodes) expect(node.spanContext().traceId).toBe(waiting.traceID)
  const taskSpans = spans.filter(
    (span) =>
      span.parentSpanContext?.spanId ===
      parseTraceparent(required(requestMeta.traceparent as string | undefined))?.spanID,
  )
  expect(taskSpans.some((span) => span.name !== 'flow.run.resume')).toBe(true)
  expect((await shared.taskStore.get(required(stored.taskID)))?.requestMeta).toEqual(requestMeta)
  logger.info('outside recovery')
  expect(logs.at(-1)?.traceID).toBeUndefined()
})
