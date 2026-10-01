/// <reference types="node" />

import { AsyncLocalStorage } from 'node:async_hooks'
import { createMemoryTaskStore } from '@mokei/context-server'
import type { Context } from '@opentelemetry/api'
import { context, ROOT_CONTEXT, trace } from '@opentelemetry/api'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import type { FlowDefinition } from '@sozai/flow-graph'
import {
  extractW3CTraceContext,
  formatTraceparent,
  parseTraceparent,
  SpanStatusCode,
  withActiveContext,
} from '@sozai/otel'
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'

import { createFlowHost } from '../src/host.js'
import { createMemoryRunStore } from '../src/run-store.js'
import { createFixture, echoFlow, emptyFlow } from './fixture.js'

const storage = new AsyncLocalStorage<Context>()
const exporter = new InMemorySpanExporter()
const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] })
const fixtures: Array<Awaited<ReturnType<typeof createFixture>>> = []
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
})
beforeEach(() => {
  trace.setGlobalTracerProvider(provider)
  exporter.reset()
})
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.dispose()
  vi.restoreAllMocks()
  trace.disable()
})
afterAll(async () => {
  await provider.shutdown()
  context.disable()
  storage.disable()
})
async function fixture(params: Parameters<typeof createFixture>[0] = {}) {
  const f = await createFixture(params)
  fixtures.push(f)
  return f
}
async function state(
  f: Awaited<ReturnType<typeof createFixture>>,
  runID: string,
  expected: string,
) {
  await vi.waitFor(async () => expect((await f.host.get(runID))?.state).toBe(expected))
  await provider.forceFlush()
}
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected fixture value')
  return value
}
const inputFlow: FlowDefinition = {
  ...emptyFlow,
  start: 'ask',
  nodes: {
    ask: {
      kind: 'input',
      prompt: { value: 'Choose' },
      schema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },
      next: 'done',
    },
    done: { kind: 'end', outcome: 'done' },
  },
}
test('flow.run span carries run attributes and ends with the run', async () => {
  const runStore = createMemoryRunStore()
  const f = await fixture({ flows: [emptyFlow], runStore })
  const run = await f.host.start({ flow: emptyFlow.id, label: 'Named run' })
  await state(f, run.runID, 'completed')
  const spans = exporter.getFinishedSpans().filter((span) => span.name === 'flow.run')
  expect(spans).toHaveLength(1)
  const span = required(spans[0])
  expect(span.instrumentationScope.name).toBe('mokei.flow-host')
  expect(span.attributes).toEqual({
    'run.id': run.runID,
    'flow.id': emptyFlow.id,
    'run.label': 'Named run',
  })
  expect(run.traceID).toBe(span.spanContext().traceId)
  expect((await runStore.get(run.runID))?.traceparent).toBe(
    formatTraceparent(
      span.spanContext().traceId,
      span.spanContext().spanId,
      span.spanContext().traceFlags,
    ),
  )
})
test('server spans share the run traceID and descend from flow.run', async () => {
  const f = await fixture()
  const run = await f.host.start({ definition: emptyFlow })
  await state(f, run.runID, 'completed')
  const spans = exporter.getFinishedSpans()
  const parent = required(spans.find((span) => span.name === 'flow.run'))
  const nodes = spans.filter((span) => span.name === 'flow.node')
  expect(nodes.length).toBeGreaterThan(0)
  expect(parent.attributes).not.toHaveProperty('flow.id')
  for (const node of nodes) {
    expect(node.spanContext().traceId).toBe(run.traceID)
    const ancestor = spans.find(
      (span) => span.spanContext().spanId === node.parentSpanContext?.spanId,
    )
    expect(
      ancestor === parent || ancestor?.parentSpanContext?.spanId === parent.spanContext().spanId,
    ).toBe(true)
  }
})
test('run.state events are recorded through input and completion', async () => {
  const f = await fixture()
  const run = await f.host.start({ definition: inputFlow })
  await state(f, run.runID, 'input_required')
  expect(exporter.getFinishedSpans().filter((span) => span.name === 'flow.run')).toEqual([])
  await f.host.inbox.answer(required(f.host.inbox.list()[0]).id, { value: 'Ada' })
  await state(f, run.runID, 'completed')
  const span = exporter.getFinishedSpans().find((span) => span.name === 'flow.run')
  const states = span?.events
    .filter((event) => event.name === 'run.state')
    .map((event) => event.attributes?.['run.state'])
  expect(states).toEqual(expect.arrayContaining(['working', 'input_required', 'completed']))
  expect(states?.at(-1)).toBe('completed')
})
test('failed run span has error status', async () => {
  const f = await fixture()
  vi.spyOn(f.session.contextHost.getContext('flow').client, 'callTool').mockRejectedValueOnce(
    new Error('Launch failed'),
  )
  const run = await f.host.start({ definition: emptyFlow })
  expect(run.state).toBe('failed')
  await provider.forceFlush()
  const span = exporter.getFinishedSpans().find((span) => span.name === 'flow.run')
  expect(span?.status.code).toBe(SpanStatusCode.ERROR)
  expect(span?.events.at(-1)).toMatchObject({
    name: 'run.state',
    attributes: { 'run.state': 'failed' },
  })
})
test.each(['denied', 'cancelled'] as const)(
  'queued approval span ends when %s',
  async (terminal) => {
    const f = await fixture({ flows: [echoFlow] })
    const run = await f.host.start({ flow: echoFlow.id })
    if (terminal === 'denied') await f.host.inbox.decline(`${run.runID}:approval`)
    else await f.host.cancel(run.runID)
    await state(f, run.runID, terminal)
    const span = exporter.getFinishedSpans().find((span) => span.name === 'flow.run')
    expect(span?.events.map((event) => event.attributes?.['run.state'])).toEqual([
      'awaiting_approval',
      terminal,
    ])
    expect(span?.status.code).not.toBe(SpanStatusCode.ERROR)
  },
)
test.each(['input', 'approval'] as const)(
  'resumed server spans keep the trace after %s recovery',
  async (kind) => {
    const shared = {
      runStore: createMemoryRunStore(),
      taskStore: createMemoryTaskStore(),
      flows: [echoFlow],
    }
    const first = await fixture(shared)
    const run = await first.host.start(
      kind === 'input' ? { definition: inputFlow } : { flow: echoFlow.id },
    )
    await state(first, run.runID, kind === 'input' ? 'input_required' : 'awaiting_approval')
    const stored = required(await shared.runStore.get(run.runID))
    expect(stored.traceparent).toBeDefined()
    if (kind === 'input')
      expect((await shared.taskStore.get(required(stored.taskID)))?.requestMeta?.traceparent).toBe(
        stored.traceparent,
      )
    await first.host.dispose()
    expect(exporter.getFinishedSpans().filter((span) => span.name === 'flow.run')).toHaveLength(1)
    const before = new Set(exporter.getFinishedSpans())
    const second = await fixture(shared)
    await vi.waitFor(() => expect(second.host.inbox.list()).toHaveLength(1))
    await second.host.inbox.answer(required(second.host.inbox.list()[0]).id, { value: 'Ada' })
    await state(second, run.runID, 'completed')
    const spans = exporter.getFinishedSpans().filter((span) => !before.has(span))
    const resumed = spans.find((span) => span.name === 'flow.run.resume')
    const parent = parseTraceparent(required(stored.traceparent))
    expect(resumed?.parentSpanContext).toMatchObject({
      traceId: run.traceID,
      spanId: parent?.spanID,
      isRemote: true,
    })
    expect(resumed?.spanContext().traceId).toBe(run.traceID)
    expect((await second.host.get(run.runID))?.traceID).toBe(run.traceID)
    const nodes = spans.filter((span) => span.name === 'flow.node')
    expect(nodes.length).toBeGreaterThan(0)
    for (const node of nodes) expect(node.spanContext().traceId).toBe(run.traceID)
  },
)
test('dispose ends open spans without terminating runs', async () => {
  const f = await fixture({ flows: [echoFlow] })
  const queued = await f.host.start({ flow: echoFlow.id })
  const waiting = await f.host.start({ definition: inputFlow })
  await state(f, waiting.runID, 'input_required')
  await f.host.dispose()
  await f.host.dispose()
  await provider.forceFlush()
  expect(exporter.getFinishedSpans().filter((span) => span.name === 'flow.run')).toHaveLength(2)
  expect((await f.host.get(queued.runID))?.state).toBe('awaiting_approval')
  expect((await f.host.get(waiting.runID))?.state).toBe('input_required')
})
test('recovery failure ends all run spans and stops the host', async () => {
  const runStore = createMemoryRunStore()
  const taskStore = createMemoryTaskStore()
  const f = await fixture({ flows: [echoFlow], runStore, taskStore })
  const queued = await f.host.start({ flow: echoFlow.id })
  const waiting = await f.host.start({ definition: inputFlow })
  await state(f, waiting.runID, 'input_required')
  const interrupted = await f.host.start({ flow: echoFlow.id })
  await f.host.dispose()
  for (const [run, createdAt] of [
    [queued, 3],
    [waiting, 2],
    [interrupted, 1],
  ] as const) {
    const record = required(await runStore.get(run.runID))
    await runStore.update(
      run.runID,
      { createdAt, ...(run === interrupted ? { state: 'working' } : {}) },
      { revision: record.revision },
    )
  }
  const failure = new Error('Recovery storage unavailable')
  const update = runStore.update.bind(runStore)
  vi.spyOn(runStore, 'update').mockImplementation(async (...args) => {
    if (args[0] === interrupted.runID) throw failure
    return update(...args)
  })
  let polls = 0
  const list = runStore.list.bind(runStore)
  vi.spyOn(runStore, 'list').mockImplementation(async (filter) => {
    const client = f.session.contextHost.getContext('flow').client
    const get = client.tasks.get.bind(client.tasks)
    vi.spyOn(client.tasks, 'get').mockImplementation(async (...args) => {
      polls += 1
      return get(...args)
    })
    return list(filter)
  })
  await expect(
    createFlowHost({ session: f.session, flows: [echoFlow], runStore, taskStore, pollMs: 1 }),
  ).rejects.toBe(failure)
  await provider.forceFlush()
  const spans = exporter.getFinishedSpans().filter((span) => span.name.startsWith('flow.run'))
  expect(spans.filter((span) => span.name === 'flow.run')).toHaveLength(3)
  const resumed = spans.filter((span) => span.name === 'flow.run.resume')
  expect(resumed).toHaveLength(3)
  expect(resumed.map((span) => span.attributes['run.id']).sort()).toEqual(
    [queued.runID, waiting.runID, interrupted.runID].sort(),
  )
  for (const span of spans) expect(span.ended).toBe(true)
  expect(f.session.contextHost.getContextKeys()).not.toContain('flow')
  expect(polls).toBeGreaterThan(0)
  const stoppedPolls = polls
  await new Promise((resolve) => setTimeout(resolve, 30))
  expect(polls).toBe(stoppedPolls)
  expect(await taskStore.list({ status: ['input_required'] })).toHaveLength(1)
})
test('without an SDK trace fields are absent and runs complete', async () => {
  trace.disable()
  const runStore = createMemoryRunStore()
  const f = await fixture({ runStore })
  const run = await f.host.start({ definition: emptyFlow })
  await state(f, run.runID, 'completed')
  expect(run).not.toHaveProperty('traceID')
  expect(await f.host.get(run.runID)).not.toHaveProperty('traceID')
  expect(await runStore.get(run.runID)).not.toHaveProperty('traceparent')
  expect(exporter.getFinishedSpans().filter((span) => span.name.startsWith('flow.run'))).toEqual([])
})

