import type { FromSchema, Schema } from '@enkaku/schema'

import { notification, request, result } from './rpc.js'

export const experimentalCapabilities = {
  additionalProperties: {
    additionalProperties: true,
    properties: {},
    type: 'object',
  },
  description: 'Experimental, non-standard capabilities that the client supports.',
  type: 'object',
} as const satisfies Schema

// https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.json#L144
export const clientCapabilities = {
  description:
    'Capabilities a client may support. Known capabilities are defined here, in this schema, but this is not a closed set: any client can define its own, additional capabilities.',
  properties: {
    elicitation: {
      additionalProperties: true,
      description: 'Present if the client supports elicitation from the server.',
      properties: {},
      type: 'object',
    },
    experimental: experimentalCapabilities,
    roots: {
      description: 'Present if the client supports listing roots.',
      properties: {
        listChanged: {
          description: 'Whether the client supports notifications for changes to the roots list.',
          type: 'boolean',
        },
      },
      type: 'object',
    },
    sampling: {
      additionalProperties: true,
      description: 'Present if the client supports sampling from an LLM.',
      properties: {},
      type: 'object',
    },
  },
  type: 'object',
} as const satisfies Schema
export type ClientCapabilities = FromSchema<typeof clientCapabilities>

// https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.json#L1734
export const serverCapabilities = {
  description:
    'Capabilities that a server may support. Known capabilities are defined here, in this schema, but this is not a closed set: any server can define its own, additional capabilities.',
  properties: {
    completions: {
      additionalProperties: true,
      description: 'Present if the server supports argument autocompletion suggestions.',
      properties: {},
      type: 'object',
    },
    experimental: experimentalCapabilities,
    logging: {
      additionalProperties: true,
      description: 'Present if the server supports sending log messages to the client.',
      properties: {},
      type: 'object',
    },
    prompts: {
      description: 'Present if the server offers any prompt templates.',
      properties: {
        listChanged: {
          description: 'Whether this server supports notifications for changes to the prompt list.',
          type: 'boolean',
        },
      },
      type: 'object',
    },
    resources: {
      description: 'Present if the server offers any resources to read.',
      properties: {
        listChanged: {
          description:
            'Whether this server supports notifications for changes to the resource list.',
          type: 'boolean',
        },
        subscribe: {
          description: 'Whether this server supports subscribing to resource updates.',
          type: 'boolean',
        },
      },
      type: 'object',
    },
    tools: {
      description: 'Present if the server offers any tools to call.',
      properties: {
        listChanged: {
          description: 'Whether this server supports notifications for changes to the tool list.',
          type: 'boolean',
        },
      },
      type: 'object',
    },
  },
  type: 'object',
} as const satisfies Schema
export type ServerCapabilities = FromSchema<typeof serverCapabilities>

// https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.json#L582
export const implementation = {
  description: 'Describes the name and version of an MCP implementation.',
  properties: {
    name: {
      type: 'string',
    },
    version: {
      type: 'string',
    },
  },
  required: ['name', 'version'],
  type: 'object',
} as const satisfies Schema
export type Implementation = FromSchema<typeof implementation>

// https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.json#L598
export const initializeRequest = {
  description:
    'This request is sent from the client to the server when it first connects, asking it to begin initialization.',
  allOf: [
    request,
    {
      properties: {
        method: {
          const: 'initialize',
          type: 'string',
        },
        params: {
          properties: {
            capabilities: clientCapabilities,
            clientInfo: implementation,
            protocolVersion: {
              description:
                'The latest version of the Model Context Protocol that the client supports. The client MAY decide to support older versions as well.',
              type: 'string',
            },
          },
          required: ['capabilities', 'clientInfo', 'protocolVersion'],
          type: 'object',
        },
      },
      required: ['method', 'params'],
      type: 'object',
    },
  ],
} as const satisfies Schema
export type InitializeRequest = FromSchema<typeof initializeRequest>

// https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.json#L632
export const initializeResult = {
  description:
    'After receiving an initialize request from the client, the server sends this response.',
  allOf: [
    result,
    {
      properties: {
        capabilities: serverCapabilities,
        instructions: {
          description:
            'Instructions describing how to use the server and its features.\n\nThis can be used by clients to improve the LLM\'s understanding of available tools, resources, etc. It can be thought of like a "hint" to the model. For example, this information MAY be added to the system prompt.',
          type: 'string',
        },
        protocolVersion: {
          description:
            'The version of the Model Context Protocol that the server wants to use. This may not match the version that the client requested. If the client cannot support this version, it MUST disconnect.',
          type: 'string',
        },
        serverInfo: implementation,
      },
      required: ['capabilities', 'protocolVersion', 'serverInfo'],
      type: 'object',
    },
  ],
} as const satisfies Schema
export type InitializeResult = FromSchema<typeof initializeResult>

// https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.json#L662
export const initializedNotification = {
  description:
    'This notification is sent from the client to the server after initialization has finished.',
  allOf: [
    notification,
    {
      properties: {
        method: {
          const: 'notifications/initialized',
          type: 'string',
        },
      },
      required: ['method'],
      type: 'object',
    },
  ],
} as const satisfies Schema
export type InitializedNotification = FromSchema<typeof initializedNotification>
