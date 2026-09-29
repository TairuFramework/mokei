import { expect, test } from 'vitest'

import { createGrantStore } from '../src/grants.js'

test('a grant is single-use', () => {
  const store = createGrantStore()
  const params = { toolName: 'run_flow', arguments: { question: 'hello' } }
  const token = store.issue({ ...params, tools: ['local:fetch'] })
  expect(store.consume({ token, ...params })).toEqual({ tools: ['local:fetch'] })
  expect(store.consume({ token, ...params })).toBeUndefined()
})

test('a grant expires after five minutes', () => {
  let now = 1000
  const store = createGrantStore({ now: () => now })
  const token = store.issue({ toolName: 'run_flow', arguments: {}, tools: [] })
  now += 300000
  expect(store.consume({ token, toolName: 'run_flow', arguments: {} })).toBeUndefined()
})

test('a mismatched tool or arguments cannot use a grant', () => {
  const store = createGrantStore()
  const token = store.issue({ toolName: 'run_flow', arguments: { a: 1 }, tools: ['local:fetch'] })
  expect(store.consume({ token, toolName: 'other', arguments: { a: 1 } })).toBeUndefined()
  expect(store.consume({ token, toolName: 'run_flow', arguments: { a: 2 } })).toBeUndefined()
  expect(store.consume({ token, toolName: 'run_flow', arguments: { a: 1 } })).toBeUndefined()
})

test('a grant matches reordered argument keys', () => {
  const store = createGrantStore()
  const token = store.issue({
    toolName: 'run_flow',
    arguments: { outer: { a: 1, b: 2 }, z: true },
    tools: ['local:fetch'],
  })
  expect(
    store.consume({
      token,
      toolName: 'run_flow',
      arguments: { z: true, outer: { b: 2, a: 1 } },
    }),
  ).toEqual({ tools: ['local:fetch'] })
})

test('expired grants are purged on issue and consume', () => {
  let now = 0
  const store = createGrantStore({ now: () => now, ttlMs: 10 })
  const stale = store.issue({ toolName: 'run_flow', arguments: {}, tools: [] })
  now = 11
  const fresh = store.issue({ toolName: 'run_flow', arguments: {}, tools: ['a'] })
  expect(store.consume({ token: stale, toolName: 'run_flow', arguments: {} })).toBeUndefined()
  expect(store.consume({ token: fresh, toolName: 'run_flow', arguments: {} })).toEqual({
    tools: ['a'],
  })
  now = 22
  expect(store.consume({ token: fresh, toolName: 'run_flow', arguments: {} })).toBeUndefined()
})

test('non-string tokens are refused', () => {
  const store = createGrantStore()
  expect(store.consume({ token: {}, toolName: 'run_flow', arguments: {} })).toBeUndefined()
})
