import { expect, test } from 'vitest'

import {
  protectedResourceMetadataPath,
  protectedResourceMetadataResponse,
} from '../src/auth/metadata.js'

test('path-insertion for a path-bearing resource', () => {
  expect(protectedResourceMetadataPath('https://host.example/mcp')).toBe(
    '/.well-known/oauth-protected-resource/mcp',
  )
})

test('path for a root resource', () => {
  expect(protectedResourceMetadataPath('https://host.example/')).toBe(
    '/.well-known/oauth-protected-resource',
  )
})

test('serves resource + authorization_servers', async () => {
  const res = protectedResourceMetadataResponse({
    resource: 'https://host.example/mcp',
    authorizationServers: ['https://as.example'],
  })
  const body = (await res.json()) as { resource: string; authorization_servers: Array<string> }
  expect(body.resource).toBe('https://host.example/mcp')
  expect(body.authorization_servers).toEqual(['https://as.example'])
})
