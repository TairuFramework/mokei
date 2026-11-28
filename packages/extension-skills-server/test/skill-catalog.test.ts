import { createHash } from 'node:crypto'
import { SkillFormatError } from '@mokei/extension-skills'
import { describe, expect, test } from 'vitest'

import { createSkillCatalog, type SkillDefinition } from '../src/skill-catalog.js'

const SKILL_MD = `---
name: pdf-processing
description: Extract and fill PDF forms.
license: MIT
metadata:
  author: acme
---
# PDF processing

Use templates/invoice.md.
`
const INVOICE_MD = '# Invoice\n\nTotal: {{total}}\n'

function sha256(text: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

function skillMd(name: string, description = 'A skill.'): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\nBody\n`
}

function pdfSkill(): SkillDefinition {
  return {
    path: 'pdf-processing',
    files: { 'SKILL.md': SKILL_MD, 'templates/invoice.md': INVOICE_MD },
  }
}

describe('createSkillCatalog', () => {
  test('builds a manifest from served bytes', async () => {
    const catalog = await createSkillCatalog([pdfSkill()])
    expect(catalog.entries).toHaveLength(1)
    const entry = catalog.entries[0]
    expect(entry?.uri).toBe('skill://pdf-processing/SKILL.md')
    expect(entry?.resources).toEqual([
      {
        uri: 'skill://pdf-processing/SKILL.md',
        digest: sha256(SKILL_MD),
        size: byteLength(SKILL_MD),
      },
      {
        uri: 'skill://pdf-processing/templates/invoice.md',
        digest: sha256(INVOICE_MD),
        size: byteLength(INVOICE_MD),
      },
    ])
    expect(entry?.frontmatter).toEqual({
      name: 'pdf-processing',
      description: 'Extract and fill PDF forms.',
      license: 'MIT',
      metadata: { author: 'acme' },
    })
    expect(catalog.getEntry('skill://pdf-processing/SKILL.md')).toBe(entry)
    expect(catalog.getEntry('skill://nope/SKILL.md')).toBeUndefined()
  })

  test('exposes options', async () => {
    const defaults = await createSkillCatalog([pdfSkill()])
    expect(defaults.directoryRead).toBe(false)
    expect(defaults.cache).toBeUndefined()
    expect(defaults.scopes).toBeUndefined()
    const custom = await createSkillCatalog([pdfSkill()], {
      directoryRead: true,
      cache: { ttlMs: 5, cacheScope: 'public' },
      scopes: ['skills:read'],
    })
    expect(custom.directoryRead).toBe(true)
    expect(custom.cache).toEqual({ ttlMs: 5, cacheScope: 'public' })
    expect(custom.scopes).toEqual(['skills:read'])
  })

  const invalid: Array<[string, () => Array<SkillDefinition>]> = [
    [
      'name differs from last path segment',
      () => [{ path: 'other', files: { 'SKILL.md': skillMd('pdf-processing') } }],
    ],
    ['invalid name', () => [{ path: 'Bad_Name', files: { 'SKILL.md': skillMd('Bad_Name') } }]],
    [
      'path with ..',
      () => [{ path: 'acme/../refunds', files: { 'SKILL.md': skillMd('refunds') } }],
    ],
    ['path segment a%2Fb', () => [{ path: 'a%2Fb', files: { 'SKILL.md': skillMd('a') } }]],
    ['file key ../x', () => [{ path: 'a', files: { 'SKILL.md': skillMd('a'), '../x': 'x' } }]],
    [
      'file named my notes.md',
      () => [{ path: 'a', files: { 'SKILL.md': skillMd('a'), 'my notes.md': 'x' } }],
    ],
    ['no SKILL.md', () => [{ path: 'a', files: { 'readme.md': 'x' } }]],
    [
      '513 files',
      () => {
        const files: Record<string, string> = { 'SKILL.md': skillMd('a') }
        for (let i = 0; i < 512; i++) {
          files[`f${i}.txt`] = 'x'
        }
        return [{ path: 'a', files }]
      },
    ],
    [
      'too many bytes',
      () => [
        {
          path: 'a',
          files: { 'SKILL.md': skillMd('a'), 'big.bin': new Uint8Array(16777216) },
        },
      ],
    ],
    [
      'duplicate path',
      () => [
        { path: 'a', files: { 'SKILL.md': skillMd('a') } },
        { path: 'a', files: { 'SKILL.md': skillMd('a') } },
      ],
    ],
    [
      'description too long',
      () => [{ path: 'a', files: { 'SKILL.md': skillMd('a', 'x'.repeat(1025)) } }],
    ],
    [
      'invalid directories entry',
      () => [{ path: 'a', files: { 'SKILL.md': skillMd('a') }, directories: ['../x'] }],
    ],
  ]
  test.each(invalid)('rejects invalid definition: %s', async (_name, build) => {
    await expect(createSkillCatalog(build())).rejects.toBeInstanceOf(SkillFormatError)
  })

  test.each([
    ['BOM-prefixed SKILL.md', { path: 'acme/a', files: { 'SKILL.md': `\uFEFF${skillMd('a')}` } }],
    ['invalid skill path', { path: 'acme/../a', files: { 'SKILL.md': skillMd('a') } }],
    ['invalid file key', { path: 'acme/a', files: { 'SKILL.md': skillMd('a'), 'a b': 'x' } }],
    [
      'invalid frontmatter field',
      { path: 'acme/a', files: { 'SKILL.md': skillMd('a', 'x'.repeat(1025)) } },
    ],
  ] as Array<[string, SkillDefinition]>)(
    'attributes a format error to the definition path: %s',
    async (_name, definition) => {
      const error = await createSkillCatalog([definition]).catch((error: unknown) => error)
      expect(error).toBeInstanceOf(SkillFormatError)
      expect((error as SkillFormatError).skill).toBe(definition.path)
      expect((error as SkillFormatError).message).toContain(definition.path)
    },
  )

  test.each([
    [
      'file that is an ancestor of another file',
      [{ path: 'a', files: { 'SKILL.md': skillMd('a'), x: '1', 'x/y': '2' } }],
    ],
    [
      'declared directory that is a file',
      [{ path: 'a', files: { 'SKILL.md': skillMd('a') }, directories: ['SKILL.md'] }],
    ],
    [
      'file that is a nested skill root',
      [
        { path: 'x', files: { 'SKILL.md': skillMd('x'), sub: 'file' } },
        { path: 'x/sub', files: { 'SKILL.md': skillMd('sub') } },
      ],
    ],
  ] as Array<[string, Array<SkillDefinition>]>)(
    'rejects a URI that is both file and directory: %s',
    async (_name, definitions) => {
      await expect(createSkillCatalog(definitions)).rejects.toBeInstanceOf(SkillFormatError)
    },
  )

  test('rejects inconsistent nested definitions', async () => {
    const inner = {
      path: 'outer/inner',
      files: { 'SKILL.md': skillMd('inner'), 'x.txt': 'x' },
    }
    await expect(
      createSkillCatalog([
        {
          path: 'outer',
          files: { 'SKILL.md': skillMd('outer'), 'inner/SKILL.md': skillMd('inner') },
        },
        inner,
      ]),
    ).rejects.toBeInstanceOf(SkillFormatError)
    await expect(
      createSkillCatalog([
        {
          path: 'outer',
          files: {
            'SKILL.md': skillMd('outer'),
            'inner/SKILL.md': skillMd('inner'),
            'inner/x.txt': 'different',
          },
        },
        inner,
      ]),
    ).rejects.toBeInstanceOf(SkillFormatError)
  })

  test('publishes a nested skill separately', async () => {
    const catalog = await createSkillCatalog([
      {
        path: 'outer',
        files: { 'SKILL.md': skillMd('outer'), 'inner/SKILL.md': skillMd('inner') },
      },
      { path: 'outer/inner', files: { 'SKILL.md': skillMd('inner') } },
    ])
    expect(catalog.entries.map((e) => e.uri)).toEqual([
      'skill://outer/SKILL.md',
      'skill://outer/inner/SKILL.md',
    ])
    const outer = catalog.getEntry('skill://outer/SKILL.md')
    expect(outer?.resources).toContainEqual(
      expect.objectContaining({ uri: 'skill://outer/inner/SKILL.md' }),
    )
  })

  test('chooses text only for exact UTF-8', async () => {
    const catalog = await createSkillCatalog([
      {
        path: 'a',
        files: {
          'SKILL.md': skillMd('a'),
          'notes.txt': new Uint8Array([0xff]),
          'bom.md': '﻿hello',
          'ascii.bin': 'plain',
        },
      },
    ])
    const notes = catalog.getFile('skill://a/notes.txt')
    expect(notes?.text).toBeUndefined()
    expect(notes?.mimeType).toBe('text/plain')
    expect(Array.from(Buffer.from(notes?.blob ?? '', 'base64'))).toEqual([0xff])
    const bom = catalog.getFile('skill://a/bom.md')
    expect(bom?.text?.startsWith('﻿')).toBe(true)
    expect(bom?.blob).toBeUndefined()
    const bin = catalog.getFile('skill://a/ascii.bin')
    expect(bin?.text).toBe('plain')
    expect(bin?.mimeType).toBe('application/octet-stream')
    expect(catalog.getFile('skill://a/missing')).toBeUndefined()
  })

  test('SKILL.md mime is text/markdown', async () => {
    const catalog = await createSkillCatalog([pdfSkill()])
    expect(catalog.getFile('skill://pdf-processing/SKILL.md')?.mimeType).toBe('text/markdown')
  })

  test('indexes directories, including empty ones', async () => {
    const catalog = await createSkillCatalog([
      { ...pdfSkill(), directories: ['empty'] },
      { path: 'acme/billing/refunds', files: { 'SKILL.md': skillMd('refunds') } },
    ])
    const root = catalog.getDirectory('skill://pdf-processing')
    expect(root?.map((r) => [r.name, r.uri, r.mimeType])).toEqual([
      ['SKILL.md', 'skill://pdf-processing/SKILL.md', 'text/markdown'],
      ['empty', 'skill://pdf-processing/empty', 'inode/directory'],
      ['templates', 'skill://pdf-processing/templates', 'inode/directory'],
    ])
    expect(root?.[0]?.size).toBe(byteLength(SKILL_MD))
    expect(catalog.getDirectory('skill://pdf-processing/empty')).toEqual([])
    expect(catalog.getDirectory('skill://acme')?.map((r) => r.name)).toEqual(['billing'])
    expect(catalog.getDirectory('skill://pdf-processing/SKILL.md')).toBeUndefined()
    expect(catalog.has('skill://pdf-processing/empty')).toBe(true)
    expect(catalog.has('skill://acme/billing')).toBe(true)
    expect(catalog.has('skill://pdf-processing/SKILL.md')).toBe(true)
    expect(catalog.has('skill://nope')).toBe(false)
  })
})
