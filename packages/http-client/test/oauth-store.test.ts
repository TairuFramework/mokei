import { expect, test } from 'vitest'

import {
  clientCredentialsStoreKey,
  createMemoryTokenStore,
  parseClientCredentialsStoreKey,
  parseTokenStoreKey,
  tokenStoreKey,
} from '../src/oauth/store.js'

test('memory store round-trips and deletes', async () => {
  const store = createMemoryTokenStore()
  await store.set('k', { accessToken: 'a', tokenType: 'Bearer' })
  expect((await store.get('k'))?.accessToken).toBe('a')
  await store.delete('k')
  expect(await store.get('k')).toBeUndefined()
})

test('client credentials key round-trips with sorted unique scopes', () => {
  const key = clientCredentialsStoreKey({
    issuer: 'https://as.example.com',
    resource: 'https://mcp.example.com/mcp',
    clientID: 'svc',
    scopes: ['b', 'a', 'b'],
  })
  expect(key).toBe(
    JSON.stringify([
      'client_credentials',
      'https://as.example.com',
      'https://mcp.example.com/mcp',
      'svc',
      ['a', 'b'],
    ]),
  )
  expect(parseClientCredentialsStoreKey(key)).toEqual({
    issuer: 'https://as.example.com',
    resource: 'https://mcp.example.com/mcp',
    clientID: 'svc',
    scopes: ['a', 'b'],
  })
})

test('client credentials and legacy keys do not parse as each other', () => {
  const cc = clientCredentialsStoreKey({ issuer: 'i', resource: 'r', clientID: 'c' })
  const legacy = tokenStoreKey({ resource: 'r', clientID: 'c', scopes: ['a'] })
  expect(parseTokenStoreKey(cc)).toBeUndefined()
  expect(parseClientCredentialsStoreKey(legacy)).toBeUndefined()
  expect(parseClientCredentialsStoreKey('nope')).toBeUndefined()
})
