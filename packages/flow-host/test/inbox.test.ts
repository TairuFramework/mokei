import type { InputRequest } from '@mokei/context-protocol'
import type { FlowDefinition } from '@sozai/flow-graph'
import { afterEach, expect, test, vi } from 'vitest'

import { InboxAnswerInvalidError, InboxItemNotFoundError } from '../src/errors.js'
import type { FlowHost, InboxItem } from '../src/types.js'
import { createFixture, deferred } from './fixture.js'

const schema = {
  type: 'object' as const,
  properties: { value: { type: 'string' as const } },
  required: ['value'],
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
      schema,
      next: 'done',
      decline: { to: 'declined' },
    },
    done: { kind: 'end', outcome: 'done', output: { answer: { ref: ['results', 'ask'] } } },
    declined: {
      kind: 'end',
      outcome: 'declined',
      output: { action: { ref: ['results', 'ask', 'declined'] } },
    },
    timed: { kind: 'end', outcome: 'timed' },
  },
}
const fixtures: Array<Awaited<ReturnType<typeof createFixture>>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(fixtures.splice(0).map((f) => f.dispose()))
})
async function fixture() {
  const f = await createFixture()
  fixtures.push(f)
  return f
}
async function pending(
  host: FlowHost,
  runID: string,
): Promise<Extract<InboxItem, { kind: 'input' }>> {
  await vi.waitFor(() => expect(host.inbox.list({ runID })).toHaveLength(1))
  const item = host.inbox.list({ runID })[0]
  if (item?.kind !== 'input') throw new Error('Expected input')
  return item
}
async function completed(host: FlowHost, runID: string) {
  await vi.waitFor(async () => expect((await host.get(runID))?.state).toBe('completed'))
  return host.get(runID)
}
test('input appears once and a valid answer resumes the run', async () => {
  const { host, elicit } = await fixture()
  const added = vi.fn()
  const settled = vi.fn()
  host.events.on('inbox:added', added)
  host.events.on('inbox:settled', settled)
  const run = await host.start({ definition: inputFlow })
  const item = await pending(host, run.runID)
  expect(item).toMatchObject({
    id: `${run.runID}:${item.inputKey}`,
    kind: 'input',
    message: 'Choose',
    requestedSchema: schema,
  })
  expect((await host.get(run.runID))?.state).toBe('input_required')
  await host.inbox.answer(item.id, { value: 'Ada' })
  expect(await completed(host, run.runID)).toMatchObject({
    result: { outcome: 'done', output: { answer: { value: 'Ada' } } },
  })
  expect(added).toHaveBeenCalledTimes(1)
  expect(settled).toHaveBeenCalledExactlyOnceWith({ item, outcome: 'answered' })
  expect(elicit).not.toHaveBeenCalled()
  await expect(host.inbox.answer(item.id, { value: 'again' })).rejects.toBeInstanceOf(
    InboxItemNotFoundError,
  )
})
test('invalid answers leave the input open with portable validation issues', async () => {
  const { host } = await fixture()
  const run = await host.start({ definition: inputFlow })
  const item = await pending(host, run.runID)
  await expect(host.inbox.answer(item.id, {})).rejects.toBeInstanceOf(InboxAnswerInvalidError)
  await expect(host.inbox.answer(item.id, {})).rejects.toMatchObject({
    issues: ['value: required'],
  })
  expect(host.inbox.get(item.id)).toEqual(item)
})
test.each(['decline', 'cancel'] as const)(
  '%s reaches the flow as its own action',
  async (action) => {
    const { host } = await fixture()
    const settled = vi.fn()
    host.events.on('inbox:settled', settled)
    const run = await host.start({ definition: inputFlow })
    const item = await pending(host, run.runID)
    await host.inbox[action](item.id)
    expect(await completed(host, run.runID)).toMatchObject({
      result: { outcome: 'declined', output: { action } },
    })
    expect(settled).toHaveBeenCalledExactlyOnceWith({
      item,
      outcome: action === 'decline' ? 'declined' : 'cancelled',
    })
  },
)
test('an expired input settles withdrawn', async () => {
  const { host } = await fixture()
  const settled = vi.fn()
  host.events.on('inbox:settled', settled)
  const run = await host.start({
    definition: {
      ...inputFlow,
      nodes: {
        ...inputFlow.nodes,
        ask: {
          kind: 'input',
          prompt: { value: 'Choose' },
          schema,
          next: 'done',
          timeout: { afterMs: 200, to: 'timed' },
        },
      },
    },
  })
  const item = await pending(host, run.runID)
  expect(await completed(host, run.runID)).toMatchObject({ result: { outcome: 'timed' } })
  expect(settled).toHaveBeenCalledExactlyOnceWith({ item, outcome: 'withdrawn' })
  expect(host.inbox.get(item.id)).toBeUndefined()
})
test('polls cannot withdraw or re-list an input while its answer is in flight', async () => {
  const { host, session } = await fixture()
  const settled = vi.fn()
  const added = vi.fn()
  host.events.on('inbox:settled', settled)
  host.events.on('inbox:added', added)
  const client = session.contextHost.getContext('flow').client
  const run = await host.start({ definition: inputFlow })
  const item = await pending(host, run.runID)
  const get = client.tasks.get.bind(client.tasks)
  const update = client.tasks.update.bind(client.tasks)
  const gate = deferred<void>()
  const entered = deferred<void>()
  vi.spyOn(client.tasks, 'update').mockImplementation(async (...args) => {
    entered.resolve()
    await gate.promise
    return update(...args)
  })
  const answer = host.inbox.answer(item.id, { value: 'Ada' })
  await entered.promise
  expect(host.inbox.get(item.id)).toBeUndefined()
  for (const action of ['answer', 'decline', 'cancel'] as const) {
    await expect(host.inbox[action](item.id)).rejects.toBeInstanceOf(InboxItemNotFoundError)
  }
  const polled = vi.spyOn(client.tasks, 'get').mockImplementation(async (taskID) => {
    const task = await get(taskID)
    return task.status === 'input_required' ? { ...task, inputRequests: {} } : task
  })
  await vi.waitFor(() => expect(polled.mock.calls.length).toBeGreaterThanOrEqual(2))
  expect(settled).not.toHaveBeenCalled()
  expect(host.inbox.list()).toEqual([])
  polled.mockClear().mockImplementation(get)
  await vi.waitFor(() => expect(polled.mock.calls.length).toBeGreaterThanOrEqual(2))
  expect(host.inbox.list()).toEqual([])
  expect(added).toHaveBeenCalledTimes(1)
  expect(settled).not.toHaveBeenCalled()
  gate.resolve()
  await answer
  await completed(host, run.runID)
  expect(added).toHaveBeenCalledTimes(1)
  expect(settled).toHaveBeenCalledExactlyOnceWith({ item, outcome: 'answered' })
})
test('a transport update error reopens the item for retry', async () => {
  const { host, session } = await fixture()
  const run = await host.start({ definition: inputFlow })
  const item = await pending(host, run.runID)
  vi.spyOn(session.contextHost.getContext('flow').client.tasks, 'update').mockRejectedValueOnce(
    new Error('Transport failed'),
  )
  await expect(host.inbox.answer(item.id, { value: 'Ada' })).rejects.toThrow('Transport failed')
  expect(host.inbox.get(item.id)).toEqual(item)
  await host.inbox.answer(item.id, { value: 'Ada' })
  await completed(host, run.runID)
})
test.each(['cancelled', 'completed', 'withdrawn'] as const)(
  'a failed answer never reopens an input after %s',
  async (outcome) => {
    const { host, session } = await fixture()
    const settled = vi.fn()
    host.events.on('inbox:settled', settled)
    const run = await host.start({ definition: inputFlow })
    const item = await pending(host, run.runID)
    const client = session.contextHost.getContext('flow').client
    const entered = deferred<void>()
    const update = deferred<{ resultType: 'complete' }>()
    vi.spyOn(client.tasks, 'update').mockImplementation(async () => {
      entered.resolve()
      return update.promise
    })
    const answer = expect(host.inbox.answer(item.id, { value: 'Ada' })).rejects.toThrow(
      'Transport failed',
    )
    await entered.promise
    if (outcome === 'cancelled') {
      expect((await host.cancel(run.runID)).state).toBe('cancelled')
    } else {
      const get = client.tasks.get.bind(client.tasks)
      const polled = vi.spyOn(client.tasks, 'get').mockImplementation(async (taskID) => {
        const task = await get(taskID)
        return outcome === 'completed'
          ? { ...task, status: 'completed', result: { resultType: 'complete', content: [] } }
          : { ...task, status: 'input_required', inputRequests: {} }
      })
      if (outcome === 'completed') await completed(host, run.runID)
      else await vi.waitFor(() => expect(polled.mock.calls.length).toBeGreaterThanOrEqual(2))
    }
    expect(settled).not.toHaveBeenCalled()
    update.reject(new Error('Transport failed'))
    await answer
    expect(host.inbox.list({ runID: run.runID })).toEqual([])
    expect(settled).toHaveBeenCalledExactlyOnceWith({
      item,
      outcome: outcome === 'cancelled' ? 'cancelled' : 'withdrawn',
    })
    await expect(host.inbox.answer(item.id, { value: 'again' })).rejects.toBeInstanceOf(
      InboxItemNotFoundError,
    )
  },
)
test('a key no longer awaited settles withdrawn and rejects with not found', async () => {
  const { host, session } = await fixture()
  const settled = vi.fn()
  host.events.on('inbox:settled', settled)
  const run = await host.start({ definition: inputFlow })
  const item = await pending(host, run.runID)
  vi.spyOn(session.contextHost.getContext('flow').client.tasks, 'update').mockRejectedValueOnce({
    code: -32602,
    message: 'Key no longer awaited',
  })
  await expect(host.inbox.answer(item.id, { value: 'Ada' })).rejects.toBeInstanceOf(
    InboxItemNotFoundError,
  )
  expect(host.inbox.list()).toEqual([])
  expect(settled).toHaveBeenCalledExactlyOnceWith({ item, outcome: 'withdrawn' })
  await host.cancel(run.runID)
})
test('inbox lists inputs for the requested run', async () => {
  const { host } = await fixture()
  const first = await host.start({ definition: inputFlow })
  const second = await host.start({ definition: inputFlow })
  const a = await pending(host, first.runID)
  const b = await pending(host, second.runID)
  expect(host.inbox.list()).toEqual(expect.arrayContaining([a, b]))
  expect(host.inbox.list({ runID: first.runID })).toEqual([a])
})
const taskBase = {
  createdAt: new Date(0).toISOString(),
  lastUpdatedAt: new Date(1).toISOString(),
  ttlMs: null,
  resultType: 'complete' as const,
}
async function synthetic(request: InputRequest) {
  const f = await fixture()
  const client = f.session.contextHost.getContext('flow').client
  const snapshot = {
    ...taskBase,
    status: 'input_required' as const,
    inputRequests: { unsupported: request },
  }
  const get = vi
    .spyOn(client.tasks, 'get')
    .mockImplementation(async (taskID) => ({ ...snapshot, taskId: taskID }))
  return { ...f, client, get }
}
test('URL elicitation is cancelled without listing an item', async () => {
  const { host, client, get } = await synthetic({
    method: 'elicitation/create',
    params: {
      mode: 'url',
      message: 'Open',
      url: 'https://example.com',
      elicitationId: 'url-input',
    },
  })
  const update = vi.spyOn(client.tasks, 'update').mockResolvedValue({ resultType: 'complete' })
  const added = vi.fn()
  host.events.on('inbox:added', added)
  await host.start({ definition: inputFlow })
  await vi.waitFor(() =>
    expect(update).toHaveBeenCalledWith(get.mock.calls[0]?.[0], {
      unsupported: { action: 'cancel' },
    }),
  )
  expect(host.inbox.list()).toEqual([])
  expect(added).not.toHaveBeenCalled()
})
test.each([
  { method: 'sampling/createMessage', params: { messages: [], maxTokens: 10 } },
  { method: 'roots/list', params: {} },
] satisfies Array<InputRequest>)(
  'unsupported $method fails the run and cancels its task',
  async (request) => {
    const { host, client, get } = await synthetic(request)
    const cancel = vi.spyOn(client.tasks, 'cancel').mockResolvedValue({ resultType: 'complete' })
    const run = await host.start({ definition: inputFlow })
    await vi.waitFor(async () =>
      expect(await host.get(run.runID)).toMatchObject({
        state: 'failed',
        error: { type: 'UnsupportedInput', message: request.method },
      }),
    )
    expect(cancel).toHaveBeenCalledWith(get.mock.calls[0]?.[0])
    expect(host.inbox.list()).toEqual([])
  },
)

