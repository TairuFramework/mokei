import { clientMessage } from '../client.js'
import { serverMessage } from '../server.js'
import type { ProtocolDefinition, RequestMetaInfo } from './types.js'

export const PROTOCOL_VERSION = '2025-11-25'

export const PROTOCOL = {
  version: PROTOCOL_VERSION,
  requiresHandshake: true,
  requiresRequestMeta: false,
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
