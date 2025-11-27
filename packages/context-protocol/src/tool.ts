import type { FromSchema, Schema } from '@enkaku/schema'

import { contentBlock } from './content.js'
import {
  icon,
  metadata,
  notification,
  paginatedRequest,
  paginatedResult,
  request,
  result,
} from './rpc.js'

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
    type: {
      const: 'object',
      type: 'string',
    },
  },
  required: ['type'],
  type: 'object',
} as const satisfies Schema
export type InputSchema = FromSchema<typeof inputSchema>

export const outputSchema = {
  description:
    "An optional JSON Schema object defining the structure of the tool's output returned in\nthe structuredContent field of a CallToolResult.",
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
export type OutputSchema = FromSchema<typeof outputSchema>

export const toolAnnotations = {
  description:
    'Additional properties describing a Tool to clients.\n\nNOTE: all properties in ToolAnnotations are **hints**.\nThey are not guaranteed to provide a faithful description of\ntool behavior (including descriptive properties like `title`).\n\nClients should never make tool use decisions based on ToolAnnotations\nreceived from untrusted servers.',
  properties: {
    destructiveHint: {
      description:
        'If true, the tool may perform destructive updates to its environment.\nIf false, the tool performs only additive updates.\n\n(This property is meaningful only when `readOnlyHint == false`)\n\nDefault: true',
      type: 'boolean',
    },
    idempotentHint: {
      description:
        'If true, calling the tool repeatedly with the same arguments \nwill have no additional effect on the its environment.\n\n(This property is meaningful only when `readOnlyHint == false`)\n\nDefault: false',
      type: 'boolean',
    },
    openWorldHint: {
      description:
        'If true, this tool may interact with an "open world" of external\nentities. If false, the tool\'s domain of interaction is closed.\nFor example, the world of a web search tool is open, whereas that\nof a memory tool is not.\n\nDefault: true',
      type: 'boolean',
    },
    readOnlyHint: {
      description: 'If true, the tool does not modify its environment.\n\nDefault: false',
      type: 'boolean',
    },
    title: {
      description: 'A human-readable title for the tool.',
      type: 'string',
    },
  },
  type: 'object',
} as const satisfies Schema
export type ToolAnnotations = FromSchema<typeof toolAnnotations>

// https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.json#L1969
export const tool = {
  description: 'Definition for a tool the client can call.',
  properties: {
    _meta: metadata,
    annotations: toolAnnotations,
    description: {
      description:
        'A human-readable description of the tool.\n\nThis can be used by clients to improve the LLM\'s understanding of available tools. It can be thought of like a "hint" to the model.',
      type: 'string',
    },
    icons: {
      description: 'Optional icons representing the tool.',
      items: icon,
      type: 'array',
    },
    inputSchema,
    name: {
      description: 'The name of the tool.',
      type: 'string',
    },
    outputSchema,
    title: {
      description:
        'Intended for UI and end-user contexts — optimized to be human-readable and easily understood,\neven by those unfamiliar with domain-specific terminology.\n\nIf not provided, the name should be used for display (except for Tool,\nwhere `annotations.title` should be given precedence over using `name`,\nif present).',
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
  description:
    'The server\'s response to a tool call.\n\nAny errors that originate from the tool SHOULD be reported inside the result object, with "isError" set to true, _not_ as an MCP protocol-level error response. Otherwise, the LLM would not be able to see that an error occurred and self-correct.\n\nHowever, any errors in _finding_ the tool, an error indicating that the server does not support tool calls, or any other exceptional conditions, should be reported as an MCP error response.',
  allOf: [
    result,
    {
      properties: {
        content: {
          description:
            'A list of content objects that represent the unstructured result of the tool call.',
          items: contentBlock,
          type: 'array',
        },
        isError: {
          description:
            'Whether the tool call ended in an error.\n\nIf not set, this is assumed to be false (the call was successful).',
          type: 'boolean',
        },
        structuredContent: {
          additionalProperties: {},
          description:
            'An optional JSON object that represents the structured result of the tool call.',
          type: 'object',
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
export type ListToolsRequest = FromSchema<typeof listToolsRequest>

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
export type ListToolsResult = FromSchema<typeof listToolsResult>

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
export type ToolListChangedNotification = FromSchema<typeof toolListChangedNotification>
