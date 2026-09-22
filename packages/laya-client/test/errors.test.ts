import { describe, expect, test } from 'vitest'

import {
  LayaAuthError,
  LayaConnectionError,
  LayaError,
  LayaInputError,
  LayaModelError,
  LayaResponseError,
} from '../src/errors.js'

describe('Laya errors', () => {
  test('every subclass extends LayaError and keeps its name', () => {
    for (const [err, name] of [
      [new LayaConnectionError('x'), 'LayaConnectionError'],
      [new LayaAuthError('x'), 'LayaAuthError'],
      [new LayaModelError('x'), 'LayaModelError'],
    ] as const) {
      expect(err).toBeInstanceOf(LayaError)
      expect(err.name).toBe(name)
    }
  })

  test('input and response errors carry validation issues', () => {
    const input = new LayaInputError('bad', [{ message: 'missing type', path: ['dept', 'type'] }])
    const response = new LayaResponseError('bad', [
      { message: 'missing answers', path: ['answers'] },
    ])
    expect(input).toBeInstanceOf(LayaError)
    expect(input.issues.at(0)?.message).toBe('missing type')
    expect(response.issues.at(0)?.message).toBe('missing answers')
  })
})
