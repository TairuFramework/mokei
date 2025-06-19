import type { FromSchema, Schema } from '@enkaku/schema'

import { contentBlock, role } from './content.js'
import { notification, paginatedRequest, paginatedResult, request, result } from './rpc.js'

// https://github.com/modelcontextprotocol/specification/blob/bb5fdd282a4d0793822a569f573ebc36804d38f8/schema/schema.json#L1296
export const promptArgument = {
  description: 'Describes an argument that a prompt can accept.',
  properties: {
    description: {
      description: 'A human-readable description of the argument.',
      type: 'string',
    },
    name: {
      description: 'The name of the argument.',
      type: 'string',
    },
    required: {
      description: 'Whether this argument must be provided.',
      type: 'boolean',
    },
  },
  required: ['name'],
  type: 'object',
} as const satisfies Schema
export type PromptArgument = FromSchema<typeof promptArgument>

export const prompt = {
  description: 'A prompt or prompt template that the server offers.',
  properties: {
    arguments: {
      description: 'A list of arguments to use for templating the prompt.',
      items: promptArgument,
      type: 'array',
    },
    description: {
      description: 'An optional description of what this prompt provides',
      type: 'string',
    },
    name: {
      description: 'The name of the prompt or prompt template.',
      type: 'string',
    },
  },
  required: ['name'],
  type: 'object',
} as const satisfies Schema
export type Prompt = FromSchema<typeof prompt>

// https://github.com/modelcontextprotocol/specification/blob/bb5fdd282a4d0793822a569f573ebc36804d38f8/schema/schema.json#L1341
export const promptMessage = {
  description:
    'Describes a message returned as part of a prompt.\n\nThis is similar to `SamplingMessage`, but also supports the embedding of\nresources from the MCP server.',
  properties: {
    content: contentBlock,
    role,
  },
  required: ['content', 'role'],
  type: 'object',
} as const satisfies Schema

// https://github.com/modelcontextprotocol/specification/blob/bb5fdd282a4d0793822a569f573ebc36804d38f8/schema/schema.json#L483
export const getPromptRequest = {
  description: 'Used by the client to get a prompt provided by the server.',
  allOf: [
    request,
    {
      properties: {
        method: {
          const: 'prompts/get',
          type: 'string',
        },
        params: {
          properties: {
            arguments: {
              additionalProperties: {
                type: 'string',
              },
              description: 'Arguments to use for templating the prompt.',
              type: 'object',
            },
            name: {
              description: 'The name of the prompt or prompt template.',
              type: 'string',
            },
          },
          required: ['name'],
          type: 'object',
        },
      },
      required: ['method', 'params'],
      type: 'object',
    },
  ],
} as const satisfies Schema
export type GetPromptRequest = FromSchema<typeof getPromptRequest>

// https://github.com/modelcontextprotocol/specification/blob/bb5fdd282a4d0793822a569f573ebc36804d38f8/schema/schema.json#L516
export const getPromptResult = {
  description: "The server's response to a prompts/get request from the client.",
  allOf: [
    result,
    {
      properties: {
        description: {
          description: 'An optional description for the prompt.',
          type: 'string',
        },
        messages: {
          items: promptMessage,
          type: 'array',
        },
      },
      required: ['messages'],
      type: 'object',
    },
  ],
} as const satisfies Schema
export type GetPromptResult = FromSchema<typeof getPromptResult>

// https://github.com/modelcontextprotocol/specification/blob/bb5fdd282a4d0793822a569f573ebc36804d38f8/schema/schema.json#L825
export const listPromptsRequest = {
  description:
    'Sent from the client to request a list of prompts and prompt templates the server has.',
  allOf: [
    paginatedRequest,
    {
      properties: {
        method: {
          const: 'prompts/list',
          type: 'string',
        },
      },
      required: ['method'],
      type: 'object',
    },
  ],
} as const satisfies Schema
export type ListPromptsRequest = FromSchema<typeof listPromptsRequest>

// https://github.com/modelcontextprotocol/specification/blob/bb5fdd282a4d0793822a569f573ebc36804d38f8/schema/schema.json#L847
export const listPromptsResult = {
  description: "The server's response to a prompts/list request from the client.",
  allOf: [
    paginatedResult,
    {
      properties: {
        prompts: {
          items: prompt,
          type: 'array',
        },
      },
      required: ['prompts'],
      type: 'object',
    },
  ],
} as const satisfies Schema
export type ListPromptsResult = FromSchema<typeof listPromptsResult>

// https://github.com/modelcontextprotocol/specification/blob/bb5fdd282a4d0793822a569f573ebc36804d38f8/schema/schema.json#L1317
export const promptListChangedNotification = {
  description:
    'An optional notification from the server to the client, informing it that the list of prompts it offers has changed. This may be issued by servers without any previous subscription from the client.',
  allOf: [
    notification,
    {
      properties: {
        method: {
          const: 'notifications/prompts/list_changed',
          type: 'string',
        },
      },
      required: ['method'],
      type: 'object',
    },
  ],
} as const satisfies Schema
export type PromptListChangedNotification = FromSchema<typeof promptListChangedNotification>
