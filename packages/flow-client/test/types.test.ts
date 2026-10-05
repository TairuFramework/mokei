import { describe, expect, test } from 'vitest'

import { isTerminalRunState } from '../src/index.js'

describe('isTerminalRunState', () => {
  test.each(['denied', 'completed', 'failed', 'cancelled'] as const)('%s is terminal', (state) => {
    expect(isTerminalRunState(state)).toBe(true)
  })

  test.each(['awaiting_approval', 'working', 'input_required'] as const)(
    '%s is not terminal',
    (state) => {
      expect(isTerminalRunState(state)).toBe(false)
    },
  )
})
