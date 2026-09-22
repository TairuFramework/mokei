import type { FromSchema, Schema } from '@sozai/schema'

const instructionsSchema = {} as const satisfies Schema

export const choiceQuestionSchema = {
  type: 'object',
  properties: {
    type: { enum: ['choice'] },
    instructions: instructionsSchema,
    criteria: { type: 'object', additionalProperties: { type: 'string' }, minProperties: 1 },
  },
  required: ['type', 'criteria'],
  additionalProperties: false,
} as const satisfies Schema

export const scoreQuestionSchema = {
  type: 'object',
  properties: {
    type: { enum: ['score'] },
    instructions: instructionsSchema,
    criteria: { type: 'array', items: { type: 'string' }, minItems: 2 },
  },
  required: ['type', 'criteria'],
  additionalProperties: false,
} as const satisfies Schema

export const noulQuestionSchema = {
  type: 'object',
  properties: {
    type: { enum: ['noul'] },
    instructions: instructionsSchema,
    criteria: {},
  },
  required: ['type'],
  additionalProperties: false,
} as const satisfies Schema

export const questionSchema = {
  anyOf: [choiceQuestionSchema, scoreQuestionSchema, noulQuestionSchema],
} as const satisfies Schema

export const questionMapSchema = {
  type: 'object',
  additionalProperties: questionSchema,
  minProperties: 1,
} as const satisfies Schema

export const stateSchema = {
  anyOf: [{ type: 'string' }, { type: 'object', additionalProperties: true }, { type: 'array' }],
} as const satisfies Schema

export type ChoiceQuestion = FromSchema<typeof choiceQuestionSchema>
export type ScoreQuestion = FromSchema<typeof scoreQuestionSchema>
export type NoulQuestion = FromSchema<typeof noulQuestionSchema>
export type Question = ChoiceQuestion | ScoreQuestion | NoulQuestion
export type QuestionMap = Record<string, Question>
export type State = string | Record<string, unknown> | Array<unknown>

export const choiceAnswerSchema = {
  type: 'object',
  properties: {
    type: { enum: ['choice'] },
    choice: { type: 'string' },
    confidence: { type: 'number' },
    probabilities: { type: 'object', additionalProperties: { type: 'number' } },
  },
  required: ['type', 'choice', 'confidence', 'probabilities'],
  additionalProperties: false,
} as const satisfies Schema

export const scoreAnswerSchema = {
  type: 'object',
  properties: {
    type: { enum: ['score'] },
    score: { type: 'number' },
    confidence: { type: 'number' },
    legend: { type: 'object', additionalProperties: true },
    probabilities: { type: 'object', additionalProperties: { type: 'number' } },
  },
  required: ['type', 'score', 'confidence', 'legend', 'probabilities'],
  additionalProperties: false,
} as const satisfies Schema

export const noulAnswerSchema = {
  type: 'object',
  properties: { type: { enum: ['noul'] }, noul: { type: 'number' } },
  required: ['type', 'noul'],
  additionalProperties: false,
} as const satisfies Schema

export type ChoiceAnswer = FromSchema<typeof choiceAnswerSchema>
export type ScoreAnswer = FromSchema<typeof scoreAnswerSchema>
export type NoulAnswer = FromSchema<typeof noulAnswerSchema>

/** Wire usage: snake_case as returned by the API. Mapped to Usage during validation. */
export const wireUsageSchema = {
  type: 'object',
  properties: { input_tokens: { type: 'integer' }, output_tokens: { type: 'integer' } },
  required: ['input_tokens', 'output_tokens'],
  additionalProperties: true,
} as const satisfies Schema

export type Usage = { inputTokens: number; outputTokens: number }

export const modelMetadataSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    release_date: { type: 'string' },
  },
  required: ['name'],
  additionalProperties: true,
} as const satisfies Schema

export const modelsResponseSchema = {
  type: 'object',
  properties: { models: { type: 'array', items: modelMetadataSchema } },
  required: ['models'],
  additionalProperties: true,
} as const satisfies Schema

export type LayaModel = { name: string; description?: string; releaseDate?: string }

export type AnswerFor<TQuestion> = TQuestion extends ChoiceQuestion
  ? ChoiceAnswer
  : TQuestion extends ScoreQuestion
    ? ScoreAnswer
    : NoulAnswer

export type PredictResult<TQuestions extends QuestionMap> = {
  model: string
  answers: { [K in keyof TQuestions]: AnswerFor<TQuestions[K]> }
  usage: Usage
  extras?: Record<string, unknown>
}
