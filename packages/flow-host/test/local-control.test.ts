import { type FlowRunSnapshot, isFlowControlError } from '@mokei/flow-client'
import type { FlowDefinition } from '@sozai/flow-graph'
import { afterEach, expect, test, vi } from 'vitest'

import { createLocalFlowControl } from '../src/local-control.js'
import { createFixture, emptyFlow } from './fixture.js'

const inputFlow: FlowDefinition = {
  id: 'input',
  name: 'Input',
  version: 1,
  start: 'ask',
  nodes: {
    ask: {
      kind: 'input',
      prompt: { value: 'Choose' },
      schema: {
        type: 'object',
        properties: { value: { type: 'string' } },
        required: ['value'],
      },
      next: 'done',
    },
    done: { kind: 'end', outcome: 'done' },
  },
}

const fixtures: Array<Awaited<ReturnType<typeof createFixture>>> = []
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.dispose()))
})
async function setup(flows = [emptyFlow, inputFlow]) {
  const f = await createFixture({ flows })
  fixtures.push(f)
  return { ...f, control: createLocalFlowControl(f.host) }
}
async function rejection(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('Expected rejection')
}

test('runs.get matches host.get and missing rejects RUN_NOT_FOUND', async () => {
  const { host, control } = await setup()
  const started = await control.runs.start({ flow: 'empty', input: { name: 'x' } })
  const snapshot: FlowRunSnapshot = await control.runs.get(started.runID)
  expect(snapshot).toEqual(await host.get(started.runID))
  const error = await rejection(control.runs.get('missing'))
  expect(isFlowControlError(error, 'RUN_NOT_FOUND')).toBe(true)
})

test('inbox get and answer reject INBOX_ITEM_NOT_FOUND for unknown ids', async () => {
  const { control } = await setup()
  expect(
    isFlowControlError(await rejection(control.inbox.get('missing')), 'INBOX_ITEM_NOT_FOUND'),
  ).toBe(true)
  expect(
    isFlowControlError(await rejection(control.inbox.answer('missing')), 'INBOX_ITEM_NOT_FOUND'),
  ).toBe(true)
  expect(
    isFlowControlError(await rejection(control.inbox.decline('missing')), 'INBOX_ITEM_NOT_FOUND'),
  ).toBe(true)
  expect(
    isFlowControlError(await rejection(control.inbox.cancel('missing')), 'INBOX_ITEM_NOT_FOUND'),
  ).toBe(true)
})

test('invalid inline definition rejects FLOW_INVALID with issues', async () => {
  const { control } = await setup()
  const error = await rejection(control.runs.start({ definition: { id: 'bad' } as never }))
  expect(isFlowControlError(error, 'FLOW_INVALID')).toBe(true)
  expect(Array.isArray((error as { data?: { issues?: unknown } }).data?.issues)).toBe(true)
})

test('unknown flow rejects FLOW_NOT_FOUND', async () => {
  const { control } = await setup()
  const error = await rejection(control.runs.start({ flow: 'nope' }))
  expect(isFlowControlError(error, 'FLOW_NOT_FOUND')).toBe(true)
})

test('flows.check projects issues, and value for valid definitions', async () => {
  const { control } = await setup()
  const invalid = await control.flows.check({ id: 'bad' })
  expect(Object.keys(invalid).sort()).toEqual(['formatted', 'issues', 'warnings'])
  expect('issues' in invalid && Array.isArray(invalid.issues)).toBe(true)
  const valid = await control.flows.check(emptyFlow)
  expect(Object.keys(valid).sort()).toEqual(['formatted', 'value', 'warnings'])
  expect(await control.flows.list()).toHaveLength(2)
})

test('subscribe yields events emitted after it resolves and close unregisters', async () => {
  const { host, control } = await setup()
  const subscription = await control.subscribe()
  const started = await control.runs.start({ flow: 'input' })
  const iterator = subscription[Symbol.asyncIterator]()
  const types: Array<string> = []
  while (!types.includes('inbox:added')) {
    const next = await iterator.next()
    expect(next.done).toBe(false)
    if (next.value != null) types.push(next.value.type)
  }
  expect(types).toContain('run:state')
  const item = host.inbox.list({ runID: started.runID })[0]
  if (item == null) throw new Error('Expected inbox item')
  await control.inbox.answer(item.id, { value: 'a' })
  let settled = false
  while (!settled) {
    const next = await iterator.next()
    if (next.value?.type === 'inbox:settled') settled = true
  }
  subscription.close()
  expect(await iterator.next()).toEqual({ done: true, value: undefined })
  // Closed: later events do not reach (or buffer in) the subscription.
  await control.runs.start({ flow: 'empty', input: { name: 'y' } })
  expect(await iterator.next()).toEqual({ done: true, value: undefined })
})

test('abort signal closes the subscription', async () => {
  const { control } = await setup()
  const controller = new AbortController()
  const subscription = await control.subscribe(controller.signal)
  const iterator = subscription[Symbol.asyncIterator]()
  const pendingNext = iterator.next()
  controller.abort()
  expect(await pendingNext).toEqual({ done: true, value: undefined })
})

test('trace and prompt exist only when passed in extras', async () => {
  const { host, control } = await setup()
  expect(control.runs.trace).toBeUndefined()
  expect(control.inbox.prompt).toBeUndefined()
  const trace = vi.fn(async () => ({ spans: [], logs: [] }))
  const prompt = vi.fn(async () => 'accept' as const)
  const extended = createLocalFlowControl(host, { trace, prompt })
  expect(extended.runs.trace).toBe(trace)
  expect(extended.inbox.prompt).toBe(prompt)
})

test('subscribe rejects with the abort reason when already aborted', async () => {
  const { control } = await setup()
  const reason = new Error('stop')
  await expect(control.subscribe(AbortSignal.abort(reason))).rejects.toBe(reason)
})
