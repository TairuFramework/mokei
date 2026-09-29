import type { FromSchema, Schema } from '@sozai/schema'

import { completeResult } from './completion.js'
import { elicitationCompleteNotification, elicitRequest } from './elicitation.js'
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
  emptyResult,
  errorResponse,
  pingRequest,
  progressNotification,
  response,
} from './rpc.js'
import { createMessageRequest } from './sampling.js'
import { callToolResult, listToolsResult, toolListChangedNotification } from './tool.js'
import {
  type CreateTaskResult,
  createTaskResult,
  type TaskNotification,
  type TasksAcknowledgement,
  type TasksGetResult,
  taskNotification,
  tasksAcknowledgement,
  tasksGetResult,
} from './versions/2026-07-28.js'

// Server messages from https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.ts#L1089
//
// These are the package's unqualified, cross-revision server unions, re-exported from the index
// as `ServerRequest` / `ServerNotification` / `ServerResult` / `ServerMessage` for callers that
// are not revision-specific. Each revision now owns its own server unions under `versions/`
// (`2025-11-25.ts`, `2026-07-28.ts`); per-connection wire validation goes through
// `PROTOCOLS[version].serverMessage`, never these. They coincide with `2025-11-25`'s members
// today -- that is convenience overlap, not a coupling: the revision union is the source of truth.

export const serverRequest = {
  anyOf: [pingRequest, createMessageRequest, listRootsRequest, elicitRequest],
} as const satisfies Schema
export type ServerRequest = FromSchema<typeof serverRequest>

export const serverNotification = {
  anyOf: [
    cancelledNotification,
    elicitationCompleteNotification,
    loggingMessageNotification,
    progressNotification,
    resourceUpdatedNotification,
    resourceListChangedNotification,
    toolListChangedNotification,
    promptListChangedNotification,
    taskNotification,
  ],
} as const satisfies Schema
export type ServerNotification =
  | FromSchema<typeof cancelledNotification>
  | FromSchema<typeof elicitationCompleteNotification>
  | FromSchema<typeof loggingMessageNotification>
  | FromSchema<typeof progressNotification>
  | FromSchema<typeof resourceUpdatedNotification>
  | FromSchema<typeof resourceListChangedNotification>
  | FromSchema<typeof toolListChangedNotification>
  | FromSchema<typeof promptListChangedNotification>
  | TaskNotification

export const serverResult = {
  anyOf: [
    emptyResult,
    initializeResult,
    completeResult,
    getPromptResult,
    listPromptsResult,
    listResourcesResult,
    listResourceTemplatesResult,
    readResourceResult,
    callToolResult,
    createTaskResult,
    tasksGetResult,
    tasksAcknowledgement,
    listToolsResult,
  ],
} as const satisfies Schema
export type ServerResult =
  | FromSchema<typeof emptyResult>
  | FromSchema<typeof initializeResult>
  | FromSchema<typeof completeResult>
  | FromSchema<typeof getPromptResult>
  | FromSchema<typeof listPromptsResult>
  | FromSchema<typeof listResourcesResult>
  | FromSchema<typeof listResourceTemplatesResult>
  | FromSchema<typeof readResourceResult>
  | FromSchema<typeof callToolResult>
  | CreateTaskResult
  | TasksGetResult
  | TasksAcknowledgement
  | FromSchema<typeof listToolsResult>

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
export type ServerResponse =
  | FromSchema<typeof errorResponse>
  | (FromSchema<typeof response> & { result: ServerResult })

/**
 * Any MCP server message.
 */
export const serverMessage = {
  anyOf: [serverRequest, serverNotification, serverResponse],
} as const satisfies Schema
export type ServerMessage = ServerRequest | ServerNotification | ServerResponse
