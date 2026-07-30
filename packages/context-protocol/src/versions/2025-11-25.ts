import type { FromSchema, Schema } from '@sozai/schema'

import { clientResponse } from '../client.js'
import { completeRequest } from '../completion.js'
import { initializedNotification, initializeRequest } from '../initialize.js'
import { setLevelRequest } from '../logging.js'
import { getPromptRequest, listPromptsRequest } from '../prompt.js'
import {
  listResourcesRequest,
  listResourceTemplatesRequest,
  readResourceRequest,
  subscribeRequest,
  unsubscribeRequest,
} from '../resource.js'
import { rootsListChangedNotification } from '../root.js'
import { cancelledNotification, pingRequest, progressNotification } from '../rpc.js'
import { serverMessage } from '../server.js'
import { callToolRequest, listToolsRequest } from '../tool.js'
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

export const PROTOCOL = {
  version: PROTOCOL_VERSION,
  requiresHandshake: true,
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
  serverMethods: new Set(['ping', 'sampling/createMessage', 'roots/list', 'elicitation/create']),
  clientMessage,
  serverMessage,
  decorateRequest: (params: unknown): unknown => params,
  readRequestMeta: (): RequestMetaInfo => ({}),
  wrapResult: (value: Record<string, unknown>): Record<string, unknown> => value,
} satisfies ProtocolDefinition
