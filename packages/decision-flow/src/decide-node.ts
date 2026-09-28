import { type QuestionMap, questionMapSchema } from '@mokei/system-one-client'
import { type Filter, type FlowRetryPolicy, retryPolicySchema, type Value } from '@sozai/flow-graph'
import type { Schema } from '@sozai/schema'

export type DecideNode = {
  kind: 'decide'
  description?: string
  state: Value
  questions: QuestionMap
  model?: string
  cases: Array<{ when: Filter; to: string }>
  default: string
  onError?: string
  retry?: FlowRetryPolicy
}

export const decideNodeSchema: Schema = {
  definitions: {
    value: {
      anyOf: [
        {
          type: 'object',
          properties: { ref: { type: 'array', items: { type: 'string' } } },
          required: ['ref'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: { value: {} },
          required: ['value'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            object: { type: 'object', additionalProperties: { $ref: '#/definitions/value' } },
          },
          required: ['object'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: { array: { type: 'array', items: { $ref: '#/definitions/value' } } },
          required: ['array'],
          additionalProperties: false,
        },
      ],
    },
    filter: {
      anyOf: [
        {
          type: 'object',
          properties: {
            path: { type: 'array', items: { type: 'string' } },
            is: {
              type: 'object',
              properties: {
                isNull: { type: 'boolean' },
                equalTo: {},
                notEqualTo: {},
                in: { type: 'array' },
                notIn: { type: 'array' },
                lessThan: { type: ['number', 'string'] },
                lessThanOrEqualTo: { type: ['number', 'string'] },
                greaterThan: { type: ['number', 'string'] },
                greaterThanOrEqualTo: { type: ['number', 'string'] },
                contains: { type: 'string' },
                includesAll: { type: 'array', items: { type: ['string', 'number'] } },
                includesAny: { type: 'array', items: { type: ['string', 'number'] } },
                presence: { enum: ['null', 'nonNull', 'empty', 'nonEmpty', 'nullOrEmpty'] },
              },
              additionalProperties: false,
            },
          },
          required: ['path', 'is'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: { and: { type: 'array', items: { $ref: '#/definitions/filter' } } },
          required: ['and'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: { or: { type: 'array', items: { $ref: '#/definitions/filter' } } },
          required: ['or'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: { not: { $ref: '#/definitions/filter' } },
          required: ['not'],
          additionalProperties: false,
        },
      ],
    },
  },
  type: 'object',
  properties: {
    kind: { const: 'decide' },
    description: { type: 'string' },
    state: { $ref: '#/definitions/value' },
    questions: questionMapSchema,
    model: { type: 'string' },
    cases: {
      type: 'array',
      items: {
        type: 'object',
        properties: { when: { $ref: '#/definitions/filter' }, to: { type: 'string' } },
        required: ['when', 'to'],
        additionalProperties: false,
      },
    },
    default: { type: 'string' },
    onError: { type: 'string' },
    retry: retryPolicySchema as Schema,
  },
  required: ['kind', 'state', 'questions', 'cases', 'default'],
  additionalProperties: false,
  examples: [
    {
      kind: 'decide',
      state: { ref: ['input'] },
      questions: {
        department: {
          type: 'choice',
          instructions: 'Which department should handle this request?',
          criteria: { billing: 'Billing', technical: 'Technical support' },
        },
      },
      cases: [
        {
          when: {
            path: ['results', 'triage', 'department', 'choice'],
            is: { equalTo: 'billing' },
          },
          to: 'billing',
        },
      ],
      default: 'general',
    },
  ],
}
