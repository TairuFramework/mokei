import type { OpenSpan, StoredSpan, TraceLog, TraceSummary } from '@mokei/host-protocol'
import { expect, test } from 'vitest'

import {
  applyLog,
  applySnapshot,
  applySpan,
  mergeSummaries,
  type TraceState,
} from '../src/traces/trace-merge.js'

export const summary: TraceSummary = {
  traceID: 'trace-a',
  rootSpanID: 'root-a',
  kind: 'flow',
  name: 'Example',
  active: true,
  outcome: null,
  startTime: 100,
  attributes: {},
  spanCount: 0,
  errorCount: 0,
  droppedCount: 0,
  revision: 1,
}
export const open: OpenSpan = {
  traceID: summary.traceID,
  spanID: summary.rootSpanID,
  name: 'flow.run',
  kind: 0,
  startTime: 100,
  attributes: {},
  links: [],
}
export const ended: StoredSpan = { ...open, endTime: 200, status: { code: 1 }, events: [] }
export const log: TraceLog = {
  logID: 'log-a',
  traceID: summary.traceID,
  spanID: open.spanID,
  timestamp: 150,
  level: 'info',
  category: ['mokei'],
  message: 'Hello',
  properties: {},
}
export function empty(): TraceState {
  return { spans: new Map(), logs: new Map(), logsTruncated: false }
}

test('only higher summary revisions replace existing values without mutating the input', () => {
  const current = new Map([[summary.traceID, summary]])
  const higher = { ...summary, revision: 3 }
  const next = mergeSummaries(current, [
    higher,
    { ...summary, revision: 2 },
    { ...higher, name: 'equal' },
  ])
  expect(next.get(summary.traceID)).toEqual(higher)
  expect(current.get(summary.traceID)).toEqual(summary)
})

test('ended spans replace open spans and cannot be replaced by open spans', () => {
  const initial = empty()
  const next = applySpan(applySpan(applySpan(initial, open), ended), open)
  expect(next.spans.get(open.spanID)).toEqual(ended)
  expect(initial.spans.size).toBe(0)
})

test('logs deduplicate by logID without mutating previous state', () => {
  const initial = empty()
  const next = applyLog(applyLog(initial, log), log)
  expect([...next.logs.values()]).toEqual([log])
  expect(initial.logs.size).toBe(0)
})

test('snapshots merge with buffered events and preserve newer summaries and ended spans', () => {
  const initial = { ...empty(), summary: { ...summary, revision: 3 } }
  const buffered = applyLog(applySpan(initial, ended), log)
  const next = applySnapshot(buffered, { summary, spans: [open], logs: [log], logsTruncated: true })
  expect(next.summary?.revision).toBe(3)
  expect([...next.spans.values()]).toEqual([ended])
  expect([...next.logs.values()]).toEqual([log])
  expect(next.logsTruncated).toBe(true)
})
