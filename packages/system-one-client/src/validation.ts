import { createValidator, type Validator } from '@sozai/schema'

import { SystemOneInputError, SystemOneResponseError, type ValidationIssue } from './errors.js'
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

function toIssues(prefix: string, issues: ReadonlyArray<{ message: string; path?: unknown }>) {
  return issues.map((issue) => {
    return {
      message: `${prefix}: ${issue.message}`,
      path: issue.path as ReadonlyArray<unknown>,
    }
  }) satisfies Array<ValidationIssue>
}

function run<T>(validator: Validator<T>, value: unknown, prefix: string): Array<ValidationIssue> {
  const result = validator(value)
  return result.issues == null ? [] : toIssues(prefix, result.issues)
}

export function validateQuestions(params: { questions: unknown }): QuestionMap {
  const issues = run(questionMapValidator, params.questions, 'questions')
  if (issues.length > 0) {
    throw new SystemOneInputError({ message: 'Invalid question map', issues: issues })
  }
  return params.questions as QuestionMap
}

export function validateState(params: { state: unknown }): State {
  const issues = run(stateValidator, params.state, 'state')
  if (issues.length > 0) {
    throw new SystemOneInputError({ message: 'Invalid state', issues: issues })
  }
  return params.state as State
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

function probabilityIssue(value: number, path: Array<string>): ValidationIssue | undefined {
  return Number.isFinite(value) && value >= 0 && value <= 1
    ? undefined
    : { message: `${path.join('.')} must be finite and within [0, 1]`, path }
}

function valueIssues(question: Question, answer: unknown, key: string): Array<ValidationIssue> {
  const result: Array<ValidationIssue> = []
  const value = answer as Record<string, unknown>
  const base = ['answers', key]
  const addProbability = (number: unknown, path: Array<string>) => {
    if (typeof number !== 'number') return
    const issue = probabilityIssue(number, path)
    if (issue != null) result.push(issue)
  }
  if (question.type === 'choice') {
    if (!Object.hasOwn(question.criteria, value.choice as string)) {
      result.push({
        message: `${base.join('.')} choice must name a declared criterion`,
        path: [...base, 'choice'],
      })
    }
    for (const [label, probability] of Object.entries(
      value.probabilities as Record<string, number>,
    )) {
      if (!Object.hasOwn(question.criteria, label)) {
        result.push({
          message: `${base.join('.')} probability key must name a declared criterion`,
          path: [...base, 'probabilities', label],
        })
      }
      addProbability(probability, [...base, 'probabilities', label])
    }
  }
  if (question.type === 'score') {
    const legend = value.legend as Record<string, unknown>
    const score = value.score as number
    if (
      !Number.isFinite(score) ||
      (typeof legend.min === 'number' &&
        typeof legend.max === 'number' &&
        (score < legend.min || score > legend.max))
    ) {
      result.push({
        message: `${base.join('.')} score must be finite and within numeric legend bounds`,
        path: [...base, 'score'],
      })
    }
    for (const [label, probability] of Object.entries(
      value.probabilities as Record<string, number>,
    )) {
      addProbability(probability, [...base, 'probabilities', label])
    }
  }
  if (question.type === 'noul') addProbability(value.noul, [...base, 'noul'])
  if (value.confidence !== undefined) addProbability(value.confidence, [...base, 'confidence'])
  const action = value.action as { act_probability?: number } | undefined
  if (action?.act_probability !== undefined) {
    addProbability(action.act_probability, [...base, 'action', 'act_probability'])
  }
  return result
}

export function validateResult<TQuestions extends QuestionMap>(params: {
  questions: TQuestions
  raw: unknown
}): PredictResult<TQuestions> {
  const { questions, raw } = params
  if (raw == null || typeof raw !== 'object') {
    throw new SystemOneResponseError({ message: 'Response is not an object' })
  }
  const record = raw as Record<string, unknown>
  const { answers, usage, model, ...extras } = record
  if (answers == null || typeof answers !== 'object') {
    throw new SystemOneResponseError({
      message: 'Response is missing answers',
      issues: [{ message: 'answers must be an object', path: ['answers'] }],
    })
  }
  if (typeof model !== 'string') {
    throw new SystemOneResponseError({
      message: 'Response is missing model',
      issues: [{ message: 'model must be a string', path: ['model'] }],
    })
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
  if (issues.length > 0) {
    throw new SystemOneResponseError({ message: 'Response failed validation', issues: issues })
  }
  const wireUsage = usage as { input_tokens: number; output_tokens: number }
  const mappedUsage: Usage = {
    inputTokens: wireUsage.input_tokens,
    outputTokens: wireUsage.output_tokens,
  }
  return {
    model,
    answers: answerRecord,
    usage: mappedUsage,
    extras: Object.keys(extras).length > 0 ? extras : undefined,
  } as PredictResult<TQuestions>
}
