import type { FromSchema, Schema } from '@sozai/schema'

export const LATEST_PROTOCOL_VERSION = '2025-11-25'
export const JSONRPC_VERSION = '2.0'

export const PARSE_ERROR = -32700
export const INVALID_REQUEST = -32600
export const METHOD_NOT_FOUND = -32601
export const INVALID_PARAMS = -32602
export const INTERNAL_ERROR = -32603
export const RESOURCE_NOT_FOUND = -32002
export const URL_ELICITATION_REQUIRED = -32042

// Protocol revisions mokei accepts when negotiating. Strict: the single
// targeted revision. Widening this is the only change needed to support more.
export const SUPPORTED_PROTOCOL_VERSIONS = [LATEST_PROTOCOL_VERSION] as const

export function isSupportedProtocolVersion(version: string): boolean {
  return (SUPPORTED_PROTOCOL_VERSIONS as ReadonlyArray<string>).includes(version)
}

// https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.json#L1465
export const requestId = {
  description: 'A uniquely identifying ID for a request in JSON-RPC.',
  anyOf: [{ type: 'string' }, { type: 'integer' }],
} as const satisfies Schema
export type RequestID = FromSchema<typeof requestId>

// https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities#icons
export const icon = {
  description:
    'An icon representing a resource, tool, prompt, or other entity. Icons can be HTTP/HTTPS URLs or data URIs.',
  properties: {
    src: {
      description:
        'The URI of the icon. This can be an HTTP/HTTPS URL or a data URI. Icons should be square and support transparency.',
      format: 'uri',
      type: 'string',
    },
    mimeType: {
      description:
        'The MIME type of the icon. This is optional and can be used to override the type inferred from the URI.',
      type: 'string',
    },
    sizes: {
      description:
        'The sizes of the icon in WxH format (e.g., "48x48"). Use "any" for scalable formats like SVG.',
      items: {
        type: 'string',
      },
      type: 'array',
    },
    theme: {
      description:
        'The theme the icon is designed for. If not specified, the icon is assumed to work for both themes.',
      enum: ['light', 'dark'],
      type: 'string',
    },
  },
  required: ['src'],
  type: 'object',
} as const satisfies Schema
export type Icon = FromSchema<typeof icon>

// https://modelcontextprotocol.io/specification/2025-11-25/basic/index#meta
export const metadata = {
  type: 'object',
  description:
    'See [specification/2025-11-25/basic/index#general-fields] for notes on _meta usage.',
  additionalProperties: {},
} as const satisfies Schema
export type Metadata = FromSchema<typeof metadata>

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
        _meta: metadata,
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

// https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.json#L1650
export const result = {
  additionalProperties: {},
  properties: {
    _meta: metadata,
  },
  type: 'object',
} as const satisfies Schema
export type Result = FromSchema<typeof result>

// https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.json#L1188
export const paginatedResult = {
  properties: {
    _meta: metadata,
    nextCursor: cursor,
  },
  type: 'object',
} as const satisfies Schema
export type PaginatedResult = FromSchema<typeof paginatedResult>

// CacheableResult — MCP draft caching hints (additive on 2025-11-25).
export const cacheableResult = {
  properties: {
    cacheScope: {
      description:
        'Controls whether shared intermediaries may cache the response. "public" allows shared caching; "private" restricts it to the requesting client.',
      enum: ['public', 'private'],
      type: 'string',
    },
    ttlMs: {
      description:
        'Freshness hint in milliseconds. Allows clients to cache the response and reduce polling. Complements listChanged notifications.',
      type: 'number',
    },
  },
  type: 'object',
} as const satisfies Schema
export type CacheableResult = FromSchema<typeof cacheableResult>

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

export type AnyMessage = Notification | Request | Response
