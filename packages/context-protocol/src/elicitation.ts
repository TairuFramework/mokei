import type { FromSchema, Schema } from '@enkaku/schema'

import { request, result } from './rpc.js'
import { primitiveSchemaDefinition } from './schema.js'

// Form-based elicitation (original mode)
export const elicitRequestFormParams = {
  properties: {
    message: {
      description: 'The message to present to the user.',
      type: 'string',
    },
    mode: {
      const: 'form',
      description: 'Indicates this is a form-based elicitation request.',
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
} as const satisfies Schema

// URL-based elicitation (new in 2025-11-25)
export const elicitRequestURLParams = {
  properties: {
    elicitationId: {
      description:
        'A unique identifier for this elicitation request, scoped to the server. This is opaque to the client.',
      type: 'string',
    },
    message: {
      description:
        'The message explaining why the user should navigate to the URL and what they should do there.',
      type: 'string',
    },
    mode: {
      const: 'url',
      description: 'Indicates this is a URL-based elicitation request.',
      type: 'string',
    },
    url: {
      description: 'The URL the user should navigate to for out-of-band elicitation.',
      format: 'uri',
      type: 'string',
    },
  },
  required: ['elicitationId', 'message', 'mode', 'url'],
  type: 'object',
} as const satisfies Schema

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
          anyOf: [elicitRequestFormParams, elicitRequestURLParams],
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
