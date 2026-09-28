import type { QuestionMap } from '@mokei/system-one-client'
import { createValidator } from '@sozai/schema'
import { describe, expect, test } from 'vitest'

import { decideResultSchema } from '../src/result-schema.js'

const questions: QuestionMap = {
  dept: {
    type: 'choice',
    instructions: 'Which department?',
    criteria: { billing: 'Billing', technical: 'Technical' },
  },
  urgency: { type: 'score', instructions: 'How urgent?', criteria: ['low', 'high'] },
  refund: { type: 'noul', instructions: 'Does this need a refund?' },
}

type SchemaShape = {
  type?: string
  properties: Record<string, SchemaShape>
  additionalProperties?: boolean | SchemaShape
  enum?: Array<string>
  minimum?: number
  maximum?: number
}

const propertyNames = (schema: SchemaShape) => Object.keys(schema.properties)

const at = (schema: SchemaShape, key: string): SchemaShape => {
  const value = schema.properties[key]
  if (value === undefined) throw new Error(`Missing schema property: ${key}`)
  return value
}

describe('decideResultSchema', () => {
  test('builds closed referenceable paths and two documented open maps', () => {
    const schema = decideResultSchema(questions) as unknown as SchemaShape

    expect(schema.additionalProperties).toBe(false)
    expect(propertyNames(schema)).toEqual(['dept', 'urgency', 'refund', '$meta'])

    const dept = at(schema, 'dept')
    const urgency = at(schema, 'urgency')
    const refund = at(schema, 'refund')
    const meta = at(schema, '$meta')
    const choiceProbabilities = at(dept, 'probabilities')
    const action = at(dept, 'action')
    const usage = at(meta, 'usage')

    expect(propertyNames(dept)).toEqual(['choice', 'confidence', 'probabilities', 'action'])
    expect(at(dept, 'choice').enum).toEqual(['billing', 'technical'])
    expect(propertyNames(choiceProbabilities)).toEqual(['billing', 'technical'])
    expect(dept.additionalProperties).toBe(false)
    expect(action.additionalProperties).toBe(false)
    expect(at(action, 'act_probability')).toMatchObject({ minimum: 0, maximum: 1 })

    expect(propertyNames(urgency)).toEqual([
      'score',
      'confidence',
      'legend',
      'probabilities',
      'action',
    ])
    expect(urgency.additionalProperties).toBe(false)
    expect(at(urgency, 'legend').additionalProperties).toEqual({})
    expect(at(urgency, 'probabilities').additionalProperties).toEqual({
      type: 'number',
      minimum: 0,
      maximum: 1,
    })

    expect(propertyNames(refund)).toEqual(['noul', 'confidence', 'action'])
    expect(refund.additionalProperties).toBe(false)
    expect(propertyNames(meta)).toEqual(['model', 'usage'])
    expect(at(meta, 'model').type).toBe('string')
    expect(meta.additionalProperties).toBe(false)
    expect(propertyNames(usage)).toEqual(['inputTokens', 'outputTokens'])
    expect(at(usage, 'inputTokens').type).toBe('integer')
    expect(at(usage, 'outputTokens').type).toBe('integer')
    expect(usage.additionalProperties).toBe(false)

    const serialized = JSON.stringify(schema)
    expect(serialized).not.toContain('rationale')
  })

  test('rejects extra runtime answer fields from this reference schema', () => {
    const validate = createValidator(decideResultSchema(questions))
    const result = validate({
      dept: {
        choice: 'billing',
        confidence: 0.9,
        probabilities: { billing: 0.9, technical: 0.1 },
        action: { act_probability: 0.8 },
        rationale: 'backend-only field',
      },
      urgency: {
        score: 1.2,
        confidence: 0.7,
        legend: { anyBackendKey: 'open' },
        probabilities: { '1.2': 0.8 },
        action: { act_probability: 0.6 },
      },
      refund: { noul: 0.2, confidence: 0.8, action: { act_probability: 0.4 } },
      $meta: { model: 'test-model', usage: { inputTokens: 10, outputTokens: 5 } },
    })

    expect(result).toHaveProperty('issues')
  })
})
