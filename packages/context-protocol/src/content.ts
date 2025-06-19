import type { Schema } from '@enkaku/schema'

import { metadata } from './rpc.js'

// https://github.com/modelcontextprotocol/specification/blob/bb5fdd282a4d0793822a569f573ebc36804d38f8/schema/schema.json#L1661
export const role = {
  description: 'The sender or recipient of messages and data in a conversation.',
  enum: ['assistant', 'user'],
  type: 'string',
} as const satisfies Schema

export const annotations = {
  properties: {
    audience: {
      description: `Describes who the intended customer of this object or data is.\n\nIt can include multiple entries to indicate content useful for multiple audiences (e.g., ['user', 'assistant'].`,
      items: role,
      type: 'array',
    },
    priority: {
      description: `Describes how important this data is for operating the server.\n\nA value of 1 means "most important," and indicates that the data is effectively required, while 0 means "least important," and indicates that the data is entirely optional.`,
      maximum: 1,
      minimum: 0,
      type: 'number',
    },
    lastModified: {
      description: `The moment the resource was last modified, as an ISO 8601 formatted string.\n\nShould be an ISO 8601 formatted string (e.g., \"2025-01-12T15:00:58Z\").\n\nExamples: last activity timestamp in an open file, timestamp when the resource\nwas attached, etc.`,
      format: 'date-time',
      type: 'string',
    },
  },
  type: 'object',
} as const satisfies Schema

// https://github.com/modelcontextprotocol/specification/blob/bb5fdd282a4d0793822a569f573ebc36804d38f8/schema/schema.json#L1911
export const textContent = {
  description: 'Text provided to or from an LLM.',
  properties: {
    _meta: metadata,
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
    _meta: metadata,
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

export const audioContent = {
  description: 'Audio provided to or from an LLM.',
  properties: {
    _meta: metadata,
    annotations,
    data: {
      description: 'The base64-encoded audio data.',
      format: 'byte',
      type: 'string',
    },
    mimeType: {
      description:
        'The MIME type of the audio. Different providers may support different audio types.',
      type: 'string',
    },
    type: {
      const: 'audio',
      type: 'string',
    },
  },
  required: ['data', 'mimeType', 'type'],
  type: 'object',
} as const satisfies Schema

// https://github.com/modelcontextprotocol/specification/blob/bb5fdd282a4d0793822a569f573ebc36804d38f8/schema/schema.json#L1947
export const textResourceContents = {
  properties: {
    _meta: metadata,
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
    _meta: metadata,
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

export const resourceLink = {
  description:
    'A resource that the server is capable of reading, included in a prompt or tool call result.\n\nNote: resource links returned by tools are not guaranteed to appear in the results of `resources/list` requests.',
  properties: {
    _meta: metadata,
    annotations,
    description: {
      description:
        'A description of what this resource represents.\n\nThis can be used by clients to improve the LLM\'s understanding of available resources. It can be thought of like a "hint" to the model.',
      type: 'string',
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
    type: {
      const: 'resource_link',
      type: 'string',
    },
    uri: {
      description: 'The URI of this resource.',
      format: 'uri',
      type: 'string',
    },
  },
  required: ['name', 'type', 'uri'],
  type: 'object',
} as const satisfies Schema

// https://github.com/modelcontextprotocol/specification/blob/bb5fdd282a4d0793822a569f573ebc36804d38f8/schema/schema.json#L438
export const embeddedResource = {
  description:
    'The contents of a resource, embedded into a prompt or tool call result.\n\nIt is up to the client how best to render embedded resources for the benefit\nof the LLM and/or the user.',
  properties: {
    _meta: metadata,
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

export const contentBlock = {
  anyOf: [textContent, imageContent, audioContent, resourceLink, embeddedResource],
} as const satisfies Schema
