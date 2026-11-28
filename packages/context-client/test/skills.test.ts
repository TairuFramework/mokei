import { DirectTransports } from '@enkaku/transport'
import type { ClientMessage, ClientRequest, ServerMessage, Skill } from '@mokei/context-protocol'
import { SKILLS_EXTENSION, skill as skillSchema } from '@mokei/context-protocol'
import { computeDigest } from '@mokei/extension-skills'
import { createValidator } from '@sozai/schema'
import { afterEach, describe, expect, test } from 'vitest'

import {
  ContextServer,
  createSkillCatalog,
  createTool,
  type SkillCatalogOptions,
  type SkillDefinition,
} from '../../context-server/lib/index.js'
import {
  ContextClient,
  checkSkillEntry,
  ExtensionNotDeclaredError,
  MethodNotInRevisionError,
  SkillVerificationError,
  type SkillVerificationReason,
} from '../src/index.js'

const SKILL_MD = '---\nname: pdf\ndescription: Fill PDF forms.\n---\nBody\n'
const INVOICE_MD = '# Invoice\n'
const NOTES = new Uint8Array([0xff, 0x00, 0x01])
const ROOT = 'skill://acme/pdf'

const DEFINITIONS: Array<SkillDefinition> = [
  {
    path: 'acme/pdf',
    files: { 'SKILL.md': SKILL_MD, 'templates/invoice.md': INVOICE_MD, 'notes.bin': NOTES },
  },
]

const encode = (text: string): Uint8Array => new TextEncoder().encode(text)

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
})

const methods = (sent: Array<ClientMessage>): Array<string | undefined> =>
  sent.map((message) => (message as { method?: string }).method)

function recordWrites(pair: DirectTransports<ServerMessage, ClientMessage>): Array<ClientMessage> {
  const sent: Array<ClientMessage> = []
  const write = pair.client.write.bind(pair.client)
  pair.client.write = ((message: ClientMessage) => {
    sent.push(message)
    return write(message)
  }) as typeof pair.client.write
  return sent
}

type Setup = {
  definitions?: Array<SkillDefinition>
  catalog?: SkillCatalogOptions | false
  version?: '2025-11-25' | '2026-07-28'
  skills?: boolean
}

async function setup(options: Setup = {}) {
  const pair = new DirectTransports<ServerMessage, ClientMessage>()
  cleanup.push(() => pair.dispose())
  const sent = recordWrites(pair)
  const server = new ContextServer({
    name: 'skills-test',
    version: '1.0.0',
    protocolVersions: ['2025-11-25', '2026-07-28'],
    tools: {
      echo: createTool({
        description: 'echo',
        inputSchema: { type: 'object' },
        handler: () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
      }),
    },
    skills:
      options.catalog === false
        ? undefined
        : await createSkillCatalog(options.definitions ?? DEFINITIONS, options.catalog),
    transport: pair.server,
  })
  cleanup.push(() => server.dispose())
  const client = new ContextClient({
    protocolVersion: options.version ?? '2026-07-28',
    transport: pair.client,
    skills: options.skills ?? true,
  })
  return { client, sent }
}

type Reply = (request: ClientRequest) => unknown

const DISCOVERY = {
  resultType: 'complete',
  supportedVersions: ['2026-07-28'],
  capabilities: { resources: {}, extensions: { [SKILLS_EXTENSION]: {} } },
  ttlMs: 0,
  cacheScope: 'private',
}

/** A server that answers every request itself, after a discover declaring skills. */
function fake(reply: Reply) {
  const pair = new DirectTransports<ServerMessage, ClientMessage>()
  cleanup.push(() => pair.dispose())
  const client = new ContextClient({
    protocolVersion: '2026-07-28',
    transport: pair.client,
    skills: true,
  })
  const received: Array<ClientRequest> = []
  void (async () => {
    for (;;) {
      const next = await pair.server.read()
      if (next.done) return
      const request = next.value as ClientRequest
      received.push(request)
      if (request.id == null) continue
      const result = request.method === 'server/discover' ? DISCOVERY : reply(request)
      pair.server.write({ jsonrpc: '2.0', id: request.id, result } as ServerMessage)
    }
  })()
  return { client, received }
}

