import type { FromSchema, Schema } from '@enkaku/schema'

import { content } from './content.js'
import { notification, paginatedRequest, paginatedResult, request, result } from './rpc.js'

export const inputSchema = {
  description: 'A JSON Schema object defining the expected parameters for the tool.',
  properties: {
    properties: {
      additionalProperties: {
        additionalProperties: true,
        properties: {},
        type: 'object',
      },
      type: 'object',
    },
    required: {
      items: {
        type: 'string',
      },
      type: 'array',
    },
    type: {
      const: 'object',
      type: 'string',
    },
  },
  required: ['type'],
  type: 'object',
} as const satisfies Schema

// https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.json#L1969
export const tool = {
  description: 'Definition for a tool the client can call.',
  properties: {
    description: {
      description: 'A human-readable description of the tool.',
      type: 'string',
    },
    inputSchema,
    name: {
      description: 'The name of the tool.',
      type: 'string',
    },
  },
  required: ['inputSchema', 'name'],
  type: 'object',
} as const satisfies Schema
export type Tool = FromSchema<typeof tool>

// https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.json#L51
export const callToolRequest = {
  description: 'Used by the client to invoke a tool provided by the server.',
  allOf: [
    request,
    {
      properties: {
        method: {
          const: 'tools/call',
          type: 'string',
        },
        params: {
          properties: {
            arguments: {
              additionalProperties: {},
              type: 'object',
            },
            name: {
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
export type CallToolRequest = FromSchema<typeof callToolRequest>

// https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.json#L80
export const callToolResult = {
  description: `The server's response to a tool call.
    
    Any errors that originate from the tool SHOULD be reported inside the result object, with "isError" set to true, _not_ as an MCP protocol-level error response. Otherwise, the LLM would not be able to see that an error occurred and self-correct.
    
    However, any errors in _finding_ the tool, an error indicating that the server does not support tool calls, or any other exceptional conditions, should be reported as an MCP error response.`,
  allOf: [
    result,
    {
      properties: {
        content: {
          items: content,
          type: 'array',
        },
        isError: {
          description: `Whether the tool call ended in an error.
        
        If not set, this is assumed to be false (the call was successful).`,
          type: 'boolean',
        },
      },
      required: ['content'],
      type: 'object',
    },
  ],
} as const satisfies Schema
export type CallToolResult = FromSchema<typeof callToolResult>

// https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.json#L1011
export const listToolsRequest = {
  description: 'Sent from the client to request a list of tools the server has.',
  allOf: [
    paginatedRequest,
    {
      properties: {
        method: {
          const: 'tools/list',
          type: 'string',
        },
      },
      required: ['method'],
      type: 'object',
    },
  ],
} as const satisfies Schema

// https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.json#L1033
export const listToolsResult = {
  description: "The server's response to a tools/list request from the client.",
  allOf: [
    paginatedResult,
    {
      properties: {
        tools: {
          items: tool,
          type: 'array',
        },
      },
      required: ['tools'],
      type: 'object',
    },
  ],
} as const satisfies Schema

export const toolListChangedNotification = {
  description:
    'An optional notification from the server to the client, informing it that the list of tools it offers has changed. This may be issued by servers without any previous subscription from the client.',
  allOf: [
    notification,
    {
      properties: {
        method: {
          const: 'notifications/tools/list_changed',
          type: 'string',
        },
      },
      required: ['method'],
      type: 'object',
    },
  ],
} as const satisfies Schema
