import { createHash } from 'node:crypto'
import { DirectTransports } from '@enkaku/transport'
import type { ClientMessage, ClientRequest, ServerMessage } from '@mokei/context-protocol'
import {
  INVALID_PARAMS,
  META_CLIENT_CAPABILITIES,
  META_PROTOCOL_VERSION,
  METHOD_NOT_FOUND,
  SKILLS_EXTENSION,
} from '@mokei/context-protocol'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { INSUFFICIENT_SCOPE, type ServerAuth } from '../src/auth.js'
import { ContextServer, type ServerConfig } from '../src/server.js'
import {
  createSkillCatalog,
  type SkillCatalogOptions,
  type SkillDefinition,
} from '../src/skill-catalog.js'
import type { ResourceDefinitions } from '../src/types.js'

type Response = {
  error?: { code: number; message: string; data?: unknown }
  // biome-ignore lint/suspicious/noExplicitAny: test helper reads arbitrary result shapes
  result?: Record<string, any>
}

const SKILL_MD = '---\nname: pdf\ndescription: Fill PDF forms.\n---\nBody\n'
const NOTES = new Uint8Array([0xff])

const DEFINITIONS: Array<SkillDefinition> = [
  {
    path: 'acme/pdf',
    files: { 'SKILL.md': SKILL_MD, 'templates/invoice.md': '# Invoice\n', 'notes.txt': NOTES },
  },
]

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
})

type Setup = {
  catalog?: SkillCatalogOptions
  protocolVersions?: ServerConfig['protocolVersions']
  cache?: ServerConfig['cache']
  resources?: ResourceDefinitions
  auth?: ServerAuth
}

async function setup(options: Setup = {}) {
  const transports = new DirectTransports<ServerMessage, ClientMessage>()
  const server = new ContextServer({
    name: 'skills-test',
    version: '1.0.0',
    protocolVersions: options.protocolVersions ?? ['2026-07-28'],
    cache: options.cache,
    resources: options.resources,
    skills: await createSkillCatalog(DEFINITIONS, options.catalog),
    auth: options.auth,
    transport: transports.server,
  })
  cleanup.push(() => transports.dispose())
  cleanup.push(() => server.dispose())
  let nextID = 0
  return async (method: string, params: Record<string, unknown> = {}): Promise<Response> => {
    transports.client.write({ jsonrpc: '2.0', id: ++nextID, method, params } as ClientRequest)
    const frame = await transports.client.read()
    return frame.value as Response
  }
}

const META = {
  _meta: { [META_PROTOCOL_VERSION]: '2026-07-28', [META_CLIENT_CAPABILITIES]: {} },
}

