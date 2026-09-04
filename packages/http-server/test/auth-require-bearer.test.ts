import { expect, test } from 'vitest'

import { createBearerAuthGate } from '../src/auth/require-bearer.js'
import type { OAuthTokenVerifier } from '../src/auth/verifier.js'
import { TokenVerificationError } from '../src/auth/verifier.js'

const resource = 'https://mcp.example.com/mcp'
const metadataURL = 'https://mcp.example.com/.well-known/oauth-protected-resource/mcp'

const okVerifier: OAuthTokenVerifier = {
  async verifyAccessToken() {
    return { subject: 'u', scopes: ['read'] }
  },
}

test('401 with resource_metadata when no token', async () => {
  const gate = createBearerAuthGate({
    verifier: okVerifier,
    resource,
    resourceMetadataURL: metadataURL,
  })
  const { response } = await gate(new Request(resource, { method: 'POST' }))
  expect(response?.status).toBe(401)
  expect(response?.headers.get('WWW-Authenticate')).toContain(`resource_metadata="${metadataURL}"`)
})

test('403 insufficient_scope when a required scope is missing', async () => {
  const gate = createBearerAuthGate({
    verifier: okVerifier,
    resource,
    resourceMetadataURL: metadataURL,
    requiredScopes: ['admin'],
  })
  const { response } = await gate(
    new Request(resource, { method: 'POST', headers: { Authorization: 'Bearer x' } }),
  )
  expect(response?.status).toBe(403)
  expect(response?.headers.get('WWW-Authenticate')).toContain('insufficient_scope')
})

test('passes (no response) and returns authInfo on success', async () => {
  const gate = createBearerAuthGate({
    verifier: okVerifier,
    resource,
    resourceMetadataURL: metadataURL,
    requiredScopes: ['read'],
  })
  const { response, authInfo } = await gate(
    new Request(resource, { method: 'POST', headers: { Authorization: 'Bearer x' } }),
  )
  expect(response).toBeUndefined()
  expect(authInfo?.subject).toBe('u')
})

test('401 invalid_token when the verifier rejects', async () => {
  const badVerifier: OAuthTokenVerifier = {
    async verifyAccessToken() {
      throw new TokenVerificationError('invalid_token', 'bad')
    },
  }
  const gate = createBearerAuthGate({
    verifier: badVerifier,
    resource,
    resourceMetadataURL: metadataURL,
  })
  const { response } = await gate(
    new Request(resource, { method: 'POST', headers: { Authorization: 'Bearer x' } }),
  )
  expect(response?.status).toBe(401)
  expect(response?.headers.get('WWW-Authenticate')).toContain('invalid_token')
})
