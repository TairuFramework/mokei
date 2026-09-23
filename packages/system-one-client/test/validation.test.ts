import { describe, expect, test } from 'vitest'

import { SystemOneInputError, SystemOneResponseError } from '../src/errors.js'
import type { ChoiceQuestion, NoulQuestion, ScoreQuestion } from '../src/types.js'
import {
  validateModels,
  validateQuestions,
  validateResult,
  validateState,
} from '../src/validation.js'

const questions = {
  dept: {
    type: 'choice',
    instructions: 'Which team?',
    criteria: { billing: 'x', tech: 'y' },
  } as ChoiceQuestion,
  urgency: {
    type: 'score',
    instructions: 'How urgent?',
    criteria: ['low', 'high'],
  } as ScoreQuestion,
  churn: { type: 'noul', instructions: 'Will they churn?' } as NoulQuestion,
}

describe('validateQuestions / validateState', () => {
  test('accepts a valid question map and state', () => {
    expect(validateQuestions({ questions })).toBe(questions as unknown)
    expect(validateState({ state: { body: 'hi' } })).toEqual({ body: 'hi' })
  })

  test('throws SystemOneInputError on a malformed question (missing criteria)', () => {
    expect(() => validateQuestions({ questions: { dept: { type: 'choice' } } })).toThrow(
      SystemOneInputError,
    )
  })

  test.each([
    ['choice', { type: 'choice', criteria: { billing: 'x' } }],
    ['score', { type: 'score', criteria: ['low', 'high'] }],
    ['noul', { type: 'noul' }],
  ])('throws SystemOneInputError on a %s question without instructions', (_type, question) => {
    expect(() => validateQuestions({ questions: { q: question } })).toThrow(SystemOneInputError)
  })

  test('accepts object and array instructions', () => {
    expect(() =>
      validateQuestions({
        questions: {
          a: {
            type: 'noul',
            instructions: { question: 'Refund?', policy: 'refund within 30 days' },
          },
          b: { type: 'noul', instructions: ['Refund?', 'Only for duplicate charges'] },
        },
      }),
    ).not.toThrow()
  })

  test('throws SystemOneInputError on instructions that are not a string, object or array', () => {
    expect(() =>
      validateQuestions({ questions: { q: { type: 'noul', instructions: 42 } } }),
    ).toThrow(SystemOneInputError)
  })

  test('throws SystemOneInputError on an empty question map', () => {
    expect(() => validateQuestions({ questions: {} })).toThrow(SystemOneInputError)
  })

  test('throws SystemOneInputError on a score question with fewer than 2 criteria levels', () => {
    expect(() =>
      validateQuestions({ questions: { urgency: { type: 'score', criteria: ['only-one'] } } }),
    ).toThrow(SystemOneInputError)
  })

  test('throws SystemOneInputError on a choice question with empty criteria', () => {
    expect(() =>
      validateQuestions({ questions: { dept: { type: 'choice', criteria: {} } } }),
    ).toThrow(SystemOneInputError)
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

  test('accepts Laya answers carrying action and a noul confidence', () => {
    const result = validateResult({
      questions,
      raw: {
        model: 'laya',
        family: 'english',
        route: 'english: ascii',
        answers: {
          dept: {
            type: 'choice',
            choice: 'billing',
            confidence: 0.9,
            probabilities: { billing: 0.9, tech: 0.1 },
            action: { act_probability: 0.8 },
          },
          urgency: {
            type: 'score',
            score: 0.3,
            confidence: 0.7,
            legend: { '0': 'low', '1': 'high' },
            probabilities: { '0': 0.7, '1': 0.3 },
            action: { act_probability: 0.5 },
          },
          churn: { type: 'noul', noul: 0.2, confidence: 0.8, action: { act_probability: 0.1 } },
        },
        usage: { input_tokens: 12, output_tokens: 0, latency_ms: 4.2 },
      },
    })
    expect(result.answers.dept.action?.act_probability).toBe(0.8)
    expect(result.answers.churn.confidence).toBe(0.8)
    expect(result.extras).toEqual({ family: 'english', route: 'english: ascii' })
  })

  test('still rejects an unknown answer field', () => {
    expect(() =>
      validateResult({
        questions,
        raw: {
          model: 'laya',
          answers: {
            dept: { type: 'choice', choice: 'billing', confidence: 1, probabilities: {}, extra: 1 },
            urgency: { type: 'score', score: 0, confidence: 1, legend: {}, probabilities: {} },
            churn: { type: 'noul', noul: 0.5 },
          },
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      }),
    ).toThrow(SystemOneResponseError)
  })

  test('throws SystemOneResponseError when answers is missing', () => {
    expect(() =>
      validateResult({
        questions,
        raw: { model: 'english', usage: { input_tokens: 0, output_tokens: 0 } },
      }),
    ).toThrow(SystemOneResponseError)
  })

  test('throws SystemOneResponseError when an answer has the wrong shape', () => {
    const raw = {
      model: 'english',
      answers: { dept: { type: 'choice', confidence: 0.9 }, urgency: {}, churn: {} },
      usage: { input_tokens: 0, output_tokens: 0 },
    }
    expect(() => validateResult({ questions, raw })).toThrow(SystemOneResponseError)
  })
})

describe('validateModels', () => {
  test('maps release_date to releaseDate', () => {
    const models = validateModels({
      raw: { models: [{ name: 'english', release_date: '2025-01-01' }] },
    })
    expect(models).toEqual([{ name: 'english', description: undefined, releaseDate: '2025-01-01' }])
  })

  test('throws SystemOneResponseError on a bad models list', () => {
    expect(() => validateModels({ raw: { models: 'x' } })).toThrow(SystemOneResponseError)
  })
})
