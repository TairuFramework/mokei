import { describe, expect, test } from 'vitest'

import { buildAllowedHosts, verifyAPIRequest } from '../src/auth.js'

const TOKEN = 'a'.repeat(64)

function req(headers: Record<string, string>): Request {
  return new Request('http://127.0.0.1/api', { method: 'POST', headers })
}

describe('buildAllowedHosts', () => {
  test('includes localhost aliases for a loopback bind', () => {
    const hosts = buildAllowedHosts('127.0.0.1', 5000)
    expect(hosts.has('127.0.0.1:5000')).toBe(true)
    expect(hosts.has('localhost:5000')).toBe(true)
  })

  test('uses only the bind host for a remote bind', () => {
    const hosts = buildAllowedHosts('192.168.1.10', 5000)
    expect(hosts.has('192.168.1.10:5000')).toBe(true)
    expect(hosts.has('localhost:5000')).toBe(false)
  })

  test('includes loopback aliases for a wildcard bind (browser reaches it via localhost)', () => {
    const hosts = buildAllowedHosts('0.0.0.0', 5000)
    expect(hosts.has('localhost:5000')).toBe(true)
    expect(hosts.has('127.0.0.1:5000')).toBe(true)
  })
})

describe('verifyAPIRequest', () => {
  const opts = { token: TOKEN, allowedHosts: buildAllowedHosts('127.0.0.1', 5000) }

  test('accepts a valid Host + token', () => {
    expect(
      verifyAPIRequest(req({ host: 'localhost:5000', authorization: `Bearer ${TOKEN}` }), opts),
    ).toBe(true)
  })

  test('rejects a missing token', () => {
    expect(verifyAPIRequest(req({ host: 'localhost:5000' }), opts)).toBe(false)
  })

  test('rejects a wrong token', () => {
    expect(
      verifyAPIRequest(
        req({ host: 'localhost:5000', authorization: `Bearer ${'b'.repeat(64)}` }),
        opts,
      ),
    ).toBe(false)
  })

  test('rejects a foreign Host (DNS-rebinding)', () => {
    expect(
      verifyAPIRequest(req({ host: 'evil.com:5000', authorization: `Bearer ${TOKEN}` }), opts),
    ).toBe(false)
  })

  test('rejects a foreign Origin when present', () => {
    expect(
      verifyAPIRequest(
        req({
          host: 'localhost:5000',
          origin: 'http://evil.com',
          authorization: `Bearer ${TOKEN}`,
        }),
        opts,
      ),
    ).toBe(false)
  })

  test('accepts a matching Origin', () => {
    expect(
      verifyAPIRequest(
        req({
          host: 'localhost:5000',
          origin: 'http://localhost:5000',
          authorization: `Bearer ${TOKEN}`,
        }),
        opts,
      ),
    ).toBe(true)
  })
})
