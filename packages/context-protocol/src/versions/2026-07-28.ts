import type { FromSchema, Schema } from '@sozai/schema'

import { clientResponse } from '../client.js'
import { completeRequest, completeResult } from '../completion.js'
import { elicitRequestParams, elicitResult } from '../elicitation.js'
import { clientCapabilities, implementation, serverCapabilities } from '../initialize.js'
import { loggingLevel, loggingMessageNotification } from '../logging.js'
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
} from '../resource.js'
import { listRootsResult } from '../root.js'
import type { Request } from '../rpc.js'
import {
  cacheableResult,
  cancelledNotification,
  errorResponse,
  metadata,
  progressNotification,
  request,
  response,
  result,
} from '../rpc.js'
import { createMessageRequestParams, createMessageResult } from '../sampling.js'
import {
  callToolRequest,
  callToolResult,
  listToolsRequest,
  listToolsResult,
  toolListChangedNotification,
} from '../tool.js'
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
        // `type: 'object'` on the inner `params` is required, not decorative: without it Ajv's
        // `strictTypes` warns for every `properties`/`required` here, and those warnings go to
        // stderr — the log channel of every stdio MCP server that loads this package.
        properties: {
          params: {
            properties: { _meta: requestMeta },
            required: ['_meta'],
            type: 'object',
          },
        },
        required: ['params'],
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
export type ClientRequest = FromSchema<typeof clientRequest>

/**
 * Notifications a client may send in this revision. `2025-11-25`'s `initialized` and
 * `roots/list_changed` are excluded: the former only means something as part of the
 * handshake this revision drops (`requiresHandshake: false`), and the latter only means
 * something if a server can ask for the roots list back, which no `2026-07-28` server can
 * (`serverMethods` carries no `roots/list`).
 *
 * Both members that remain build on `notification`, whose `params` already admits the `_meta`
 * that `decorateNotification` stamps below.
 */
export const clientNotification = {
  anyOf: [cancelledNotification, progressNotification],
} as const satisfies Schema
export type ClientNotification = FromSchema<typeof clientNotification>

export const clientMessage = {
  anyOf: [clientRequest, clientNotification, clientResponse],
} as const satisfies Schema
export type ClientMessage = FromSchema<typeof clientMessage>

/**
 * Notifications a server may send in this revision. `2025-11-25`'s
 * `elicitation/complete` is excluded: it only means something as the tail end of an
 * `elicitation/create` request, which no `2026-07-28` server can send (`serverMethods` is
 * empty).
 */
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

/**
 * Every result on this revision carries a `resultType`: `'complete'` for a terminal answer,
 * `'input_required'` for one suspended on MRTR input. Applied per union member rather than
 * once around the union, so a result must be both a known shape *and* carry the field.
 */
function withResultType<S extends Schema>(schema: S) {
  return {
    allOf: [
      schema,
      {
        properties: { resultType: { enum: ['complete', 'input_required'], type: 'string' } },
        required: ['resultType'],
        type: 'object',
      },
    ],
  } as const satisfies Schema
}

/**
 * An empty result on this revision: `_meta` and the mandatory `resultType`, nothing else.
 *
 * Purpose-built rather than `withResultType(emptyResult)` — `additionalProperties: false` in
 * one `allOf` branch rejects the `resultType` the other branch adds, so the two cannot be
 * composed.
 */
export const emptyResult = {
  additionalProperties: false,
  properties: {
    _meta: metadata,
    resultType: { enum: ['complete', 'input_required'], type: 'string' },
  },
  required: ['resultType'],
  type: 'object',
} as const satisfies Schema

/**
 * A single embedded input request inside an `input_required` result (SEP-2322): a sampling,
 * elicitation or roots request carried in-band as `{ method, params }`.
 *
 * Deliberately not `createMessageRequest`/`elicitRequest`/`listRootsRequest`: those build on
 * `request`, which requires `jsonrpc` and `id`. An embedded request is de-JSON-RPC'd — it never
 * travels as a JSON-RPC request in this revision, because this revision has no server-initiated
 * requests at all. `additionalProperties: false` so the envelope cannot be smuggled back in.
 */
export const inputRequest = {
  anyOf: [
    {
      additionalProperties: false,
      properties: {
        method: { const: 'sampling/createMessage', type: 'string' },
        params: createMessageRequestParams,
      },
      required: ['method', 'params'],
      type: 'object',
    },
    {
      additionalProperties: false,
      properties: {
        method: { const: 'elicitation/create', type: 'string' },
        params: elicitRequestParams,
      },
      required: ['method', 'params'],
      type: 'object',
    },
    {
      additionalProperties: false,
      properties: {
        method: { const: 'roots/list', type: 'string' },
        params: { additionalProperties: {}, type: 'object' },
      },
      required: ['method'],
      type: 'object',
    },
  ],
} as const satisfies Schema
export type InputRequest = FromSchema<typeof inputRequest>

