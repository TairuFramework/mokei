import {
  type PredictResult,
  type QuestionMap,
  questionMapSchema,
  type SystemOnePredictParams,
} from '@mokei/system-one-client'
import {
  type Attributes,
  createNoopMeter,
  type Histogram,
  type MeterProvider,
  metrics,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api'
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

const SEMCONV_SCHEMA_URL = 'https://opentelemetry.io/schemas/gen-ai-dev/1.42.0-dev'
const GEN_AI_DURATION_BUCKETS = [
  0.01, 0.02, 0.04, 0.08, 0.16, 0.32, 0.64, 1.28, 2.56, 5.12, 10.24, 20.48, 40.96, 81.92,
]
const PROVIDER_NAME = 'mokei.system_one'

// trace.getTracer / metrics.getMeter drop the options argument; go through the provider.
function getTracer() {
  return trace
    .getTracerProvider()
    .getTracer('mokei.decision-flow', undefined, { schemaUrl: SEMCONV_SCHEMA_URL })
}

let durationHistogram: Histogram | undefined
let durationProvider: MeterProvider | undefined

function recordDuration(durationS: number, attributes: Attributes): void {
  const provider = metrics.getMeterProvider()
  const meter = provider.getMeter('mokei.decision-flow', undefined, {
    schemaUrl: SEMCONV_SCHEMA_URL,
  })
  if (meter === createNoopMeter()) return
  if (provider !== durationProvider || durationHistogram === undefined) {
    durationProvider = provider
    durationHistogram = meter.createHistogram('gen_ai.client.operation.duration', {
      description: 'GenAI operation duration',
      unit: 's',
      advice: { explicitBucketBoundaries: GEN_AI_DURATION_BUCKETS },
    })
  }
  durationHistogram.record(durationS, attributes)
}

function serverAttributes(url: unknown): Attributes {
  if (typeof url !== 'string') return {}
  try {
    const parsed = new URL(url)
    return {
      'server.address': parsed.hostname.replace(/^\[|\]$/g, ''),
      'server.port':
        parsed.port !== '' ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80,
    }
  } catch {
    return {}
  }
}

export type PredictCall = { runID: string; invocationID: string; attempt: number }

export type PredictParams = SystemOnePredictParams<QuestionMap> & { call?: PredictCall }

export type Predictor = { predict(params: PredictParams): Promise<PredictResult<QuestionMap>> }

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
export function decideKind(params: { client: Predictor }): NodeKind<DecideNode> {
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

      const spanName = node.model === undefined ? 'predict' : `predict ${node.model}`
      const result = await getTracer().startActiveSpan(
        spanName,
        { kind: SpanKind.CLIENT },
        async (span) => {
          const startedAt = performance.now()
          const metricAttributes: Attributes = {
            'gen_ai.operation.name': 'predict',
            'gen_ai.provider.name': PROVIDER_NAME,
          }
          span.setAttributes({
            ...metricAttributes,
            'mokei.kind': 'step',
            'mokei.system_one.question.count': Object.keys(node.questions).length,
            ...serverAttributes((params.client as { url?: unknown }).url),
          })
          if (node.model !== undefined) {
            span.setAttribute('gen_ai.request.model', node.model)
            metricAttributes['gen_ai.request.model'] = node.model
          }
          let ended = false
          const endSpan = (errorType?: string) => {
            if (ended) return
            ended = true
            if (errorType !== undefined) metricAttributes['error.type'] = errorType
            recordDuration((performance.now() - startedAt) / 1000, metricAttributes)
            span.end()
          }
          const onAbort = () => {
            if (ended) return
            const reason = ctx.signal.reason
            const errorType = reason instanceof Error ? reason.name : 'AbortError'
            span.setAttribute('error.type', errorType)
            span.setStatus({ code: SpanStatusCode.ERROR })
            endSpan(errorType)
          }

          ctx.signal.addEventListener('abort', onAbort, { once: true })
          if (ctx.signal.aborted) onAbort()
          let errorType: string | undefined
          try {
            const prediction = await params.client.predict({
              state,
              questions: node.questions,
              model: node.model,
              signal: ctx.signal,
              call: {
                runID: ctx.runID,
                invocationID: ctx.invocationID,
                attempt: ctx.attempt,
              },
            })
            if (!ended) {
              span.setAttribute('gen_ai.response.model', prediction.model)
              span.setAttribute('gen_ai.usage.input_tokens', prediction.usage.inputTokens)
              span.setAttribute('gen_ai.usage.output_tokens', prediction.usage.outputTokens)
            }
            return prediction
          } catch (error) {
            if (!ended) {
              const metadata = describeDecisionError(error)
              errorType = metadata.type
              span.setAttribute('error.type', metadata.type)
              if (metadata.status !== undefined) {
                span.setAttribute('http.response.status_code', metadata.status)
              }
              if (metadata.retryAfterMs !== undefined) {
                span.setAttribute('mokei.system_one.retry_after_ms', metadata.retryAfterMs)
              }
              span.setStatus({ code: SpanStatusCode.ERROR })
            }
            throw error
          } finally {
            ctx.signal.removeEventListener('abort', onAbort)
            endSpan(errorType)
          }
        },
      )

      const answers: typeof result.answers = {}
      for (const question of Object.keys(node.questions)) {
        if (!Object.hasOwn(result.answers, question)) continue
        const answer = result.answers[question]
        if (answer === undefined) continue
        answers[question] = answer
        const attributes: Record<string, string | number | boolean> = {
          'decision.question': question,
          'decision.type': answer.type,
        }
        if (answer.type === 'choice') attributes['decision.choice'] = answer.choice
        if (answer.type === 'score') attributes['decision.score'] = answer.score
        if (answer.type === 'noul') attributes['decision.noul'] = answer.noul
        if ('confidence' in answer && answer.confidence !== undefined) {
          attributes['decision.confidence'] = answer.confidence
        }
        ctx.span.addEvent('decision.answer', attributes)
      }

      ctx.setResult({
        ...answers,
        $meta: { model: result.model, usage: result.usage },
      })

      const match = node.cases.find((item) => ctx.evaluate(item.when))
      return { next: match?.to ?? node.default }
    },
  }
}

/**
 * Schema for a `decide` node. Example:
 *
 * ```json
 * {
 *   "kind": "decide",
 *   "state": { "ref": ["input"] },
 *   "questions": {
 *     "department": {
 *       "type": "choice",
 *       "instructions": "Which department should handle this request?",
 *       "criteria": { "billing": "Billing", "technical": "Technical support" }
 *     }
 *   },
 *   "cases": [
 *     {
 *       "when": { "path": ["results", "triage", "department", "choice"], "is": { "equalTo": "billing" } },
 *       "to": "billing"
 *     }
 *   ],
 *   "default": "general"
 * }
 * ```
 */
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
    retry: structuredClone(retryPolicySchema) as Schema,
  },
  required: ['kind', 'state', 'questions', 'cases', 'default'],
  additionalProperties: false,
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
