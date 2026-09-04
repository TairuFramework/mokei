import { expect, test } from 'vitest'

import {
  assertStandardClaims,
  scopesFromClaim,
  TokenVerificationError,
} from '../src/auth/verifier.js'

const resource = 'https://mcp.example.com/mcp'

test('accepts a token bound to the resource and unexpired', () => {
  expect(() =>
    assertStandardClaims(
      { aud: resource, exp: 2000, iss: 'https://as' },
      { resource, now: 1000, toleranceSeconds: 30 },
    ),
  ).not.toThrow()
})

test('rejects a wrong audience', () => {
  expect(() =>
    assertStandardClaims(
      { aud: 'https://other', exp: 2000, iss: 'https://as' },
      { resource, now: 1000, toleranceSeconds: 30 },
    ),
  ).toThrow(TokenVerificationError)
})

test('rejects an expired token', () => {
  expect(() =>
    assertStandardClaims(
      { aud: resource, exp: 900, iss: 'https://as' },
      { resource, now: 1000, toleranceSeconds: 30 },
    ),
  ).toThrow(/expired|exp/i)
})

test('extracts space-delimited scopes', () => {
  expect(scopesFromClaim({ scope: 'a b c' })).toEqual(['a', 'b', 'c'])
})
