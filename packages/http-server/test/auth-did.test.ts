import { randomIdentity, stringifyToken } from '@kokuin/token'
import { expect, test } from 'vitest'

import { createDIDVerifier } from '../src/auth/did-verifier.js'
import { TokenVerificationError } from '../src/auth/verifier.js'

const resource = 'https://mcp.example.com/mcp'

test('verifies a DID-issued token bound to the resource', async () => {
  const identity = randomIdentity()
  const signed = await identity.signToken({
    aud: resource,
    scope: 'read',
    exp: Math.floor(Date.now() / 1000) + 3600,
  })
  const token = stringifyToken(signed)
  const verifier = createDIDVerifier()
  const info = await verifier.verifyAccessToken(token, { resource })
  expect(info.subject).toBe(identity.id)
  expect(info.scopes).toEqual(['read'])
})

test('rejects a DID token with no exp claim', async () => {
  const identity = randomIdentity()
  const signed = await identity.signToken({
    aud: resource,
    scope: 'read',
  })
  const token = stringifyToken(signed)
  const verifier = createDIDVerifier()
  await expect(verifier.verifyAccessToken(token, { resource })).rejects.toThrow(
    TokenVerificationError,
  )
  await expect(verifier.verifyAccessToken(token, { resource })).rejects.toThrow(/exp/i)
})

test('rejects a DID token for the wrong resource', async () => {
  const identity = randomIdentity()
  const signed = await identity.signToken({
    aud: 'https://other.test',
    exp: Math.floor(Date.now() / 1000) + 3600,
  })
  const token = stringifyToken(signed)
  const verifier = createDIDVerifier()
  await expect(verifier.verifyAccessToken(token, { resource })).rejects.toThrow(/audience/i)
})