async function reasonOf(run: () => unknown): Promise<SkillVerificationReason | 'no-error'> {
  try {
    await run()
  } catch (error) {
    if (error instanceof SkillVerificationError) return error.reason
    throw error
  }
  return 'no-error'
}

const DIGEST = `sha256:${'0'.repeat(64)}`

function entry(overrides: Partial<Skill> = {}): Skill {
  return {
    uri: `${ROOT}/SKILL.md`,
    frontmatter: { name: 'pdf', description: 'Fill PDF forms.' },
    resources: [
      { uri: `${ROOT}/SKILL.md`, digest: DIGEST, size: 10 },
      { uri: `${ROOT}/templates/invoice.md`, digest: DIGEST, size: 10 },
    ],
    ...overrides,
  }
}

function withFile(file: Record<string, unknown>): Skill {
  return entry({
    resources: [{ uri: `${ROOT}/SKILL.md`, digest: DIGEST, size: 10 }, file] as Skill['resources'],
  })
}

describe('checkSkillEntry rejects hostile entries', () => {
  test('accepts a well-formed entry', () => {
    expect(() => checkSkillEntry(entry())).not.toThrow()
    expect(() => checkSkillEntry(entry({ resources: 'dynamic' }))).not.toThrow()
  })

  const invalid: Record<string, () => Skill> = {
    'negative size': () => withFile({ uri: `${ROOT}/a.md`, digest: DIGEST, size: -1 }),
    'unsafe size': () => withFile({ uri: `${ROOT}/a.md`, digest: DIGEST, size: 2 ** 53 }),
    'fractional size': () => withFile({ uri: `${ROOT}/a.md`, digest: DIGEST, size: 1.5 }),
    'uppercase digest': () =>
      withFile({ uri: `${ROOT}/a.md`, digest: `sha256:${'A'.repeat(64)}`, size: 1 }),
    'missing digest': () => withFile({ uri: `${ROOT}/a.md`, size: 1 }),
    'empty description': () => entry({ frontmatter: { name: 'pdf', description: '' } }),
    'non-string name': () =>
      entry({ frontmatter: { name: 1, description: 'x' } as unknown as Skill['frontmatter'] }),
    'uri not ending in /SKILL.md': () => entry({ uri: `${ROOT}/README.md` }),
    'name segment differs from frontmatter.name': () =>
      entry({ frontmatter: { name: 'other', description: 'x' } }),
    'invalid skill name segment': () =>
      entry({
        uri: 'skill://acme/PDF/SKILL.md',
        frontmatter: { name: 'PDF', description: 'x' },
        resources: 'dynamic',
      }),
    'one-segment uri skill://SKILL.md': () =>
      entry({ uri: 'skill://SKILL.md', resources: 'dynamic' }),
    'one-segment uri skill://x': () => entry({ uri: 'skill://x', resources: 'dynamic' }),
    'resources missing its own uri': () =>
      entry({ resources: [{ uri: `${ROOT}/a.md`, digest: DIGEST, size: 1 }] }),
    'uri listed twice': () =>
      entry({
        resources: [
          { uri: `${ROOT}/SKILL.md`, digest: DIGEST, size: 1 },
          { uri: `${ROOT}/a.md`, digest: DIGEST, size: 1 },
          { uri: `${ROOT}/a.md`, digest: DIGEST, size: 1 },
        ],
      }),
    'file outside the skill root': () =>
      withFile({ uri: 'skill://acme/other/a.md', digest: DIGEST, size: 1 }),
    'file in a sibling with a shared prefix': () =>
      withFile({ uri: 'skill://acme/pdfx/a.md', digest: DIGEST, size: 1 }),
    'uri containing ..': () => withFile({ uri: `${ROOT}/../other/a.md`, digest: DIGEST, size: 1 }),
    'uri containing %2F': () => withFile({ uri: `${ROOT}/a%2Fb.md`, digest: DIGEST, size: 1 }),
    'uri containing a backslash': () =>
      withFile({ uri: `${ROOT}/a\\b.md`, digest: DIGEST, size: 1 }),
    'resources neither array nor dynamic': () =>
      entry({ resources: 'static' as unknown as Skill['resources'] }),
    'resource not an object': () => withFile(null as unknown as Record<string, unknown>),
  }
  for (const [name, build] of Object.entries(invalid)) {
    test(`invalid-entry: ${name}`, async () => {
      expect(await reasonOf(() => checkSkillEntry(build()))).toBe('invalid-entry')
    })
  }

  test('invalid-entry: not an object', async () => {
    expect(await reasonOf(() => checkSkillEntry(null as unknown as Skill))).toBe('invalid-entry')
  })

  test('limits: 513 entries', async () => {
    const resources = [{ uri: `${ROOT}/SKILL.md`, digest: DIGEST, size: 1 }]
    for (let i = 0; i < 512; i++) {
      resources.push({ uri: `${ROOT}/f${i}.md`, digest: DIGEST, size: 1 })
    }
    expect(await reasonOf(() => checkSkillEntry(entry({ resources })))).toBe('limits')
    resources.pop()
    expect(() => checkSkillEntry(entry({ resources }))).not.toThrow()
  })

  test('limits: total over 16,777,216 bytes', async () => {
    const over = withFile({ uri: `${ROOT}/big.bin`, digest: DIGEST, size: 16_777_216 - 9 })
    expect(await reasonOf(() => checkSkillEntry(over))).toBe('limits')
    const exact = withFile({ uri: `${ROOT}/big.bin`, digest: DIGEST, size: 16_777_216 - 10 })
    expect(() => checkSkillEntry(exact)).not.toThrow()
  })

  test('the error carries the entry uri', () => {
    try {
      checkSkillEntry(entry({ frontmatter: { name: 'pdf', description: '' } }))
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(SkillVerificationError)
      expect((error as SkillVerificationError).uri).toBe(`${ROOT}/SKILL.md`)
    }
  })
})

