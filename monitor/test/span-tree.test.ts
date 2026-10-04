import { expect, test, vi } from 'vitest'

import { barPosition, buildSpanTree } from '../src/flow/span-tree.js'
import { run, span } from './fixtures.js'

test('orphan spans hang under the synthetic run root', () => {
  const { root } = buildSpanTree([span('orphan', 'missing')], run())
  expect(root.children.map((node) => node.id)).toEqual(['orphan'])
  expect(root.start).toBe(1)
})

test('spans nest by parent ID regardless of input order', () => {
  const { root } = buildSpanTree([span('child', 'parent'), span('parent')], run())
  expect(root.children.map((node) => node.id)).toEqual(['parent'])
  expect(root.children[0].children.map((node) => node.id)).toEqual(['child'])
  expect(root.children[0].status).toBe('ok')
})

test('bar position uses fractions of the full time range', () => {
  const { root } = buildSpanTree([span('halfway')], run())
  expect(barPosition(root.children[0], 0, 100)).toEqual({ left: 0.5, width: 0.25 })
})

test('active roots stay open while their time range advances', () => {
  vi.spyOn(Date, 'now').mockReturnValue(100)
  try {
    const { root, end } = buildSpanTree([], run())
    expect(root.end).toBeUndefined()
    expect(end).toBe(100)
  } finally {
    vi.restoreAllMocks()
  }
})

test('terminal roots end at the snapshot update time', () => {
  const { root, start, end } = buildSpanTree([], { ...run('done', 'completed'), updatedAt: 100 })
  expect(root.end).toBe(100)
  expect(barPosition(root, start, end)).toEqual({ left: 0, width: 1 })
})

test('zero-duration time ranges do not produce invalid positions', () => {
  const { root } = buildSpanTree([], run('done', 'completed'))
  expect(barPosition(root, 1, 1)).toEqual({ left: 0, width: 0 })
})
