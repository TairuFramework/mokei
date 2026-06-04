import { render } from 'ink-testing-library'
import React, { act, useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { useElapsed } from '../../src/chat/hooks/useElapsed.js'

function Harness({ active, onTick }: { active: boolean; onTick: (now: number) => void }) {
  const now = useElapsed(active)
  useEffect(() => {
    onTick(now)
  }, [now, onTick])
  return null
}

describe('useElapsed', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  test('emits new values while active', () => {
    const ticks: Array<number> = []
    render(<Harness active onTick={(n) => ticks.push(n)} />)
    const initialCount = ticks.length
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(ticks.length).toBeGreaterThan(initialCount)
  })

  test('does not tick while inactive', () => {
    const ticks: Array<number> = []
    render(<Harness active={false} onTick={(n) => ticks.push(n)} />)
    const initialCount = ticks.length
    vi.advanceTimersByTime(3000)
    expect(ticks.length).toBe(initialCount)
  })
})
