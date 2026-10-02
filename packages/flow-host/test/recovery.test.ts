import { isCreateTaskResult } from '@mokei/context-protocol'
import { createMemoryTaskStore, createTaskManager, createTool } from '@mokei/context-server'
import type { DecisionFlowWiring } from '@mokei/decision-flow-server'
import * as wiringModule from '@mokei/decision-flow-server'
import { Session } from '@mokei/session'
import type { FlowDefinition } from '@sozai/flow-graph'
import { afterEach, expect, test, vi } from 'vitest'

import { createFlowHost } from '../src/host.js'
import { createMemoryRunStore } from '../src/run-store.js'
import type { FlowHost, FlowRunSnapshot, InboxItem, RunRecord } from '../src/types.js'
import { createFixture, deferred, echoFlow, emptyFlow } from './fixture.js'

const fixtures: Array<Awaited<ReturnType<typeof createFixture>>> = []
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(fixtures.splice(0).map((f) => f.dispose()))
  for (const cleanup of cleanups.splice(0)) await cleanup()
})
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected fixture value')
  return value
}
async function admissionClosed(host: FlowHost) {
  await expect(host.start({ definition: emptyFlow })).rejects.toThrow('Flow host disposed')
  await expect(host.cancel('missing')).rejects.toThrow('Flow host disposed')
  expect(() => host.inbox.list()).toThrow('Flow host disposed')
  expect(() => host.inbox.get('missing')).toThrow('Flow host disposed')
  for (const action of ['answer', 'decline', 'cancel'] as const)
    await expect(host.inbox[action]('missing')).rejects.toThrow('Flow host disposed')
}
function stores() {
  return { runStore: createMemoryRunStore(), taskStore: createMemoryTaskStore() }
}
async function fixture(params: Parameters<typeof createFixture>[0]) {
  const f = await createFixture(params)
  fixtures.push(f)
  return f
}
async function state(host: FlowHost, runID: string, expected: string) {
  await vi.waitFor(async () => expect((await host.get(runID))?.state).toBe(expected))
}
const inputFlow: FlowDefinition = {
  ...emptyFlow,
  id: 'input',
  start: 'ask',
  nodes: {
    ask: {
      kind: 'input',
      prompt: { value: 'Choose' },
      schema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },
      next: 'done',
    },
    done: { kind: 'end', outcome: 'done', output: { answer: { ref: ['results', 'ask'] } } },
  },
}
test('input survives a restart with the same item ID', async () => {
  const shared = stores()
  const first = await fixture(shared)
  const run = await first.host.start({ definition: inputFlow })
  await state(first.host, run.runID, 'input_required')
  const item = required(first.host.inbox.list()[0])
  await first.host.dispose()
  const second = await fixture(shared)
  expect(second.host.inbox.list()).toHaveLength(1)
  expect(second.host.inbox.list()[0]?.id).toBe(item.id)
  await second.host.inbox.answer(item.id, { value: 'Ada' })
  await state(second.host, run.runID, 'completed')
  expect(await second.host.get(run.runID)).toMatchObject({
    result: { output: { answer: { value: 'Ada' } } },
  })
})
test('creation waits for the first recovered task read without waiting for an answer', async () => {
  const shared = stores()
  const first = await fixture(shared)
  const run = await first.host.start({ definition: inputFlow })
  await state(first.host, run.runID, 'input_required')
  const item = required(first.host.inbox.list()[0])
  await first.host.dispose()
  const entered = deferred<void>()
  const release = deferred<void>()
  const original = wiringModule.addDecisionFlow
  vi.spyOn(wiringModule, 'addDecisionFlow').mockImplementation(async (...args) => {
    const wiring = await original(...args)
    const client = args[0].contextHost.getContext(args[1].key).client
    const get = client.tasks.get.bind(client.tasks)
    vi.spyOn(client.tasks, 'get').mockImplementationOnce(async (taskID) => {
      entered.resolve()
      await release.promise
      return get(taskID)
    })
    return wiring
  })
  let created = false
  const creating = fixture(shared).then((f) => {
    created = true
    return f
  })
  try {
    await entered.promise
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(created).toBe(false)
  } finally {
    release.resolve()
    await creating
  }
  const second = await creating
  expect(second.host.inbox.list()).toHaveLength(1)
  expect(second.host.inbox.list()[0]?.id).toBe(item.id)
  expect((await second.host.get(run.runID))?.state).toBe('input_required')
})

