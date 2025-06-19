import type { FromSchema, Schema } from '@enkaku/schema'

import { request, result } from './rpc.js'
import { primitiveSchemaDefinition } from './schema.js'

export const elicitRequest = {
  description:
    'A request from the server to elicit additional information from the user via the client.',
  allOf: [
    request,
    {
      properties: {
        method: {
          const: 'elicitation/create',
          type: 'string',
        },
        params: {
          properties: {
            message: {
              description: 'The message to present to the user.',
              type: 'string',
            },
            requestedSchema: {
              description:
                'A restricted subset of JSON Schema.\nOnly top-level properties are allowed, without nesting.',
              properties: {
                properties: {
                  additionalProperties: primitiveSchemaDefinition,
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
              required: ['properties', 'type'],
              type: 'object',
            },
          },
          required: ['message', 'requestedSchema'],
          type: 'object',
        },
      },
      required: ['method', 'params'],
      type: 'object',
    },
  ],
} as const satisfies Schema
export type ElicitRequest = FromSchema<typeof elicitRequest>

export const elicitResult = {
  description: "The client's response to an elicitation request.",
  allOf: [
    result,
    {
      properties: {
        action: {
          description:
            'The user action in response to the elicitation.\n- "accept": User submitted the form/confirmed the action\n- "decline": User explicitly declined the action\n- "cancel": User dismissed without making an explicit choice',
          enum: ['accept', 'cancel', 'decline'],
          type: 'string',
        },
        content: {
          additionalProperties: {
            anyOf: [{ type: 'string' }, { type: 'integer' }, { type: 'boolean' }],
          },
          description:
            'The submitted form data, only present when action is "accept".\nContains values matching the requested schema.',
          type: 'object',
        },
      },
      required: ['action'],
      type: 'object',
    },
  ],
} as const satisfies Schema
export type ElicitResult = FromSchema<typeof elicitResult>