describe('readSkillFile verifies', () => {
  async function listed() {
    const context = await setup()
    const { skills } = await context.client.listSkills()
    const held = skills[0] as Skill
    return { ...context, held }
  }

  test('returns the served bytes and text', async () => {
    const { client, held } = await listed()
    const invoice = await client.readSkillFile(held, `${ROOT}/templates/invoice.md`)
    expect(invoice).toEqual({
      uri: `${ROOT}/templates/invoice.md`,
      mimeType: 'text/markdown',
      bytes: encode(INVOICE_MD),
      text: INVOICE_MD,
    })
    const skill = await client.readSkillFile(held, held.uri)
    expect(skill.text).toBe(SKILL_MD)
    const notes = await client.readSkillFile(held, `${ROOT}/notes.bin`)
    expect(notes.bytes).toEqual(NOTES)
    expect(notes.text).toBeUndefined()
  })

  test('unlisted URI is refused before anything is sent', async () => {
    const { client, sent, held } = await listed()
    const before = sent.length
    expect(await reasonOf(() => client.readSkillFile(held, `${ROOT}/nope.md`))).toBe('unlisted')
    expect(sent.length).toBe(before)
  })

  test('altered digest', async () => {
    const { client, held } = await listed()
    const uri = `${ROOT}/templates/invoice.md`
    const altered = {
      ...held,
      resources: (held.resources as Array<{ uri: string }>).map((file) =>
        file.uri === uri ? { ...file, digest: `sha256:${'a'.repeat(64)}` } : file,
      ),
    } as Skill
    expect(await reasonOf(() => client.readSkillFile(altered, uri))).toBe('digest')
  })

  test('altered size', async () => {
    const { client, held } = await listed()
    const uri = `${ROOT}/notes.bin`
    const altered = {
      ...held,
      resources: (held.resources as Array<{ uri: string; size: number }>).map((file) =>
        file.uri === uri ? { ...file, size: file.size + 1 } : file,
      ),
    } as Skill
    expect(await reasonOf(() => client.readSkillFile(altered, uri))).toBe('size')
  })

  test('altered frontmatter on SKILL.md', async () => {
    const { client, held } = await listed()
    const altered = { ...held, frontmatter: { ...held.frontmatter, description: 'Other.' } }
    expect(await reasonOf(() => client.readSkillFile(altered, held.uri))).toBe('frontmatter')
    // Other files of the same entry are unaffected by the frontmatter.
    await expect(
      client.readSkillFile(altered, `${ROOT}/templates/invoice.md`),
    ).resolves.toBeDefined()
  })

  test('hostile entry is refused before anything is sent', async () => {
    const { client, sent, held } = await listed()
    const before = sent.length
    const hostile = { ...held, frontmatter: { ...held.frontmatter, name: 'other' } }
    expect(await reasonOf(() => client.readSkillFile(hostile, held.uri))).toBe('invalid-entry')
    expect(sent.length).toBe(before)
  })
})