test.each(['input', 'allowlisted approval'] as const)(
  'an initial recovered %s task transport error rejects creation and disposes wiring',
  async (source) => {
    const shared = stores()
    const first = await fixture(shared)
    const run = await first.host.start({ definition: source === 'input' ? inputFlow : echoFlow })
    if (source === 'input') await state(first.host, run.runID, 'input_required')
    await first.host.dispose()
    const session = new Session({ elicit: true })
    session.contextHost.addLocalTool({
      name: 'echo',
      inputSchema: { type: 'object' },
      execute: () => ({ content: [] }),
    })
    cleanups.push(() => session.dispose())
    const original = wiringModule.addDecisionFlow
    const failure = new Error('Initial task transport failed')
    let disposed = false
    let reads = 0
    vi.spyOn(wiringModule, 'addDecisionFlow').mockImplementation(async (...args) => {
      const wiring = await original(...args)
      const dispose = wiring.dispose.bind(wiring)
      wiring.dispose = async () => {
        disposed = true
        await dispose()
      }
      vi.spyOn(args[0].contextHost.getContext(args[1].key).client.tasks, 'get').mockImplementation(
        async () => {
          reads += 1
          throw failure
        },
      )
      return wiring
    })
    const creating = createFlowHost({
      ...shared,
      session,
      pollMs: 1,
      approval: { allow: ['local:echo'] },
    }).then((host) => {
      cleanups.unshift(() => host.dispose())
      return host
    })
    await expect(creating).rejects.toBe(failure)
    expect(disposed).toBe(true)
    expect(() => session.contextHost.getContext('flow')).toThrow()
    await new Promise<void>((resolve) => setTimeout(resolve, 20))
    expect(reads).toBe(1)
    expect((await shared.runStore.get(run.runID))?.state).toBe(
      source === 'input' ? 'input_required' : 'working',
    )
  },
)

test('creation reconciles input from an approval allowlisted during recovery', async () => {
  const shared = stores()
  const definition: FlowDefinition = {
    ...inputFlow,
    start: 'echo',
    nodes: {
      ...inputFlow.nodes,
      echo: { kind: 'tool', tool: 'local:echo', args: {}, next: 'ask' },
    },
  }
  const first = await fixture(shared)
  const run = await first.host.start({ definition })
  expect(run.state).toBe('awaiting_approval')
  await first.host.dispose()
  const entered = deferred<void>()
  const release = deferred<void>()
  const original = wiringModule.addDecisionFlow
  vi.spyOn(wiringModule, 'addDecisionFlow').mockImplementation(async (...args) => {
    const wiring = await original(...args)
    const client = args[0].contextHost.getContext(args[1].key).client
    const get = client.tasks.get.bind(client.tasks)
    vi.spyOn(client.tasks, 'get').mockImplementationOnce(async (taskID) => {
      entered.resolve()
      await release.promise
      return get(taskID)
    })
    return wiring
  })
  let created = false
  const creating = fixture({ ...shared, allow: ['local:echo'] }).then((f) => {
    created = true
    return f
  })
  try {
    await entered.promise
    await vi.waitFor(async () => {
      expect(await shared.taskStore.list({ status: ['input_required'] })).toHaveLength(1)
    })
    expect(created).toBe(false)
  } finally {
    release.resolve()
    await creating
  }
  const second = await creating
  expect(second.host.inbox.list()).toEqual([
    expect.objectContaining({ runID: run.runID, kind: 'input' }),
  ])
})

