import type { FromSchema, Schema } from '@sozai/schema'

export const monitorAttachParamSchema = {
  type: 'object',
  properties: { url: { type: 'string' } },
  required: ['url'],
  additionalProperties: false,
} as const satisfies Schema

export const monitorAttachReceiveSchema = {
  type: 'object',
  properties: {
    type: { type: 'string', const: 'attached' },
    attachmentID: { type: 'string' },
  },
  required: ['type', 'attachmentID'],
  additionalProperties: false,
} as const satisfies Schema

export const monitorPresenceParamSchema = {
  type: 'object',
  properties: { attachmentID: { type: 'string' } },
  required: ['attachmentID'],
  additionalProperties: false,
} as const satisfies Schema

const monitorStateSchema = {
  type: 'object',
  properties: {
    type: { type: 'string', const: 'state' },
    visible: { type: 'boolean' },
    canNotify: { type: 'boolean' },
    activeItemID: { type: 'string' },
  },
  required: ['type', 'visible', 'canNotify'],
  additionalProperties: false,
} as const satisfies Schema

const monitorPongSchema = {
  type: 'object',
  properties: { type: { type: 'string', const: 'pong' }, nonce: { type: 'string' } },
  required: ['type', 'nonce'],
  additionalProperties: false,
} as const satisfies Schema

const monitorAckSchema = {
  type: 'object',
  properties: {
    type: { type: 'string', const: 'ack' },
    attemptID: { type: 'string' },
    shown: { type: 'boolean' },
  },
  required: ['type', 'attemptID', 'shown'],
  additionalProperties: false,
} as const satisfies Schema

const monitorPingSchema = {
  type: 'object',
  properties: { type: { type: 'string', const: 'ping' }, nonce: { type: 'string' } },
  required: ['type', 'nonce'],
  additionalProperties: false,
} as const satisfies Schema

const monitorNotifySchema = {
  type: 'object',
  properties: {
    type: { type: 'string', const: 'notify' },
    attemptID: { type: 'string' },
    deadline: { type: 'number' },
    itemID: { type: 'string' },
    title: { type: 'string' },
    message: { type: 'string' },
  },
  required: ['type', 'attemptID', 'deadline', 'itemID', 'title', 'message'],
  additionalProperties: false,
} as const satisfies Schema

const monitorPromptSchema = {
  type: 'object',
  properties: {
    type: { type: 'string', const: 'prompt' },
    attemptID: { type: 'string' },
    deadline: { type: 'number' },
    itemID: { type: 'string' },
  },
  required: ['type', 'attemptID', 'deadline', 'itemID'],
  additionalProperties: false,
} as const satisfies Schema

const monitorWithdrawSchema = {
  type: 'object',
  properties: { type: { type: 'string', const: 'withdraw' }, attemptID: { type: 'string' } },
  required: ['type', 'attemptID'],
  additionalProperties: false,
} as const satisfies Schema

export const monitorPresenceSendSchema = {
  anyOf: [monitorStateSchema, monitorPongSchema, monitorAckSchema],
} as const satisfies Schema

export const monitorPresenceReceiveSchema = {
  anyOf: [monitorPingSchema, monitorNotifySchema, monitorPromptSchema, monitorWithdrawSchema],
} as const satisfies Schema

export type MonitorPresenceSend = FromSchema<typeof monitorPresenceSendSchema>
export type MonitorPresenceReceive = FromSchema<typeof monitorPresenceReceiveSchema>
