import type { StoredSpan } from '@mokei/host-protocol'
import { describe, expect, test } from 'vitest'

import { nestSpans } from '../src/span-tree.js'

function span(spanID: string, startTime: number, parentSpanID?: string): StoredSpan {
  return {
    traceID: 'trace-1',
    spanID,
    parentSpanID,
    name: spanID,
    kind: 0,
    startTime,
    endTime: startTime + 10,
    status: { code: 0 },
    attributes: {},
    events: [],
    links: [],
  }
}

describe('nestSpans', () => {
  test('nests children under parents sorted by startTime', () => {
    const parent = span('parent', 10)
    const early = span('early', 20, 'parent')
    const late = span('late', 30, 'parent')
    const grandchild = span('grandchild', 40, 'early')
    const other = span('other', 50)
    const spans = [other, late, grandchild, early, parent]

    expect(nestSpans(spans)).toEqual([
      {
        span: parent,
        children: [
          { span: early, children: [{ span: grandchild, children: [] }] },
          { span: late, children: [] },
        ],
      },
      { span: other, children: [] },
    ])
    expect(spans).toEqual([other, late, grandchild, early, parent])
  })

  test('treats a span with an unknown parent as a root', () => {
    const orphan = span('orphan', 10, 'missing')
    const child = span('child', 20, 'orphan')

    expect(nestSpans([child, orphan])).toEqual([
      { span: orphan, children: [{ span: child, children: [] }] },
    ])
  })

  test('keeps spans in a parent cycle as roots', () => {
    const a = span('a', 10, 'b')
    const b = span('b', 20, 'a')
    const root = span('root', 30)

    expect(nestSpans([b, root, a])).toEqual([
      { span: root, children: [] },
      { span: a, children: [] },
      { span: b, children: [] },
    ])
  })
})
