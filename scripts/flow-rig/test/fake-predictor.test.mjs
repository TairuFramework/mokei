import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createFakePredictor } from '../fake-predictor.mjs'

test('returns configured answers for asked keys', async () => {
  const predictor = createFakePredictor({ label: 'spam' })
  const result = await predictor.predict({ questions: { label: {} }, state: {} })
  assert.deepEqual(result, {
    model: 'fake',
    answers: { label: 'spam' },
    usage: { inputTokens: 0, outputTokens: 0 },
  })
})

test('returns only asked keys', async () => {
  const predictor = createFakePredictor({ label: 'spam', other: 1 })
  const result = await predictor.predict({ questions: { label: {} }, state: {} })
  assert.deepEqual(result.answers, { label: 'spam' })
})

test('rejects on a missing key', async () => {
  const predictor = createFakePredictor({})
  await assert.rejects(
    predictor.predict({ questions: { label: {} }, state: {} }),
    /No fake answer for label/,
  )
})

test('rejects with the signal reason when aborted', async () => {
  const predictor = createFakePredictor({ label: 'x' })
  const reason = new Error('stop')
  const controller = new AbortController()
  controller.abort(reason)
  await assert.rejects(
    predictor.predict({ questions: { label: {} }, state: {}, signal: controller.signal }),
    (err) => err === reason,
  )
})
