import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SkillFormatError } from '@mokei/extension-skills'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { loadSkillCatalog, loadSkillDefinitions } from '../src/skills.js'

const skillMd = (name: string) => `---\nname: ${name}\ndescription: test skill\n---\n# ${name}\n`

describe('skills loader', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'mokei-skills-'))
    await mkdir(join(root, 'a', 'ref'), { recursive: true })
    await mkdir(join(root, 'a', 'inner'), { recursive: true })
    await mkdir(join(root, 'a', 'empty'), { recursive: true })
    await writeFile(join(root, 'a', 'SKILL.md'), skillMd('a'))
    await writeFile(join(root, 'a', 'ref', 'x.md'), 'x')
    await writeFile(join(root, 'a', 'inner', 'SKILL.md'), skillMd('inner'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('loads skills with nesting and prefix', async () => {
    const defs = await loadSkillDefinitions(root, { prefix: 'acme' })
    expect(defs.map((d) => d.path)).toEqual(['acme/a', 'acme/a/inner'])
    const a = defs[0]
    if (a == null) throw new Error('missing skill')
    expect(Object.keys(a.files).sort()).toEqual(['SKILL.md', 'inner/SKILL.md', 'ref/x.md'])
    expect(a.files['SKILL.md']).toBeInstanceOf(Uint8Array)
    expect(a.directories).toContain('empty')
    expect(a.directories).not.toContain('ref')
  })

  test('skips symlinks and dotfiles', async () => {
    await writeFile(join(root, 'a', '.DS_Store'), 'x')
    await mkdir(join(root, 'a', '.git'))
    await writeFile(join(root, 'a', '.git', 'config'), 'x')
    await symlink(join(root, 'a', 'ref', 'x.md'), join(root, 'a', 'link.md'))
    const defs = await loadSkillDefinitions(root)
    const keys = Object.keys(defs[0]?.files ?? {})
    expect(keys).not.toContain('.DS_Store')
    expect(keys).not.toContain('link.md')
    expect(keys.some((k) => k.startsWith('.git'))).toBe(false)
  })

  test('rejects an invalid prefix', async () => {
    await expect(loadSkillDefinitions(root, { prefix: '../x' })).rejects.toThrow(SkillFormatError)
  })

  test('root skill uses prefix as path, skipped without prefix', async () => {
    await writeFile(join(root, 'SKILL.md'), skillMd('acme'))
    const defs = await loadSkillDefinitions(root, { prefix: 'acme' })
    expect(defs.map((d) => d.path)).toEqual(['acme', 'acme/a', 'acme/a/inner'])
    expect(await loadSkillDefinitions(root)).toHaveLength(2)
  })

  test('loadSkillCatalog builds a served catalog', async () => {
    const catalog = await loadSkillCatalog(root, { prefix: 'acme' })
    expect(catalog.entries.length).toBe(2)
  })

  test('loadSkillCatalog rejects a file name that is not a URI path segment', async () => {
    await writeFile(join(root, 'a', 'my notes.md'), 'x')
    const error = await loadSkillCatalog(root).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(SkillFormatError)
    expect((error as SkillFormatError).skill).toBe('a')
  })

  test('loadSkillCatalog rejects a skill over the file limit', async () => {
    for (let i = 0; i < 512; i++) {
      await writeFile(join(root, 'a', 'ref', `f${i}.txt`), 'x')
    }
    await expect(loadSkillCatalog(root)).rejects.toThrow(SkillFormatError)
  })
})
