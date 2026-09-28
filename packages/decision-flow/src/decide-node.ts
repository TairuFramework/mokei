import { type QuestionMap, questionMapSchema, type SystemOneClient } from '@mokei/system-one-client'
import {
  type ExecuteContext,
  type Filter,
  type FlowRetryPolicy,
  type NodeKind,
  retryPolicySchema,
  type Value,
} from '@sozai/flow-graph'
import type { Schema } from '@sozai/schema'

import { checkDecide, decideTargets } from './check-decide.js'
import { describeDecisionError, retryableDecision } from './decide-error.js'
import { decideResultSchema } from './result-schema.js'

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

export class InvalidDecisionStateError extends Error {
  #code = 'invalid_state'

  constructor() {
    super('Decision state must be a string, object, or array.')
    this.name = 'InvalidDecisionStateError'
  }

  get code(): string {
    return this.#code
  }
}

/** Create a flow-graph node kind that runs a System One decision. */
export function decideKind(params: { client: SystemOneClient }): NodeKind<DecideNode> {
  return {
    kind: 'decide' as const,
    schema: decideNodeSchema,
    targets: decideTargets,
    resultSchema: (node: DecideNode) => decideResultSchema(node.questions),
    check: checkDecide,
    retries: true,
    describeError: describeDecisionError,
    retryable: retryableDecision,
    execute: async (node: DecideNode, ctx: ExecuteContext) => {
      const state = ctx.resolve(node.state)
      if (state === null || (typeof state !== 'string' && typeof state !== 'object')) {
        throw new InvalidDecisionStateError()
      }

      const result = await params.client.predict({
        state,
        questions: node.questions,
        model: node.model,
        signal: ctx.signal,
      })
      ctx.setResult({
        ...result.answers,
        $meta: { model: result.model, usage: result.usage },
      })

      const match = node.cases.find((item) => ctx.evaluate(item.when))
      return { next: match?.to ?? node.default }
    },
  }
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
              minProperties: 1,
              properties: {
                isNull: { type: 'boolean' },
                equalTo: {},
                notEqualTo: {},
                in: { type: 'array', minItems: 1 },
                notIn: { type: 'array', minItems: 1 },
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
          properties: {
            and: { type: 'array', minItems: 1, items: { $ref: '#/definitions/filter' } },
          },
          required: ['and'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            or: { type: 'array', minItems: 1, items: { $ref: '#/definitions/filter' } },
          },
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
    questions: structuredClone(questionMapSchema),
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

function fieldExample(field: string, schema: Record<string, unknown>): unknown {
  const explicit: Record<string, unknown> = {
    kind: 'decide',
    description: 'Route this request to the right team.',
    state: { value: 'A customer needs help with an invoice.' },
    questions: {
      department: {
        type: 'choice',
        instructions: 'Which team should handle this request?',
        criteria: { billing: 'Billing support', technical: 'Technical support' },
      },
    },
    model: 'laya-general',
    cases: [
      {
        when: { path: ['results', 'triage', 'department', 'choice'], is: { equalTo: 'billing' } },
        to: 'billing',
      },
    ],
    when: { path: ['state', 'department'], is: { equalTo: 'billing' } },
    is: { equalTo: 'billing' },
    path: ['state', 'department'],
    to: 'billing',
    default: 'general',
    onError: 'fallback',
    retry: { maxAttempts: 2 },
    presence: 'nonEmpty',
    and: [{ path: ['state', 'active'], is: { equalTo: true } }],
    or: [{ path: ['state', 'active'], is: { equalTo: true } }],
    not: { path: ['state', 'active'], is: { equalTo: true } },
  }
  if (Object.hasOwn(explicit, field)) return explicit[field]
  if (Object.hasOwn(schema, 'const')) return schema.const
  if (Array.isArray(schema.enum)) return schema.enum[0]
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type
  if (type === 'string') return 'example'
  if (type === 'number' || type === 'integer') return 1
  if (type === 'boolean') return true
  if (type === 'array')
    return Number(schema.minItems) > 0
      ? [fieldExample(field, (schema.items ?? {}) as Record<string, unknown>)]
      : []
  if (type === 'object') {
    const properties = schema.properties as Record<string, Record<string, unknown>> | undefined
    const required = Array.isArray(schema.required) ? (schema.required as Array<string>) : []
    if (properties) {
      return Object.fromEntries(
        required.flatMap((key) => {
          const property = properties[key]
          return property ? [[key, fieldExample(key, property)]] : []
        }),
      )
    }
    if (schema.additionalProperties) return { example: 'Example value' }
    return {}
  }
  for (const key of ['oneOf', 'anyOf', 'allOf']) {
    const options = schema[key]
    if (Array.isArray(options) && options[0] && typeof options[0] === 'object') {
      return fieldExample(field, options[0] as Record<string, unknown>)
    }
  }
  return null
}

function documentProperties(schema: unknown): void {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return
  const objectSchema = schema as Record<string, unknown>
  const properties = objectSchema.properties
  if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
    for (const [field, value] of Object.entries(properties)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const property = value as Record<string, unknown>
      const label = field.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      property.description ??= `${label.charAt(0).toUpperCase()}${label.slice(1)} for this decision.`
      property.examples ??= [fieldExample(field, property)]
      documentProperties(property)
    }
  }
  for (const key of ['definitions', 'items', 'additionalProperties']) {
    const value = objectSchema[key]
    if (value && typeof value === 'object') documentProperties(value)
  }
  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    const value = objectSchema[key]
    if (Array.isArray(value)) value.forEach(documentProperties)
  }
}

documentProperties(decideNodeSchema)
