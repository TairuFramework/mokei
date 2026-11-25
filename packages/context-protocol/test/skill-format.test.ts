import { describe, expect, test } from 'vitest'

import {
  computeDigest,
  decodeExactUTF8,
  frontmatterEquals,
  isValidDigest,
  isValidSkillName,
  isValidSkillURI,
  isWithinSkill,
  joinSkillURI,
  parseSkillFrontmatter,
  SKILL_LIMITS,
  SkillFormatError,
  skillNameFromURI,
  skillRootURI,
  validatePathSegments,
  validateSkillFrontmatter,
} from '../src/skill-format.js'

describe('skill format', () => {
  test('SKILL_LIMITS', () => {
    expect(SKILL_LIMITS).toEqual({ maxFiles: 512, maxBytes: 16777216 })
  })

  test('computeDigest matches the spec example', async () => {
    const bytes = new TextEncoder().encode('# Invoice\n\nCustomer:\nAmount:\n')
    expect(bytes.length).toBe(29)
    expect(await computeDigest(bytes)).toBe(
      'sha256:61f4ea6d2c75fde1b4977219e7e3107d491c3c26aefb6686e84d6281c088d9ee',
    )
  })

  test('isValidDigest', () => {
    const hex = 'a'.repeat(64)
    expect(isValidDigest(`sha256:${hex}`)).toBe(true)
    expect(isValidDigest(`sha256:${'A'.repeat(64)}`)).toBe(false)
    expect(isValidDigest(`sha256:${'a'.repeat(63)}`)).toBe(false)
    expect(isValidDigest(hex)).toBe(false)
  })

  test('isValidSkillName', () => {
    expect(isValidSkillName('git-workflow')).toBe(true)
    expect(isValidSkillName('a')).toBe(true)
    expect(isValidSkillName('a'.repeat(64))).toBe(true)
    for (const name of ['Git', '-a', 'a-', 'a--b', '', 'a'.repeat(65)]) {
      expect(isValidSkillName(name)).toBe(false)
    }
  })

  test('validatePathSegments', () => {
    expect(validatePathSegments('acme/billing/refunds')).toEqual(['acme', 'billing', 'refunds'])
    for (const path of [
      '',
      '/a',
      'a//b',
      'a/./b',
      'a/../b',
      'a\\b',
      'a%b',
      'a?b',
      'a#b',
      'a\u0001b',
    ]) {
      expect(() => validatePathSegments(path)).toThrow(SkillFormatError)
    }
  })

  test('joinSkillURI', () => {
    expect(joinSkillURI('acme/billing/refunds', 'SKILL.md')).toBe(
      'skill://acme/billing/refunds/SKILL.md',
    )
    expect(joinSkillURI('acme/billing/refunds')).toBe('skill://acme/billing/refunds')
    expect(() => joinSkillURI('acme/../x')).toThrow(SkillFormatError)
    expect(() => joinSkillURI('acme', 'a//b')).toThrow(SkillFormatError)
  })

  test('URI helpers', () => {
    for (const scheme of ['skill', 'github']) {
      const uri = `${scheme}://acme/billing/refunds/SKILL.md`
      expect(skillRootURI(uri)).toBe(`${scheme}://acme/billing/refunds`)
      expect(skillNameFromURI(uri)).toBe('refunds')
      expect(isWithinSkill(uri, `${scheme}://acme/billing/refunds/examples/email.md`)).toBe(true)
      expect(isWithinSkill(uri, `${scheme}://acme/billing/refunds-other/x.md`)).toBe(false)
      expect(isWithinSkill(uri, `${scheme}://acme/billing/x.md`)).toBe(false)
    }
    const root = 'skill://a/b/SKILL.md'
    for (const hostile of [
      'skill://a/b/../../x',
      'skill://a/b/%2e%2e/x',
      'skill://a/b//x',
      'skill://a/b/x?x',
      'skill://a/b/x#f',
      'skill://a/b/x\u0001',
    ]) {
      expect(isWithinSkill(root, hostile)).toBe(false)
    }
    expect(isWithinSkill('skill://a/../SKILL.md', 'skill://a/../x')).toBe(false)
    expect(skillNameFromURI('github://o/r/refunds/SKILL.md')).toBe('refunds')
  })

  test('isValidSkillURI', () => {
    expect(isValidSkillURI('skill://acme/SKILL.md')).toBe(true)
    expect(isValidSkillURI('skill://a/%2F/SKILL.md')).toBe(false)
    expect(isValidSkillURI('skill://a/../SKILL.md')).toBe(false)
    expect(isValidSkillURI('skill://a//SKILL.md')).toBe(false)
    expect(isValidSkillURI('Skill://a/SKILL.md')).toBe(false)
    expect(isValidSkillURI('skill:/a')).toBe(false)
  })

  test('decodeExactUTF8', () => {
    expect(decodeExactUTF8(Uint8Array.of(0xff))).toBeNull()
    expect(decodeExactUTF8(Uint8Array.of(0xef, 0xbb, 0xbf, 0x61))).toBe('﻿a')
    expect(decodeExactUTF8(Uint8Array.of(0xc3, 0xa9))).toBe('é')
  })

  test('parseSkillFrontmatter', () => {
    expect(
      parseSkillFrontmatter(
        '---\nname: x\ndescription: y\nversion: 1.0\ncreated: 2026-01-01\n---\nbody',
      ),
    ).toEqual({ name: 'x', description: 'y', version: 1, created: '2026-01-01' })
    expect(() => parseSkillFrontmatter('name: x\n')).toThrow(SkillFormatError)
    expect(() => parseSkillFrontmatter('---\n- a\n- b\n---\n')).toThrow(SkillFormatError)
    expect(() => parseSkillFrontmatter('---\ndescription: y\n---\n')).toThrow(SkillFormatError)
    expect(() => parseSkillFrontmatter('---\nname: x\n---\n')).toThrow(SkillFormatError)
    expect(() => parseSkillFrontmatter('---\nname: 1\ndescription: y\n---\n')).toThrow(
      SkillFormatError,
    )
    expect(() => parseSkillFrontmatter('---\nname: x\ndescription: 2\n---\n')).toThrow(
      SkillFormatError,
    )
  })

  test('validateSkillFrontmatter', () => {
    const base = { name: 'x', description: 'y' }
    expect(() => validateSkillFrontmatter({ ...base, extra: [1] })).not.toThrow()
    const bad: Array<Record<string, unknown>> = [
      { ...base, description: '' },
      { ...base, description: 'a'.repeat(1025) },
      { ...base, compatibility: 'a'.repeat(501) },
      { ...base, metadata: { a: 1 } },
      { ...base, license: 3 },
      { ...base, 'allowed-tools': ['x'] },
    ]
    for (const fm of bad) {
      expect(() => validateSkillFrontmatter(fm)).toThrow(SkillFormatError)
    }
    expect(() =>
      validateSkillFrontmatter({ ...base, description: 'a'.repeat(1024), compatibility: 'c' }),
    ).not.toThrow()
  })

  test('frontmatterEquals', () => {
    expect(frontmatterEquals({ a: [1, { b: 'c', d: 1 }] }, { a: [1, { d: 1, b: 'c' }] })).toBe(true)
    expect(frontmatterEquals(1, '1')).toBe(false)
    expect(frontmatterEquals({ a: undefined }, {})).toBe(false)
    expect(frontmatterEquals([1, 2], [2, 1])).toBe(false)
    expect(frontmatterEquals(null, null)).toBe(true)
  })
})
