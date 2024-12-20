import type { Schema } from '@enkaku/schema'

// https://github.com/modelcontextprotocol/specification/blob/bb5fdd282a4d0793822a569f573ebc36804d38f8/schema/schema.json#L1661
export const role = {
  description: 'The sender or recipient of messages and data in a conversation.',
  enum: ['assistant', 'user'],
  type: 'string',
} as const satisfies Schema

export const annotations = {
  properties: {
    audience: {
      description: `Describes who the intended customer of this object or data is.
      
      It can include multiple entries to indicate content useful for multiple audiences (e.g., ['user', 'assistant'].`,
      items: role,
      type: 'array',
    },
    priority: {
      description: `Describes how important this data is for operating the server.
        
        A value of 1 means "most important," and indicates that the data is effectively required, while 0 means "least important," and indicates that the data is entirely optional.`,
      maximum: 1,
      minimum: 0,
      type: 'number',
    },
  },
  type: 'object',
} as const satisfies Schema

// https://github.com/modelcontextprotocol/specification/blob/bb5fdd282a4d0793822a569f573ebc36804d38f8/schema/schema.json#L1911
export const textContent = {
  description: 'Text provided to or from an LLM.',
  properties: {
    annotations,
    text: {
      description: 'The text content of the message.',
      type: 'string',
    },
    type: {
      const: 'text',
      type: 'string',
    },
  },
  required: ['text', 'type'],
  type: 'object',
} as const satisfies Schema

// https://github.com/modelcontextprotocol/specification/blob/bb5fdd282a4d0793822a569f573ebc36804d38f8/schema/schema.json#L540
export const imageContent = {
  description: 'An image provided to or from an LLM.',
  properties: {
    annotations,
    data: {
      description: 'The base64-encoded image data.',
      format: 'byte',
      type: 'string',
    },
    mimeType: {
      description:
        'The MIME type of the image. Different providers may support different image types.',
      type: 'string',
    },
    type: {
      const: 'image',
      type: 'string',
    },
  },
  required: ['data', 'mimeType', 'type'],
  type: 'object',
} as const satisfies Schema

// https://github.com/modelcontextprotocol/specification/blob/bb5fdd282a4d0793822a569f573ebc36804d38f8/schema/schema.json#L1947
export const textResourceContents = {
  properties: {
    mimeType: {
      description: 'The MIME type of this resource, if known.',
      type: 'string',
    },
    text: {
      description:
        'The text of the item. This must only be set if the item can actually be represented as text (not binary data).',
      type: 'string',
    },
    uri: {
      description: 'The URI of this resource.',
      format: 'uri',
      type: 'string',
    },
  },
  required: ['text', 'uri'],
  type: 'object',
} as const satisfies Schema

// https://github.com/modelcontextprotocol/specification/blob/bb5fdd282a4d0793822a569f573ebc36804d38f8/schema/schema.json#L28
export const blobResourceContents = {
  properties: {
    blob: {
      description: 'A base64-encoded string representing the binary data of the item.',
      format: 'byte',
      type: 'string',
    },
    mimeType: {
      description: 'The MIME type of this resource, if known.',
      type: 'string',
    },
    uri: {
      description: 'The URI of this resource.',
      format: 'uri',
      type: 'string',
    },
  },
  required: ['blob', 'uri'],
  type: 'object',
} as const satisfies Schema

export const resourceContents = {
  anyOf: [textResourceContents, blobResourceContents],
} as const satisfies Schema

// https://github.com/modelcontextprotocol/specification/blob/bb5fdd282a4d0793822a569f573ebc36804d38f8/schema/schema.json#L438
export const embeddedResource = {
  description:
    'The contents of a resource, embedded into a prompt or tool call result.\n\nIt is up to the client how best to render embedded resources for the benefit\nof the LLM and/or the user.',
  properties: {
    annotations,
    resource: resourceContents,
    type: {
      const: 'resource',
      type: 'string',
    },
  },
  required: ['resource', 'type'],
  type: 'object',
} as const satisfies Schema

export const content = {
  anyOf: [textContent, imageContent, embeddedResource],
} as const satisfies Schema
