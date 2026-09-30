import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createInputTracker } from '../inputs.mjs'

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

function snapshot(keys, status = 'input_required') {
  return {
    status,
    inputRequests: Object.fromEntries(keys.map((key) => [key, REQUEST])),
  }
}

function setup(options = {}) {
  const asks = []
  const updates = []
  const logs = []
  const tracker = createInputTracker({
    ask(requestKey, request, signal) {
      const d = deferred()
      asks.push({ requestKey, request, signal, ...d })
      return d.promise
    },
    update(responses) {
      const d = deferred()
      updates.push({ responses, ...d })
      return d.promise
    },
    log(message, error) {
      logs.push({ message, error })
    },
    ...options,
  })
  return { tracker, asks, updates, logs }
}

test('asks once per new key', () => {
  const { tracker, asks } = setup()
  tracker.reconcile(snapshot(['a']))
  tracker.reconcile(snapshot(['a']))
  assert.equal(asks.length, 1)
  assert.equal(asks[0].requestKey, 'a')
  assert.deepEqual(asks[0].request, REQUEST)
  assert.equal(tracker.records.get('a').state, 'asking')
})

test('withdraws an asking key missing from a later snapshot', async () => {
  const { tracker, asks, updates } = setup()
  tracker.reconcile(snapshot(['a']))
  tracker.reconcile(snapshot([]))
  assert.equal(asks[0].signal.aborted, true)
  assert.equal(tracker.records.get('a').state, 'done')
  asks[0].resolve({ action: 'accept', content: { value: 'x' } })
  await flush()
  assert.equal(updates.length, 0)
})

test('aborts every asking record once the task is not input_required', () => {
  const { tracker, asks } = setup()
  tracker.reconcile(snapshot(['a', 'b']))
  tracker.reconcile({ status: 'working' })
  assert.equal(asks[0].signal.aborted, true)
  assert.equal(asks[1].signal.aborted, true)
  assert.equal(tracker.records.get('a').state, 'done')
  assert.equal(tracker.records.get('b').state, 'done')
})

test('sends an accepted result and marks done after the update', async () => {
  const { tracker, asks, updates } = setup()
  tracker.reconcile(snapshot(['a']))
  const result = { action: 'accept', content: { value: 'x' } }
  asks[0].resolve(result)
  await flush()
  assert.equal(updates.length, 1)
  assert.deepEqual(updates[0].responses, { a: result })
  assert.equal(tracker.records.get('a').state, 'sending')
  updates[0].resolve()
  await flush()
  assert.equal(tracker.records.get('a').state, 'done')
})

test('sends a decline unchanged', async () => {
  const { tracker, asks, updates } = setup()
  tracker.reconcile(snapshot(['a']))
  asks[0].resolve({ action: 'decline' })
  await flush()
  assert.deepEqual(updates[0].responses, { a: { action: 'decline' } })
})

test('answers cancel and logs when the handler rejects', async () => {
  const { tracker, asks, updates, logs } = setup()
  tracker.reconcile(snapshot(['a']))
  const error = new Error('boom')
  asks[0].reject(error)
  await flush()
  assert.deepEqual(updates[0].responses, { a: { action: 'cancel' } })
  assert.equal(logs.length, 1)
  assert.equal(logs[0].error, error)
})

test('marks a stale update done without retrying', async () => {
  const { tracker, asks, updates, logs } = setup()
  tracker.reconcile(snapshot(['a']))
  asks[0].resolve({ action: 'accept', content: {} })
  await flush()
  updates[0].reject({ code: -32602, message: 'not pending' })
  await flush()
  assert.equal(tracker.records.get('a').state, 'done')
  assert.equal(logs.length, 1)
  tracker.reconcile(snapshot(['a']))
  await flush()
  assert.equal(updates.length, 1)
  assert.equal(tracker.error, undefined)
})

test('retries other update errors on reconcile up to maxAttempts', async () => {
  const { tracker, asks, updates } = setup()
  tracker.reconcile(snapshot(['a']))
  const result = { action: 'accept', content: { value: 'x' } }
  asks[0].resolve(result)
  await flush()
  updates[0].reject(new Error('network'))
  await flush()
  assert.equal(tracker.records.get('a').state, 'sending')

  tracker.reconcile(snapshot(['a']))
  // A second reconcile while the retry is in flight does not send again.
  tracker.reconcile(snapshot(['a']))
  assert.equal(updates.length, 2)
  assert.equal(asks.length, 1)
  assert.deepEqual(updates[1].responses, { a: result })
  updates[1].reject(new Error('network'))
  await flush()
  assert.equal(tracker.records.get('a').state, 'sending')
  assert.equal(tracker.error, undefined)

  tracker.reconcile(snapshot(['a']))
  assert.equal(updates.length, 3)
  updates[2].reject(new Error('still down'))
  await flush()
  assert.equal(tracker.records.get('a').state, 'done')
  assert.match(tracker.error, /input a:/)
  assert.match(tracker.error, /still down/)

  tracker.reconcile(snapshot(['a']))
  assert.equal(updates.length, 3)
  assert.equal(asks.length, 1)
})

test('marks a sending record done when its key is gone', async () => {
  const { tracker, asks, updates } = setup()
  tracker.reconcile(snapshot(['a']))
  asks[0].resolve({ action: 'accept', content: {} })
  await flush()
  updates[0].reject(new Error('network'))
  await flush()
  tracker.reconcile(snapshot([]))
  assert.equal(tracker.records.get('a').state, 'done')
  assert.equal(updates.length, 1)
})

test('abortAll aborts asking records and drops later results', async () => {
  const { tracker, asks, updates } = setup()
  tracker.reconcile(snapshot(['a', 'b']))
  tracker.abortAll()
  assert.equal(asks[0].signal.aborted, true)
  assert.equal(asks[1].signal.aborted, true)
  assert.equal(tracker.records.get('a').state, 'done')
  asks[0].resolve({ action: 'accept', content: {} })
  await flush()
  assert.equal(updates.length, 0)
})

test('settled waits for an in-flight update', async () => {
  const { tracker, asks, updates } = setup()
  await tracker.settled()
  tracker.reconcile(snapshot(['a']))
  asks[0].resolve({ action: 'accept', content: {} })
  await flush()
  let settled = false
  const done = tracker.settled().then(() => {
    settled = true
  })
  await flush()
  assert.equal(settled, false)
  updates[0].resolve()
  await done
  assert.equal(settled, true)
})

test('a handler rejecting after withdrawal or abortAll is not logged or sent', async () => {
  const { tracker, asks, updates, logs } = setup()
  tracker.reconcile(snapshot(['a', 'b']))
  tracker.reconcile(snapshot(['b']))
  tracker.abortAll()
  asks[0].reject(asks[0].signal.reason)
  asks[1].reject(asks[1].signal.reason)
  await flush()
  assert.deepEqual(logs, [])
  assert.equal(updates.length, 0)
})

test('withdrawReason builds the abort reason for each key', () => {
  const { tracker, asks } = setup({ withdrawReason: (key) => new Error(`withdrawn ${key}`) })
  tracker.reconcile(snapshot(['a', 'b']))
  tracker.reconcile(snapshot(['b']))
  tracker.abortAll()
  assert.equal(asks[0].signal.reason.message, 'withdrawn a')
  assert.equal(asks[1].signal.reason.message, 'withdrawn b')
})
