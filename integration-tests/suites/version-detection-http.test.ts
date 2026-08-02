/** The specification's compatibility matrix, over Streamable HTTP. */
import type { ContextClient } from '@mokei/context-client'
import { UNSUPPORTED_PROTOCOL_VERSION } from '@mokei/context-protocol'
import { afterEach, describe, expect, test } from 'vitest'

import {
  connectMokeiHTTPClient,
  type RunningHTTPServer,
  startMokeiHTTPServer,
} from '../support/interop/servers.ts'

describe('protocol version detection over HTTP', () => {
  let server: RunningHTTPServer | null = null
  let client: ContextClient | null = null

  afterEach(async () => {
    await client?.dispose()
    client = null
    await server?.dispose()
    server = null
  })

  test("an 'auto' client falls back against a 2025-11-25-only server", async () => {
    server = await startMokeiHTTPServer(['2025-11-25'])
    client = connectMokeiHTTPClient(server.url, 'auto')

    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name).sort()).toEqual(['echo', 'sum'])
    expect(client.protocolVersion).toBe('2025-11-25')
  })

  test("an 'auto' client resolves 2026-07-28 against a multi-revision server", async () => {
    server = await startMokeiHTTPServer(['2026-07-28', '2025-11-25'])
    client = connectMokeiHTTPClient(server.url, 'auto')

    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name).sort()).toEqual(['echo', 'sum'])
    expect(client.protocolVersion).toBe('2026-07-28')
  })

  test('a 2025-11-25 client works against a multi-revision server', async () => {
    server = await startMokeiHTTPServer(['2026-07-28', '2025-11-25'])
    client = connectMokeiHTTPClient(server.url, '2025-11-25')

    await client.initialize()
    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name).sort()).toEqual(['echo', 'sum'])
  })

  test('a pinned 2026-07-28 client fails deterministically against a 2025-11-25 server', async () => {
    server = await startMokeiHTTPServer(['2025-11-25'])
    client = connectMokeiHTTPClient(server.url, '2026-07-28')

    // The server's own `-32022`, carried out of the HTTP `400` body — not a flattened
    // "HTTP 400: ..." internal error, which would tell the operator nothing actionable.
    // vitest's failure printer renders the received `RPCError` without its `code`/`data`
    // getters, but `subsetEquality` walks the prototype chain and does read them.
    await expect(client.listTools()).rejects.toMatchObject({
      code: UNSUPPORTED_PROTOCOL_VERSION,
      data: { supported: ['2025-11-25'], requested: '2026-07-28' },
    })
  })

  test('a pinned 2026-07-28 client works against a 2026-07-28-only server', async () => {
    server = await startMokeiHTTPServer(['2026-07-28'])
    client = connectMokeiHTTPClient(server.url, '2026-07-28')

    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name).sort()).toEqual(['echo', 'sum'])
  })
})
