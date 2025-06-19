import type { FromSchema, Schema } from '@enkaku/schema'

import { completeResult } from './completion.js'
import { elicitRequest } from './elicitation.js'
import { initializeResult } from './initialize.js'
import { loggingMessageNotification } from './logging.js'
import { getPromptResult, listPromptsResult, promptListChangedNotification } from './prompt.js'
import {
  listResourcesResult,
  listResourceTemplatesResult,
  readResourceResult,
  resourceListChangedNotification,
  resourceUpdatedNotification,
} from './resource.js'
import { listRootsRequest } from './root.js'
import {
  cancelledNotification,
  errorResponse,
  pingRequest,
  progressNotification,
  response,
  result,
} from './rpc.js'
import { createMessageRequest } from './sampling.js'
import { callToolResult, listToolsResult, toolListChangedNotification } from './tool.js'

// Server messages from https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.ts#L1089

export const serverRequest = {
  anyOf: [pingRequest, createMessageRequest, listRootsRequest, elicitRequest],
} as const satisfies Schema
export type ServerRequest = FromSchema<typeof serverRequest>

export const serverNotification = {
  anyOf: [
    cancelledNotification,
    loggingMessageNotification,
    progressNotification,
    resourceUpdatedNotification,
    resourceListChangedNotification,
    toolListChangedNotification,
    promptListChangedNotification,
  ],
} as const satisfies Schema
export type ServerNotification = FromSchema<typeof serverNotification>

export const serverResult = {
  anyOf: [
    result, // empty result
    initializeResult,
    completeResult,
    getPromptResult,
    listPromptsResult,
    listResourcesResult,
    listResourceTemplatesResult,
    readResourceResult,
    callToolResult,
    listToolsResult,
  ],
} as const satisfies Schema
export type ServerResult = FromSchema<typeof serverResult>

export const serverResponse = {
  anyOf: [
    errorResponse,
    {
      allOf: [
        response,
        {
          type: 'object',
          properties: { result: serverResult },
          required: ['result'],
        },
      ],
    },
  ],
} as const satisfies Schema
export type ServerResponse = FromSchema<typeof serverResponse>

/**
 * Any MCP server message.
 */
export const serverMessage = {
  anyOf: [serverRequest, serverNotification, serverResponse],
} as const satisfies Schema
export type ServerMessage = FromSchema<typeof serverMessage>
