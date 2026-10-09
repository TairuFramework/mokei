import type { HozonDB } from '@hozon/db'
import type { TraceSummary, TracesListParams } from '@mokei/host-protocol'
import { afterEach, beforeEach, expect, test } from 'vitest'

import { getTraceIndexStore, openMokeiDatabase, type TraceIndexStore } from '../src/index.js'

let db: HozonDB
let store: TraceIndexStore
beforeEach(async () => {
  db = await openMokeiDatabase({ path: ':memory:' })
  store = await getTraceIndexStore(db)
})
afterEach(async () => {
  await db.close()
})

function summary(traceID: string, patch: Partial<TraceSummary> = {}): TraceSummary {
  return {
    traceID,
    rootSpanID: `root-${traceID}`,
    kind: 'flow',
    name: 'Example flow',
    active: false,
    outcome: 'ok',
    startTime: 100,
    attributes: {},
    spanCount: 2,
    errorCount: 0,
    droppedCount: 0,
    revision: 1,
    ...patch,
  }
}

test('round-trips every field and absent optional fields', async () => {
  const full = summary('full', {
    active: true,
    outcome: null,
    activeSegmentSpanID: 'segment',
    endTime: 200.5,
    startTime: 100.25,
    attributes: { 'run.id': 'run', 'flow.id': 'flow', 'mokei.context.id': 'ctx', label: 'label' },
    errorCount: 1,
    droppedCount: 3,
  })
  await store.upsert([full, summary('minimal')])
  expect(await store.get('full')).toEqual(full)
  expect(await store.get('minimal')).toEqual(summary('minimal'))
  expect(await store.get('missing')).toBeUndefined()
  await store.upsert([])
})

test('preserves JSON-looking string attributes through get and list', async () => {
  const trace = summary('trace', { attributes: { label: '{"a":1}', 'flow.id': '[1,2]' } })
  await store.upsert([trace])
  expect(await store.get('trace')).toEqual(trace)
  expect((await store.list({ limit: 10 })).traces).toEqual([trace])
})

test('replaces rows only for a higher revision, including duplicates in a batch', async () => {
  await store.upsert([summary('trace', { revision: 3, endTime: 150 })])
  await store.upsert([
    summary('trace', { revision: 2 }),
    summary('trace', { revision: 3, name: 'stale' }),
  ])
  expect(await store.get('trace')).toEqual(summary('trace', { revision: 3, endTime: 150 }))
  const next = summary('trace', { revision: 4, active: true, outcome: null })
  await store.upsert([next, summary('trace', { revision: 1 })])
  expect(await store.get('trace')).toEqual(next)
})

async function seed() {
  await store.upsert([
    summary('a', { startTime: 100, name: 'Alpha 100%_done' }),
    summary('b', { startTime: 200, kind: 'mcp', name: 'ALPHA call', outcome: 'error' }),
    summary('c', { startTime: 200, kind: 'context', name: 'Beta', active: true, outcome: null }),
    summary('d', { startTime: 300, kind: 'step', name: 'Alpha step', outcome: 'interrupted' }),
  ])
}

test('filters kind, active, nullable outcome, literal case-insensitive name and inclusive time bounds', async () => {
  await seed()
  const cases: Array<[Partial<TracesListParams>, Array<string>]> = [
    [{ kind: 'mcp' }, ['b']],
    [{ active: true }, ['c']],
    [{ active: false }, ['d', 'b', 'a']],
    [{ outcome: 'error' }, ['b']],
    [{ outcome: null }, ['c']],
    [{ outcome: 'ok' }, ['a']],
    [{ outcome: 'interrupted' }, ['d']],
    [{ name: 'alpha' }, ['d', 'b', 'a']],
    [{ name: '%_done' }, ['a']],
    [{ since: 200, until: 200 }, ['c', 'b']],
    [{ kind: 'flow', active: false, outcome: 'ok', name: 'ALPHA', since: 100, until: 100 }, ['a']],
  ]
  for (const [params, expected] of cases) {
    expect((await store.list({ limit: 10, ...params })).traces.map((row) => row.traceID)).toEqual(
      expected,
    )
  }
})

