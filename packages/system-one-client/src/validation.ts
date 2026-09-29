import type { StandardSchemaV1 } from '@sozai/schema'
import { createValidator, type Validator } from '@sozai/schema'

import type { ValidationIssue } from './errors.js'
import {
  choiceAnswerSchema,
  noulAnswerSchema,
  type PredictResult,
  type Question,
  type QuestionMap,
  questionMapSchema,
  type State,
  scoreAnswerSchema,
  stateSchema,
  type Usage,
  wireUsageSchema,
} from './types.js'

const questionMapValidator = createValidator(questionMapSchema)
const stateValidator = createValidator(stateSchema)
const choiceAnswerValidator = createValidator(choiceAnswerSchema)
const scoreAnswerValidator = createValidator(scoreAnswerSchema)
const noulAnswerValidator = createValidator(noulAnswerSchema)
const usageValidator = createValidator(wireUsageSchema)

function run<T>(validator: Validator<T>, value: unknown, prefix: string): Array<ValidationIssue> {
  const result = validator(value)
  if (result.issues == null) return []
  return result.issues.map((issue) => {
    return { message: `${prefix}: ${issue.message}`, path: issue.path }
  })
}

function toResult<T>(
  value: unknown,
  issues: ReadonlyArray<ValidationIssue>,
): StandardSchemaV1.Result<T> {
  return issues.length > 0 ? { issues } : { value: value as T }
}

export function validateQuestions(params: {
  questions: unknown
}): StandardSchemaV1.Result<QuestionMap> {
  return toResult(params.questions, run(questionMapValidator, params.questions, 'questions'))
}

export function validateState(params: { state: unknown }): StandardSchemaV1.Result<State> {
  return toResult(params.state, run(stateValidator, params.state, 'state'))
}

function answerValidatorFor(question: Question) {
  switch (question.type) {
    case 'choice':
      return choiceAnswerValidator
    case 'score':
      return scoreAnswerValidator
    case 'noul':
      return noulAnswerValidator
  }
}

// Fixed bounds (confidence, probabilities, noul, act_probability) live in the answer schemas.
// These checks depend on the question: declared criteria and numeric legend bounds.
function valueIssues(question: Question, answer: unknown, key: string): Array<ValidationIssue> {
  const result: Array<ValidationIssue> = []
  const value = answer as Record<string, unknown>
  const base = ['answers', key]
  if (question.type === 'choice') {
    if (!Object.hasOwn(question.criteria, value.choice as string)) {
      result.push({
        message: `${base.join('.')} choice must name a declared criterion`,
        path: [...base, 'choice'],
      })
    }
    for (const label of Object.keys(value.probabilities as Record<string, number>)) {
      if (!Object.hasOwn(question.criteria, label)) {
        result.push({
          message: `${base.join('.')} probability key must name a declared criterion`,
          path: [...base, 'probabilities', label],
        })
      }
    }
  }
  if (question.type === 'score') {
    const legend = value.legend as Record<string, unknown>
    const score = value.score as number
    if (
      typeof legend.min === 'number' &&
      typeof legend.max === 'number' &&
      (score < legend.min || score > legend.max)
    ) {
      result.push({
        message: `${base.join('.')} score must be within numeric legend bounds`,
        path: [...base, 'score'],
      })
    }
  }
  return result
}

export function validateResult<TQuestions extends QuestionMap>(params: {
  questions: TQuestions
  raw: unknown
}): StandardSchemaV1.Result<PredictResult<TQuestions>> {
  const { questions, raw } = params
  if (raw == null || typeof raw !== 'object') {
    return { issues: [{ message: 'response must be an object' }] }
  }
  const record = raw as Record<string, unknown>
  const { answers, usage, model, ...extras } = record
  if (answers == null || typeof answers !== 'object') {
    return { issues: [{ message: 'answers must be an object', path: ['answers'] }] }
  }
  if (typeof model !== 'string') {
    return { issues: [{ message: 'model must be a string', path: ['model'] }] }
  }
  const answerRecord = answers as Record<string, unknown>
  const issues: Array<ValidationIssue> = []
  for (const [key, question] of Object.entries(questions)) {
    const shapeIssues = run(
      answerValidatorFor(question) as Validator<unknown>,
      answerRecord[key],
      `answers.${key}`,
    ).map((issue) => {
      const answerPath = ['answers', key, ...(Array.isArray(issue.path) ? issue.path : [])]
      const message = issue.message.replace(`answers.${key}: `, '')
      return { message: `${answerPath.join('.')}: ${message}`, path: answerPath }
    })
    issues.push(...shapeIssues)
    if (shapeIssues.length === 0) issues.push(...valueIssues(question, answerRecord[key], key))
  }
  const usageIssues = run(usageValidator, usage, 'usage')
  issues.push(...usageIssues)
  if (issues.length > 0) return { issues }
  const wireUsage = usage as { input_tokens: number; output_tokens: number }
  const mappedUsage: Usage = {
    inputTokens: wireUsage.input_tokens,
    outputTokens: wireUsage.output_tokens,
  }
  const value = {
    model,
    answers: answerRecord,
    usage: mappedUsage,
    extras: Object.keys(extras).length > 0 ? extras : undefined,
  } as PredictResult<TQuestions>
  return { value }
}