/** A map of embedded input requests, keyed by server-assigned identifiers unique to one request. */
export const inputRequests = {
  additionalProperties: inputRequest,
  type: 'object',
} as const satisfies Schema

/**
 * A single embedded input response: the *bare* result for its request, never wrapped in a
 * `{ method, result }` envelope and never carrying this revision's `resultType` — a suspended
 * exchange's sub-answers are not themselves protocol results.
 */
export const inputResponse = {
  anyOf: [createMessageResult, elicitResult, listRootsResult],
} as const satisfies Schema
export type InputResponse = FromSchema<typeof inputResponse>

/** A map of embedded input responses, keyed as the server keyed its `inputRequests`. */
export const inputResponses = {
  additionalProperties: inputResponse,
  type: 'object',
} as const satisfies Schema

/**
 * A result suspended on MRTR input (SEP-2322): `resultType: 'input_required'` stands in for a
 * terminal answer, carrying the server's `inputRequests` and an opaque `requestState` the client
 * must echo back unmodified. Modeled directly off SEP-2322's `InputRequiredResult extends
 * Result` rather than `withResultType(<terminal shape>)`: a suspended `tools/call` has none of
 * `callToolResult`'s required `content`, so composing it with any terminal shape's `allOf` would
 * make a real `input_required` response fail validation the same way the fixture below did
 * before this member existed.
 *
 * Full MRTR — retrying with `inputResponses` — is out of scope for this revision's schema (see
 * the defect-wave design doc); this member only lets a spec-shaped `input_required` result clear
 * wire validation so `context-client`'s existing `InputRequiredNotSupportedError` guard can
 * refuse it with a clear error instead of the read loop dropping it as an unparseable response.
 *
 * Closed (`additionalProperties: false`), not open: this is one branch inside a union whose
 * entire purpose is closing off a vacuous escape hatch, so it must not itself become one. Limited
 * to exactly SEP-2322's four `InputRequiredResult` fields — `_meta`, `resultType`,
 * `inputRequests`, `requestState` — a real MRTR frame carries nothing else. `inputRequests`'
 * values stay open (`additionalProperties: {}`): each is a full elicitation or sampling request,
 * and modeling those here is the same out-of-scope MRTR work as the retry path above.
 */
export const inputRequiredResult = {
  additionalProperties: false,
  properties: {
    _meta: metadata,
    inputRequests: { additionalProperties: {}, type: 'object' },
    requestState: { type: 'string' },
    resultType: { const: 'input_required', type: 'string' },
  },
  required: ['resultType'],
  type: 'object',
} as const satisfies Schema

/**
 * Results a server may return in this revision. No `initializeResult`: there is no handshake.
 * `discoverResult` is a member here, which is what lets a `server/discover` answer be
 * validated rather than cast.
 */
export const serverResult = {
  anyOf: [
    emptyResult,
    inputRequiredResult,
    discoverResult,
    withResultType(completeResult),
    withResultType(getPromptResult),
    withResultType(listPromptsResult),
    withResultType(listResourcesResult),
    withResultType(listResourceTemplatesResult),
    withResultType(readResourceResult),
    withResultType(callToolResult),
    withResultType(listToolsResult),
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
          properties: { result: serverResult },
          required: ['result'],
          type: 'object',
        },
      ],
    },
  ],
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
  requiresCacheHints: true,
  // `logging/setLevel` is absent from `clientMethods` below: there is no session-level opt-in
  // left, so log level travels per request in `_meta` instead (`readRequestMeta().logLevel`).
  requiresPerRequestLogLevel: true,
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
  // Mirrors `clientNotification` above: `notifications/initialized` and
  // `notifications/roots/list_changed` are gone with the handshake and with server-initiated
  // `roots/list`, so sending either would put a frame on the wire this revision's own
  // `clientMessage` union rejects.
  clientNotifications: new Set(['notifications/cancelled', 'notifications/progress']),
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
  // Only the version key, never the `clientInfo`/`clientCapabilities`/`logLevel` that
  // `decorateRequest` adds: those describe a request, and a notification is not one. The version
  // is what a peer needs and the one thing it cannot infer — there is no handshake to have
  // agreed it and, on a transport that carries each exchange separately, no session to have
  // recorded it, so an unstamped notification is unroutable and cannot cancel anything.
  // `clientNotification` above admits this: both members build on `notification`, whose
  // `params` declares `_meta: metadata` (open) and `additionalProperties: {}` — unlike a
  // request's `withProtocolMeta`, which would additionally *require* the request envelope.
  decorateNotification: (params: unknown): unknown => {
    const base = asRecord(params)
    return {
      ...base,
      _meta: { ...asRecord(base._meta), [META_PROTOCOL_VERSION]: PROTOCOL_VERSION },
    }
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