function readMock() {
  return vi.fn(({ params }: { params: { uri: string } }) => ({
    contents: [{ uri: params.uri, text: 'user' }],
  }))
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

describe('skills extension', () => {
  test('declares skills and resources', async () => {
    const request = await setup()
    const { result } = await request('server/discover', META)
    expect(result?.capabilities.extensions[SKILLS_EXTENSION]).toEqual({})
    expect(result?.capabilities.resources).toBeDefined()

    const withDirectory = await setup({ catalog: { directoryRead: true } })
    const discovered = await withDirectory('server/discover', META)
    expect(discovered.result?.capabilities.extensions[SKILLS_EXTENSION]).toEqual({
      directoryRead: true,
    })
  })

  test('skills/list returns every entry on one page', async () => {
    const request = await setup({ cache: { ttlMs: 10, cacheScope: 'private' } })
    const { result } = await request('skills/list', META)
    expect(result?.resultType).toBe('complete')
    expect(result?.skills.map((skill: { uri: string }) => skill.uri)).toEqual([
      'skill://acme/pdf/SKILL.md',
    ])
    expect(result?.nextCursor).toBeUndefined()
    expect(result?.ttlMs).toBe(10)
    expect(result?.cacheScope).toBe('private')

    const overridden = await setup({
      cache: { ttlMs: 10, cacheScope: 'private' },
      catalog: { cache: { ttlMs: 60_000, cacheScope: 'public' } },
    })
    const listed = await overridden('skills/list', META)
    expect(listed.result?.ttlMs).toBe(60_000)
    expect(listed.result?.cacheScope).toBe('public')
  })

  test('skills/get returns the entry', async () => {
    const request = await setup()
    const { result } = await request('skills/get', { uri: 'skill://acme/pdf/SKILL.md', ...META })
    expect(result?.skill.frontmatter.name).toBe('pdf')
    expect(result?.ttlMs).toBe(0)
  })

  test('skills/get unknown uri is -32602', async () => {
    const request = await setup()
    const { error } = await request('skills/get', { uri: 'skill://nope/SKILL.md', ...META })
    expect(error?.code).toBe(INVALID_PARAMS)
    expect(error?.message).toBe('No skill is served at skill://nope/SKILL.md')
  })

  test('a client that never declared skills is still served', async () => {
    const request = await setup()
    const { result, error } = await request('skills/list', META)
    expect(error).toBeUndefined()
    expect(result?.skills).toHaveLength(1)
  })

  describe('resources/directory/read', () => {
    test('lists children', async () => {
      const request = await setup({ catalog: { directoryRead: true } })
      const { result } = await request('resources/directory/read', {
        uri: 'skill://acme/pdf',
        ...META,
      })
      expect(result?.resources.map((item: { uri: string }) => item.uri)).toEqual([
        'skill://acme/pdf/SKILL.md',
        'skill://acme/pdf/notes.txt',
        'skill://acme/pdf/templates',
      ])
      expect(result?.resultType).toBe('complete')
      expect(result?.ttlMs).toBe(0)
    })

    test('a non-directory is -32602', async () => {
      const request = await setup({ catalog: { directoryRead: true } })
      const { error } = await request('resources/directory/read', {
        uri: 'skill://acme/pdf/SKILL.md',
        ...META,
      })
      expect(error?.code).toBe(INVALID_PARAMS)
      expect(error?.message).toBe('skill://acme/pdf/SKILL.md is not a directory resource')
    })

    test('is METHOD_NOT_FOUND with directoryRead off', async () => {
      const request = await setup()
      const { error } = await request('resources/directory/read', {
        uri: 'skill://acme/pdf',
        ...META,
      })
      expect(error?.code).toBe(METHOD_NOT_FOUND)
    })
  })

  test('resources/read routes catalog uris to the catalog', async () => {
    const read = readMock()
    const request = await setup({ resources: { read } })

    const catalog = await request('resources/read', { uri: 'skill://acme/pdf/SKILL.md', ...META })
    expect(catalog.result?.contents).toEqual([
      { uri: 'skill://acme/pdf/SKILL.md', mimeType: 'text/markdown', text: SKILL_MD },
    ])
    expect(read).not.toHaveBeenCalled()

    const unknown = await request('resources/read', { uri: 'skill://unknown/x.md', ...META })
    expect(unknown.error?.code).toBe(INVALID_PARAMS)
    expect(unknown.error?.message).toBe('Resource not found: skill://unknown/x.md')
    expect(read).not.toHaveBeenCalled()

    const user = await request('resources/read', { uri: 'file:///a', ...META })
    expect(user.result?.contents).toEqual([{ uri: 'file:///a', text: 'user' }])
    expect(read).toHaveBeenCalledTimes(1)
  })

  test('catalog cache applies to catalog resources/read only', async () => {
    const request = await setup({
      resources: { read: readMock() },
      catalog: { cache: { ttlMs: 60_000, cacheScope: 'public' } },
    })
    const catalog = await request('resources/read', { uri: 'skill://acme/pdf/SKILL.md', ...META })
    expect(catalog.result?.ttlMs).toBe(60_000)
    const user = await request('resources/read', { uri: 'file:///a', ...META })
    expect(user.result?.ttlMs).toBe(0)
  })

  test('serves blobs byte-exact', async () => {
    const request = await setup()
    const uri = 'skill://acme/pdf/notes.txt'
    const { result } = await request('resources/read', { uri, ...META })
    const [content] = result?.contents ?? []
    expect(content.text).toBeUndefined()
    const bytes = new Uint8Array(Buffer.from(content.blob, 'base64'))
    expect(bytes).toEqual(NOTES)
    const listed = await request('skills/list', META)
    const manifest = listed.result?.skills[0].resources.find(
      (item: { uri: string }) => item.uri === uri,
    )
    expect(sha256(bytes)).toBe(manifest.digest)
  })

  test('skills-only server answers resource lists empty', async () => {
    const request = await setup()
    const listed = await request('resources/list', META)
    expect(listed.result?.resources).toEqual([])
    const templates = await request('resources/templates/list', META)
    expect(templates.result?.resourceTemplates).toEqual([])
    const read = await request('resources/read', { uri: 'file:///a', ...META })
    expect(read.error?.code).toBe(INVALID_PARAMS)
    expect(read.error?.message).toBe('Resource not found: file:///a')
  })

  describe('2025-11-25', () => {
    async function initialized() {
      const request = await setup({ protocolVersions: ['2025-11-25', '2026-07-28'] })
      const init = await request('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'c', version: '1' },
      })
      return { request, init }
    }

    test('skills methods are METHOD_NOT_FOUND', async () => {
      const { request } = await initialized()
      // The skills request schemas require `_meta`, so a well-formed call names its revision there.
      const legacyMeta = {
        _meta: { [META_PROTOCOL_VERSION]: '2025-11-25', [META_CLIENT_CAPABILITIES]: {} },
      }
      for (const [method, params] of [
        ['skills/list', {}],
        ['skills/get', { uri: 'skill://acme/pdf/SKILL.md' }],
        ['resources/directory/read', { uri: 'skill://acme/pdf' }],
      ] as const) {
        const { error } = await request(method, { ...params, ...legacyMeta })
        expect(error?.code).toBe(METHOD_NOT_FOUND)
      }
    })

    test('initialize carries no skills extension', async () => {
      const { init } = await initialized()
      expect(init.result?.capabilities.extensions?.[SKILLS_EXTENSION]).toBeUndefined()
      expect(init.result?.capabilities.resources).toBeDefined()
    })

    test('resources/read of a catalog uri still returns the file', async () => {
      const { request } = await initialized()
      const { result } = await request('resources/read', { uri: 'skill://acme/pdf/SKILL.md' })
      expect(result?.contents[0].text).toBe(SKILL_MD)
    })
  })

  test('catalog scopes apply to all four operations', async () => {
    const scopes = vi.fn(() => ['resources:user'])
    const request = await setup({
      catalog: { directoryRead: true, scopes: ['skills:read'] },
      resources: { read: readMock(), scopes },
      auth: { subject: 'alice', scopes: [] },
    })
    for (const [method, params] of [
      ['skills/list', {}],
      ['skills/get', { uri: 'skill://acme/pdf/SKILL.md' }],
      ['resources/directory/read', { uri: 'skill://acme/pdf' }],
      ['resources/read', { uri: 'skill://acme/pdf/SKILL.md' }],
    ] as const) {
      const { error } = await request(method, { ...params, ...META })
      expect(error?.data).toEqual({ error: INSUFFICIENT_SCOPE, scopes: ['skills:read'] })
    }
    expect(scopes).not.toHaveBeenCalled()

    const user = await request('resources/read', { uri: 'file:///a', ...META })
    expect(user.error?.data).toEqual({ error: INSUFFICIENT_SCOPE, scopes: ['resources:user'] })
  })

  test('catalog scopes are met by held scopes', async () => {
    const request = await setup({
      catalog: { scopes: ['skills:read'] },
      auth: { subject: 'alice', scopes: ['skills:read'] },
    })
    const { result } = await request('skills/list', META)
    expect(result?.skills).toHaveLength(1)
  })
})
