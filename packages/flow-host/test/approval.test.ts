import { describe, expect, test } from 'vitest'

import { isAllowed, matchesAllow } from '../src/approval.js'

describe('approval globs', () => {
  test('matches wildcard characters within one colon segment', () => {
    expect(matchesAllow('sqlite:sqlite_get', ['sqlite:*'])).toBe(true)
    expect(matchesAllow('a:b:c', ['a:*'])).toBe(false)
  })

  test('allows a plan with no tools', () => {
    expect(isAllowed([], [])).toBe(true)
  })
})
