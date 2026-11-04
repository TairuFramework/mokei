import {
  createMemoryTokenStore,
  revokeTokens,
  type TokenStore,
  tokenStoreKey,
} from '@mokei/http-client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import type * as AuthStore from '../src/auth-store.js'
import { openTokenStore } from '../src/auth-store.js'
import { createAuthCommand } from '../src/commands/auth.js'
import type * as Output from '../src/output.js'
import { renderTable } from '../src/output.js'

vi.mock('../src/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>()
  return { ...actual, openTokenStore: vi.fn(actual.openTokenStore) }
})
vi.mock('../src/output.js', async (importOriginal) => {
  const actual = await importOriginal<typeof Output>()
  return { ...actual, renderTable: vi.fn() }
})
vi.mock('@mokei/http-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mokei/http-client')>()
  return { ...actual, revokeTokens: vi.fn() }
})

const RESOURCE = 'https://mcp.example.com/mcp'
const OTHER = 'https://other.example.com/mcp'

let stdout: Array<string>
let stderr: Array<string>
let store: TokenStore

async function seed(): Promise<void> {
  await store.set(tokenStoreKey({ resource: RESOURCE, clientID: 'cli', scopes: ['read'] }), {
    accessToken: 'secret-access',
    tokenType: 'Bearer',
    refreshToken: 'secret-refresh',
    expiresAt: 4_000_000_000,
    issuer: 'https://as.example.com',
  })
  await store.set(tokenStoreKey({ resource: RESOURCE, clientID: 'other-client' }), {
    accessToken: 'a2',
    tokenType: 'Bearer',
  })
  await store.set(tokenStoreKey({ resource: OTHER, clientID: 'cli' }), {
    accessToken: 'a3',
    tokenType: 'Bearer',
  })
  await store.set('not-a-mokei-key', { accessToken: 'x', tokenType: 'Bearer' })
}

async function run(...args: Array<string>) {
  await createAuthCommand().parseAsync(args, { from: 'user' })
}

beforeEach(async () => {
  vi.clearAllMocks()
  process.exitCode = undefined
  store = createMemoryTokenStore()
  vi.mocked(openTokenStore).mockReturnValue(store)
  await seed()
  stdout = []
  stderr = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk))
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk))
    return true
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  process.exitCode = undefined
})

test('list shows sign-ins without their tokens', async () => {
  await run('list', '--keychain', '--json')
  expect(openTokenStore).toHaveBeenCalledWith(expect.objectContaining({ keychain: true }))
  const output = stdout.join('')
  expect(output).not.toContain('secret')
  expect(JSON.parse(output)).toEqual([
    {
      resource: RESOURCE,
      clientID: 'cli',
      scopes: ['read'],
      issuer: 'https://as.example.com',
      expiresAt: 4_000_000_000,
      refreshable: true,
    },
    {
      resource: RESOURCE,
      clientID: 'other-client',
      scopes: [],
      issuer: null,
      expiresAt: null,
      refreshable: false,
    },
    {
      resource: OTHER,
      clientID: 'cli',
      scopes: [],
      issuer: null,
      expiresAt: null,
      refreshable: false,
    },
  ])
})

test('list renders a table', async () => {
  await run('list', '--tokens', './t.json')
  expect(openTokenStore).toHaveBeenCalledWith(expect.objectContaining({ tokens: './t.json' }))
  expect(renderTable).toHaveBeenCalledTimes(1)
  const rows = vi.mocked(renderTable).mock.calls[0]?.[1]
  expect(rows?.[0]).toEqual({
    resource: RESOURCE,
    clientID: 'cli',
    scopes: 'read',
    issuer: 'https://as.example.com',
    expires: new Date(4_000_000_000_000).toISOString(),
    refresh: 'yes',
  })
})

test('logout revokes then deletes every sign-in for the resource', async () => {
  vi.mocked(revokeTokens).mockResolvedValue({
    status: 'revoked',
    endpoint: 'https://as.example.com/revoke',
    revoked: ['refresh_token', 'access_token'],
  })
  await run('logout', `${RESOURCE}?ignored=1`, '--keychain')
  expect(revokeTokens).toHaveBeenCalledTimes(2)
  expect(revokeTokens).toHaveBeenCalledWith(
    expect.objectContaining({
      clientID: 'cli',
      resource: RESOURCE,
      tokens: expect.objectContaining({ refreshToken: 'secret-refresh' }),
    }),
  )
  expect((await store.keys()).sort()).toEqual(
    [tokenStoreKey({ resource: OTHER, clientID: 'cli' }), 'not-a-mokei-key'].sort(),
  )
  expect(stdout.join('')).toContain('revocation revoked: refresh_token, access_token')
  expect(process.exitCode).toBeUndefined()
})

test('logout --client-id narrows the match and --no-revoke skips revocation', async () => {
  await run('logout', RESOURCE, '--keychain', '--client-id', 'other-client', '--no-revoke')
  expect(revokeTokens).not.toHaveBeenCalled()
  expect(await store.get(tokenStoreKey({ resource: RESOURCE, clientID: 'other-client' }))).toBe(
    undefined,
  )
  expect(
    await store.get(tokenStoreKey({ resource: RESOURCE, clientID: 'cli', scopes: ['read'] })),
  ).toBeDefined()
  expect(stdout.join('')).toContain('revocation skipped')
})

test('a failed revocation still deletes locally but exits 1', async () => {
  vi.mocked(revokeTokens).mockRejectedValue(new Error('Token revocation failed: 503'))
  await run('logout', OTHER, '--keychain', '--json')
  expect(await store.keys()).not.toContain(tokenStoreKey({ resource: OTHER, clientID: 'cli' }))
  expect(JSON.parse(stdout.join(''))).toEqual([
    {
      resource: OTHER,
      clientID: 'cli',
      scopes: [],
      revocation: 'failed',
      detail: 'Token revocation failed: 503',
    },
  ])
  expect(process.exitCode).toBe(1)
})

test('logout with no matching sign-in fails', async () => {
  await run('logout', 'https://nowhere.example.com/mcp', '--keychain')
  expect(process.exitCode).toBe(1)
  expect(stderr.join('')).toContain('No stored sign-in for https://nowhere.example.com/mcp')
})
