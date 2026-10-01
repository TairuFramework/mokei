import type { CallToolResult, CreateTaskResult } from '@mokei/context-protocol'
import type { JSONValue } from '@mokei/context-server'
import { createMemoryTaskStore } from '@mokei/context-server'
import * as wiringModule from '@mokei/decision-flow-server'
import { Session } from '@mokei/session'
import { afterEach, expect, test, vi } from 'vitest'

import {
  FlowCheckError,
  FlowNotFoundError,
  InboxItemNotFoundError,
  RunNotFoundError,
} from '../src/errors.js'
import { createFlowHost } from '../src/host.js'
import { createMemoryRunStore } from '../src/run-store.js'
import type { FlowHost, RunRecord, RunState } from '../src/types.js'
import { createFixture, deferred, echoFlow, emptyFlow } from './fixture.js'

const taskBase = {
  taskId: 'task',
  createdAt: new Date(0).toISOString(),
  lastUpdatedAt: new Date(1).toISOString(),
  ttlMs: null,
}

type ToolClient = {
  callTool(params: {
    name: string
    arguments?: Record<string, JSONValue>
    _meta?: Record<string, JSONValue>
    task?: 'handle'
  }): Promise<CallToolResult | CreateTaskResult>
}

const fixtures: Array<Awaited<ReturnType<typeof createFixture>>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(fixtures.splice(0).map((f) => f.dispose()))
})
async function fixture(params: Parameters<typeof createFixture>[0] = {}) {
  const f = await createFixture(params)
  fixtures.push(f)
  return f
}
async function waitState(host: FlowHost, runID: string, state: RunState) {
  await vi.waitFor(async () => expect((await host.get(runID))?.state).toBe(state))
  return host.get(runID)
}
const holdFlow = {
  ...echoFlow,
  id: 'hold',
  nodes: {
    ...echoFlow.nodes,
    echo: { kind: 'tool' as const, tool: 'local:hold', args: {}, next: 'done' },
  },
}