test('matches non-ASCII names using JavaScript case folding', async () => {
  await store.upsert([summary('unicode', { name: 'Éclair' })])
  expect(
    (await store.list({ limit: 10, name: 'éclair' })).traces.map((row) => row.traceID),
  ).toEqual(['unicode'])
  expect(
    (await store.list({ limit: 10, name: 'ÉCLAIR' })).traces.map((row) => row.traceID),
  ).toEqual(['unicode'])
})

test('pages newest first with descending trace IDs breaking timestamp ties', async () => {
  await seed()
  const first = await store.list({ limit: 2 })
  expect(first.traces.map((row) => row.traceID)).toEqual(['d', 'c'])
  expect(first.cursor).toBeTypeOf('string')
  const second = await store.list({ limit: 2, cursor: first.cursor })
  expect(second.traces.map((row) => row.traceID)).toEqual(['b', 'a'])
  expect(second.cursor).toBeUndefined()
  expect(await store.list({ limit: 0 })).toEqual({ traces: [] })
})

test('interrupts only active rows, clears the open segment and increments their revisions once', async () => {
  await seed()
  await store.upsert([
    summary('e', { active: true, outcome: null, revision: 8, activeSegmentSpanID: 'open' }),
  ])
  expect((await store.listActiveIDs()).sort()).toEqual(['c', 'e'])
  expect(await store.markInterrupted()).toBe(2)
  expect(await store.get('e')).toEqual(summary('e', { outcome: 'interrupted', revision: 9 }))
  expect(await store.get('c')).toEqual(
    summary('c', {
      startTime: 200,
      kind: 'context',
      name: 'Beta',
      outcome: 'interrupted',
      revision: 2,
    }),
  )
  expect(await store.get('b')).toEqual(
    summary('b', { startTime: 200, kind: 'mcp', name: 'ALPHA call', outcome: 'error' }),
  )
  expect(await store.listActiveIDs()).toEqual([])
  expect(await store.markInterrupted()).toBe(0)
})

test('deletes older traces while preserving keep IDs and the cutoff boundary', async () => {
  await seed()
  expect(await store.deleteBefore(300, { keepTraceIDs: ['b', 'missing'] })).toBe(1)
  expect((await store.list({ limit: 10 })).traces.map((row) => row.traceID)).toEqual([
    'd',
    'c',
    'b',
  ])
  expect(await store.deleteBefore(300, { keepTraceIDs: [] })).toBe(1)
  expect(await store.get('c')).toBeDefined()
  expect(await store.get('d')).toBeDefined()
  expect(await store.deleteBefore(400)).toBe(1)
})

test('keeps inactive summaries whose end time is after the cutoff', async () => {
  await store.upsert([summary('spans-cutoff', { startTime: 1, endTime: 20 })])
  expect(await store.deleteBefore(10, { keepTraceIDs: [] })).toBe(0)
  expect(await store.get('spans-cutoff')).toEqual(
    summary('spans-cutoff', { startTime: 1, endTime: 20 }),
  )
})

test('deletes requested traces and returns the number of existing rows', async () => {
  await seed()
  expect(await store.deleteByTrace([])).toBe(0)
  expect(await store.deleteByTrace(['a', 'c', 'missing', 'a'])).toBe(2)
  expect((await store.list({ limit: 10 })).traces.map((row) => row.traceID)).toEqual(['d', 'b'])
})

test('name filter searches span name, label and flow ID as literal case-insensitive text', async () => {
  await store.upsert([
    summary('named', {
      name: 'flow.run',
      attributes: { label: 'Éclair 100%_done!', 'flow.id': 'Review-Flow' },
    }),
    summary('other'),
  ])
  for (const name of ['FLOW.RUN', 'éCLAIR', '100%_done!', 'REVIEW-flow']) {
    expect((await store.list({ limit: 10, name })).traces.map((row) => row.traceID)).toEqual([
      'named',
    ])
  }
  expect((await store.list({ limit: 10, name: 'missing' })).traces).toEqual([])
  await store.upsert([
    summary('named', { revision: 2, name: 'flow.run', attributes: { label: 'New label' } }),
  ])
  expect((await store.list({ limit: 10, name: 'éclair' })).traces).toEqual([])
  expect(
    (await store.list({ limit: 10, name: 'NEW LABEL' })).traces.map((row) => row.traceID),
  ).toEqual(['named'])
})