test('a missing recovered task is failed before creation resolves', async () => {
  const shared = stores()
  const first = await fixture(shared)
  const run = await first.host.start({ definition: inputFlow })
  await state(first.host, run.runID, 'input_required')
  await first.host.dispose()
  await shared.taskStore.delete(required((await shared.runStore.get(run.runID))?.taskID))
  const second = await fixture(shared)
  expect(await second.host.get(run.runID)).toMatchObject({
    state: 'failed',
    error: { type: 'Interrupted' },
  })
  expect(second.host.inbox.list()).toEqual([])
})

test('recovery readiness survives persistent unsupported-input cancellation failures', async () => {
  const shared = stores()
  const first = await fixture(shared)
  const run = await first.host.start({ definition: inputFlow })
  await state(first.host, run.runID, 'input_required')
  await first.host.dispose()
  const entered = deferred<void>()
  const release = deferred<void>()
  const original = wiringModule.addDecisionFlow
  vi.spyOn(wiringModule, 'addDecisionFlow').mockImplementation(async (...args) => {
    const wiring = await original(...args)
    const client = args[0].contextHost.getContext(args[1].key).client
    const get = client.tasks.get.bind(client.tasks)
    vi.spyOn(client.tasks, 'get').mockImplementation(async (taskID) => {
      return {
        ...(await get(taskID)),
        status: 'input_required',
        inputRequests: { unsupported: { method: 'roots/list', params: {} } },
      }
    })
    vi.spyOn(client.tasks, 'cancel').mockImplementation(async () => {
      entered.resolve()
      await release.promise
      throw new Error('Cancellation transport failed')
    })
    return wiring
  })
  let created = false
  const creating = fixture(shared).then((f) => {
    created = true
    return f
  })
  try {
    await entered.promise
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(created).toBe(true)
  } finally {
    release.resolve()
    await creating.catch(() => undefined)
  }
  const second = await creating
  expect(await second.host.get(run.runID)).toMatchObject({
    state: 'failed',
    error: { type: 'UnsupportedInput', message: 'roots/list' },
  })
  expect(second.host.inbox.list()).toEqual([])
})

