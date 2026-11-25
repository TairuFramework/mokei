import { createValidator } from '@sozai/schema'
import { describe, expect, test } from 'vitest'

import { PROTOCOLS } from '../src/index.js'
import { skill, skillResource } from '../src/skills.js'

const protocol = PROTOCOLS['2026-07-28']
const validateClient = createValidator(protocol.clientMessage)
const validateServer = createValidator(protocol.serverMessage)
const validateSkillResource = createValidator(skillResource)
const validateSkill = createValidator(skill)

const META = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'ExampleClient', version: '1.0.0' },
  'io.modelcontextprotocol/clientCapabilities': {},
}
const DIGEST = `sha256:${'a'.repeat(64)}`
const ENTRY = {
  uri: 'skill://pdf-processing/SKILL.md',
  frontmatter: { name: 'pdf-processing', description: 'Extract PDFs', license: 'Apache-2.0' },
  resources: [{ uri: 'skill://pdf-processing/SKILL.md', digest: DIGEST, size: 151 }],
}

function ok(validate: (value: unknown) => { issues?: unknown }, value: unknown) {
  expect(validate(value).issues).toBeUndefined()
}

describe('skills wire schemas', () => {
  test('skills/list request and result', () => {
    ok(validateClient, {
      jsonrpc: '2.0',
      id: 4,
      method: 'skills/list',
      params: { _meta: META },
    })
    ok(validateServer, {
      jsonrpc: '2.0',
      id: 4,
      result: {
        resultType: 'complete',
        skills: [ENTRY, { ...ENTRY, uri: 'skill://dyn/SKILL.md', resources: 'dynamic' }],
        ttlMs: 300000,
        cacheScope: 'public',
      },
    })
  })

  test('skills/get request and result', () => {
    ok(validateClient, {
      jsonrpc: '2.0',
      id: 5,
      method: 'skills/get',
      params: { _meta: META, uri: 'skill://pdf-processing/SKILL.md' },
    })
    ok(validateServer, {
      jsonrpc: '2.0',
      id: 5,
      result: { resultType: 'complete', skill: ENTRY, ttlMs: 300000, cacheScope: 'public' },
    })
  })

  test('resources/directory/read request and result', () => {
    ok(validateClient, {
      jsonrpc: '2.0',
      id: 7,
      method: 'resources/directory/read',
      params: { _meta: META, uri: 'skill://pdf-processing/templates' },
    })
    ok(validateServer, {
      jsonrpc: '2.0',
      id: 7,
      result: {
        resultType: 'complete',
        resources: [
          {
            uri: 'skill://pdf-processing/templates/invoice.md',
            name: 'invoice.md',
            mimeType: 'text/markdown',
          },
          {
            uri: 'skill://pdf-processing/templates/regional',
            name: 'regional',
            mimeType: 'inode/directory',
          },
        ],
        ttlMs: 300000,
        cacheScope: 'public',
      },
    })
  })

  test('skills/get requires uri', () => {
    const outcome = validateClient({
      jsonrpc: '2.0',
      id: 5,
      method: 'skills/get',
      params: { _meta: META },
    })
    expect(outcome.issues).toBeDefined()
  })

  test('rejects a malformed digest', () => {
    expect(
      validateSkillResource({ uri: 'skill://a/SKILL.md', digest: 'sha256:ABC', size: 1 }).issues,
    ).toBeDefined()
    expect(
      validateSkillResource({
        uri: 'skill://a/SKILL.md',
        digest: `sha256:${'A'.repeat(64)}`,
        size: 1,
      }).issues,
    ).toBeDefined()
  })

  test('rejects a skill without resources', () => {
    const { resources: _resources, ...missing } = ENTRY
    expect(validateSkill(missing).issues).toBeDefined()
  })

  test('rejects resources other than an array or "dynamic"', () => {
    expect(validateSkill({ ...ENTRY, resources: 'static' }).issues).toBeDefined()
  })

  test.each([-1, 1.5])('rejects size %s', (size) => {
    expect(
      validateSkillResource({ uri: 'skill://a/SKILL.md', digest: DIGEST, size }).issues,
    ).toBeDefined()
  })

  test('accepts size 0', () => {
    ok(validateSkillResource, { uri: 'skill://a/SKILL.md', digest: DIGEST, size: 0 })
  })
})