test('registered flow with required input completes with its output', async () => {
  const flow = {
    ...emptyFlow,
    input: {
      type: 'object' as const,
      properties: { name: { type: 'string' as const } },
      required: ['name'],
    },
  }
  const { host, elicit } = await fixture({ flows: [flow] })
  const run = await host.start({ flow: flow.id, input: { name: 'a' } })
  expect(await waitState(host, run.runID, 'completed')).toMatchObject({
    result: { outcome: 'done', output: { name: 'a' } },
  })
  expect(host.flows()).toHaveLength(1)
  expect(elicit).not.toHaveBeenCalled()
})
test('inline flow completes and omitted input uses the default', async () => {
  const { host } = await fixture()
  for (const input of [{ name: 'a' }, undefined]) {
    const run = await host.start({ definition: emptyFlow, input })
    expect(await waitState(host, run.runID, 'completed')).toMatchObject({
      result: { outcome: 'done' },
    })
  }
})
test('unknown and invalid flows create no run', async () => {
  const { host } = await fixture()
  await expect(host.start({ flow: 'missing' })).rejects.toBeInstanceOf(FlowNotFoundError)
  await expect(
    host.start({ definition: { ...emptyFlow, start: 'missing' } }),
  ).rejects.toBeInstanceOf(FlowCheckError)
  expect(await host.list()).toEqual([])
})
test('allowlisted plans launch immediately', async () => {
  const { host, echo } = await fixture({ allow: ['local:*'] })
  const run = await host.start({ definition: echoFlow })
  expect(run.state).toBe('working')
  await waitState(host, run.runID, 'completed')
  expect(echo).toHaveBeenCalledTimes(1)
})
test('queued approvals expose the plan and answering launches once', async () => {
  const { host, echo } = await fixture()
  const run = await host.start({ definition: echoFlow })
  const id = `${run.runID}:approval`
  expect(run.state).toBe('awaiting_approval')
  expect(host.inbox.list({ runID: run.runID })).toMatchObject([
    { id, kind: 'approval', plan: { tools: ['local:echo'] } },
  ])
  const answers = await Promise.allSettled([host.inbox.answer(id), host.inbox.answer(id)])
  expect(answers.map((r) => r.status)).toEqual(['fulfilled', 'rejected'])
  expect(answers[1]).toMatchObject({ reason: expect.any(InboxItemNotFoundError) })
  await waitState(host, run.runID, 'completed')
  expect(echo).toHaveBeenCalledTimes(1)
  expect(() => host.inbox.get(id)).toThrow(InboxItemNotFoundError)
})
test.each([
  ['no', 'no'],
  [undefined, 'Flow denied'],
])('declining approval records its reason', async (reason, message) => {
  const { host } = await fixture()
  const run = await host.start({ definition: echoFlow })
  await host.inbox.decline(`${run.runID}:approval`, reason)
  expect(await host.get(run.runID)).toMatchObject({
    state: 'denied',
    error: { type: 'FlowDenied', message },
  })
})
test('cancelling queued approval settles once', async () => {
  const { host } = await fixture()
  const settled = vi.fn()
  host.events.on('inbox:settled', settled)
  const run = await host.start({ definition: echoFlow })
  await host.inbox.cancel(`${run.runID}:approval`)
  expect(await host.get(run.runID)).toMatchObject({ state: 'cancelled' })
  expect(settled).toHaveBeenCalledTimes(1)
  expect(settled.mock.calls[0]?.[0]).toMatchObject({ outcome: 'cancelled' })
})
test('cancel during run creation preserves publication and approval ordering', async () => {
  const runStore = createMemoryRunStore()
  const created = deferred<RunRecord>()
  const gate = deferred<void>()
  const create = runStore.create.bind(runStore)
  vi.spyOn(runStore, 'create').mockImplementation(async (record) => {
    await create(record)
    created.resolve(record)
    await gate.promise
  })
  const { host } = await fixture({ runStore })
  const events: Array<string> = []
  host.events.on('run:state', (run) => {
    events.push(run.state)
  })
  host.events.on('inbox:added', () => {
    events.push('added')
  })
  host.events.on('inbox:settled', ({ outcome }) => {
    events.push(outcome)
  })
  const start = host.start({ definition: echoFlow })
  const record = await created.promise
  expect(await host.list()).toMatchObject([{ runID: record.runID }])
  const cancel = host.cancel(record.runID)
  await new Promise((resolve) => setTimeout(resolve, 0))
  gate.resolve()
  await Promise.all([start, cancel])
  expect((await host.get(record.runID))?.state).toBe('cancelled')
  expect(host.inbox.list()).toEqual([])
  expect(events).toEqual(['awaiting_approval', 'added', 'cancelled', 'cancelled'])
})

test.each(['cancel', 'complete'] as const)(
  'a rejected launch cancellation keeps watching until tasks %s',
  async (finish) => {
    const runStore = createMemoryRunStore()
    const { host, session, held } = await fixture({ runStore })
    const client = session.contextHost.getContext('flow').client
    const toolClient = client as ToolClient
    const gate = deferred<void>()
    const entered = deferred<void>()
    const original = toolClient.callTool.bind(toolClient)
    vi.spyOn(toolClient, 'callTool').mockImplementation(async (params) => {
      entered.resolve()
      await gate.promise
      return original(params)
    })
    const failure = new Error('Cancellation transport failed')
    vi.spyOn(client.tasks, 'cancel').mockRejectedValueOnce(failure)
    const polled = deferred<void>()
    const get = client.tasks.get.bind(client.tasks)
    vi.spyOn(client.tasks, 'get').mockImplementation(async (taskID) => {
      const task = await get(taskID)
      polled.resolve()
      return task
    })
    const run = await host.start({ definition: holdFlow })
    const answer = host.inbox.answer(`${run.runID}:approval`)
    const answered = Promise.allSettled([answer])
    await entered.promise
    expect((await host.cancel(run.runID)).state).toBe('working')
    gate.resolve()
    expect(await answered).toEqual([{ status: 'rejected', reason: failure }])
    await polled.promise
    const linked = await runStore.get(run.runID)
    expect(linked).toMatchObject({ state: 'working', taskID: expect.any(String) })
    expect(linked?.error).toBeUndefined()
    if (finish === 'cancel') {
      expect((await host.cancel(run.runID)).state).toBe('cancelled')
    } else {
      held.resolve()
      expect(await waitState(host, run.runID, 'completed')).toMatchObject({
        result: { outcome: 'done' },
      })
    }
  },
)

