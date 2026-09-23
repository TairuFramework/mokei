import { describe, expect, test } from 'vitest'

import {
  SystemOneAuthError,
  SystemOneConnectionError,
  SystemOneError,
  SystemOneInputError,
  SystemOneModelError,
  SystemOneResponseError,
} from '../src/errors.js'

describe('System One errors', () => {
  test('every error class extends SystemOneError and keeps its name', () => {
    for (const [err, name] of [
      [new SystemOneError('x'), 'SystemOneError'],
      [new SystemOneInputError('x'), 'SystemOneInputError'],
      [new SystemOneConnectionError('x'), 'SystemOneConnectionError'],
      [new SystemOneAuthError('x'), 'SystemOneAuthError'],
      [new SystemOneResponseError('x'), 'SystemOneResponseError'],
      [new SystemOneModelError('x'), 'SystemOneModelError'],
    ] as const) {
      expect(err).toBeInstanceOf(SystemOneError)
      expect(err.name).toBe(name)
    }
  })

  test('input and response errors carry validation issues', () => {
    const input = new SystemOneInputError('bad', [
      { message: 'missing type', path: ['dept', 'type'] },
    ])
    const response = new SystemOneResponseError('bad', [
      { message: 'missing answers', path: ['answers'] },
    ])
    expect(input).toBeInstanceOf(SystemOneError)
    expect(input.issues.at(0)?.message).toBe('missing type')
    expect(response.issues.at(0)?.message).toBe('missing answers')
  })
})