test('queued approval survives a restart', async () => {
  const shared = { ...stores(), flows: [echoFlow] }
  const first = await fixture(shared)
  const run = await first.host.start({ flow: echoFlow.id })
  const item = required(first.host.inbox.list()[0])
  await first.host.dispose()
  const second = await fixture(shared)
  expect(second.host.inbox.list()).toEqual([item])
  await second.host.inbox.answer(item.id)
  await state(second.host, run.runID, 'completed')
  expect(second.echo).toHaveBeenCalledTimes(1)
})
test('input keeps its item and task IDs across two sequential recoveries', async () => {
  const shared = stores()
  const first = await fixture(shared)
  const run = await first.host.start({ definition: inputFlow })
  await state(first.host, run.runID, 'input_required')
  const item = required(first.host.inbox.list()[0])
  const taskID = required((await shared.runStore.get(run.runID))?.taskID)
  await first.host.dispose()
  const second = await fixture(shared)
  expect(second.host.inbox.list()[0]?.id).toBe(item.id)
  await second.host.dispose()
  const third = await fixture(shared)
  expect(third.host.inbox.list()[0]?.id).toBe(item.id)
  expect((await shared.runStore.get(run.runID))?.taskID).toBe(taskID)
  await third.host.inbox.answer(item.id, { value: 'Ada' })
  await state(third.host, run.runID, 'completed')
  expect(await third.host.get(run.runID)).toMatchObject({
    result: { output: { answer: { value: 'Ada' } } },
  })
  const tasks = await shared.taskStore.list({
    status: ['working', 'input_required', 'completed', 'failed', 'cancelled'],
  })
  expect(tasks.map((task) => task.taskID)).toEqual([taskID])
})
test.each(['snapshot', 'interrupted'] as const)(
  'dispose drains an in-progress watcher %s write before disposing wiring',
  async (source) => {
    const shared = stores()
    const originalWiring = wiringModule.addDecisionFlow
    let wiringDisposed = false
    vi.spyOn(wiringModule, 'addDecisionFlow').mockImplementation(async (...args) => {
      const wiring = await originalWiring(...args)
      const dispose = wiring.dispose.bind(wiring)
      wiring.dispose = async () => {
        wiringDisposed = true
        await dispose()
      }
      return wiring
    })
    const f = await fixture(shared)
    const run = await f.host.start({ definition: inputFlow })
    await state(f.host, run.runID, 'input_required')
    const taskID = required((await shared.runStore.get(run.runID))?.taskID)
    const entered = deferred<void>()
    const release = deferred<void>()
    const written = deferred<void>()
    const update = shared.runStore.update.bind(shared.runStore)
    let disposed = false
    let writesAfterDispose = 0
    vi.spyOn(shared.runStore, 'update').mockImplementation(async (...args) => {
      const held = args[1].state === (source === 'snapshot' ? 'completed' : 'failed')
      if (held) {
        entered.resolve()
        await release.promise
      }
      const result = await update(...args)
      if (disposed) writesAfterDispose += 1
      if (held) written.resolve()
      return result
    })
    if (source === 'snapshot') {
      const client = f.session.contextHost.getContext('flow').client
      const task = await client.tasks.get(taskID)
      if (task.status !== 'input_required') throw new Error('Expected input')
      await client.tasks.update(taskID, {
        [required(Object.keys(task.inputRequests)[0])]: {
          action: 'accept',
          content: { value: 'Ada' },
        },
      })
    } else {
      await shared.taskStore.delete(taskID)
    }
    await entered.promise
    const disposing = f.host.dispose().then(() => {
      disposed = true
    })
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect(disposed).toBe(false)
      expect(wiringDisposed).toBe(false)
    } finally {
      release.resolve()
      await written.promise
      await disposing
    }
    expect(writesAfterDispose).toBe(0)
    expect(await f.host.get(run.runID)).toMatchObject({
      state: source === 'snapshot' ? 'completed' : 'failed',
      ...(source === 'interrupted' ? { error: { type: 'Interrupted' } } : {}),
    })
  },
)
async function crash(withTask: boolean) {
  const shared = stores()
  const original = wiringModule.addDecisionFlow
  let wiring: DecisionFlowWiring | undefined
  const polls = { count: 0 }
  vi.spyOn(wiringModule, 'addDecisionFlow').mockImplementation(async (...args) => {
    wiring = await original(...args)
    const client = args[0].contextHost.getContext(args[1].key).client
    const get = client.tasks.get.bind(client.tasks)
    vi.spyOn(client.tasks, 'get').mockImplementation(async (taskID) => {
      polls.count += 1
      return get(taskID)
    })
    return wiring
  })
  const first = await fixture(shared)
  if (wiring === undefined) throw new Error('Expected wiring')
  const request = {
    toolName: 'run_flow',
    arguments: { definition: inputFlow },
  } as unknown as RunRecord['request']
  const authorized = await wiring.authorize(request)
  if (!authorized.ok) throw new Error('Expected authorisation')
  const now = Date.now()
  const record: RunRecord = {
    runID: crypto.randomUUID(),
    label: 'Interrupted launch',
    state: 'working',
    createdAt: now,
    updatedAt: now,
    revision: 0,
    request,
    digest: authorized.digest,
    plan: { tools: [...authorized.plan] },
  }
  await shared.runStore.create(record)
  let taskID: string | undefined
  if (withTask) {
    const result = await first.session.contextHost.getContext('flow').client.callTool({
      name: request.toolName,
      arguments: request.arguments,
      task: 'handle',
      _meta: { ...authorized.grant(), 'dev.mokei/flow-run': record.runID },
    })
    if (!isCreateTaskResult(result)) throw new Error('Expected task')
    taskID = result.taskId
    await vi.waitFor(async () =>
      expect((await shared.taskStore.get(required(taskID)))?.status).toBe('input_required'),
    )
  }
  return { ...shared, first, record, taskID, polls }
}
test.each([false, true])('launch crash links a task already completed: %s', async (completed) => {
  const f = await crash(true)
  if (completed) {
    const client = f.first.session.contextHost.getContext('flow').client
    const task = await client.tasks.get(required(f.taskID))
    if (task.status !== 'input_required') throw new Error('Expected input')
    await client.tasks.update(required(f.taskID), {
      [required(Object.keys(task.inputRequests)[0])]: {
        action: 'accept',
        content: { value: 'Ada' },
      },
    })
    await vi.waitFor(async () =>
      expect((await f.taskStore.get(required(f.taskID)))?.status).toBe('completed'),
    )
  }
  await f.first.host.dispose()
  f.polls.count = 0
  const second = await fixture(f)
  await vi.waitFor(async () =>
    expect((await f.runStore.get(f.record.runID))?.taskID).toBe(f.taskID),
  )
  if (!completed) {
    await vi.waitFor(() => expect(second.host.inbox.list()).toHaveLength(1))
    await second.host.inbox.answer(required(second.host.inbox.list()[0]).id, { value: 'Ada' })
  }
  await state(second.host, f.record.runID, 'completed')
  if (completed) expect(f.polls.count).toBe(1)
  expect(
    await f.taskStore.list({
      status: ['working', 'input_required', 'completed', 'failed', 'cancelled'],
    }),
  ).toHaveLength(1)
})
test('launch crash without a task fails Interrupted', async () => {
  const f = await crash(false)
  await f.first.host.dispose()
  const second = await fixture(f)
  expect(await second.host.get(f.record.runID)).toMatchObject({
    state: 'failed',
    error: { type: 'Interrupted' },
  })
})
test.each(['failed', 'cancelled'] as const)(
  'launch crash links a task already %s without creating another task',
  async (status) => {
    const f = await crash(true)
    await f.first.host.dispose()
    const taskID = required(f.taskID)
    const task = required(await f.taskStore.get(taskID))
    await f.taskStore.update(
      taskID,
      {
        status,
        lastUpdatedAt: new Date().toISOString(),
        ...(status === 'failed' ? { error: { code: -32603, message: 'Worker failed' } } : {}),
      },
      { revision: task.revision },
    )
    f.polls.count = 0
    const second = await fixture(f)
    await state(second.host, f.record.runID, status)
    expect((await f.runStore.get(f.record.runID))?.taskID).toBe(taskID)
    if (status === 'failed')
      expect(await second.host.get(f.record.runID)).toMatchObject({
        error: { type: 'TaskFailed', message: 'Worker failed' },
      })
    expect(f.polls.count).toBe(1)
    expect(second.host.inbox.list()).toEqual([])
    const tasks = await f.taskStore.list({
      status: ['working', 'input_required', 'completed', 'failed', 'cancelled'],
    })
    expect(tasks.map((task) => task.taskID)).toEqual([taskID])
  },
)
test.each([false, true])(
  'recovery honours cancelRequested with a linked task: %s',
  async (linked) => {
    const f = await crash(true)
    await f.first.host.dispose()
    await f.runStore.update(
      f.record.runID,
      { cancelRequested: true, ...(linked ? { taskID: f.taskID } : {}) },
      { revision: 0 },
    )
    const second = await fixture(f)
    await state(second.host, f.record.runID, 'cancelled')
    expect((await f.taskStore.get(required(f.taskID)))?.status).toBe('cancelled')
  },
)
test.each(['start', 'approval'] as const)(
  'dispose waits for an in-flight %s launch and closes admission',
  async (source) => {
    const shared = { ...stores(), ...(source === 'approval' ? { flows: [echoFlow] } : {}) }
    const f = await fixture(shared)
    const queued = source === 'approval' ? await f.host.start({ flow: echoFlow.id }) : undefined
    const client = f.session.contextHost.getContext('flow').client
    const original = client.callTool.bind(client)
    const entered = deferred<void>()
    const release = deferred<void>()
    vi.spyOn(client as { callTool: typeof original }, 'callTool').mockImplementationOnce(
      async (...args) => {
        entered.resolve()
        await release.promise
        return original(...args)
      },
    )
    const launch =
      source === 'approval'
        ? f.host.inbox.answer(`${required(queued).runID}:approval`)
        : f.host.start({ definition: inputFlow })
    await entered.promise
    let disposed = false
    const disposing = f.host.dispose().then(() => {
      disposed = true
    })
    try {
      await admissionClosed(f.host)
      expect(disposed).toBe(false)
    } finally {
      release.resolve()
      await launch
      await disposing
    }
    await admissionClosed(f.host)
    expect((await shared.runStore.list({}))[0]?.taskID).toBeDefined()
    const second = await fixture(shared)
    if (source === 'start') await vi.waitFor(() => expect(second.host.inbox.list()).toHaveLength(1))
    else await state(second.host, required(queued).runID, 'completed')
  },
)
test('sibling wait survives disposal without cancelling or relaunching the sibling', async () => {
  const shared = stores()
  const siblingStore = createMemoryTaskStore()
  const tasks = createTaskManager({ store: siblingStore, pollIntervalMs: 10 })
  const held = deferred<void>()
  const tool = createTool({
    description: 'Held work',
    inputSchema: { type: 'object' },
    handler: ({ task }) => {
      if (task === undefined) throw new Error('Expected task context')
      return task.run(async () => {
        await held.promise
        return { content: [] }
      })
    },
  })
  const session = new Session({ elicit: true })
  session.contextHost.addDirectContext({
    key: 'sibling',
    protocolVersion: '2026-07-28',
    config: {
      protocolVersions: ['2026-07-28'],
      name: 'Sibling',
      version: '1',
      tools: { work: tool },
      tasks,
    },
    tools: [
      {
        id: 'sibling:work',
        enabled: true,
        tool: { name: 'work', inputSchema: { type: 'object' } },
      },
    ],
  })
  cleanups.push(async () => {
    held.resolve()
    await tasks.dispose()
    await session.dispose()
  })
  const flow: FlowDefinition = {
    ...echoFlow,
    nodes: {
      ...echoFlow.nodes,
      echo: { kind: 'tool', tool: 'sibling:work', args: {}, next: 'done' },
    },
  }
  const first = await createFlowHost({
    ...shared,
    session,
    pollMs: 10,
    approval: { allow: ['sibling:work'] },
  })
  cleanups.unshift(() => first.dispose())
  const run = await first.start({ definition: flow })
  await vi.waitFor(async () =>
    expect((await shared.taskStore.list({ status: ['working'] }))[0]?.resumeData).toMatchObject({
      siblings: [{ tool: 'sibling:work' }],
    }),
  )
  await first.dispose()
  const sibling = required((await siblingStore.list({ status: ['working'] }))[0])
  expect(sibling).toBeDefined()
  const second = await createFlowHost({ ...shared, session, pollMs: 10 })
  cleanups.unshift(() => second.dispose())
  held.resolve()
  await state(second, run.runID, 'completed')
  expect(await siblingStore.list({ status: ['working', 'completed', 'cancelled'] })).toHaveLength(1)
  expect((await siblingStore.get(sibling.taskID))?.status).toBe('completed')
})