test.each([false, true])('cancel during launch survives call failure %s', async (fails) => {
  const { host, session } = await fixture()
  const client = session.contextHost.getContext('flow').client as ToolClient
  const gate = deferred<void>()
  const entered = deferred<void>()
  const original = client.callTool.bind(client)
  vi.spyOn(client, 'callTool').mockImplementation(async (params) => {
    entered.resolve()
    await gate.promise
    if (fails) throw new Error('launch failed')
    return original(params)
  })
  const run = await host.start({ definition: holdFlow })
  const answer = host.inbox.answer(`${run.runID}:approval`)
  await entered.promise
  expect((await host.cancel(run.runID)).state).toBe('working')
  gate.resolve()
  await answer
  await waitState(host, run.runID, 'cancelled')
})
test('changed digest fails approval without calling the flow tool', async () => {
  const original = wiringModule.addDecisionFlow
  vi.spyOn(wiringModule, 'addDecisionFlow').mockImplementation(async (...args) => {
    const wiring = await original(...args)
    let calls = 0
    return {
      ...wiring,
      authorize: async (request) => {
        const result = await wiring.authorize(request)
        return result.ok && ++calls > 1 ? { ...result, digest: 'changed' } : result
      },
    }
  })
  const { host, echo } = await fixture({ flows: [echoFlow] })
  const run = await host.start({ flow: echoFlow.id })
  await host.inbox.answer(`${run.runID}:approval`)
  expect(await host.get(run.runID)).toMatchObject({
    state: 'failed',
    error: { type: 'FlowChanged' },
  })
  expect(echo).not.toHaveBeenCalled()
})
test('cancel working, terminal and unknown runs', async () => {
  const { host } = await fixture({ allow: ['local:*'] })
  const run = await host.start({ definition: holdFlow })
  const cancelled = await host.cancel(run.runID)
  expect(cancelled.state).toBe('cancelled')
  expect(await host.cancel(run.runID)).toEqual(cancelled)
  await expect(host.cancel('missing')).rejects.toBeInstanceOf(RunNotFoundError)
})
test('late polls cannot move a terminal run', async () => {
  const { host, session } = await fixture({ allow: ['local:*'] })
  const client = session.contextHost.getContext('flow').client
  const gate = deferred<Awaited<ReturnType<typeof client.tasks.get>>>()
  const entered = deferred<void>()
  const original = client.tasks.get.bind(client.tasks)
  vi.spyOn(client.tasks, 'get').mockImplementationOnce(() => {
    entered.resolve()
    return gate.promise
  })
  const run = await host.start({ definition: holdFlow })
  await entered.promise
  await host.cancel(run.runID)
  gate.resolve({ ...taskBase, status: 'working', resultType: 'complete' })
  await new Promise((resolve) => setTimeout(resolve, 30))
  expect((await host.get(run.runID))?.state).toBe('cancelled')
  vi.spyOn(client.tasks, 'get').mockImplementation(original)
})
test('older task snapshots are dropped', async () => {
  const { host, session } = await fixture({ allow: ['local:*'] })
  const client = session.contextHost.getContext('flow').client
  let calls = 0
  vi.spyOn(client.tasks, 'get').mockImplementation(async () => {
    calls++
    return calls === 1
      ? {
          ...taskBase,
          lastUpdatedAt: new Date(30).toISOString(),
          status: 'input_required',
          inputRequests: {},
          resultType: 'complete',
        }
      : {
          ...taskBase,
          lastUpdatedAt: new Date(20).toISOString(),
          status: 'working',
          resultType: 'complete',
        }
  })
  const run = await host.start({ definition: holdFlow })
  await waitState(host, run.runID, 'input_required')
  await vi.waitFor(() => expect(calls).toBeGreaterThan(2))
  expect((await host.get(run.runID))?.state).toBe('input_required')
})
test.each([false, true])('events preserve state and approval ordering %s', async (queued) => {
  const { host } = await fixture({ allow: queued ? [] : ['local:*'] })
  const events: Array<string> = []
  host.events.on('run:state', (run) => {
    events.push(run.state)
  })
  host.events.on('inbox:added', () => {
    events.push('added')
  })
  host.events.on('inbox:settled', () => {
    events.push('settled')
  })
  const run = await host.start({ definition: echoFlow })
  if (queued) await host.inbox.answer(`${run.runID}:approval`)
  await waitState(host, run.runID, 'completed')
  expect(events).toEqual(
    queued
      ? ['awaiting_approval', 'added', 'working', 'settled', 'completed']
      : ['working', 'completed'],
  )
})
test('task missing during execution interrupts the run', async () => {
  const taskStore = createMemoryTaskStore()
  const runStore = createMemoryRunStore()
  const { host } = await fixture({ allow: ['local:*'], taskStore, runStore })
  const run = await host.start({ definition: holdFlow })
  const record = await runStore.get(run.runID)
  await taskStore.delete(record?.taskID as string)
  expect(await waitState(host, run.runID, 'failed')).toMatchObject({
    error: { type: 'Interrupted' },
  })
})
test('pre-task errors fail with StartFailed', async () => {
  const { host, session } = await fixture()
  vi.spyOn(
    session.contextHost.getContext('flow').client as ToolClient,
    'callTool',
  ).mockResolvedValue({ content: [{ type: 'text', text: 'before task' }], isError: true })
  const run = await host.start({ definition: emptyFlow })
  expect(run).toMatchObject({
    state: 'failed',
    error: { type: 'StartFailed', message: 'before task' },
  })
})
test('flow error results map to failed', async () => {
  const { host, session } = await fixture()
  vi.spyOn(session.contextHost.getContext('flow').client.tasks, 'get').mockResolvedValue({
    ...taskBase,
    status: 'completed',
    resultType: 'complete',
    result: {
      isError: true,
      content: [{ type: 'text', text: 'flow failed' }],
      structuredContent: {
        error: { code: 'tool_failed', name: 'FlowError', lastFailure: { type: 'SystemOneError' } },
      },
    },
  })
  const run = await host.start({ definition: emptyFlow })
  expect(await waitState(host, run.runID, 'failed')).toMatchObject({
    error: { type: 'SystemOneError', code: 'tool_failed', message: 'flow failed' },
  })
})
test('elicitation must be enabled', async () => {
  const session = new Session()
  await expect(createFlowHost({ session })).rejects.toThrow(/elicitation/i)
  await session.dispose()
})

