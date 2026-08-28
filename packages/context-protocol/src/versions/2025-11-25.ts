import type { FromSchema, Schema } from '@sozai/schema'

import { clientResponse } from '../client.js'
import { completeRequest, completeResult } from '../completion.js'
import { elicitationCompleteNotification, elicitRequest } from '../elicitation.js'
import { initializedNotification, initializeRequest, initializeResult } from '../initialize.js'
import { loggingMessageNotification, setLevelRequest } from '../logging.js'
import {
  getPromptRequest,
  getPromptResult,
  listPromptsRequest,
  listPromptsResult,
  promptListChangedNotification,
} from '../prompt.js'
import {
  listResourcesRequest,
  listResourcesResult,
  listResourceTemplatesRequest,
  listResourceTemplatesResult,
  readResourceRequest,
  readResourceResult,
  resourceListChangedNotification,
  resourceUpdatedNotification,
  subscribeRequest,
  unsubscribeRequest,
} from '../resource.js'
import { listRootsRequest, rootsListChangedNotification } from '../root.js'
import {
  cancelledNotification,
  emptyResult,
  errorResponse,
  pingRequest,
  progressNotification,
  response,
} from '../rpc.js'
import { createMessageRequest } from '../sampling.js'
import {
  callToolRequest,
  callToolResult,
  listToolsRequest,
  listToolsResult,
  toolListChangedNotification,
} from '../tool.js'
import type { ProtocolDefinition, RequestMetaInfo } from './types.js'

export const PROTOCOL_VERSION = '2025-11-25'

// Client messages from https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.ts#L1066

/** Requests a client may send in this revision. */
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

/** Notifications a client may send in this revision. */
export const clientNotification = {
  anyOf: [
    cancelledNotification,
    progressNotification,
    initializedNotification,
    rootsListChangedNotification,
  ],
} as const satisfies Schema
export type ClientNotification = FromSchema<typeof clientNotification>

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

// Server messages from https://github.com/modelcontextprotocol/specification/blob/e19c2d5768c6b5f0c7372b9330a66d5a5cc22549/schema/schema.ts#L1089

/** Requests a server may send in this revision. */
export const serverRequest = {
  anyOf: [pingRequest, createMessageRequest, listRootsRequest, elicitRequest],
} as const satisfies Schema
export type ServerRequest = FromSchema<typeof serverRequest>

/**
 * Notifications a server may send in this revision. Includes `elicitation/complete`, the tail
 * end of an `elicitation/create` request — which a `2025-11-25` server can send but a
 * `2026-07-28` one cannot, so that revision's own union omits it.
 */
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
  ],
} as const satisfies Schema
export type ServerNotification = FromSchema<typeof serverNotification>

/** Results a server may return in this revision. */
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

export const serverMessage = {
  anyOf: [serverRequest, serverNotification, serverResponse],
} as const satisfies Schema
export type ServerMessage = FromSchema<typeof serverMessage>

export const PROTOCOL = {
  version: PROTOCOL_VERSION,
  requiresRequestMeta: false,
  requiresCacheHints: false,
  clientMethods: new Set([
    'ping',
    'initialize',
    'completion/complete',
    'logging/setLevel',
    'prompts/get',
    'prompts/list',
    'resources/list',
    'resources/read',
    'resources/templates/list',
    'tools/call',
    'tools/list',
  ]),
  clientNotifications: new Set([
    'notifications/cancelled',
    'notifications/progress',
    'notifications/initialized',
    'notifications/roots/list_changed',
  ]),
  serverMethods: new Set(['ping', 'sampling/createMessage', 'roots/list', 'elicitation/create']),
  inputRequestMethods: new Set<string>(),
  clientMessage,
  serverMessage,
  decorateRequest: (params: unknown): unknown => params,
  decorateNotification: (params: unknown): unknown => params,
  readRequestMeta: (): RequestMetaInfo => ({}),
  wrapResult: (value: Record<string, unknown>): Record<string, unknown> => value,
} satisfies ProtocolDefinition
