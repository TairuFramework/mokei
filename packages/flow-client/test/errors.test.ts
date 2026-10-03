import { describe, expect, test } from 'vitest'

import { FlowControlError, isFlowControlError, TERMINAL_RUN_STATES } from '../src/index.js'

describe('FlowControlError', () => {
  test('carries code, message, name, data and cause', () => {
    const cause = new Error('boom')
    const err = new FlowControlError({
      code: 'RUN_NOT_FOUND',
      message: 'x',
      data: { runID: 'r1' },
      cause,
    })
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe('RUN_NOT_FOUND')
    expect(err.message).toBe('x')
    expect(err.name).toBe('FlowControlError')
    expect(err.data).toEqual({ runID: 'r1' })
    expect(err.cause).toBe(cause)
  })

  test('isFlowControlError narrows by class and optional code', () => {
    const err = new FlowControlError({ code: 'RUN_NOT_FOUND', message: 'x' })
    expect(isFlowControlError(err)).toBe(true)
    expect(isFlowControlError(err, 'RUN_NOT_FOUND')).toBe(true)
    expect(isFlowControlError(err, 'FLOW_INVALID')).toBe(false)
    expect(isFlowControlError(new Error())).toBe(false)
    expect(isFlowControlError(undefined)).toBe(false)
  })
})

describe('TERMINAL_RUN_STATES', () => {
  test('lists terminal states', () => {
    expect(TERMINAL_RUN_STATES).toEqual(['denied', 'completed', 'failed', 'cancelled'])
  })
})
