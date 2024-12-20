import type { FromSchema, Schema } from '@enkaku/schema'

import { completeRequest } from './completion.js'
import { initializeRequest, initializedNotification } from './initialize.js'
import { setLevelRequest } from './logging.js'
import { getPromptRequest, listPromptsRequest } from './prompt.js'
import {
  listResourceTemplatesRequest,
  listResourcesRequest,
  readResourceRequest,
  subscribeRequest,
  unsubscribeRequest,
} from './resource.js'
import { listRootsResult, rootsListChangedNotification } from './root.js'
import {
  cancelledNotification,
  errorResponse,
  pingRequest,
  progressNotification,
  response,
  result,
} from './rpc.js'
import { createMessageResult } from './sampling.js'
import { callToolRequest, listToolsRequest } from './tool.js'

// Client messages from https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.ts#L1066

export const clientRequest = {
  anyOf: [
    pingRequest,
    initializeRequest,
    completeRequest,
    setLevelRequest,
    getPromptRequest,
    listPromptsRequest,
    listResourcesRequest,
    listResourceTemplatesRequest,
    readResourceRequest,
    subscribeRequest,
    unsubscribeRequest,
    listToolsRequest,
    callToolRequest,
  ],
} as const satisfies Schema
export type ClientRequest = FromSchema<typeof clientRequest>

export const clientNotification = {
  anyOf: [
    cancelledNotification,
    progressNotification,
    initializedNotification,
    rootsListChangedNotification,
  ],
} as const satisfies Schema
export type ClientNotification = FromSchema<typeof clientNotification>

export const clientResponse = {
  anyOf: [
    errorResponse,
    {
      allOf: [
        response,
        {
          type: 'object',
          properties: { result: { anyOf: [result, createMessageResult, listRootsResult] } },
          required: ['result'],
        },
      ],
    },
  ],
} as const satisfies Schema
export type ClientResponse = FromSchema<typeof clientResponse>

// Generic messages
export const clientMessage = {
  anyOf: [
    pingRequest,
    initializeRequest,
    completeRequest,
    setLevelRequest,
    getPromptRequest,
    listPromptsRequest,
    listResourcesRequest,
    listResourceTemplatesRequest,
    readResourceRequest,
    subscribeRequest,
    unsubscribeRequest,
    listToolsRequest,
    callToolRequest,
    clientNotification,
    clientResponse,
  ],
} as const satisfies Schema
export type ClientMessage = FromSchema<typeof clientMessage>

export function createClientMessage(callTools?: Record<string, Schema>): Schema {
  if (callTools == null) {
    return clientMessage
  }

  // Validate params for supported tool calls
  const callToolParams = Object.entries(callTools).map(([name, inputSchema]) => {
    return {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', const: name },
        arguments: inputSchema,
      },
    } as const satisfies Schema
  })
  return {
    anyOf: [
      pingRequest,
      initializeRequest,
      completeRequest,
      setLevelRequest,
      getPromptRequest,
      listPromptsRequest,
      listResourcesRequest,
      listResourceTemplatesRequest,
      readResourceRequest,
      subscribeRequest,
      unsubscribeRequest,
      listToolsRequest,
      {
        type: 'object',
        properties: {
          method: { type: 'string', const: 'tools/call' },
          params: { anyOf: callToolParams },
        },
        required: ['method', 'params'],
      },
      clientNotification,
      clientResponse,
    ],
  } as const satisfies Schema
}