describe('readSkillFile rejects ambiguous responses', () => {
  const uri = `${ROOT}/a.md`
  async function held(): Promise<Skill> {
    return entry({
      resources: [
        { uri: `${ROOT}/SKILL.md`, digest: DIGEST, size: 1 },
        { uri, digest: await computeDigest(encode('hello')), size: 5 },
      ],
    })
  }
  const responses: Record<string, Array<Record<string, unknown>>> = {
    'no contents': [],
    'two contents': [
      { uri, text: 'hello' },
      { uri, text: 'hello' },
    ],
    'mismatched uri': [{ uri: `${ROOT}/b.md`, text: 'hello' }],
    'both text and blob': [{ uri, text: 'hello', blob: 'aGVsbG8=' }],
    // Passes the wire schema, but its unused trailing bits are not zero.
    'non-canonical base64 blob': [{ uri, blob: 'aGVsbG9=' }],
  }
  for (const [name, contents] of Object.entries(responses)) {
    test(name, async () => {
      const { client } = fake(() => ({ resultType: 'complete', contents }))
      expect(await reasonOf(async () => client.readSkillFile(await held(), uri))).toBe('response')
    })
  }

  test('neither text nor blob is refused', async () => {
    // The inbound wire validator rejects this shape before verification runs.
    const { client } = fake(() => ({ resultType: 'complete', contents: [{ uri }] }))
    await expect(client.readSkillFile(await held(), uri)).rejects.toThrow()
  })

  test('a matching blob response is accepted', async () => {
    const { client } = fake(() => ({
      resultType: 'complete',
      contents: [{ uri, blob: 'aGVsbG8=' }],
    }))
    const file = await client.readSkillFile(await held(), uri)
    expect(file.bytes).toEqual(encode('hello'))
    expect(file.text).toBeUndefined()
  })
})

