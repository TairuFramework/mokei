import type { FromSchema, Schema } from '@sozai/schema'

import {
  jsonDefinitions,
  jsonObjectSchema,
  storedLogSchema,
  storedSpanSchema,
} from './flow-schemas.js'

export const traceSummarySchema = {
  definitions: jsonDefinitions,
  type: 'object',
  properties: {
    traceID: { type: 'string' },
    rootSpanID: { type: 'string' },
    activeSegmentSpanID: { type: 'string' },
    kind: { type: 'string', enum: ['context', 'mcp', 'flow', 'step'] },
    name: { type: 'string' },
    active: { type: 'boolean' },
    outcome: { type: ['string', 'null'], enum: ['ok', 'error', 'interrupted', null] },
    startTime: { type: 'number' },
    endTime: { type: 'number' },
    attributes: {
      type: 'object',
      properties: {
        'mokei.run.id': { type: 'string' },
        'mokei.flow.id': { type: 'string' },
        'mokei.context.id': { type: 'string' },
        'mokei.server.name': { type: 'string' },
        label: { type: 'string' },
      },
      additionalProperties: false,
    },
    spanCount: { type: 'integer' },
    errorCount: { type: 'integer' },
    droppedCount: { type: 'integer' },
    revision: { type: 'integer' },
  },
  required: [
    'traceID',
    'rootSpanID',
    'kind',
    'name',
    'active',
    'outcome',
    'startTime',
    'attributes',
    'spanCount',
    'errorCount',
    'droppedCount',
    'revision',
  ],
  additionalProperties: false,
} as const satisfies Schema
export type TraceSummary = FromSchema<typeof traceSummarySchema>

export const openSpanSchema = {
  definitions: jsonDefinitions,
  type: 'object',
  properties: {
    traceID: { type: 'string' },
    spanID: { type: 'string' },
    parentSpanID: { type: 'string' },
    name: { type: 'string' },
    kind: { type: 'number' },
    startTime: { type: 'number' },
    attributes: jsonObjectSchema,
    links: { type: 'array', items: storedSpanSchema.properties.links.items },
  },
  required: ['traceID', 'spanID', 'name', 'kind', 'startTime', 'attributes', 'links'],
  additionalProperties: false,
} as const satisfies Schema
export type OpenSpan = FromSchema<typeof openSpanSchema>

export const traceLogSchema = {
  ...storedLogSchema,
  properties: { ...storedLogSchema.properties, logID: { type: 'string' } },
  required: [...storedLogSchema.required, 'logID'],
} as const satisfies Schema
export type TraceLog = FromSchema<typeof traceLogSchema>

export const tracesListParamsSchema = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['context', 'mcp', 'flow', 'step'] },
    active: { type: 'boolean' },
    outcome: { type: ['string', 'null'], enum: ['ok', 'error', 'interrupted', null] },
    name: { type: 'string' },
    since: { type: 'number' },
    until: { type: 'number' },
    limit: { type: 'integer' },
    cursor: { type: 'string' },
  },
  required: ['limit'],
  additionalProperties: false,
} as const satisfies Schema
export type TracesListParams = FromSchema<typeof tracesListParamsSchema>

export const tracesListResultSchema = {
  definitions: jsonDefinitions,
  type: 'object',
  properties: { traces: { type: 'array', items: traceSummarySchema }, cursor: { type: 'string' } },
  required: ['traces'],
  additionalProperties: false,
} as const satisfies Schema
export type TracesListResult = FromSchema<typeof tracesListResultSchema>

export const tracesGetParamsSchema = {
  type: 'object',
  properties: { traceID: { type: 'string' } },
  required: ['traceID'],
  additionalProperties: false,
} as const satisfies Schema

/**
 * A request span in another trace that called into this one: a span carrying
 * `mokei.context.trace_id` set to this trace's ID, such as a flow's tool call into a context.
 */
export const traceCallSchema = {
  type: 'object',
  properties: {
    traceID: { type: 'string' },
    spanID: { type: 'string' },
    name: { type: 'string' },
    startTime: { type: 'number' },
    endTime: { type: 'number' },
    /** `null` while the call is still open. */
    outcome: { type: ['string', 'null'], enum: ['ok', 'error', null] },
  },
  required: ['traceID', 'spanID', 'name', 'startTime', 'outcome'],
  additionalProperties: false,
} as const satisfies Schema
export type TraceCall = FromSchema<typeof traceCallSchema>

export const tracesGetResultSchema = {
  definitions: jsonDefinitions,
  type: 'object',
  properties: {
    summary: traceSummarySchema,
    spans: { type: 'array', items: { anyOf: [storedSpanSchema, openSpanSchema] } },
    logs: { type: 'array', items: traceLogSchema },
    logsTruncated: { type: 'boolean' },
    /** Calls into this trace from other traces, newest first. */
    calls: { type: 'array', items: traceCallSchema },
    callsTruncated: { type: 'boolean' },
  },
  required: ['summary', 'spans', 'logs', 'logsTruncated'],
  additionalProperties: false,
} as const satisfies Schema
export type TracesGetResult = FromSchema<typeof tracesGetResultSchema>

export const tracesLogsParamsSchema = {
  type: 'object',
  properties: {
    traceID: { type: 'string' },
    /** Only logs recorded under this span. */
    spanID: { type: 'string' },
    /** Only logs at or before this time (milliseconds), to page back from logs already held. */
    before: { type: 'number' },
    limit: { type: 'integer' },
    cursor: { type: 'string' },
  },
  required: ['traceID', 'limit'],
  additionalProperties: false,
} as const satisfies Schema
export type TracesLogsParams = FromSchema<typeof tracesLogsParamsSchema>

export const tracesLogsResultSchema = {
  definitions: jsonDefinitions,
  type: 'object',
  properties: {
    /** Newest first. */
    logs: { type: 'array', items: traceLogSchema },
    /** Pass back to read the next, older page; absent on the last page. */
    cursor: { type: 'string' },
  },
  required: ['logs'],
  additionalProperties: false,
} as const satisfies Schema
export type TracesLogsResult = FromSchema<typeof tracesLogsResultSchema>

export const tracingInfoSchema = {
  type: 'object',
  properties: { lostSummaryCount: { type: 'integer' }, droppedCount: { type: 'integer' } },
  required: ['lostSummaryCount', 'droppedCount'],
  additionalProperties: false,
} as const satisfies Schema
export type TracingInfo = FromSchema<typeof tracingInfoSchema>