test.each([
  { method: 'sampling/createMessage', params: { messages: [], maxTokens: 10 } },
  { method: 'roots/list', params: {} },
] satisfies Array<InputRequest>)(
  'unsupported $method retries a failed task cancellation while the run stays failed',
  async (request) => {
    const { host, client, get } = await synthetic(request)
    const states = vi.fn()
    host.events.on('run:state', states)
    const cancel = vi
      .spyOn(client.tasks, 'cancel')
      .mockRejectedValueOnce(new Error('Transport failed'))
      .mockImplementation(async () => {
        expect(await host.get(run.runID)).toMatchObject({
          state: 'failed',
          error: { type: 'UnsupportedInput', message: request.method },
        })
        return { resultType: 'complete' }
      })
    const run = await host.start({ definition: inputFlow })
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(2))
    expect(cancel.mock.calls).toEqual([[get.mock.calls[0]?.[0]], [get.mock.calls[0]?.[0]]])
    expect(await host.get(run.runID)).toMatchObject({
      state: 'failed',
      error: { type: 'UnsupportedInput', message: request.method },
    })
    expect(states.mock.calls.map(([snapshot]) => snapshot.state)).toEqual(['working', 'failed'])
    expect(host.inbox.list()).toEqual([])
  },
)

test('late snapshots cannot re-list a settled input or add an older request', async () => {
  const { host, session, held } = await fixture()
  const client = session.contextHost.getContext('flow').client
  const get = client.tasks.get.bind(client.tasks)
  const added = vi.fn()
  const settled = vi.fn()
  host.events.on('inbox:added', added)
  host.events.on('inbox:settled', settled)
  const flow: FlowDefinition = {
    ...inputFlow,
    nodes: {
      ...inputFlow.nodes,
      ask: { kind: 'input', prompt: { value: 'Choose' }, schema, next: 'hold' },
      hold: { kind: 'tool', tool: 'local:hold', args: {}, next: 'done' },
    },
  }
  const run = await host.start({ definition: flow })
  await host.inbox.answer(`${run.runID}:approval`)
  const item = await pending(host, run.runID)
  const polled = vi.spyOn(client.tasks, 'get')
  const taskID = await getTaskID()
  const old = await get(taskID)
  polled.mockResolvedValue(old)
  await host.inbox.answer(item.id, { value: 'Ada' })
  polled.mockClear()
  await vi.waitFor(() => expect(polled.mock.calls.length).toBeGreaterThanOrEqual(2))
  expect(host.inbox.list()).toEqual([])
  expect(added).toHaveBeenCalledTimes(2)
  expect(settled).toHaveBeenCalledTimes(2)
  polled.mockImplementation(get)
  await vi.waitFor(async () => expect((await host.get(run.runID))?.state).toBe('working'))
  polled.mockClear().mockResolvedValue({
    ...old,
    status: 'input_required',
    inputRequests: {
      older: {
        method: 'elicitation/create',
        params: { message: 'Old', requestedSchema: schema },
      },
    },
  })
  await vi.waitFor(() => expect(polled.mock.calls.length).toBeGreaterThanOrEqual(2))
  expect(host.inbox.list()).toEqual([])
  expect((await host.get(run.runID))?.state).toBe('working')
  polled.mockImplementation(get)
  held.resolve()
  await completed(host, run.runID)

  async function getTaskID(): Promise<string> {
    await vi.waitFor(() => expect(polled).toHaveBeenCalled())
    const id = polled.mock.calls[0]?.[0]
    if (id === undefined) throw new Error('Expected task ID')
    return id
  }
})
