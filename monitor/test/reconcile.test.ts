import { describe, expect, test } from 'vitest'

import {
  applyInboxEvent,
  applyRunEvent,
  createGenerationGuard,
  mergeInboxSnapshot,
} from '../src/flow/reconcile.js'
import { item, run } from './fixtures.js'

describe('reconciliation', () => {
  test('replaces a run by runID without mutating the old map', () => {
    const old = new Map([
      ['run-1', run()],
      ['run-2', run('run-2')],
    ])
    const next = applyRunEvent(old, { type: 'run:state', data: run('run-1', 'completed') })
    expect(next.size).toBe(2)
    expect(next.get('run-1')?.state).toBe('completed')
    expect(old.get('run-1')?.state).toBe('working')
  })

  test('a snapshot cannot resurrect a tombstoned item', () => {
    const original = { items: new Map([['item-1', item()]]), settled: new Map() }
    const settled = applyInboxEvent(original, {
      type: 'inbox:settled',
      data: { item: item(), outcome: 'answered' },
    })
    const merged = mergeInboxSnapshot(settled, [item(), item('item-2')])
    expect([...merged.items.keys()]).toEqual(['item-2'])
    expect(merged.settled.get('item-1')).toBe('answered')
    expect(original.items.has('item-1')).toBe(true)
    expect(applyInboxEvent(merged, { type: 'inbox:added', data: item() }).items.has('item-1')).toBe(
      false,
    )
  })

  test('generation guard discards an old read', () => {
    const guard = createGenerationGuard()
    const old = guard.next()
    const current = guard.next()
    expect(guard.isCurrent(old)).toBe(false)
    expect(guard.isCurrent(current)).toBe(true)
  })
})
