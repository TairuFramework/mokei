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
      [new SystemOneError({ message: 'x' }), 'SystemOneError'],
      [new SystemOneInputError({ message: 'x' }), 'SystemOneInputError'],
      [new SystemOneConnectionError({ message: 'x' }), 'SystemOneConnectionError'],
      [new SystemOneAuthError({ message: 'x' }), 'SystemOneAuthError'],
      [new SystemOneResponseError({ message: 'x' }), 'SystemOneResponseError'],
      [new SystemOneModelError({ message: 'x' }), 'SystemOneModelError'],
    ] as const) {
      expect(err).toBeInstanceOf(SystemOneError)
      expect(err.name).toBe(name)
    }
  })

  test('input and response errors carry validation issues', () => {
    const input = new SystemOneInputError({
      message: 'bad',
      issues: [{ message: 'missing type', path: ['dept', 'type'] }],
    })
    const response = new SystemOneResponseError({
      message: 'bad',
      issues: [{ message: 'missing answers', path: ['answers'] }],
    })
    expect(input).toBeInstanceOf(SystemOneError)
    expect(input.issues.at(0)?.message).toBe('missing type')
    expect(response.issues.at(0)?.message).toBe('missing answers')
  })
})
