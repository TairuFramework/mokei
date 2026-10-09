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

import type { AnyClientMessageOf, AnyServerMessageOf, ProtocolDefinition } from '@enkaku/protocol'
import type { FromSchema, Schema } from '@sozai/schema'

import {
  flowCheckResultSchema,
  flowRunSnapshotSchema,
  flowServiceStatusSchema,
  flowSummarySchema,
  inboxItemSchema,
  jsonDefinitions,
  jsonObjectSchema,
  runStateSchema,
  storedLogSchema,
  storedSpanSchema,
} from './flow-schemas.js'
import {
  monitorAttachParamSchema,
  monitorAttachReceiveSchema,
  monitorPresenceParamSchema,
  monitorPresenceReceiveSchema,
  monitorPresenceSendSchema,
} from './monitor-schemas.js'
import {
  openSpanSchema,
  traceLogSchema,
  traceSummarySchema,
  tracesGetParamsSchema,
  tracesGetResultSchema,
  tracesListParamsSchema,
  tracesListResultSchema,
  tracingInfoSchema,
} from './trace-schemas.js'

export {
  type FlowCheckResult,
  type FlowIssue,
  type FlowRunSnapshot,
  type FlowServiceStatus,
  type FlowSummary,
  flowCheckResultSchema,
  flowIssueSchema,
  flowRunSnapshotSchema,
  flowServiceStatusSchema,
  flowSummarySchema,
  type InboxItem,
  inboxItemSchema,
  type StoredLog,
  type StoredSpan,
  storedLogSchema,
  storedSpanSchema,
} from './flow-schemas.js'
export {
  type MonitorPresenceReceive,
  type MonitorPresenceSend,
  monitorAttachParamSchema,
  monitorAttachReceiveSchema,
  monitorPresenceParamSchema,
  monitorPresenceReceiveSchema,
  monitorPresenceSendSchema,
} from './monitor-schemas.js'
export {
  type OpenSpan,
  openSpanSchema,
  type TraceLog,
  type TraceSummary,
  type TracesGetResult,
  type TracesListParams,
  type TracesListResult,
  type TracingInfo,
  traceLogSchema,
  traceSummarySchema,
  tracesGetParamsSchema,
  tracesGetResultSchema,
  tracesListParamsSchema,
  tracesListResultSchema,
  tracingInfoSchema,
} from './trace-schemas.js'

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

export const serviceEventMetaSchema = {
  type: 'object',
  properties: { eventID: { type: 'string' }, time: { type: 'integer' } },
  required: ['eventID', 'time'],
  additionalProperties: false,
} as const satisfies Schema
export type ServiceEventMeta = FromSchema<typeof serviceEventMetaSchema>

export const hostEventSchema = {
  type: 'object',
  definitions: jsonDefinitions,
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
        type: { type: 'string', const: 'service:status' },
        meta: serviceEventMetaSchema,
        data: {
          type: 'object',
          properties: {
            service: { type: 'string', const: 'flow' },
            status: flowServiceStatusSchema,
          },
          required: ['service', 'status'],
          additionalProperties: false,
        },
      },
      required: ['type', 'meta', 'data'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        type: { type: 'string', const: 'run:state' },
        meta: serviceEventMetaSchema,
        data: flowRunSnapshotSchema,
      },
      required: ['type', 'meta', 'data'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        type: { type: 'string', const: 'inbox:added' },
        meta: serviceEventMetaSchema,
        data: inboxItemSchema,
      },
      required: ['type', 'meta', 'data'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        type: { type: 'string', const: 'inbox:settled' },
        meta: serviceEventMetaSchema,
        data: {
          type: 'object',
          properties: {
            item: inboxItemSchema,
            outcome: { type: 'string', enum: ['answered', 'declined', 'cancelled', 'withdrawn'] },
          },
          required: ['item', 'outcome'],
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
    ...[
      {
        type: 'object',
        properties: {
          type: { type: 'string', const: 'span:start' },
          meta: serviceEventMetaSchema,
          data: openSpanSchema,
        },
        required: ['type', 'meta', 'data'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          type: { type: 'string', const: 'span:end' },
          meta: serviceEventMetaSchema,
          data: storedSpanSchema,
        },
        required: ['type', 'meta', 'data'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          type: { type: 'string', const: 'log' },
          meta: serviceEventMetaSchema,
          data: traceLogSchema,
        },
        required: ['type', 'meta', 'data'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          type: { type: 'string', const: 'trace:summary' },
          meta: serviceEventMetaSchema,
          data: traceSummarySchema,
        },
        required: ['type', 'meta', 'data'],
        additionalProperties: false,
      },
    ],
  ],
} as const satisfies Schema
export type HostEvent = FromSchema<typeof hostEventSchema>
export type HostEvents = {
  [Type in HostEvent['type']]: Omit<Extract<HostEvent, { type: Type }>, 'type'>
}

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
    flowService: flowServiceStatusSchema,
    tracing: tracingInfoSchema,
  },
  required: ['activeContexts', 'startedTime', 'flowService'],
  additionalProperties: false,
} as const satisfies Schema
export type HostInfoResult = FromSchema<typeof hostInfoResultSchema>

const runIDParamSchema = {
  type: 'object',
  properties: { runID: { type: 'string' } },
  required: ['runID'],
  additionalProperties: false,
} as const satisfies Schema

