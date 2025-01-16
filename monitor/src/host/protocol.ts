import type { AnyClientMessageOf, AnyServerMessageOf, ProtocolDefinition } from '@enkaku/protocol'
import type { FromSchema, Schema } from '@enkaku/schema'

// TODO: extract to dedicated package shared by monitor app and CLI

export const channelEventSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    from: { type: 'string', enum: ['client', 'server'] },
    message: { type: 'object' },
  },
  required: ['id', 'from', 'message'],
  additionalProperties: false,
} as const satisfies Schema

export const hostInfoResultSchema = {
  type: 'object',
  properties: { startedTime: { type: 'string' } },
  required: ['startedTime'],
  additionalProperties: false,
} as const satisfies Schema
export type HostInfoResult = FromSchema<typeof hostInfoResultSchema>

export const protocol = {
  events: {
    type: 'stream',
    receive: { type: 'object' },
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
    params: {
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
