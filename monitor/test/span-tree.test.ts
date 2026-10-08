import type { OpenSpan, TraceSummary } from '@mokei/host-protocol'
import { expect, test } from 'vitest'

import { barPosition, buildTraceTree } from '../src/traces/span-tree.js'
import { span } from './fixtures.js'

const summary: TraceSummary = {
  traceID: 'trace-1',
  rootSpanID: 'root',
  kind: 'flow',
  name: 'Crashed flow',
  active: false,
  outcome: 'interrupted',
  startTime: 1,
  endTime: 100,
  attributes: { 'run.id': 'run-1' },
  spanCount: 2,
  errorCount: 0,
  droppedCount: 0,
  revision: 1,
}

test('open span extends to now', () => {
  const open: OpenSpan = {
    traceID: 'trace-1',
    spanID: 'open',
    name: 'Working',
    kind: 0,
    startTime: 50,
    attributes: {},
    links: [],
  }
  const { roots, start, end } = buildTraceTree([open], undefined, 100)
  expect(roots[0]).toMatchObject({ end: 100, open: true, placeholder: false, status: 'unset' })
  expect({ start, end }).toEqual({ start: 50, end: 100 })
  expect(buildTraceTree([open], undefined, 1100).roots[0].end).toBe(1100)
})

test('orphan renders under a placeholder parent', () => {
  const { roots } = buildTraceTree([span('one', 'missing'), span('two', 'missing')], undefined, 100)
  expect(roots).toHaveLength(1)
  expect(roots[0]).toMatchObject({ id: 'missing', placeholder: true, start: 50, end: 75 })
  expect(roots[0].children.map((node) => node.id)).toEqual(['one', 'two'])
  const resolved = buildTraceTree([span('one', 'missing'), span('missing')], undefined, 100)
  expect(resolved.roots[0].placeholder).toBe(false)
})

test('missing root renders a placeholder root from the summary', () => {
  const { roots, start, end } = buildTraceTree([span('child', 'root')], summary, 200)
  expect(roots).toHaveLength(1)
  expect(roots[0]).toMatchObject({
    id: 'root',
    name: 'Crashed flow',
    start: 1,
    end: 100,
    kind: 'flow',
    placeholder: true,
    open: false,
    attributes: summary.attributes,
  })
  expect(roots[0].children[0].id).toBe('child')
  expect({ start, end }).toEqual({ start: 1, end: 100 })
  expect(
    buildTraceTree([], { ...summary, active: true, endTime: undefined }, 200).roots[0],
  ).toMatchObject({ open: true, end: 200 })
})

test('context navigation uses its explicit trace ID instead of the first retry link', () => {
  const linked = {
    ...span('request'),
    attributes: { 'mokei.kind': 'mcp', 'mokei.context.trace_id': 'context-trace' },
    links: [
      { traceID: 'trace-1', spanID: 'first-leg' },
      { traceID: 'context-trace', spanID: 'context-span' },
    ],
  }
  expect(buildTraceTree([linked], undefined, 100).roots[0].contextLink).toEqual({
    traceID: 'context-trace',
  })
  expect(buildTraceTree([{ ...linked, links: [] }], undefined, 100).roots[0].contextLink).toEqual({
    traceID: 'context-trace',
  })
})

test.each([
  { 'mokei.kind': 'mcp' },
  { 'mokei.kind': 'mcp', 'mokei.context.trace_id': 'trace-1' },
  { 'mokei.kind': 'flow', 'mokei.context.trace_id': 'context-trace' },
])('context navigation ignores remote, same-trace and non-MCP links: %j', (attributes) => {
  const linked = {
    ...span('request'),
    attributes,
    links: [{ traceID: 'remote-trace', spanID: 'remote' }],
  }
  expect(buildTraceTree([linked], undefined, 100).roots[0].contextLink).toBeUndefined()
})

test('spans nest by parent ID regardless of input order', () => {
  const { roots } = buildTraceTree([span('child', 'parent'), span('parent')], undefined, 100)
  expect(roots.map((node) => node.id)).toEqual(['parent'])
  expect(roots[0].children[0]).toMatchObject({ id: 'child', status: 'ok', open: false })
})

test('bar position uses fractions and handles zero duration', () => {
  const { roots } = buildTraceTree([span('halfway')], undefined, 100)
  expect(barPosition(roots[0], 0, 100)).toEqual({ left: 0.5, width: 0.25 })
  expect(barPosition(roots[0], 1, 1)).toEqual({ left: 0, width: 0 })
})

test('empty trace has a finite zero duration range', () => {
  expect(buildTraceTree([], undefined, 100)).toEqual({ roots: [], start: 100, end: 100 })
})