test.each(['issues', 'plan'] as const)(
  'changed authorization %s fails without minting a grant',
  async (change) => {
    const original = wiringModule.addDecisionFlow
    const grant = vi.fn(() => ({}))
    vi.spyOn(wiringModule, 'addDecisionFlow').mockImplementation(async (...args) => {
      const wiring = await original(...args)
      let calls = 0
      return {
        ...wiring,
        authorize: async (request) => {
          const result = await wiring.authorize(request)
          if (++calls === 1) return result
          return change === 'issues'
            ? { ok: false, issues: ['Changed flow'] }
            : { ok: true, plan: ['local:hold'], grant }
        },
      }
    })
    const { host, echo } = await fixture()
    const run = await host.start({ definition: echoFlow })
    await host.inbox.answer(`${run.runID}:approval`)
    expect(await host.get(run.runID)).toMatchObject({
      state: 'failed',
      error: { type: 'FlowChanged' },
    })
    expect(grant).not.toHaveBeenCalled()
    expect(echo).not.toHaveBeenCalled()
  },
)

test('launch metadata names the run and snapshots hide stored request fields', async () => {
  const runStore = createMemoryRunStore()
  const taskStore = createMemoryTaskStore()
  const { host } = await fixture({ runStore, taskStore, allow: ['local:*'] })
  const run = await host.start({ definition: holdFlow, label: 'Held run' })
  const record = await runStore.get(run.runID)
  expect(record?.taskID).toBeDefined()
  const task = await taskStore.get(record?.taskID as string)
  expect(task?.requestMeta).toMatchObject({ 'dev.mokei/flow-run': run.runID })
  expect(run.label).toBe('Held run')
  for (const snapshot of [run, await host.get(run.runID), ...(await host.list())]) {
    expect(snapshot).not.toHaveProperty('request')
    expect(snapshot).not.toHaveProperty('taskID')
    expect(snapshot).not.toHaveProperty('revision')
  }
})