describe('dynamic entries', () => {
  const GenMd = '---\nname: gen\ndescription: Generated.\n---\n'
  const dynamic: Skill = {
    uri: 'skill://acme/gen/SKILL.md',
    frontmatter: { name: 'gen', description: 'Generated.' },
    resources: 'dynamic',
  }
  function generator() {
    return fake((request) => {
      const { uri } = request.params as { uri: string }
      return {
        resultType: 'complete',
        contents: [{ uri, text: uri.endsWith('/SKILL.md') ? GenMd : `content of ${uri}` }],
      }
    })
  }

  test('any URI within the root is read', async () => {
    const { client } = generator()
    const file = await client.readSkillFile(dynamic, 'skill://acme/gen/data/x.txt')
    expect(file.text).toBe('content of skill://acme/gen/data/x.txt')
    expect((await client.readSkillFile(dynamic, dynamic.uri)).text).toBe(GenMd)
  })

  test('SKILL.md frontmatter is still checked', async () => {
    const { client } = generator()
    const altered = { ...dynamic, frontmatter: { name: 'gen', description: 'Different.' } }
    expect(await reasonOf(() => client.readSkillFile(altered, dynamic.uri))).toBe('frontmatter')
  })

  test('a non-UTF-8 blob SKILL.md is refused', async () => {
    const { client } = fake(() => ({
      resultType: 'complete',
      contents: [{ uri: dynamic.uri, blob: '//8A' }],
    }))
    expect(await reasonOf(() => client.readSkillFile(dynamic, dynamic.uri))).toBe('frontmatter')
  })

  test('a SKILL.md with unparseable frontmatter is refused', async () => {
    const { client } = fake(() => ({
      resultType: 'complete',
      contents: [{ uri: dynamic.uri, text: '---\nname: [gen\n---\n' }],
    }))
    expect(await reasonOf(() => client.readSkillFile(dynamic, dynamic.uri))).toBe('frontmatter')
  })

  test('a URI outside the root is unlisted', async () => {
    const { client, received } = generator()
    expect(await reasonOf(() => client.readSkillFile(dynamic, 'skill://acme/other/x.txt'))).toBe(
      'unlisted',
    )
    expect(await reasonOf(() => client.readSkillFile(dynamic, 'skill://acme/gen/../x.txt'))).toBe(
      'unlisted',
    )
    expect(received.map((request) => request.method)).not.toContain('resources/read')
  })
})

test('getSkill refuses an entry for another uri', async () => {
  const uri = `${ROOT}/SKILL.md`
  const { client } = fake(() => ({
    resultType: 'complete',
    skill: entry({ uri: 'skill://acme/other/pdf/SKILL.md', resources: 'dynamic' }),
  }))
  const error = await client.getSkill(uri).catch((error: unknown) => error)
  expect(error).toBeInstanceOf(SkillVerificationError)
  expect((error as SkillVerificationError).reason).toBe('response')
  expect((error as SkillVerificationError).uri).toBe(uri)
})

describe('gates', () => {
  test('skills not enabled refuses locally', async () => {
    const { client, sent } = await setup({ skills: false })
    await expect(client.listSkills()).rejects.toBeInstanceOf(MethodNotInRevisionError)
    await expect(client.getSkill(`${ROOT}/SKILL.md`)).rejects.toBeInstanceOf(
      MethodNotInRevisionError,
    )
    await expect(client.readResourceDirectory({ uri: ROOT })).rejects.toBeInstanceOf(
      MethodNotInRevisionError,
    )
    await expect(client.readSkillFile(entry(), `${ROOT}/SKILL.md`)).rejects.toBeInstanceOf(
      MethodNotInRevisionError,
    )
    expect(methods(sent)).toEqual(['server/discover'])
  })

  test('server without skills gives ExtensionNotDeclaredError', async () => {
    const { client, sent } = await setup({ catalog: false })
    await expect(client.listSkills()).rejects.toBeInstanceOf(ExtensionNotDeclaredError)
    await expect(client.getSkill(`${ROOT}/SKILL.md`)).rejects.toBeInstanceOf(
      ExtensionNotDeclaredError,
    )
    await expect(client.readResourceDirectory({ uri: ROOT })).rejects.toBeInstanceOf(
      ExtensionNotDeclaredError,
    )
    await expect(client.readSkillFile(entry(), `${ROOT}/SKILL.md`)).rejects.toBeInstanceOf(
      ExtensionNotDeclaredError,
    )
    expect(methods(sent)).toEqual(['server/discover'])
  })

  test('readResourceDirectory is refused locally without directoryRead', async () => {
    const { client, sent } = await setup()
    const error = await client.readResourceDirectory({ uri: ROOT }).catch((cause) => cause)
    expect(error).toBeInstanceOf(ExtensionNotDeclaredError)
    expect((error as ExtensionNotDeclaredError).extension).toBe(
      'io.modelcontextprotocol/skills#directoryRead',
    )
    expect(methods(sent)).not.toContain('resources/directory/read')
  })

  test('readResourceDirectory lists children with directoryRead', async () => {
    const { client } = await setup({ catalog: { directoryRead: true } })
    const { resources } = await client.readResourceDirectory({ uri: ROOT })
    expect(resources.map((resource) => resource.uri).sort()).toEqual([
      `${ROOT}/SKILL.md`,
      `${ROOT}/notes.bin`,
      `${ROOT}/templates`,
    ])
  })

  test('listSkills is refused locally on 2025-11-25', async () => {
    const { client, sent } = await setup({ version: '2025-11-25' })
    await expect(client.listSkills()).rejects.toBeInstanceOf(MethodNotInRevisionError)
    expect(methods(sent)).not.toContain('skills/list')
  })
})

