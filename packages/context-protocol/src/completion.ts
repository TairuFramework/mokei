import type { Schema } from '@enkaku/schema'

import { request, result } from './rpc.js'

// https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.json#L1367
export const promptReference = {
  description: 'Identifies a prompt.',
  properties: {
    name: {
      description: 'The name of the prompt or prompt template',
      type: 'string',
    },
    type: {
      const: 'ref/prompt',
      type: 'string',
    },
  },
  required: ['name', 'type'],
  type: 'object',
} as const satisfies Schema

// https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.json#L1559
export const resourceReference = {
  description: 'A reference to a resource or resource template definition.',
  properties: {
    type: {
      const: 'ref/resource',
      type: 'string',
    },
    uri: {
      description: 'The URI or URI template of the resource.',
      format: 'uri-template',
      type: 'string',
    },
  },
  required: ['type', 'uri'],
  type: 'object',
} as const satisfies Schema

// https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.json#L244
export const completeRequest = {
  description: 'A request from the client to the server, to ask for completion options.',
  allOf: [
    request,
    {
      properties: {
        method: {
          const: 'completion/complete',
          type: 'string',
        },
        params: {
          properties: {
            argument: {
              description: "The argument's information",
              properties: {
                name: {
                  description: 'The name of the argument',
                  type: 'string',
                },
                value: {
                  description: 'The value of the argument to use for completion matching.',
                  type: 'string',
                },
              },
              required: ['name', 'value'],
              type: 'object',
            },
            ref: {
              anyOf: [promptReference, resourceReference],
            },
          },
          required: ['argument', 'ref'],
          type: 'object',
        },
      },
      required: ['method', 'params'],
      type: 'object',
    },
  ],
} as const satisfies Schema

export const completeResult = {
  description: "The server's response to a completion/complete request",
  allOf: [
    result,
    {
      properties: {
        completion: {
          properties: {
            hasMore: {
              description:
                'Indicates whether there are additional completion options beyond those provided in the current response, even if the exact total is unknown.',
              type: 'boolean',
            },
            total: {
              description:
                'The total number of completion options available. This can exceed the number of values actually sent in the response.',
              type: 'integer',
            },
            values: {
              description: 'An array of completion values. Must not exceed 100 items.',
              items: {
                type: 'string',
              },
              type: 'array',
              maxItems: 100,
            },
          },
          required: ['values'],
          type: 'object',
        },
      },
      required: ['completion'],
      type: 'object',
    },
  ],
} as const satisfies Schema
