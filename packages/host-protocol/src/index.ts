/**
 * Mokei Host protocol.
 *
 * ## Installation
 *
 * ```sh
 * npm install @mokei/host-protocol
 * ```
 *
 * @module host-protocol
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AnyClientMessageOf, AnyServerMessageOf, ProtocolDefinition } from '@enkaku/protocol'
import type { FromSchema, Schema } from '@enkaku/schema'

export const DEFAULT_SOCKET_PATH = join(homedir(), '.mokei-daemon.sock')

export const hostEventMetaSchema = {
  type: 'object',
  properties: {
    contextID: { type: 'string' },
    eventID: { type: 'string' },
    time: { type: 'integer' },
  },
  required: ['contextID', 'eventID', 'time'],
  additionalProperties: false,
} as const satisfies Schema
export type HostEventMeta = FromSchema<typeof hostEventMetaSchema>

export const hostEventSchema = {
  anyOf: [
    {
      type: 'object',
      properties: {
        type: { type: 'string', const: 'context:start' },
        meta: hostEventMetaSchema,
        data: {
          type: 'object',
          properties: {
            transport: { type: 'string', const: 'stdio' },
            command: { type: 'string' },
            args: { type: 'array', items: { type: 'string' } },
          },
          required: ['transport', 'command', 'args'],
          additionalProperties: false,
        },
      },
      required: ['type', 'meta', 'data'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        type: { type: 'string', const: 'context:stop' },
        meta: hostEventMetaSchema,
      },
      required: ['type', 'meta'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        type: { type: 'string', const: 'context:message' },
        meta: hostEventMetaSchema,
        data: {
          type: 'object',
          properties: {
            from: { type: 'string', enum: ['client', 'server'] },
            message: { type: 'object' },
          },
          required: ['from', 'message'],
          additionalProperties: false,
        },
      },
      required: ['type', 'meta', 'data'],
      additionalProperties: false,
    },
  ],
} as const satisfies Schema
export type HostEvent = FromSchema<typeof hostEventSchema>

export const activeContextInfoSchema = {
  type: 'object',
  properties: {
    startedTime: { type: 'integer' },
  },
  required: ['startedTime'],
} as const satisfies Schema
export type ActiveContextInfo = FromSchema<typeof activeContextInfoSchema>

export const hostInfoResultSchema = {
  type: 'object',
  properties: {
    activeContexts: {
      type: 'object',
      additionalProperties: activeContextInfoSchema,
    },
    startedTime: { type: 'integer' },
  },
  required: ['activeContexts', 'startedTime'],
  additionalProperties: false,
} as const satisfies Schema
export type HostInfoResult = FromSchema<typeof hostInfoResultSchema>

export const protocol = {
  events: {
    type: 'stream',
    receive: { type: 'object' }, // hostEventSchema
  },
  info: {
    type: 'request',
    result: hostInfoResultSchema,
  },
  shutdown: {
    type: 'request',
  },
  spawn: {
    type: 'channel',
    param: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        args: { type: 'array', items: { type: 'string' } },
      },
      required: ['command'],
      additionalProperties: false,
    },
    send: { type: 'object' }, // clientMessage
    receive: { type: 'object' }, // serverMessage
  },
} as const satisfies ProtocolDefinition
export type Protocol = typeof protocol

export type ClientMessage = AnyClientMessageOf<Protocol>
export type ServerMessage = AnyServerMessageOf<Protocol>
