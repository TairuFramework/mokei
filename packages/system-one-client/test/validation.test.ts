import { describe, expect, test } from 'vitest'

import { SystemOneInputError, SystemOneResponseError } from '../src/errors.js'
import type { ChoiceQuestion, NoulQuestion, ScoreQuestion } from '../src/types.js'
import { validateQuestions, validateResult, validateState } from '../src/validation.js'

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
      validateQuestions({
        questions: {
          urgency: { type: 'score', instructions: 'How urgent?', criteria: ['only-one'] },
        },
      }),
    ).toThrow(SystemOneInputError)
  })

  test('throws SystemOneInputError on a choice question with empty criteria', () => {
    expect(() =>
      validateQuestions({
        questions: { dept: { type: 'choice', instructions: 'Which team?', criteria: {} } },
      }),
    ).toThrow(SystemOneInputError)
  })
})

describe('question criteria', () => {
  const valid = (question: unknown) => () => validateQuestions({ questions: { q: question } })

  test('choice options take a string, object, array or null description', () => {
    expect(
      valid({
        type: 'choice',
        instructions: 'Which team?',
        criteria: {
          billing: 'invoices',
          tech: { scope: 'bugs', examples: ['crash'] },
          sales: ['pricing', 'upgrades'],
          other: null,
        },
      }),
    ).not.toThrow()
  })

  test('choice rejects a numeric option description', () => {
    expect(valid({ type: 'choice', instructions: 'Which team?', criteria: { a: 1 } })).toThrow(
      SystemOneInputError,
    )
  })

  test('choice rejects more than 255 options', () => {
    const criteria = Object.fromEntries(Array.from({ length: 256 }, (_, i) => [`o${i}`, null]))
    expect(valid({ type: 'choice', instructions: 'Which?', criteria })).toThrow(SystemOneInputError)
  })

  test('score levels take a string, object or array', () => {
    expect(
      valid({
        type: 'score',
        instructions: 'How urgent?',
        criteria: ['low', { level: 'medium', hint: 'this week' }, ['high', 'today']],
      }),
    ).not.toThrow()
  })

  test('score rejects a null level and more than 10 levels', () => {
    expect(valid({ type: 'score', instructions: 'How urgent?', criteria: ['low', null] })).toThrow(
      SystemOneInputError,
    )
    const criteria = Array.from({ length: 11 }, (_, i) => `level ${i}`)
    expect(valid({ type: 'score', instructions: 'How urgent?', criteria })).toThrow(
      SystemOneInputError,
    )
  })

  test('noul criteria describe true and false', () => {
    expect(
      valid({
        type: 'noul',
        instructions: 'Refund?',
        criteria: { true: 'asks for money back', false: { note: 'anything else' } },
      }),
    ).not.toThrow()
    expect(
      valid({ type: 'noul', instructions: 'Refund?', criteria: { true: 'yes' } }),
    ).not.toThrow()
  })

  test('noul rejects criteria other than true and false', () => {
    expect(valid({ type: 'noul', instructions: 'Refund?', criteria: { maybe: 'x' } })).toThrow(
      SystemOneInputError,
    )
    expect(valid({ type: 'noul', instructions: 'Refund?', criteria: 'yes or no' })).toThrow(
      SystemOneInputError,
    )
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
