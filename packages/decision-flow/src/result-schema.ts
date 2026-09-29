import type { QuestionMap } from '@mokei/system-one-client'
import type { Schema } from '@sozai/schema'

const probability = { type: 'number', minimum: 0, maximum: 1 } as const
const action = {
  type: 'object',
  properties: { act_probability: probability },
  additionalProperties: false,
} as const

export function decideResultSchema(questions: QuestionMap): Schema {
  const properties: Record<string, Schema> = {}
  for (const [key, question] of Object.entries(questions)) {
    if (question.type === 'choice') {
      const labels = Object.fromEntries(
        Object.keys(question.criteria).map((label) => [label, probability]),
      )
      properties[key] = {
        type: 'object',
        properties: {
          choice: { type: 'string', enum: Object.keys(question.criteria) },
          confidence: probability,
          probabilities: { type: 'object', properties: labels, additionalProperties: false },
          action,
        },
        additionalProperties: false,
      }
    } else if (question.type === 'score') {
      properties[key] = {
        type: 'object',
        properties: {
          score: { type: 'number' },
          confidence: probability,
          legend: { type: 'object', additionalProperties: {} },
          probabilities: { type: 'object', additionalProperties: probability },
          action,
        },
        additionalProperties: false,
      }
    } else {
      properties[key] = {
        type: 'object',
        properties: { noul: probability, confidence: probability, action },
        additionalProperties: false,
      }
    }
  }
  properties.$meta = {
    type: 'object',
    properties: {
      model: { type: 'string' },
      usage: {
        type: 'object',
        properties: { inputTokens: { type: 'integer' }, outputTokens: { type: 'integer' } },
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  }
  return { type: 'object', properties, additionalProperties: false }
}
