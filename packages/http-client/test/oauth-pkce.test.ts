import { describe, expect, test } from 'vitest'

import { challengeFromVerifier, createPKCE } from '../src/oauth/pkce.js'
import { canonicalResource } from '../src/oauth/resource.js'

describe('PKCE', () => {
  test('matches the RFC 7636 Appendix B test vector', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    expect(await challengeFromVerifier(verifier)).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    )
  })

  test('createPKCE returns S256 with a matching challenge', async () => {
    const { verifier, challenge, method } = await createPKCE()
    expect(method).toBe('S256')
    expect(await challengeFromVerifier(verifier)).toBe(challenge)
  })
})

describe('canonicalResource', () => {
  test('drops query and fragment, keeps scheme host port path', () => {
    expect(canonicalResource('https://mcp.example.com/mcp?x=1#y')).toBe(
      'https://mcp.example.com/mcp',
    )
  })
})