test('skills: true declares the extension', async () => {
  const { client, sent } = await setup()
  await client.listSkills()
  const list = sent.find(
    (message) => (message as { method?: string }).method === 'skills/list',
  ) as {
    params: { _meta: Record<string, { extensions?: Record<string, unknown> }> }
  }
  expect(list.params._meta['io.modelcontextprotocol/clientCapabilities']?.extensions).toEqual({
    [SKILLS_EXTENSION]: {},
  })
})

test('listSkills walks pages', async () => {
  const first = entry({ resources: 'dynamic' })
  const second = entry({
    uri: 'skill://acme/gen/SKILL.md',
    frontmatter: { name: 'gen', description: 'Generated.' },
    resources: 'dynamic',
  })
  const { client, received } = fake((request) => {
    const cursor = (request.params as { cursor?: string } | undefined)?.cursor
    return cursor == null
      ? { resultType: 'complete', skills: [first], nextCursor: 'page-2' }
      : { resultType: 'complete', skills: [second] }
  })
  const result = await client.listSkills()
  expect(result.skills).toEqual([first, second])
  expect(result.nextCursor).toBeUndefined()
  expect(received.filter((request) => request.method === 'skills/list')).toHaveLength(2)
})

test('no eager reads', async () => {
  const { client, sent } = await setup()
  const { skills } = await client.listSkills()
  await client.getSkill((skills[0] as Skill).uri)
  expect(methods(sent)).not.toContain('resources/read')
})

test('every catalog entry passes checkSkillEntry and every file reads', async () => {
  const definitions: Array<SkillDefinition> = [
    {
      path: 'tools',
      files: {
        'SKILL.md': '---\nname: tools\ndescription: Tools.\n---\n',
        'inner/SKILL.md': '---\nname: inner\ndescription: Inner.\n---\n',
        'inner/ref.md': '# Ref\n',
      },
    },
    {
      path: 'tools/inner',
      files: {
        'SKILL.md': '---\nname: inner\ndescription: Inner.\n---\n',
        'ref.md': '# Ref\n',
      },
    },
    {
      path: 'org/team/writer',
      files: {
        'SKILL.md': '---\r\nname: writer\ndescription: Writes.\nmetadata:\n  a: b\n---\n',
        'assets/logo.bin': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff]),
        'scripts/run.sh': '#!/bin/sh\necho hi\n',
        "x/a-z_0.9~!$&'()*+,;=:@.txt": 'every pchar but %\n',
      },
      directories: ['empty'],
    },
  ]
  const catalog = await createSkillCatalog(definitions)
  // The wire schema checks `format: 'uri'`: an entry it rejects would fail the whole listing.
  const validateSkill = createValidator(skillSchema)
  for (const skill of catalog.entries) {
    expect(() => checkSkillEntry(skill)).not.toThrow()
    expect(validateSkill(skill).issues).toBeUndefined()
  }
  const { client } = await setup({ definitions })
  const { skills } = await client.listSkills()
  expect(skills).toHaveLength(catalog.entries.length)
  for (const skill of skills) {
    checkSkillEntry(skill)
    for (const file of skill.resources as Array<{ uri: string; size: number }>) {
      const read = await client.readSkillFile(skill, file.uri)
      expect(read.bytes.length).toBe(file.size)
    }
  }
})
