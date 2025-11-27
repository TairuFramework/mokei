import type { FromSchema, Schema } from '@enkaku/schema'

import { annotations, resourceContents } from './content.js'
import {
  icon,
  metadata,
  notification,
  paginatedRequest,
  paginatedResult,
  request,
  result,
} from './rpc.js'

// https://github.com/modelcontextprotocol/specification/blob/bb5fdd282a4d0793822a569f573ebc36804d38f8/schema/schema.json#L1472
export const resource = {
  description: 'A known resource that the server is capable of reading.',
  properties: {
    _meta: metadata,
    annotations,
    description: {
      description:
        'A description of what this resource represents.\n\nThis can be used by clients to improve the LLM\'s understanding of available resources. It can be thought of like a "hint" to the model.',
      type: 'string',
    },
    icons: {
      description: 'Optional icons representing the resource.',
      items: icon,
      type: 'array',
    },
    mimeType: {
      description: 'The MIME type of this resource, if known.',
      type: 'string',
    },
    name: {
      description:
        "Intended for programmatic or logical use, but used as a display name in past specs or fallback (if title isn't present).",
      type: 'string',
    },
    size: {
      description:
        'The size of the raw resource content, in bytes (i.e., before base64 encoding or any tokenization), if known.\n\nThis can be used by Hosts to display file sizes and estimate context window usage.',
      type: 'integer',
    },
    title: {
      description:
        'Intended for UI and end-user contexts — optimized to be human-readable and easily understood,\neven by those unfamiliar with domain-specific terminology.\n\nIf not provided, the name should be used for display (except for Tool,\nwhere `annotations.title` should be given precedence over using `name`,\nif present).',
      type: 'string',
    },
    uri: {
      description: 'The URI of this resource.',
      format: 'uri',
      type: 'string',
    },
  },
  required: ['name', 'uri'],
  type: 'object',
} as const satisfies Schema
export type Resource = FromSchema<typeof resource>

// https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.json#L1578
export const resourceTemplate = {
  description: 'A template description for resources available on the server.',
  properties: {
    annotations,
    description: {
      description:
        'A description of what this template is for.\n\nThis can be used by clients to improve the LLM\'s understanding of available resources. It can be thought of like a "hint" to the model.',
      type: 'string',
    },
    icons: {
      description: 'Optional icons representing resources matching this template.',
      items: icon,
      type: 'array',
    },
    mimeType: {
      description:
        'The MIME type for all resources that match this template. This should only be included if all resources matching this template have the same type.',
      type: 'string',
    },
    name: {
      description:
        "Intended for programmatic or logical use, but used as a display name in past specs or fallback (if title isn't present).",
      type: 'string',
    },
    title: {
      description:
        'Intended for UI and end-user contexts — optimized to be human-readable and easily understood,\neven by those unfamiliar with domain-specific terminology.\n\nIf not provided, the name should be used for display (except for Tool,\nwhere `annotations.title` should be given precedence over using `name`,\nif present).',
      type: 'string',
    },
    uriTemplate: {
      description:
        'A URI template (according to RFC 6570) that can be used to construct resource URIs.',
      format: 'uri-template',
      type: 'string',
    },
  },
  required: ['name', 'uriTemplate'],
  type: 'object',
} as const satisfies Schema
export type ResourceTemplate = FromSchema<typeof resourceTemplate>

// https://github.com/modelcontextprotocol/specification/blob/bb5fdd282a4d0793822a569f573ebc36804d38f8/schema/schema.json#L917
export const listResourcesRequest = {
  description: 'Sent from the client to request a list of resources the server has.',
  allOf: [
    paginatedRequest,
    {
      properties: {
        method: {
          const: 'resources/list',
          type: 'string',
        },
      },
      required: ['method'],
      type: 'object',
    },
  ],
} as const satisfies Schema
export type ListResourcesRequest = FromSchema<typeof listResourcesRequest>

// https://github.com/modelcontextprotocol/specification/blob/bb5fdd282a4d0793822a569f573ebc36804d38f8/schema/schema.json#L939
export const listResourcesResult = {
  description: "The server's response to a resources/list request from the client.",
  allOf: [
    paginatedResult,
    {
      properties: {
        resources: {
          items: resource,
          type: 'array',
        },
      },
      required: ['resources'],
      type: 'object',
    },
  ],
} as const satisfies Schema
export type ListResourcesResult = FromSchema<typeof listResourcesResult>