test('recovery cancels a missing task and leaves the host usable', async () => {
  const f = await crash(true)
  await f.first.host.dispose()
  await f.runStore.update(
    f.record.runID,
    { taskID: f.taskID, cancelRequested: true },
    { revision: 0 },
  )
  await f.taskStore.delete(required(f.taskID))
  const second = await fixture(f)
  expect(await second.host.get(f.record.runID)).toMatchObject({ state: 'cancelled' })
  const run = await second.host.start({ definition: emptyFlow })
  await state(second.host, run.runID, 'completed')
})

test('a recovery error fails only its run and leaves other runs usable', async () => {
  const f = await crash(true)
  const queued = await f.first.host.start({ definition: echoFlow })
  await f.first.host.dispose()
  await f.runStore.update(
    f.record.runID,
    { taskID: f.taskID, cancelRequested: true },
    { revision: 0 },
  )
  vi.restoreAllMocks()
  const original = wiringModule.addDecisionFlow
  vi.spyOn(wiringModule, 'addDecisionFlow').mockImplementation(async (...args) => {
    const wiring = await original(...args)
    vi.spyOn(
      args[0].contextHost.getContext(args[1].key).client.tasks,
      'cancel',
    ).mockRejectedValueOnce(new Error('Recovery transport failed'))
    return wiring
  })
  const second = await fixture(f)
  expect(await second.host.get(f.record.runID)).toMatchObject({
    state: 'failed',
    error: { type: 'Interrupted', message: 'Recovery transport failed' },
  })
  expect(second.host.inbox.list()).toHaveLength(1)
  await second.host.inbox.answer(`${queued.runID}:approval`)
  await state(second.host, queued.runID, 'completed')
})

