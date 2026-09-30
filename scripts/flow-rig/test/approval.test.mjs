import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createApprovalStrategy, createApprove } from '../approval.mjs'

function strategyWith(options) {
  const dialogCalls = []
  const strategy = createApprovalStrategy({
    allow: ['x:*'],
    confirm: 'desktop',
    confirmDialog: async (flow, signal) => {
      dialogCalls.push({ flow, signal })
      return options.dialogResult ?? true
    },
    ...options,
  })
  return { strategy, dialogCalls }
}

test('request without flow is approved', async () => {
  const { strategy } = strategyWith({})
  assert.equal(await strategy({ toolCall: {} }), true)
})

test('all tools allowed skips the dialog', async () => {
  const { strategy, dialogCalls } = strategyWith({})
  const flow = { name: 'f', tools: ['x:a', 'x:b'] }
  assert.equal(await strategy({ flow }), true)
  assert.equal(dialogCalls.length, 0)
})

test('empty tools is approved', async () => {
  const { strategy } = strategyWith({})
  assert.equal(await strategy({ flow: { name: 'f', tools: [] } }), true)
})

test('disallowed tool with deny', async () => {
  const { strategy } = strategyWith({ confirm: 'deny', allow: ['q:*'] })
  const flow = { name: 'f', tools: ['q:a', 'x:y'] }
  assert.deepEqual(await strategy({ flow }), {
    approved: false,
    reason: 'Not in allowlist: x:y',
  })
})

test('deny lists all disallowed tools in order', async () => {
  const { strategy } = strategyWith({ confirm: 'deny', allow: [] })
  const flow = { name: 'f', tools: ['b:1', 'a:2'] }
  assert.deepEqual(await strategy({ flow }), {
    approved: false,
    reason: 'Not in allowlist: b:1, a:2',
  })
})

test('disallowed tool with approve', async () => {
  const { strategy } = strategyWith({ confirm: 'approve', allow: [] })
  assert.equal(await strategy({ flow: { name: 'f', tools: ['x:y'] } }), true)
})

test('disallowed tool with desktop uses dialog', async () => {
  const signal = new AbortController().signal
  const flow = { name: 'f', tools: ['z:y'] }
  const yes = strategyWith({ dialogResult: true })
  assert.equal(await yes.strategy({ flow, signal }), true)
  assert.equal(yes.dialogCalls[0].flow, flow)
  assert.equal(yes.dialogCalls[0].signal, signal)

  const no = strategyWith({ dialogResult: false })
  assert.deepEqual(await no.strategy({ flow, signal }), {
    approved: false,
    reason: 'Declined on desktop',
  })
})

test('createApprove builds the request', async () => {
  let seen
  const controller = new AbortController()
  const args = { a: 1 }
  const approve = createApprove({
    wrapped: async (request) => {
      seen = request
      return true
    },
  })
  await approve({ runId: 'r1', toolName: 'run_flow', args, signal: controller.signal })
  assert.deepEqual(seen, {
    toolCall: { id: 'r1', name: 'flow:run_flow', arguments: JSON.stringify(args) },
    iteration: 1,
    history: [],
    signal: controller.signal,
  })
})

test('createApprove normalizes results', async () => {
  const run = (result) =>
    createApprove({ wrapped: async () => result })({
      runId: 'r',
      toolName: 't',
      args: {},
      signal: undefined,
    })
  assert.deepEqual(await run(true), { approved: true, meta: {} })
  assert.deepEqual(await run({ approved: true, meta: { k: 1 } }), {
    approved: true,
    meta: { k: 1 },
  })
  assert.deepEqual(await run(false), { approved: false, reason: 'denied' })
  assert.deepEqual(await run({ approved: false, reason: 'no' }), { approved: false, reason: 'no' })
})
