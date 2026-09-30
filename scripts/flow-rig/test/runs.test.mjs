import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createRunManager } from '../runs.mjs'

const REQUEST = { method: 'elicitation/create', params: { message: 'Pick one' } }

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve))
}

async function flushMany(count = 5) {
  for (let i = 0; i < count; i++) {
    await flush()
  }
}

function taskResult(taskId = 'task-1') {
  return { resultType: 'task', taskId, status: 'working' }
}

// Fake client: every `tasks.get` call is a deferred the test settles in order.
function setup(options = {}) {
  const calls = { callTool: [], get: [], update: [], cancel: [], approve: [], ask: [], sleep: [] }
  const client = {
    callTool(params) {
      calls.callTool.push(params)
      return options.callTool ? options.callTool(params) : Promise.resolve(taskResult())
    },
    tasks: {
      get(taskId) {
        const d = deferred()
        calls.get.push({ taskId, ...d })
        return d.promise
      },
      update(taskId, responses) {
        calls.update.push({ taskId, responses })
        return Promise.resolve({})
      },
      cancel(taskId) {
        calls.cancel.push(taskId)
        return options.cancel ? options.cancel(taskId) : Promise.resolve({})
      },
    },
  }
  const manager = createRunManager({
    client,
    approve(request) {
      calls.approve.push(request)
      return options.approve ? options.approve(request) : { approved: true, meta: { grant: 'g' } }
    },
    ask(runId, requestKey, request, signal) {
      calls.ask.push({ runId, requestKey, request, signal })
      return new Promise(() => {})
    },
    listPending(runId) {
      return [{ id: `${runId}:entry`, message: 'Pick one', requestedSchema: {} }]
    },
    log() {},
    pollMs: 100,
    maxBackoffMs: 300,
    sleep(ms) {
      calls.sleep.push(ms)
      return flush()
    },
  })
  return { manager, client, calls }
}

async function nextGet(calls, index) {
  for (let i = 0; i < 20 && calls.get.length <= index; i++) {
    await flush()
  }
  assert.ok(calls.get.length > index, `tasks.get call ${index} did not happen`)
  return calls.get[index]
}

test('start approves then calls the tool with the identical args object', async () => {
  const { manager, calls } = setup()
  const args = { input: { a: 1 } }
  const result = await manager.start({ toolName: 'flow_demo', args })
  assert.equal(calls.approve.length, 1)
  const approval = calls.approve[0]
  assert.equal(approval.toolName, 'flow_demo')
  assert.equal(approval.args, args)
  assert.equal(typeof approval.runId, 'string')
  assert.ok(approval.signal instanceof AbortSignal)
  assert.equal(calls.callTool.length, 1)
  const params = calls.callTool[0]
  assert.equal(params.name, 'flow_demo')
  assert.equal(params.arguments, args)
  assert.deepEqual(params._meta, { grant: 'g' })
  assert.equal(params.task, 'handle')
  assert.deepEqual(result.structuredContent, { runId: approval.runId })
  assert.deepEqual(result.content, [
    { type: 'text', text: JSON.stringify({ runId: approval.runId }) },
  ])
  await manager.shutdown({ timeoutMs: 10 })
})

test('a denial returns an error result without calling the tool', async () => {
  const { manager, calls } = setup({ approve: () => ({ approved: false, reason: 'nope' }) })
  const result = await manager.start({ toolName: 'flow_demo', args: {} })
  assert.deepEqual(result, {
    isError: true,
    content: [{ type: 'text', text: 'Flow denied: nope' }],
  })
  assert.equal(calls.callTool.length, 0)
})

test('a synchronous CallToolResult is returned as is and registers no run', async () => {
  const sync = { isError: true, content: [{ type: 'text', text: 'bad input' }] }
  const { manager, calls } = setup({ callTool: () => Promise.resolve(sync) })
  const result = await manager.start({ toolName: 'flow_demo', args: {} })
  assert.equal(result, sync)
  const status = manager.status(calls.approve[0].runId)
  assert.equal(status.isError, true)
  await flush()
  assert.equal(calls.get.length, 0)
})

test('the watcher tracks working, input_required and completed', async () => {
  const { manager, calls } = setup()
  const { structuredContent } = await manager.start({ toolName: 'flow_demo', args: {} })
  const { runId } = structuredContent

  const first = await nextGet(calls, 0)
  assert.equal(first.taskId, 'task-1')
  first.resolve({ taskId: 'task-1', status: 'working' })
  await flush()
  assert.deepEqual(manager.status(runId).structuredContent, { state: 'working', pending: [] })

  const second = await nextGet(calls, 1)
  second.resolve({ taskId: 'task-1', status: 'input_required', inputRequests: { k1: REQUEST } })
  await flush()
  assert.deepEqual(manager.status(runId).structuredContent, {
    state: 'input_required',
    pending: [{ id: `${runId}:entry`, message: 'Pick one', requestedSchema: {} }],
  })
  assert.equal(calls.ask.length, 1)
  assert.equal(calls.ask[0].runId, runId)
  assert.equal(calls.ask[0].requestKey, 'k1')
  assert.deepEqual(calls.ask[0].request, REQUEST)

  const result = { content: [{ type: 'text', text: 'done' }] }
  const third = await nextGet(calls, 2)
  third.resolve({ taskId: 'task-1', status: 'completed', result })
  await flush()
  const status = manager.status(runId)
  assert.deepEqual(status.structuredContent, { state: 'completed', pending: [], result })
  assert.equal(calls.ask[0].signal.aborted, true)
  await flushMany()
  assert.equal(calls.get.length, 3)
})