test('without an SDK an active remote parent does not create stored trace fields', async () => {
  trace.disable()
  const runStore = createMemoryRunStore()
  const f = await fixture({ runStore })
  const parent = extractW3CTraceContext({
    traceparent: '00-0af7651916cd43dd8448eb211c80319c-00f067aa0ba902b7-01',
  })
  const run = await withActiveContext(parent, () => f.host.start({ definition: emptyFlow }))
  await state(f, run.runID, 'completed')
  expect(run).not.toHaveProperty('traceID')
  expect(await runStore.get(run.runID)).not.toHaveProperty('traceparent')
})

test('starts independent root traces linked to the caller', async () => {
  const f = await fixture()
  const caller = trace.getTracer('caller').startSpan('caller')
  const [first, second] = await context.with(trace.setSpan(context.active(), caller), () =>
    Promise.all([f.host.start({ definition: emptyFlow }), f.host.start({ definition: emptyFlow })]),
  )
  expect(first.traceID).not.toBe(second.traceID)
  expect(first.traceID).not.toBe(caller.spanContext().traceId)
  await state(f, first.runID, 'completed')
  await state(f, second.runID, 'completed')
  const runSpans = exporter.getFinishedSpans().filter((span) => span.name === 'flow.run')
  expect(runSpans).toHaveLength(2)
  expect(runSpans.every((span) => span.parentSpanContext === undefined)).toBe(true)
  expect(runSpans[0]?.links[0]?.context).toEqual(caller.spanContext())
  expect(runSpans[1]?.links[0]?.context).toEqual(caller.spanContext())
  caller.end()
})

test('ignores an invalid caller span link', async () => {
  const f = await fixture()
  const invalid = trace.setSpanContext(ROOT_CONTEXT, {
    traceId: '0'.repeat(32),
    spanId: '0'.repeat(16),
    traceFlags: 1,
  })
  const run = await context.with(invalid, () => f.host.start({ definition: emptyFlow }))
  await state(f, run.runID, 'completed')
  const span = required(exporter.getFinishedSpans().find((span) => span.name === 'flow.run'))
  expect(span.parentSpanContext).toBeUndefined()
  expect(span.links).toEqual([])
})