test('a transient poll failure retries without changing state', async () => {
  const { host, session } = await fixture({ allow: ['local:*'] })
  const client = session.contextHost.getContext('flow').client
  const original = client.tasks.get.bind(client.tasks)
  const get = vi
    .spyOn(client.tasks, 'get')
    .mockRejectedValueOnce(new Error('Temporary transport failure'))
  const run = await host.start({ definition: holdFlow })
  await vi.waitFor(() => expect(get.mock.calls.length).toBeGreaterThanOrEqual(2))
  expect((await host.get(run.runID))?.state).toBe('working')
  get.mockImplementation(original)
  expect((await host.cancel(run.runID)).state).toBe('cancelled')
})

test('re-authorization errors fail with FlowChanged before dispatch', async () => {
  const original = wiringModule.addDecisionFlow
  vi.spyOn(wiringModule, 'addDecisionFlow').mockImplementation(async (...args) => {
    const wiring = await original(...args)
    let calls = 0
    return {
      ...wiring,
      authorize: async (request) => {
        if (++calls > 1) throw new Error('Authorization unavailable')
        return wiring.authorize(request)
      },
    }
  })
  const { host, echo } = await fixture()
  const run = await host.start({ definition: echoFlow })
  await host.inbox.answer(`${run.runID}:approval`)
  expect(await host.get(run.runID)).toMatchObject({
    state: 'failed',
    error: { type: 'FlowChanged' },
  })
  expect(echo).not.toHaveBeenCalled()
})

test('flow-host tasks default to no expiry', async () => {
  const runStore = createMemoryRunStore()
  const taskStore = createMemoryTaskStore()
  const { host } = await fixture({ runStore, taskStore, allow: ['local:*'] })
  const run = await host.start({ definition: holdFlow })
  const taskID = (await runStore.get(run.runID))?.taskID
  if (taskID === undefined) throw new Error('Expected task')
  expect((await taskStore.get(taskID))?.ttlMs).toBeNull()
})

test('unchanged working polls preserve revision and update time', async () => {
  const runStore = createMemoryRunStore()
  const { host, session } = await fixture({ runStore, allow: ['local:*'] })
  const run = await host.start({ definition: holdFlow })
  const get = vi.spyOn(session.contextHost.getContext('flow').client.tasks, 'get')
  await vi.waitFor(() => expect(get.mock.calls.length).toBeGreaterThanOrEqual(2))
  const before = await runStore.get(run.runID)
  get.mockClear()
  await vi.waitFor(() => expect(get.mock.calls.length).toBeGreaterThanOrEqual(2))
  const after = await runStore.get(run.runID)
  expect(after?.revision).toBe(before?.revision)
  expect(after?.updatedAt).toBe(before?.updatedAt)
})

test('cancel of a missing task returns a cancelled snapshot', async () => {
  const { host, session } = await fixture({ allow: ['local:*'] })
  const run = await host.start({ definition: holdFlow })
  vi.spyOn(session.contextHost.getContext('flow').client.tasks, 'cancel').mockRejectedValueOnce({
    code: -32602,
    message: 'Task not found',
  })
  expect(await host.cancel(run.runID)).toMatchObject({ state: 'cancelled' })
})

test.each(['throws', 'issues', 'plan'] as const)(
  'cancel during changed authorization wins: %s',
  async (mode) => {
    const original = wiringModule.addDecisionFlow
    const entered = deferred<void>()
    const release = deferred<void>()
    vi.spyOn(wiringModule, 'addDecisionFlow').mockImplementation(async (...args) => {
      const wiring = await original(...args)
      let calls = 0
      return {
        ...wiring,
        authorize: async (request) => {
          if (++calls === 1) return wiring.authorize(request)
          entered.resolve()
          await release.promise
          if (mode === 'throws') throw new Error('Authorisation failed')
          return mode === 'issues'
            ? { ok: false, issues: ['changed'] }
            : { ok: true, plan: ['local:hold'], grant: () => ({}) }
        },
      }
    })
    const { host } = await fixture()
    const run = await host.start({ definition: echoFlow })
    const answer = host.inbox.answer(`${run.runID}:approval`)
    await entered.promise
    await host.cancel(run.runID)
    release.resolve()
    await answer
    expect(await host.get(run.runID)).toMatchObject({ state: 'cancelled' })
  },
)

