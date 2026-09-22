import { describe, expect, test } from 'vitest'

import { LayaInputError, LayaResponseError } from '../src/errors.js'
import type { ChoiceQuestion, NoulQuestion, ScoreQuestion } from '../src/types.js'
import {
  validateModels,
  validateQuestions,
  validateResult,
  validateState,
} from '../src/validation.js'

const questions = {
  dept: { type: 'choice', criteria: { billing: 'x', tech: 'y' } } as ChoiceQuestion,
  urgency: { type: 'score', criteria: ['low', 'high'] } as ScoreQuestion,
  churn: { type: 'noul' } as NoulQuestion,
}

describe('validateQuestions / validateState', () => {
  test('accepts a valid question map and state', () => {
    expect(validateQuestions({ questions })).toBe(questions as unknown)
    expect(validateState({ state: { body: 'hi' } })).toEqual({ body: 'hi' })
  })

  test('throws LayaInputError on a malformed question (missing criteria)', () => {
    expect(() => validateQuestions({ questions: { dept: { type: 'choice' } } })).toThrow(
      LayaInputError,
    )
  })

  test('throws LayaInputError on an empty question map', () => {
    expect(() => validateQuestions({ questions: {} })).toThrow(LayaInputError)
  })
})

describe('validateResult', () => {
  test('accepts a well-formed response, maps usage, keeps a label outside criteria', () => {
    const raw = {
      model: 'english',
      answers: {
        dept: {
          type: 'choice',
          choice: 'unlisted',
          confidence: 0.9,
          probabilities: { unlisted: 0.9 },
        },
        urgency: {
          type: 'score',
          score: 1.4,
          confidence: 0.8,
          legend: {},
          probabilities: { low: 0.2 },
        },
        churn: { type: 'noul', noul: 0.7 },
      },
      usage: { input_tokens: 12, output_tokens: 3 },
      family: 'english',
    }
    const result = validateResult({ questions, raw })
    expect(result.answers.dept.choice).toBe('unlisted')
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 3 })
    expect(result.extras).toEqual({ family: 'english' })
  })

  test('throws LayaResponseError when answers is missing', () => {
    expect(() =>
      validateResult({
        questions,
        raw: { model: 'english', usage: { input_tokens: 0, output_tokens: 0 } },
      }),
    ).toThrow(LayaResponseError)
  })

  test('throws LayaResponseError when an answer has the wrong shape', () => {
    const raw = {
      model: 'english',
      answers: { dept: { type: 'choice', confidence: 0.9 }, urgency: {}, churn: {} },
      usage: { input_tokens: 0, output_tokens: 0 },
    }
    expect(() => validateResult({ questions, raw })).toThrow(LayaResponseError)
  })
})

describe('validateModels', () => {
  test('maps release_date to releaseDate', () => {
    const models = validateModels({
      raw: { models: [{ name: 'english', release_date: '2025-01-01' }] },
    })
    expect(models).toEqual([{ name: 'english', description: undefined, releaseDate: '2025-01-01' }])
  })

  test('throws LayaResponseError on a bad models list', () => {
    expect(() => validateModels({ raw: { models: 'x' } })).toThrow(LayaResponseError)
  })
})
