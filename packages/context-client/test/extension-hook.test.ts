import { DirectTransports } from '@enkaku/transport'
import type {
  ClientMessage,
  ClientRequest,
  ExtensionDefinition,
  ServerMessage,
  Skill,
} from '@mokei/context-protocol'
import { afterEach, describe, expect, test } from 'vitest'

import {
  type ClientParams,
  ContextClient,
  ExtensionNotDeclaredError,
  listPaged,
  MethodNotInRevisionError,
  type PagedResult,
  requireClientExtension,
} from '../src/index.js'

/** Claims a real `2026-07-28` wire method, so the outbound validators accept it. */
const TEST_EXT: ExtensionDefinition = {
  id: 'test/ext',
  protocolVersions: new Set(['2026-07-28']),
  clientMethods: new Set(['skills/list']),
  serverMethods: new Set(),
}

const SERVER_SETTINGS = { flavour: 'vanilla', nested: { depth: 2 } }

const DIGEST = `sha256:${'0'.repeat(64)}`

function entry(name: string): Skill {
  return {
    uri: `skill://acme/${name}/SKILL.md`,
    frontmatter: { name, description: `The ${name} skill.` },
    resources: [{ uri: `skill://acme/${name}/SKILL.md`, digest: DIGEST, size: 10 }],
  }
}

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
})

type Reply = (request: ClientRequest) => unknown

type FakeOptions = {
  extensions?: ClientParams['extensions']
  declared?: boolean
}

/** A server answering every request itself, after a discover declaring `test/ext` (unless told not to). */
function fake(reply: Reply, options: FakeOptions = {}) {
  const pair = new DirectTransports<ServerMessage, ClientMessage>()
  cleanup.push(() => pair.dispose())
  const client = new ContextClient({
    protocolVersion: '2026-07-28',
    transport: pair.client,
    extensions: options.extensions,
    _registry: [TEST_EXT],
  })
  const discovery = {
    resultType: 'complete',
    supportedVersions: ['2026-07-28'],
    capabilities: {
      extensions: options.declared === false ? {} : { [TEST_EXT.id]: SERVER_SETTINGS },
    },
    ttlMs: 0,
    cacheScope: 'private',
  }
  const received: Array<ClientRequest> = []
  void (async () => {
    for (;;) {
      const next = await pair.server.read()
      if (next.done) return
      const request = next.value as ClientRequest
      received.push(request)
      if (request.id == null) continue
      const result = request.method === 'server/discover' ? discovery : reply(request)
      pair.server.write({ jsonrpc: '2.0', id: request.id, result } as ServerMessage)
    }
  })()
  return { client, received }
}

const methods = (received: Array<ClientRequest>): Array<string> =>
  received.map((request) => request.method)

const pages = (request: ClientRequest): unknown => {
  const cursor = (request.params as { cursor?: string } | undefined)?.cursor
  return cursor == null
    ? { resultType: 'complete', skills: [entry('first')], nextCursor: 'page-2' }
    : { resultType: 'complete', skills: [entry('second')] }
}

function sendSkillsList(client: ContextClient) {
  return (params: Record<string, unknown>, options: Parameters<typeof client.request>[2]) =>
    client.request('skills/list', params, options) as Promise<PagedResult>
}

test('extensions option declares the extension per request', async () => {
  const { client, received } = fake(pages, {
    extensions: [{ definition: TEST_EXT, settings: { mode: 'test' } }],
  })
  await client.request('skills/list', {})
  const list = received.find((request) => request.method === 'skills/list') as unknown as {
    params: { _meta: Record<string, { extensions?: Record<string, unknown> }> }
  }
  expect(list.params._meta['io.modelcontextprotocol/clientCapabilities']?.extensions).toEqual({
    [TEST_EXT.id]: { mode: 'test' },
  })
})

describe('requireClientExtension', () => {
  test('refuses an extension not enabled locally', async () => {
    const { client, received } = fake(pages)
    await expect(requireClientExtension(client, TEST_EXT, 'skills/list')).rejects.toBeInstanceOf(
      MethodNotInRevisionError,
    )
    // Only setup's own discover: the local gate sends nothing.
    expect(methods(received)).toEqual(['server/discover'])
  })

  test('refuses when the server did not declare it', async () => {
    const { client, received } = fake(pages, { extensions: [TEST_EXT], declared: false })
    await expect(requireClientExtension(client, TEST_EXT, 'skills/list')).rejects.toBeInstanceOf(
      ExtensionNotDeclaredError,
    )
    expect(methods(received)).not.toContain('skills/list')
  })

  test('returns server settings', async () => {
    const { client } = fake(pages, { extensions: [TEST_EXT] })
    await expect(requireClientExtension(client, TEST_EXT, 'skills/list')).resolves.toEqual(
      SERVER_SETTINGS,
    )
  })
})

describe('listPaged', () => {
  test('walks pages', async () => {
    const { client, received } = fake(pages, { extensions: [TEST_EXT] })
    const result = await listPaged(client, 'skills/list', 'skills', sendSkillsList(client), {})
    expect(result.skills).toEqual([entry('first'), entry('second')])
    expect(result.nextCursor).toBeUndefined()
    expect(received.filter((request) => request.method === 'skills/list')).toHaveLength(2)
  })

  test('returns a single page when cursor is set', async () => {
    const { client, received } = fake(pages, { extensions: [TEST_EXT] })
    const result = await listPaged(client, 'skills/list', 'skills', sendSkillsList(client), {
      cursor: 'page-2',
    })
    expect(result.skills).toEqual([entry('second')])
    expect(received.filter((request) => request.method === 'skills/list')).toHaveLength(1)
  })
})

test('matches extensions by id', async () => {
  const copy: ExtensionDefinition = {
    ...TEST_EXT,
    protocolVersions: new Set(TEST_EXT.protocolVersions),
    clientMethods: new Set(TEST_EXT.clientMethods),
    serverMethods: new Set(TEST_EXT.serverMethods),
  }
  expect(copy).not.toBe(TEST_EXT)
  const { client, received } = fake(pages, { extensions: [copy] })
  await expect(requireClientExtension(client, TEST_EXT, 'skills/list')).resolves.toEqual(
    SERVER_SETTINGS,
  )
  await client.request('skills/list', {})
  expect(methods(received)).toContain('skills/list')
})
