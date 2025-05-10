import type { FromSchema, Schema } from '@enkaku/schema'

export const LATEST_PROTOCOL_VERSION = '2025-03-26'
export const JSONRPC_VERSION = '2.0'

export const PARSE_ERROR = -32700
export const INVALID_REQUEST = -32600
export const METHOD_NOT_FOUND = -32601
export const INVALID_PARAMS = -32602
export const INTERNAL_ERROR = -32603

// https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.json#L1465
export const requestId = {
  description: 'A uniquely identifying ID for a request in JSON-RPC.',
  anyOf: [{ type: 'string' }, { type: 'integer' }],
} as const satisfies Schema
export type RequestID = FromSchema<typeof requestId>

export const paramsMeta = {
  additionalProperties: {},
  description:
    'This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.',
  type: 'object',
} as const satisfies Schema

// https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.json#L1146
export const notification = {
  properties: {
    jsonrpc: { type: 'string', const: JSONRPC_VERSION },
    method: {
      type: 'string',
    },
    params: {
      additionalProperties: {},
      properties: {
        _meta: paramsMeta,
      },
      type: 'object',
    },
  },
  required: ['jsonrpc', 'method'],
  type: 'object',
} as const satisfies Schema
export type Notification = FromSchema<typeof notification>

export const cancelledNotification = {
  allOf: [
    notification,
    {
      type: 'object',
      properties: {
        method: { type: 'string', const: 'notifications/cancelled' },
        params: {
          type: 'object',
          properties: {
            requestId,
            reason: { type: 'string' },
          },
          required: ['requestId'],
        },
      },
      required: ['method', 'params'],
    },
  ],
} as const satisfies Schema
export type CancelledNotification = FromSchema<typeof cancelledNotification>

// https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.json#L1265
export const progressToken = {
  description:
    'A progress token, used to associate progress notifications with the original request.',
  anyOf: [{ type: 'string' }, { type: 'number' }],
} as const satisfies Schema

// https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.json#L1230
export const progressNotification = {
  allOf: [
    notification,
    {
      description:
        'An out-of-band notification used to inform the receiver of a progress update for a long-running request.',
      properties: {
        method: {
          const: 'notifications/progress',
          type: 'string',
        },
        params: {
          properties: {
            message: {
              description: 'An optional message describing the current progress.',
              type: 'string',
            },
            progress: {
              description:
                'The progress thus far. This should increase every time progress is made, even if the total is unknown.',
              type: 'number',
            },
            progressToken,
            total: {
              description:
                'Total number of items to process (or total progress required), if known.',
              type: 'number',
            },
          },
          required: ['progress', 'progressToken'],
          type: 'object',
        },
      },
      required: ['method', 'params'],
      type: 'object',
    },
  ],
} as const satisfies Schema
export type ProgressNotification = FromSchema<typeof progressNotification>

// https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.json#L1439
export const request = {
  properties: {
    id: requestId,
    jsonrpc: { type: 'string', const: JSONRPC_VERSION },
    method: {
      type: 'string',
    },
    params: {
      additionalProperties: {},
      properties: {
        _meta: {
          properties: {
            progressToken,
          },
          type: 'object',
        },
      },
      type: 'object',
    },
  },
  required: ['id', 'jsonrpc', 'method'],
  type: 'object',
} as const satisfies Schema
export type Request = FromSchema<typeof request>

export const cursor = {
  description:
    'An opaque token representing the current pagination position. If provided, the server should return results starting after this cursor.',
  type: 'string',
} as const satisfies Schema

// https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.json#L1168
export const paginatedRequest = {
  allOf: [
    request,
    {
      properties: {
        params: {
          properties: {
            cursor,
          },
          type: 'object',
        },
      },
      type: 'object',
    },
  ],
} as const satisfies Schema

export const resultMeta = {
  additionalProperties: {},
  description:
    'This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.',
  type: 'object',
} as const satisfies Schema

// https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.json#L1650
export const result = {
  additionalProperties: {},
  properties: {
    _meta: resultMeta,
  },
  type: 'object',
} as const satisfies Schema

// https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.json#L1188
export const paginatedResult = {
  properties: {
    _meta: resultMeta,
    nextCursor: cursor,
  },
  type: 'object',
} as const satisfies Schema

export const response = {
  properties: {
    id: requestId,
    jsonrpc: { type: 'string', const: JSONRPC_VERSION },
  },
  required: ['id', 'jsonrpc'],
  type: 'object',
} as const satisfies Schema
export type Response = FromSchema<typeof response>

export const error = {
  properties: {
    code: { type: 'number' },
    message: { type: 'string' },
    data: { type: 'object', additionalProperties: {} },
  },
  required: ['code', 'message'],
  type: 'object',
} as const satisfies Schema

export const errorResponse = {
  allOf: [response, { type: 'object', properties: { error }, required: ['error'] }],
} as const satisfies Schema
export type ErrorResponse = FromSchema<typeof errorResponse>

// https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.json#L1202
export const pingRequest = {
  allOf: [
    request,
    {
      description:
        'A ping, issued by either the server or the client, to check that the other party is still alive. The receiver must promptly respond, or else may be disconnected.',
      properties: {
        method: {
          const: 'ping',
          type: 'string',
        },
      },
      required: ['method'],
      type: 'object',
    },
  ],
} as const satisfies Schema
export type PingRequest = FromSchema<typeof pingRequest>

export type SingleMessage = Notification | Request | Response

export type AnyMessage = SingleMessage | Array<Request> | Array<Response>
