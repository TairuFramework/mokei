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
        'run.id': { type: 'string' },
        'flow.id': { type: 'string' },
        'mokei.context.id': { type: 'string' },
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

export const tracesGetResultSchema = {
  definitions: jsonDefinitions,
  type: 'object',
  properties: {
    summary: traceSummarySchema,
    spans: { type: 'array', items: { anyOf: [storedSpanSchema, openSpanSchema] } },
    logs: { type: 'array', items: traceLogSchema },
    logsTruncated: { type: 'boolean' },
  },
  required: ['summary', 'spans', 'logs', 'logsTruncated'],
  additionalProperties: false,
} as const satisfies Schema
export type TracesGetResult = FromSchema<typeof tracesGetResultSchema>

export const tracingInfoSchema = {
  type: 'object',
  properties: { lostSummaryCount: { type: 'integer' }, droppedCount: { type: 'integer' } },
  required: ['lostSummaryCount', 'droppedCount'],
  additionalProperties: false,
} as const satisfies Schema
export type TracingInfo = FromSchema<typeof tracingInfoSchema>
