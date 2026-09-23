import { createValidator, type Validator } from '@sozai/schema'

import { SystemOneInputError, SystemOneResponseError, type ValidationIssue } from './errors.js'
import {
  choiceAnswerSchema,
  modelsResponseSchema,
  noulAnswerSchema,
  type PredictResult,
  type Question,
  type QuestionMap,
  questionMapSchema,
  type State,
  type SystemOneModel,
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
const modelsValidator = createValidator(modelsResponseSchema)

function toIssues(prefix: string, issues: ReadonlyArray<{ message: string; path?: unknown }>) {
  return issues.map((issue) => ({
    message: `${prefix}: ${issue.message}`,
    path: issue.path as ReadonlyArray<unknown>,
  })) satisfies Array<ValidationIssue>
}

function run<T>(validator: Validator<T>, value: unknown, prefix: string): Array<ValidationIssue> {
  const result = validator(value)
  return result.issues == null ? [] : toIssues(prefix, result.issues)
}

export function validateQuestions(params: { questions: unknown }): QuestionMap {
  const issues = run(questionMapValidator, params.questions, 'questions')
  if (issues.length > 0) {
    throw new SystemOneInputError('Invalid question map', issues)
  }
  return params.questions as QuestionMap
}

export function validateState(params: { state: unknown }): State {
  const issues = run(stateValidator, params.state, 'state')
  if (issues.length > 0) {
    throw new SystemOneInputError('Invalid state', issues)
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

export function validateResult<TQuestions extends QuestionMap>(params: {
  questions: TQuestions
  raw: unknown
}): PredictResult<TQuestions> {
  const { questions, raw } = params
  if (raw == null || typeof raw !== 'object') {
    throw new SystemOneResponseError('Response is not an object')
  }
  const record = raw as Record<string, unknown>
  const { answers, usage, model, ...extras } = record
  if (answers == null || typeof answers !== 'object') {
    throw new SystemOneResponseError('Response is missing answers', [
      { message: 'answers must be an object', path: ['answers'] },
    ])
  }
  if (typeof model !== 'string') {
    throw new SystemOneResponseError('Response is missing model', [
      { message: 'model must be a string', path: ['model'] },
    ])
  }
  const answerRecord = answers as Record<string, unknown>
  const issues: Array<ValidationIssue> = []
  for (const [key, question] of Object.entries(questions)) {
    issues.push(
      ...run(
        answerValidatorFor(question) as Validator<unknown>,
        answerRecord[key],
        `answers.${key}`,
      ),
    )
  }
  const usageIssues = run(usageValidator, usage, 'usage')
  issues.push(...usageIssues)
  if (issues.length > 0) {
    throw new SystemOneResponseError('Response failed validation', issues)
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

export function validateModels(params: { raw: unknown }): Array<SystemOneModel> {
  const issues = run(modelsValidator, params.raw, 'models')
  if (issues.length > 0) {
    throw new SystemOneResponseError('Invalid models list', issues)
  }
  const wire = params.raw as {
    models: Array<{ name: string; description?: string; release_date?: string }>
  }
  return wire.models.map((entry) => ({
    name: entry.name,
    description: entry.description,
    releaseDate: entry.release_date,
  }))
}
