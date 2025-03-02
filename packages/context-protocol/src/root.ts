import type { FromSchema, Schema } from '@enkaku/schema'

import { notification, request, result } from './rpc.js'

// https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.json#L1669
export const root = {
  description: 'Represents a root directory or file that the server can operate on.',
  properties: {
    name: {
      description: `An optional name for the root. This can be used to provide a human-readable identifier for the root, which may be useful for display purposes or for referencing the root in other parts of the application.',
      type: 'string`,
    },
    uri: {
      description:
        'The URI identifying the root. This *must* start with file:// for now. This restriction may be relaxed in future versions of the protocol to allow other URI schemes.',
      format: 'uri',
      type: 'string',
    },
  },
  required: ['uri'],
  type: 'object',
} as const satisfies Schema
export type Root = FromSchema<typeof root>

// https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.json#L963
export const listRootsRequest = {
  description: `Sent from the server to request a list of root URIs from the client. Roots allow servers to ask for specific directories or files to operate on. A common example for roots is providing a set of repositories or directories a server should operate on.
    
  This request is typically used when the server needs to understand the file system structure or access specific locations that the client has permission to read from.`,
  allOf: [
    request,
    {
      properties: {
        method: {
          const: 'roots/list',
          type: 'string',
        },
      },
      required: ['method'],
      type: 'object',
    },
  ],
} as const satisfies Schema
export type ListRootsRequest = FromSchema<typeof listRootsRequest>

// https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.json#L991
export const listRootsResult = {
  description: `The client's response to a roots/list request from the server.
    This result contains an array of Root objects, each representing a root directory or file that the server can operate on.`,
  allOf: [
    result,
    {
      properties: {
        roots: {
          items: root,
          type: 'array',
        },
      },
      required: ['roots'],
      type: 'object',
    },
  ],
} as const satisfies Schema
export type ListRootsResult = FromSchema<typeof listRootsResult>

// https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.json#L1687
export const rootsListChangedNotification = {
  description: `A notification from the client to the server, informing it that the list of roots has changed.
    This notification should be sent whenever the client adds, removes, or modifies any root.
    The server should then request an updated list of roots using the ListRootsRequest.`,
  allOf: [
    notification,
    {
      properties: {
        method: {
          const: 'notifications/roots/list_changed',
          type: 'string',
        },
      },
      required: ['method'],
      type: 'object',
    },
  ],
} as const satisfies Schema
export type RootsListChangedNotification = FromSchema<typeof rootsListChangedNotification>
