import { describe, expect, test } from 'vitest'

import {
  SYSTEM_ONE_ERROR_META,
  SystemOneAuthError,
  SystemOneConnectionError,
  SystemOneError,
  SystemOneInputError,
  SystemOneModelError,
  SystemOneOverloadedError,
  SystemOneRateLimitError,
  SystemOneResponseError,
  systemOneErrorFromInfo,
  systemOneErrorInfo,
} from '../src/index.js'

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

describe('portable error info', () => {
  test('uses the stable error meta key', () => {
    expect(SYSTEM_ONE_ERROR_META).toBe('dev.mokei/system-one-error')
  })

  test.each([
    SystemOneError,
    SystemOneInputError,
    SystemOneResponseError,
    SystemOneAuthError,
    SystemOneModelError,
    SystemOneConnectionError,
    SystemOneRateLimitError,
    SystemOneOverloadedError,
  ])('round-trips %s', (ErrorClass) => {
    const params = { message: 'failed', status: 529, retryAfterMs: 7000 }
    const original = new ErrorClass(params)
    const info = systemOneErrorInfo(original)
    const rebuilt = systemOneErrorFromInfo(JSON.parse(JSON.stringify(info)), original.message)
    expect(rebuilt).toBeInstanceOf(ErrorClass)
    expect(rebuilt.name).toBe(original.name)
    expect(rebuilt.message).toBe(original.message)
    expect(Object.keys(info)).toEqual(
      original instanceof SystemOneRateLimitError || original instanceof SystemOneOverloadedError
        ? ['name', 'status', 'retryAfterMs']
        : original instanceof SystemOneConnectionError
          ? ['name', 'status']
          : ['name'],
    )
    if (original instanceof SystemOneConnectionError) {
      expect((rebuilt as SystemOneConnectionError).status).toBe(original.status)
    }
    if (
      original instanceof SystemOneRateLimitError ||
      original instanceof SystemOneOverloadedError
    ) {
      expect((rebuilt as SystemOneRateLimitError).retryAfterMs).toBe(original.retryAfterMs)
    }
    if (rebuilt instanceof SystemOneInputError || rebuilt instanceof SystemOneResponseError) {
      expect(rebuilt.issues).toEqual([])
    }
  })

  test.each([SystemOneConnectionError, SystemOneRateLimitError, SystemOneOverloadedError])(
    'omits undefined optional fields (%s)',
    (ErrorClass) => {
      const error = new ErrorClass({ message: 'failed' })
      expect(systemOneErrorInfo(error)).toStrictEqual({ name: error.name })
    },
  )

  test.each(['Nope', 'constructor', '__proto__'])(
    'unknown name %s returns a plain SystemOneError',
    (name) => {
      const error = systemOneErrorFromInfo({ name }, 'm')
      expect(error.constructor).toBe(SystemOneError)
      expect(error.name).toBe('SystemOneError')
      expect(error.message).toBe('m')
    },
  )
})
