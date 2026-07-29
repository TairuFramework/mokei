import type { FromSchema, Schema } from '@sozai/schema'

import { clientNotification, clientResponse } from '../client.js'
import { completeRequest } from '../completion.js'
import { clientCapabilities, implementation, serverCapabilities } from '../initialize.js'
import { loggingLevel } from '../logging.js'
import { getPromptRequest, listPromptsRequest } from '../prompt.js'
import {
  listResourcesRequest,
  listResourceTemplatesRequest,
  readResourceRequest,
} from '../resource.js'
import type { Request } from '../rpc.js'
import { cacheableResult, request, result } from '../rpc.js'
import { serverNotification, serverResponse } from '../server.js'
import { callToolRequest, listToolsRequest } from '../tool.js'
import type {
  ClientRequestContext,
  ProtocolDefinition,
  RequestMetaInfo,
  ServerResultContext,
} from './types.js'

export const PROTOCOL_VERSION = '2026-07-28'

// Reserved _meta keys, specification/2026-07-28/basic/index#meta
export const META_PROTOCOL_VERSION = 'io.modelcontextprotocol/protocolVersion'
export const META_CLIENT_INFO = 'io.modelcontextprotocol/clientInfo'
export const META_CLIENT_CAPABILITIES = 'io.modelcontextprotocol/clientCapabilities'
export const META_LOG_LEVEL = 'io.modelcontextprotocol/logLevel'
export const META_SERVER_INFO = 'io.modelcontextprotocol/serverInfo'

/** The protocol `_meta` every request carries in this revision. */
export const requestMeta = {
  properties: {
    [META_PROTOCOL_VERSION]: { type: 'string' },
    [META_CLIENT_INFO]: implementation,
    [META_CLIENT_CAPABILITIES]: clientCapabilities,
    [META_LOG_LEVEL]: loggingLevel,
  },
  required: [META_PROTOCOL_VERSION, META_CLIENT_CAPABILITIES],
  type: 'object',
} as const satisfies Schema

/** Composes a request schema with this revision's required `_meta`. */
export function withProtocolMeta<S extends Schema>(schema: S) {
  return {
    allOf: [
      schema,
      {
        properties: { params: { properties: { _meta: requestMeta }, required: ['_meta'] } },
        required: ['params'],
        type: 'object',
      },
    ],
  } as const satisfies Schema
}

/** Composes a result schema with this revision's required `resultType`. */
export function withResultType<S extends Schema>(schema: S) {
  return {
    allOf: [
      schema,
      {
        properties: { resultType: { const: 'complete', type: 'string' } },
        required: ['resultType'],
        type: 'object',
      },
    ],
  } as const satisfies Schema
}

export const discoverRequest = {
  description: "Queries a server's supported protocol versions, capabilities and identity.",
  allOf: [
    request,
    {
      properties: { method: { const: 'server/discover', type: 'string' } },
      required: ['method'],
      type: 'object',
    },
  ],
} as const satisfies Schema
export type DiscoverRequest = FromSchema<typeof discoverRequest>

export const discoverResult = {
  allOf: [
    result,
    cacheableResult,
    {
      properties: {
        capabilities: serverCapabilities,
        instructions: { type: 'string' },
        resultType: { const: 'complete', type: 'string' },
        supportedVersions: { items: { type: 'string' }, type: 'array' },
      },
      required: ['capabilities', 'resultType', 'supportedVersions'],
      type: 'object',
    },
  ],
} as const satisfies Schema
export type DiscoverResult = FromSchema<typeof discoverResult>

/** Requests a client may send in this revision, each carrying the required `_meta`. */
export const clientRequest = {
  anyOf: [
    withProtocolMeta(discoverRequest),
    withProtocolMeta(completeRequest),
    withProtocolMeta(getPromptRequest),
    withProtocolMeta(listPromptsRequest),
    withProtocolMeta(listResourcesRequest),
    withProtocolMeta(listResourceTemplatesRequest),
    withProtocolMeta(readResourceRequest),
    withProtocolMeta(listToolsRequest),
    withProtocolMeta(callToolRequest),
  ],
} as const satisfies Schema

export const clientMessage = {
  anyOf: [clientRequest, clientNotification, clientResponse],
} as const satisfies Schema

/** A server sends no requests in this revision — only notifications and responses. */
export const serverMessage = {
  anyOf: [serverNotification, serverResponse],
} as const satisfies Schema

function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

export const PROTOCOL = {
  version: PROTOCOL_VERSION,
  requiresHandshake: false,
  requiresRequestMeta: true,
  clientMethods: new Set([
    'server/discover',
    'completion/complete',
    'prompts/get',
    'prompts/list',
    'resources/list',
    'resources/read',
    'resources/templates/list',
    'tools/call',
    'tools/list',
  ]),
  serverMethods: new Set<string>(),
  clientMessage,
  serverMessage,
  decorateRequest: (params: unknown, context: ClientRequestContext): unknown => {
    const base = asRecord(params)
    const meta: Record<string, unknown> = {
      ...asRecord(base._meta),
      [META_PROTOCOL_VERSION]: PROTOCOL_VERSION,
      [META_CLIENT_CAPABILITIES]: context.capabilities,
    }
    if (context.clientInfo != null) {
      meta[META_CLIENT_INFO] = context.clientInfo
    }
    if (context.logLevel != null) {
      meta[META_LOG_LEVEL] = context.logLevel
    }
    return { ...base, _meta: meta }
  },
  readRequestMeta: (incoming: Request): RequestMetaInfo => {
    const meta = asRecord(asRecord(incoming.params)._meta)
    return {
      protocolVersion: meta[META_PROTOCOL_VERSION] as string | undefined,
      clientInfo: meta[META_CLIENT_INFO] as RequestMetaInfo['clientInfo'],
      clientCapabilities: meta[META_CLIENT_CAPABILITIES] as RequestMetaInfo['clientCapabilities'],
      logLevel: meta[META_LOG_LEVEL] as RequestMetaInfo['logLevel'],
    }
  },
  wrapResult: (
    value: Record<string, unknown>,
    context: ServerResultContext,
  ): Record<string, unknown> => ({
    ...value,
    resultType: 'complete',
    _meta: { ...asRecord(value._meta), [META_SERVER_INFO]: context.serverInfo },
  }),
} satisfies ProtocolDefinition