// https://github.com/modelcontextprotocol/specification/blob/bb5fdd282a4d0793822a569f573ebc36804d38f8/schema/schema.json#L871
export const listResourceTemplatesRequest = {
  description: 'Sent from the client to request a list of resource templates the server has.',
  allOf: [
    paginatedRequest,
    {
      properties: {
        method: {
          const: 'resources/templates/list',
          type: 'string',
        },
      },
      required: ['method'],
      type: 'object',
    },
  ],
} as const satisfies Schema
export type ListResourceTemplatesRequest = FromSchema<typeof listResourceTemplatesRequest>

// https://github.com/modelcontextprotocol/specification/blob/bb5fdd282a4d0793822a569f573ebc36804d38f8/schema/schema.json#L893
export const listResourceTemplatesResult = {
  description: "The server's response to a resources/templates/list request from the client.",
  allOf: [
    paginatedResult,
    {
      properties: {
        resourceTemplates: {
          items: resourceTemplate,
          type: 'array',
        },
      },
      required: ['resourceTemplates'],
      type: 'object',
    },
  ],
} as const satisfies Schema
export type ListResourceTemplatesResult = FromSchema<typeof listResourceTemplatesResult>

export const resourceListChangedNotification = {
  description:
    'An optional notification from the server to the client, informing it that the list of resources it can read from has changed. This may be issued by servers without any previous subscription from the client.',
  allOf: [
    notification,
    {
      properties: {
        method: {
          const: 'notifications/resources/list_changed',
          type: 'string',
        },
      },
      required: ['method'],
      type: 'object',
    },
  ],
} as const satisfies Schema
export type ResourceListChangedNotification = FromSchema<typeof resourceListChangedNotification>

// https://github.com/modelcontextprotocol/specification/blob/bb5fdd282a4d0793822a569f573ebc36804d38f8/schema/schema.json#L1385
export const readResourceRequest = {
  description: 'Sent from the client to the server, to read a specific resource URI.',
  allOf: [
    request,
    {
      properties: {
        method: {
          const: 'resources/read',
          type: 'string',
        },
        params: {
          properties: {
            uri: {
              description:
                'The URI of the resource to read. The URI can use any protocol; it is up to the server how to interpret it.',
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
export type ReadResourceRequest = FromSchema<typeof readResourceRequest>

// https://github.com/modelcontextprotocol/specification/blob/bb5fdd282a4d0793822a569f573ebc36804d38f8/schema/schema.json#L1412
export const readResourceResult = {
  description: "The server's response to a resources/read request from the client.",
  allOf: [
    result,
    {
      properties: {
        contents: {
          items: resourceContents,
          type: 'array',
        },
      },
      required: ['contents'],
      type: 'object',
    },
  ],
} as const satisfies Schema
export type ReadResourceResult = FromSchema<typeof readResourceResult>

// https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.json#L1884
export const subscribeRequest = {
  description:
    'Sent from the client to request resources/updated notifications from the server whenever a particular resource changes.',
  allOf: [
    request,
    {
      properties: {
        method: {
          const: 'resources/subscribe',
          type: 'string',
        },
        params: {
          properties: {
            uri: {
              description:
                'The URI of the resource to subscribe to. The URI can use any protocol; it is up to the server how to interpret it.',
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
export type SubscribeRequest = FromSchema<typeof subscribeRequest>

// https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.json#L2038
export const unsubscribeRequest = {
  description:
    'Sent from the client to request cancellation of resources/updated notifications from the server. This should follow a previous resources/subscribe request.',
  allOf: [
    request,
    {
      properties: {
        method: {
          const: 'resources/unsubscribe',
          type: 'string',
        },
        params: {
          properties: {
            uri: {
              description: 'The URI of the resource to unsubscribe from.',
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
export type UnsubscribeRequest = FromSchema<typeof subscribeRequest>

// https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.json#L1623
export const resourceUpdatedNotification = {
  description:
    'A notification from the server to the client, informing it that a resource has changed and may need to be read again. This should only be sent if the client previously sent a resources/subscribe request.',
  allOf: [
    notification,
    {
      properties: {
        method: {
          const: 'notifications/resources/updated',
          type: 'string',
        },
        params: {
          properties: {
            uri: {
              description:
                'The URI of the resource that has been updated. This might be a sub-resource of the one that the client actually subscribed to.',
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
export type ResourceUpdatedNotification = FromSchema<typeof resourceUpdatedNotification>
