import type { FromSchema, Schema } from '@sozai/schema'

// Every wire schema carries this definition so nested JSON references resolve at its root.
export const jsonDefinitions = {
  json: {
    anyOf: [
      { type: 'string' },
      { type: 'number' },
      { type: 'boolean' },
      { type: 'null' },
      { type: 'array', items: { $ref: '#/definitions/json' } },
      { type: 'object', additionalProperties: { $ref: '#/definitions/json' } },
    ],
  } satisfies Schema,
} as const

// Widen recursive values for inference while retaining recursive validation on the wire.
const jsonValueSchema: { $ref: string } = { $ref: '#/definitions/json' }
export const jsonObjectSchema = {
  type: 'object',
  additionalProperties: jsonValueSchema,
} as const satisfies Schema

export const flowServiceStatusSchema = {
  anyOf: [
    {
      type: 'object',
      properties: { state: { const: 'starting', type: 'string' } },
      required: ['state'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: { state: { const: 'ready', type: 'string' } },
      required: ['state'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        state: { const: 'failed', type: 'string' },
        error: {
          type: 'object',
          properties: {
            type: { type: 'string' },
            message: { type: 'string' },
            path: { type: 'string' },
            issues: { type: 'array', items: { type: 'string' } },
          },
          required: ['type', 'message'],
          additionalProperties: false,
        },
      },
      required: ['state', 'error'],
      additionalProperties: false,
    },
  ],
} as const satisfies Schema
export type FlowServiceStatus = FromSchema<typeof flowServiceStatusSchema>

export const runStateSchema = {
  type: 'string',
  enum: [
    'awaiting_approval',
    'denied',
    'working',
    'input_required',
    'completed',
    'failed',
    'cancelled',
  ],
} as const satisfies Schema

const runPlanSchema = {
  type: 'object',
  properties: { tools: { type: 'array', items: { type: 'string' } } },
  required: ['tools'],
  additionalProperties: false,
} as const satisfies Schema

export const flowRunSnapshotSchema = {
  definitions: jsonDefinitions,
  type: 'object',
  properties: {
    runID: { type: 'string' },
    flowID: { type: 'string' },
    label: { type: 'string' },
    state: runStateSchema,
    createdAt: { type: 'number' },
    updatedAt: { type: 'number' },
    traceID: { type: 'string' },
    plan: runPlanSchema,
    result: {
      type: 'object',
      properties: {
        outcome: { type: 'string' },
        output: jsonValueSchema,
        content: { type: 'array', items: jsonObjectSchema },
      },
      required: ['content'],
      additionalProperties: false,
    },
    error: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        message: { type: 'string' },
        code: { type: 'string' },
      },
      required: ['type', 'message'],
      additionalProperties: false,
    },
  },
  required: ['runID', 'label', 'state', 'createdAt', 'updatedAt', 'plan'],
  additionalProperties: false,
} as const satisfies Schema
export type FlowRunSnapshot = FromSchema<typeof flowRunSnapshotSchema>

export const inboxItemSchema = {
  type: 'object',
  definitions: jsonDefinitions,
  anyOf: [
    {
      type: 'object',
      properties: {
        id: { type: 'string' },
        runID: { type: 'string' },
        kind: { type: 'string', const: 'approval' },
        plan: runPlanSchema,
        createdAt: { type: 'number' },
      },
      required: ['id', 'runID', 'kind', 'plan', 'createdAt'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        id: { type: 'string' },
        runID: { type: 'string' },
        kind: { type: 'string', const: 'input' },
        inputKey: { type: 'string' },
        message: { type: 'string' },
        requestedSchema: jsonObjectSchema,
        createdAt: { type: 'number' },
      },
      required: ['id', 'runID', 'kind', 'inputKey', 'message', 'requestedSchema', 'createdAt'],
      additionalProperties: false,
    },
  ],
} as const satisfies Schema
export type InboxItem = FromSchema<typeof inboxItemSchema>

export const flowSummarySchema = {
  definitions: jsonDefinitions,
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    version: { type: 'number' },
    input: jsonObjectSchema,
    outputs: { type: 'array', items: { type: 'string' } },
    outcomes: { type: 'array', items: { type: 'string' } },
  },
  required: ['id', 'name', 'version', 'input', 'outputs', 'outcomes'],
  additionalProperties: false,
} as const satisfies Schema
export type FlowSummary = FromSchema<typeof flowSummarySchema>

export const flowIssueSchema = {
  type: 'object',
  properties: {
    path: { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'number' }] } },
    severity: { type: 'string', enum: ['error', 'warning'] },
    code: { type: 'string' },
    message: { type: 'string' },
    hint: { type: 'string' },
  },
  required: ['path', 'severity', 'code', 'message'],
  additionalProperties: false,
} as const satisfies Schema
export type FlowIssue = FromSchema<typeof flowIssueSchema>

export const flowCheckResultSchema = {
  type: 'object',
  definitions: jsonDefinitions,
  anyOf: [
    {
      type: 'object',
      properties: {
        value: jsonObjectSchema,
        warnings: { type: 'array', items: flowIssueSchema },
        formatted: { type: 'string' },
      },
      required: ['value', 'warnings', 'formatted'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        issues: { type: 'array', items: flowIssueSchema },
        warnings: { type: 'array', items: flowIssueSchema },
        formatted: { type: 'string' },
      },
      required: ['issues', 'warnings', 'formatted'],
      additionalProperties: false,
    },
  ],
} as const satisfies Schema
export type FlowCheckResult = FromSchema<typeof flowCheckResultSchema>

export const storedSpanSchema = {
  definitions: jsonDefinitions,
  type: 'object',
  properties: {
    traceID: { type: 'string' },
    spanID: { type: 'string' },
    parentSpanID: { type: 'string' },
    name: { type: 'string' },
    kind: { type: 'number' },
    startTime: { type: 'number' },
    endTime: { type: 'number' },
    status: {
      type: 'object',
      properties: { code: { type: 'number' }, message: { type: 'string' } },
      required: ['code'],
      additionalProperties: false,
    },
    attributes: jsonObjectSchema,
    events: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          time: { type: 'number' },
          attributes: jsonObjectSchema,
        },
        required: ['name', 'time', 'attributes'],
        additionalProperties: false,
      },
    },
    links: {
      type: 'array',
      items: {
        type: 'object',
        properties: { traceID: { type: 'string' }, spanID: { type: 'string' } },
        required: ['traceID', 'spanID'],
        additionalProperties: false,
      },
    },
  },
  required: [
    'traceID',
    'spanID',
    'name',
    'kind',
    'startTime',
    'endTime',
    'status',
    'attributes',
    'events',
    'links',
  ],
  additionalProperties: false,
} as const satisfies Schema
export type StoredSpan = FromSchema<typeof storedSpanSchema>

export const storedLogSchema = {
  definitions: jsonDefinitions,
  type: 'object',
  properties: {
    traceID: { type: 'string' },
    spanID: { type: 'string' },
    timestamp: { type: 'number' },
    level: { type: 'string', enum: ['trace', 'debug', 'info', 'warning', 'error', 'fatal'] },
    category: { type: 'array', items: { type: 'string' } },
    message: { type: 'string' },
    properties: jsonObjectSchema,
  },
  required: ['traceID', 'spanID', 'timestamp', 'level', 'category', 'message', 'properties'],
  additionalProperties: false,
} as const satisfies Schema
export type StoredLog = FromSchema<typeof storedLogSchema>
