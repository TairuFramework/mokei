import { toB64U } from '@sozai/codec'
import { expect, test } from 'vitest'

import {
  assertStandardClaims,
  decodeJWT,
  scopesFromClaim,
  TokenVerificationError,
} from '../src/auth/verifier.js'

function b64u(text: string): string {
  return toB64U(new TextEncoder().encode(text))
}

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

test('rejects a token whose exp + tolerance exactly equals now (boundary is inclusive)', () => {
  expect(() =>
    assertStandardClaims(
      { aud: resource, exp: 970, iss: 'https://as' },
      { resource, now: 1000, toleranceSeconds: 30 },
    ),
  ).toThrow(/expired|exp/i)
})

// M2: `nbf` is an inclusive lower bound -- a token is valid AT `nbf` -- unlike `exp`'s exclusive
// upper bound above, so the boundary case (nbf - tolerance === now) must be ACCEPTED, not rejected.
test('accepts a token whose nbf - tolerance exactly equals now (nbf boundary is inclusive)', () => {
  expect(() =>
    assertStandardClaims(
      { aud: resource, nbf: 1030, iss: 'https://as' },
      { resource, now: 1000, toleranceSeconds: 30 },
    ),
  ).not.toThrow()
})

test('rejects a token whose nbf - tolerance is one second beyond now', () => {
  expect(() =>
    assertStandardClaims(
      { aud: resource, nbf: 1031, iss: 'https://as' },
      { resource, now: 1000, toleranceSeconds: 30 },
    ),
  ).toThrow(/not yet valid/i)
})

test('malformed base64url/JSON in the payload segment throws invalid_token, not a raw decode error', () => {
  let caught: unknown
  try {
    decodeJWT('aaa.!!!.bbb')
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(TokenVerificationError)
  expect((caught as TokenVerificationError).code).toBe('invalid_token')
})

test('a non-object (null) header segment throws invalid_token, not a raw TypeError', () => {
  const header = b64u('null')
  const payload = b64u(JSON.stringify({ aud: resource, exp: 2000 }))
  const signature = b64u('sig')
  let caught: unknown
  try {
    decodeJWT(`${header}.${payload}.${signature}`)
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(TokenVerificationError)
  expect((caught as TokenVerificationError).code).toBe('invalid_token')
})

test('a non-object (array) payload segment throws invalid_token, not a raw TypeError', () => {
  const header = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = b64u('[]')
  const signature = b64u('sig')
  let caught: unknown
  try {
    decodeJWT(`${header}.${payload}.${signature}`)
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(TokenVerificationError)
  expect((caught as TokenVerificationError).code).toBe('invalid_token')
})