test('three poll failures report unknown and a later success restores the state', async () => {
  const { manager, calls } = setup()
  const { runId } = (await manager.start({ toolName: 'flow_demo', args: {} })).structuredContent

  for (let i = 0; i < 2; i++) {
    ;(await nextGet(calls, i)).reject(new Error(`down ${i}`))
    await flush()
    assert.equal(manager.status(runId).structuredContent.state, 'working')
  }
  ;(await nextGet(calls, 2)).reject(new Error('down 2'))
  await flush()
  assert.deepEqual(manager.status(runId).structuredContent, {
    state: 'unknown',
    pending: [],
    error: 'down 2',
  })
  ;(await nextGet(calls, 3)).reject(new Error('down 3'))
  await flush()
  ;(await nextGet(calls, 4)).reject(new Error('down 4'))
  await flush()
  ;(await nextGet(calls, 5)).resolve({ taskId: 'task-1', status: 'working' })
  await flush()
  assert.deepEqual(manager.status(runId).structuredContent, { state: 'working', pending: [] })
  assert.deepEqual(calls.sleep.slice(0, 6), [100, 100, 200, 300, 300, 100])
  await manager.shutdown({ timeoutMs: 10 })
})

test('a failed task reports its error', async () => {
  const { manager, calls } = setup()
  const { runId } = (await manager.start({ toolName: 'flow_demo', args: {} })).structuredContent
  ;(await nextGet(calls, 0)).resolve({
    taskId: 'task-1',
    status: 'failed',
    error: { code: -32603, message: 'flow crashed' },
  })
  await flush()
  assert.deepEqual(manager.status(runId).structuredContent, {
    state: 'failed',
    pending: [],
    error: 'flow crashed',
  })
})

test('cancel calls tasks.cancel and returns the refreshed state', async () => {
  const { manager, calls } = setup()
  const { runId } = (await manager.start({ toolName: 'flow_demo', args: {} })).structuredContent
  ;(await nextGet(calls, 0)).resolve({ taskId: 'task-1', status: 'working' })
  await flush()
  const pending = manager.cancel(runId)
  await flush()
  assert.deepEqual(calls.cancel, ['task-1'])
  // Settle both the refresh and any watcher poll in flight.
  for (const get of calls.get.slice(1)) {
    get.resolve({ taskId: 'task-1', status: 'cancelled' })
  }
  const result = await pending
  assert.deepEqual(result.structuredContent, { state: 'cancelled' })
  assert.equal(manager.status(runId).structuredContent.state, 'cancelled')
  await manager.shutdown({ timeoutMs: 10 })
})

test('status and cancel of an unknown run are error results', async () => {
  const { manager } = setup()
  assert.deepEqual(manager.status('nope'), {
    isError: true,
    content: [{ type: 'text', text: 'Unknown run: nope' }],
  })
  assert.deepEqual(await manager.cancel('nope'), {
    isError: true,
    content: [{ type: 'text', text: 'Unknown run: nope' }],
  })
})

test('shutdown aborts approvals, cancels late and live tasks, and bounds the wait', async () => {
  const approval = deferred()
  const lateCall = deferred()
  let approveCount = 0
  let callCount = 0
  const { manager, calls } = setup({
    approve: () => {
      approveCount += 1
      return approveCount <= 2 ? { approved: true, meta: {} } : approval.promise
    },
    callTool: () => {
      callCount += 1
      if (callCount === 1) return Promise.resolve(taskResult('live'))
      return lateCall.promise
    },
    cancel: () => new Promise(() => {}),
  })

  await manager.start({ toolName: 'flow_live', args: {} })
  ;(await nextGet(calls, 0)).resolve({ taskId: 'live', status: 'working' })
  await flush()

  // Past approval, waiting on callTool.
  const late = manager.start({ toolName: 'flow_late', args: {} })
  // Still in approval.
  const pendingApproval = manager.start({ toolName: 'flow_pending', args: {} })
  await flush()
  assert.equal(calls.approve.length, 3)

  const startedAt = Date.now()
  const done = manager.shutdown({ timeoutMs: 20 })
  assert.equal(calls.approve[2].signal.aborted, true)
  assert.deepEqual(await manager.start({ toolName: 'flow_x', args: {} }), {
    isError: true,
    content: [{ type: 'text', text: 'Rig is shutting down' }],
  })

  lateCall.resolve(taskResult('late'))
  approval.resolve({ approved: true, meta: {} })
  await done
  assert.ok(Date.now() - startedAt < 1000)
  assert.ok(calls.cancel.includes('live'))
  assert.ok(calls.cancel.includes('late'))
  assert.equal((await late).isError, true)
  assert.equal((await pendingApproval).isError, true)
  assert.equal(calls.callTool.length, 2)
})
