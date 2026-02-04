import { describe, expect, test } from 'vitest'

import { buildHTTPHeaders, type HTTPAuthOptions } from '../src/auth.js'

describe('buildHTTPHeaders', () => {
  test('returns base headers when no auth provided', () => {
    const headers = buildHTTPHeaders({ 'X-Custom': 'value' })
    expect(headers).toEqual({ 'X-Custom': 'value' })
  })

  test('adds bearer token authorization header', () => {
    const auth: HTTPAuthOptions = { type: 'bearer', token: 'test-token' }
    const headers = buildHTTPHeaders(undefined, auth)
    expect(headers).toEqual({ Authorization: 'Bearer test-token' })
  })

  test('adds basic authorization header', () => {
    const auth: HTTPAuthOptions = { type: 'basic', username: 'user', password: 'pass' }
    const headers = buildHTTPHeaders(undefined, auth)
    expect(headers).toEqual({ Authorization: `Basic ${btoa('user:pass')}` })
  })

  test('adds custom header', () => {
    const auth: HTTPAuthOptions = { type: 'header', name: 'X-API-Key', value: 'secret' }
    const headers = buildHTTPHeaders(undefined, auth)
    expect(headers).toEqual({ 'X-API-Key': 'secret' })
  })

  test('merges base headers with auth header', () => {
    const auth: HTTPAuthOptions = { type: 'bearer', token: 'tk' }
    const headers = buildHTTPHeaders({ 'X-Custom': 'val' }, auth)
    expect(headers).toEqual({ 'X-Custom': 'val', Authorization: 'Bearer tk' })
  })
})