test.each([false, true])(
  'link failure cancels the created task before failing the run, cleanup fails: %s',
  async (cleanupFails) => {
    const runStore = createMemoryRunStore()
    const taskStore = createMemoryTaskStore()
    const { host, session } = await fixture({ runStore, taskStore, allow: ['local:*'] })
    const cancel = vi.spyOn(session.contextHost.getContext('flow').client.tasks, 'cancel')
    if (cleanupFails) cancel.mockRejectedValueOnce(new Error('Cleanup failed'))
    const update = runStore.update.bind(runStore)
    vi.spyOn(runStore, 'update')
      .mockImplementationOnce(update)
      .mockImplementationOnce(async () => {
        throw new Error('Link write failed')
      })
      .mockImplementationOnce(async (...args) => {
        expect(cancel).toHaveBeenCalledTimes(1)
        return update(...args)
      })
    const run = await host.start({ definition: holdFlow })
    if (!cleanupFails) {
      expect(await taskStore.list({ status: ['working'] })).toEqual([])
      expect(await taskStore.list({ status: ['cancelled'] })).toHaveLength(1)
    }
    expect(await host.get(run.runID)).toMatchObject({
      state: 'failed',
      error: { type: 'StartFailed', message: 'Link write failed' },
    })
  },
)

test('an allowlisted start returns the snapshot when concurrent cancellation wins its claim', async () => {
  const runStore = createMemoryRunStore()
  const { host } = await fixture({ runStore, allow: ['local:*'] })
  const get = runStore.get.bind(runStore)
  const entered = deferred<void>()
  const release = deferred<void>()
  let createdRunID: string | undefined
  vi.spyOn(runStore, 'get').mockImplementationOnce(async (runID) => {
    createdRunID = runID
    entered.resolve()
    await release.promise
    return get(runID)
  })
  const start = host.start({ definition: holdFlow })
  await entered.promise
  if (createdRunID === undefined) throw new Error('Expected run')
  const cancel = host.cancel(createdRunID)
  release.resolve()
  expect(await cancel).toMatchObject({ state: 'cancelled' })
  expect(await start).toMatchObject({ state: 'cancelled' })
})

test('public exports exclude lifecycle and approval internals', async () => {
  const exports = await import('../src/index.js')
  for (const name of ['transition', 'createRunQueue', 'matchesAllow', 'isAllowed']) {
    expect(exports).not.toHaveProperty(name)
  }
  expect(exports).toHaveProperty('TERMINAL_STATES')
})

test('unchanged snapshots advance the watermark and reject older input requests', async () => {
  const { host, session } = await fixture({ allow: ['local:*'] })
  const client = session.contextHost.getContext('flow').client
  const get = vi.spyOn(client.tasks, 'get').mockImplementation(async (taskID) => ({
    ...taskBase,
    resultType: 'complete',
    taskId: taskID,
    status: 'working',
    lastUpdatedAt: new Date(10).toISOString(),
  }))
  const run = await host.start({ definition: holdFlow })
  await vi.waitFor(() => expect(get.mock.calls.length).toBeGreaterThanOrEqual(2))
  get.mockClear().mockImplementation(async (taskID) => ({
    ...taskBase,
    resultType: 'complete',
    taskId: taskID,
    status: 'working',
    lastUpdatedAt: new Date(20).toISOString(),
  }))
  await vi.waitFor(() => expect(get.mock.calls.length).toBeGreaterThanOrEqual(2))
  get.mockClear().mockImplementation(async (taskID) => ({
    ...taskBase,
    resultType: 'complete',
    taskId: taskID,
    status: 'input_required',
    lastUpdatedAt: new Date(15).toISOString(),
    inputRequests: {
      older: {
        method: 'elicitation/create',
        params: { message: 'Old', requestedSchema: { type: 'object', properties: {} } },
      },
    },
  }))
  await vi.waitFor(() => expect(get.mock.calls.length).toBeGreaterThanOrEqual(2))
  expect(await host.get(run.runID)).toMatchObject({ state: 'working' })
  expect(host.inbox.list()).toEqual([])
})
