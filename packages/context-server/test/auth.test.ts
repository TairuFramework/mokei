import { DirectTransports } from '@enkaku/transport'
import type { ClientMessage, ClientRequest, ServerMessage } from '@mokei/context-protocol'
import { describe, expect, test } from 'vitest'

import {
  ContextServer,
  type RequestAuth,
  type ResolveAuth,
  type ServerAuth,
  toRequestAuth,
  toTaskOwner,
} from '../src/index.js'

const meta = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
}

function setup(params: { auth?: ServerAuth; resolveAuth?: ResolveAuth }) {
  const seen: Array<RequestAuth | undefined> = []
  const transports = new DirectTransports<ServerMessage, ClientMessage>()
  const server = new ContextServer({
    name: 'test',
    version: '1.0.0',
    protocolVersions: ['2026-07-28'],
    transport: transports.server,
    auth: params.auth,
    resolveAuth: params.resolveAuth,
    tools: {
      whoami: {
        description: 'Records request.auth',
        inputSchema: { type: 'object' },
        handler: async (request) => {
          seen.push(request.auth)
          return { content: [] }
        },
      },
    },
  })
  async function call(id: number): Promise<void> {
    transports.client.write({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name: 'whoami', arguments: {}, _meta: meta },
    } as ClientRequest)
    const response = await transports.client.read()
    expect((response.value as { error?: unknown }).error).toBeUndefined()
  }
  return { server, seen, call }
}

describe('request auth', () => {
  test('surfaces an object raw as claims and freezes the copy', async () => {
    const raw = { sub: 'alice', tenant: 't1' }
    const { server, seen, call } = setup({
      auth: { issuer: 'https://as', subject: 'alice', scopes: ['read'], expiresAt: 100, raw },
    })
    await call(1)
    expect(seen[0]).toEqual({
      issuer: 'https://as',
      subject: 'alice',
      scopes: ['read'],
      expiresAt: 100,
      claims: raw,
    })
    expect(Object.isFrozen(seen[0])).toBe(true)
    expect(Object.isFrozen(seen[0]?.claims)).toBe(true)
    expect(seen[0]?.claims).not.toBe(raw)
    await server.dispose()
  })

  test('prefers explicit claims and ignores a non-object raw', () => {
    expect(
      toRequestAuth({ subject: 's', scopes: [], raw: { a: 1 }, claims: { b: 2 } })?.claims,
    ).toEqual({ b: 2 })
    expect(toRequestAuth({ subject: 's', scopes: [], raw: 'opaque' })).toEqual({
      subject: 's',
      scopes: [],
    })
  })

  test('resolveAuth answers per request id and falls back to static auth', async () => {
    const perRequest = new Map<number, ServerAuth>([
      [1, { subject: 'alice', scopes: ['read'] }],
      [2, { subject: 'alice', scopes: ['read', 'write'] }],
    ])
    const { server, seen, call } = setup({
      auth: { subject: 'alice', scopes: [] },
      resolveAuth: (id) => perRequest.get(id as number),
    })
    await call(1)
    await call(2)
    await call(3)
    expect(seen.map((auth) => auth?.scopes)).toEqual([['read'], ['read', 'write'], []])
    await server.dispose()
  })

  test('task owner keeps identity and scopes only', () => {
    expect(
      toTaskOwner(
        toRequestAuth({ issuer: 'i', subject: 's', scopes: ['a'], expiresAt: 1, claims: { x: 1 } }),
      ),
    ).toEqual({ issuer: 'i', subject: 's', scopes: ['a'] })
  })
})
