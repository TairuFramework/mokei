import type { FromSchema, Schema } from '@sozai/schema'

import { resource } from './resource.js'
import {
  cacheableResult,
  metadata,
  paginatedRequest,
  paginatedResult,
  request,
  result,
} from './rpc.js'

/** Extension identifier of the Skills extension. */
export const SKILLS_EXTENSION = 'io.modelcontextprotocol/skills'

export const skillResource = {
  description: 'A file belonging to a skill, with the digest and size of its content.',
  properties: {
    uri: {
      description: 'Resource URI of the file.',
      format: 'uri',
      type: 'string',
    },
    digest: {
      description:
        "SHA-256 digest of the file's raw bytes, formatted as `sha256:{hex}` where {hex} is 64 lowercase hexadecimal characters.",
      pattern: '^sha256:[0-9a-f]{64}$',
      type: 'string',
    },
    size: {
      description:
        "Length in bytes of the file's raw content (the same bytes that `digest` covers).",
      minimum: 0,
      type: 'integer',
    },
  },
  required: ['uri', 'digest', 'size'],
  type: 'object',
} as const satisfies Schema
export type SkillResource = FromSchema<typeof skillResource>

export const skill = {
  description: 'The entry for a single skill.',
  properties: {
    _meta: metadata,
    uri: {
      description: "Resource URI of the skill's SKILL.md, readable via resources/read.",
      format: 'uri',
      type: 'string',
    },
    frontmatter: {
      additionalProperties: true,
      description:
        "The skill's SKILL.md YAML frontmatter, rendered verbatim as a JSON object. `name` and `description` are always present; every other field the author wrote passes through unchanged.",
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['name', 'description'],
      type: 'object',
    },
    resources: {
      description:
        'The skill\'s files: a complete enumeration of SKILL.md and every supporting file, or the string "dynamic" when the skill\'s content is generated such that stable digests cannot be published.',
      anyOf: [
        { items: skillResource, type: 'array' },
        { const: 'dynamic', type: 'string' },
      ],
    },
  },
  required: ['uri', 'frontmatter', 'resources'],
  type: 'object',
} as const satisfies Schema
export type Skill = FromSchema<typeof skill>

export const listSkillsRequest = {
  description: 'Sent from the client to request the skills the server serves.',
  allOf: [
    paginatedRequest,
    {
      properties: {
        method: { const: 'skills/list', type: 'string' },
      },
      required: ['method'],
      type: 'object',
    },
  ],
} as const satisfies Schema
export type ListSkillsRequest = FromSchema<typeof listSkillsRequest>

export const listSkillsResult = {
  description: "The server's response to a skills/list request from the client.",
  allOf: [
    paginatedResult,
    cacheableResult,
    {
      properties: {
        skills: { items: skill, type: 'array' },
      },
      required: ['skills'],
      type: 'object',
    },
  ],
} as const satisfies Schema
export type ListSkillsResult = FromSchema<typeof listSkillsResult>

export const getSkillRequest = {
  description: 'Sent from the client to request the entry for a single skill.',
  allOf: [
    request,
    {
      properties: {
        method: { const: 'skills/get', type: 'string' },
        params: {
          properties: {
            uri: {
              description: "URI of the skill's SKILL.md.",
              format: 'uri',
              type: 'string',
            },
          },
          required: ['uri'],
          type: 'object',
        },
      },
      required: ['method', 'params'],
      type: 'object',
    },
  ],
} as const satisfies Schema
export type GetSkillRequest = FromSchema<typeof getSkillRequest>

export const getSkillResult = {
  description: "The server's response to a skills/get request from the client.",
  allOf: [
    result,
    cacheableResult,
    {
      properties: {
        skill,
      },
      required: ['skill'],
      type: 'object',
    },
  ],
} as const satisfies Schema
export type GetSkillResult = FromSchema<typeof getSkillResult>

export const readResourceDirectoryRequest = {
  description: 'Sent from the client to list the direct children of a directory resource.',
  allOf: [
    paginatedRequest,
    {
      properties: {
        method: { const: 'resources/directory/read', type: 'string' },
        params: {
          properties: {
            uri: {
              description: 'URI of the directory resource to read.',
              format: 'uri',
              type: 'string',
            },
          },
          required: ['uri'],
          type: 'object',
        },
      },
      required: ['method', 'params'],
      type: 'object',
    },
  ],
} as const satisfies Schema
export type ReadResourceDirectoryRequest = FromSchema<typeof readResourceDirectoryRequest>

export const readResourceDirectoryResult = {
  description: "The server's response to a resources/directory/read request from the client.",
  allOf: [
    paginatedResult,
    cacheableResult,
    {
      properties: {
        resources: {
          description: "Resource metadata of the directory's direct children.",
          items: resource,
          type: 'array',
        },
      },
      required: ['resources'],
      type: 'object',
    },
  ],
} as const satisfies Schema
export type ReadResourceDirectoryResult = FromSchema<typeof readResourceDirectoryResult>