const inboxIDParamSchema = {
  type: 'object',
  properties: { id: { type: 'string' } },
  required: ['id'],
  additionalProperties: false,
} as const satisfies Schema

const settledResultSchema = {
  type: 'object',
  properties: { settled: { type: 'boolean', const: true } },
  required: ['settled'],
  additionalProperties: false,
} as const satisfies Schema

export const protocol = {
  events: {
    type: 'stream',
    receive: hostEventSchema,
  },
  info: {
    type: 'request',
    result: hostInfoResultSchema,
  },
  shutdown: {
    type: 'request',
  },
  'monitor.attach': {
    type: 'stream',
    param: monitorAttachParamSchema,
    receive: monitorAttachReceiveSchema,
  },
  'monitor.presence': {
    type: 'channel',
    param: monitorPresenceParamSchema,
    send: { anyOf: [...monitorPresenceSendSchema.anyOf] },
    receive: { anyOf: [...monitorPresenceReceiveSchema.anyOf] },
  },
  spawn: {
    type: 'channel',
    param: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        args: { type: 'array', items: { type: 'string' } },
        env: { type: 'object', additionalProperties: { type: 'string' } },
      },
      required: ['command'],
      additionalProperties: false,
    },
    send: { type: 'object' }, // clientMessage
    receive: { type: 'object' }, // serverMessage
  },
  'flows.list': {
    type: 'request',
    result: { definitions: jsonDefinitions, type: 'array', items: flowSummarySchema },
  },
  'flows.check': {
    type: 'request',
    param: {
      definitions: jsonDefinitions,
      type: 'object',
      properties: { definition: jsonObjectSchema },
      required: ['definition'],
      additionalProperties: false,
    },
    result: flowCheckResultSchema,
  },
  'runs.start': {
    type: 'request',
    param: {
      definitions: jsonDefinitions,
      anyOf: [
        {
          type: 'object',
          properties: {
            flow: { type: 'string' },
            input: jsonObjectSchema,
            label: { type: 'string' },
          },
          required: ['flow'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            definition: jsonObjectSchema,
            input: jsonObjectSchema,
            label: { type: 'string' },
          },
          required: ['definition'],
          additionalProperties: false,
        },
      ],
    },
    result: flowRunSnapshotSchema,
  },
  'runs.get': { type: 'request', param: runIDParamSchema, result: flowRunSnapshotSchema },
  'runs.list': {
    type: 'request',
    param: {
      type: 'object',
      properties: {
        states: { type: 'array', items: runStateSchema },
        limit: { type: 'integer', minimum: 0 },
        updatedBefore: { type: 'number' },
      },
      additionalProperties: false,
    },
    result: { definitions: jsonDefinitions, type: 'array', items: flowRunSnapshotSchema },
  },
  'runs.cancel': { type: 'request', param: runIDParamSchema, result: flowRunSnapshotSchema },
  'runs.trace': {
    type: 'request',
    param: runIDParamSchema,
    result: {
      definitions: jsonDefinitions,
      type: 'object',
      properties: {
        spans: { type: 'array', items: storedSpanSchema },
        logs: { type: 'array', items: storedLogSchema },
      },
      required: ['spans', 'logs'],
      additionalProperties: false,
    },
  },
  'traces.list': { type: 'request', param: tracesListParamsSchema, result: tracesListResultSchema },
  'traces.get': { type: 'request', param: tracesGetParamsSchema, result: tracesGetResultSchema },
  'inbox.list': {
    type: 'request',
    param: {
      type: 'object',
      properties: { runID: { type: 'string' } },
      additionalProperties: false,
    },
    result: { definitions: jsonDefinitions, type: 'array', items: inboxItemSchema },
  },
  'inbox.get': { type: 'request', param: inboxIDParamSchema, result: inboxItemSchema },
  'inbox.answer': {
    type: 'request',
    param: {
      definitions: jsonDefinitions,
      ...inboxIDParamSchema,
      properties: { ...inboxIDParamSchema.properties, content: jsonObjectSchema },
    },
    result: settledResultSchema,
  },
  'inbox.decline': {
    type: 'request',
    param: {
      ...inboxIDParamSchema,
      properties: { ...inboxIDParamSchema.properties, reason: { type: 'string' } },
    },
    result: settledResultSchema,
  },
  'inbox.cancel': { type: 'request', param: inboxIDParamSchema, result: settledResultSchema },
  'inbox.prompt': {
    type: 'request',
    param: inboxIDParamSchema,
    result: {
      type: 'object',
      properties: { action: { type: 'string', enum: ['accept', 'decline', 'cancel'] } },
      required: ['action'],
      additionalProperties: false,
    },
  },
} as const satisfies ProtocolDefinition
export type Protocol = typeof protocol
export type BaseProtocol = Pick<Protocol, 'events' | 'info' | 'shutdown' | 'spawn'>
export type MonitorProcedure = 'monitor.attach' | 'monitor.presence'
export type TraceProcedure = 'traces.list' | 'traces.get'
export type TraceProtocol = Pick<Protocol, TraceProcedure>
export type FlowProcedure = Exclude<
  keyof Protocol,
  keyof BaseProtocol | MonitorProcedure | TraceProcedure
>

export type ClientMessage = AnyClientMessageOf<Protocol>
export type ServerMessage = AnyServerMessageOf<Protocol>
export type BaseClientMessage = AnyClientMessageOf<BaseProtocol>
export type BaseServerMessage = AnyServerMessageOf<BaseProtocol>