test.each([true, false])(
  'recovery applies the allow policy to a stored approval plan: %s',
  async (allowed) => {
    const shared = stores()
    const definition: FlowDefinition = {
      ...echoFlow,
      nodes: {
        ...echoFlow.nodes,
        echo: { kind: 'tool', tool: 'local:hold', args: {}, next: 'done' },
      },
    }
    const now = Date.now()
    const record: RunRecord = {
      runID: crypto.randomUUID(),
      label: 'Held run',
      state: 'awaiting_approval',
      createdAt: now,
      updatedAt: now,
      revision: 0,
      request: {
        toolName: 'run_flow',
        arguments: { definition } as unknown as RunRecord['request']['arguments'],
      },
      plan: { tools: ['local:hold'] },
    }
    await shared.runStore.create(record)
    const second = await fixture({ ...shared, allow: [allowed ? 'local:*' : 'other:*'] })
    expect(await second.host.get(record.runID)).toMatchObject({
      state: allowed ? 'working' : 'awaiting_approval',
    })
    expect(second.host.inbox.list()).toEqual(
      allowed
        ? []
        : [
            {
              id: `${record.runID}:approval`,
              runID: record.runID,
              kind: 'approval',
              plan: record.plan,
              createdAt: now,
            },
          ],
    )
    const stored = required(await shared.runStore.get(record.runID))
    if (allowed) {
      expect(stored.taskID).toBeDefined()
      expect(await shared.taskStore.get(required(stored.taskID))).toMatchObject({
        status: 'working',
      })
    } else {
      expect(stored.taskID).toBeUndefined()
      expect(await shared.taskStore.list({ status: ['working'] })).toEqual([])
    }
  },
)

test('parameter listeners receive recovery approval and interrupted run events', async () => {
  const f = await crash(false)
  const queued = await f.first.host.start({ definition: echoFlow })
  await f.first.host.dispose()
  const added: Array<InboxItem> = []
  const states: Array<FlowRunSnapshot> = []
  const second = await fixture({
    ...f,
    listeners: {
      'inbox:added': (item) => {
        added.push(item)
      },
      'run:state': (run) => {
        states.push(run)
      },
    },
  })
  expect(added).toEqual(second.host.inbox.list())
  expect(added).toHaveLength(1)
  expect(added[0]).toMatchObject({ runID: queued.runID, kind: 'approval' })
  expect(states).toEqual([await second.host.get(f.record.runID)])
  expect(states[0]).toMatchObject({ state: 'failed', error: { type: 'Interrupted' } })
})
