import { type ElicitFormField, type ElicitRequest, elicitFormFields } from '@mokei/context-protocol'
import {
  type ElicitValidator,
  elicitCompile,
  elicitDescribeIssue,
  elicitIssuesOf,
  elicitMessageOf,
  elicitPropertyValidationSchema,
  type RequestedSchema,
} from '@mokei/host'

import type { AskRequest } from './backends/types.js'

export type FormParams = Extract<ElicitRequest['params'], { requestedSchema: unknown }>
export type { RequestedSchema }
export type PrimitiveSchemaDefinition = RequestedSchema['properties'][string]

export type FieldPlan = {
  name: string
  required: boolean
  schema: PrimitiveSchemaDefinition
  ask: AskRequest
  toValue(
    answer: string | boolean,
  ): { ok: true; value?: string | number | boolean } | { ok: false; violation: string }
}
export type FormPlan = { ok: true; fields: Array<FieldPlan> } | { ok: false; reason: string }

const MAX_PROPERTIES = 10
const CHOICE_MESSAGE = 'must be one of the offered choices'
const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/
const NUMBER_MESSAGE = 'must be a number, such as 42 or 3.5'
function defaultFor(field: ElicitFormField): string | undefined {
  const value = field.default
  if (value == null) return undefined
  if (field.kind === 'boolean') return value === true ? 'yes' : value === false ? 'no' : undefined
  if (field.kind === 'choice') {
    return typeof value === 'string' && field.choices?.some((choice) => choice.value === value)
      ? value
      : undefined
  }
  return String(value)
}

function planField(
  field: ElicitFormField,
  schema: PrimitiveSchemaDefinition,
  intro: Array<string>,
  appName: string,
  validator: ElicitValidator,
): FieldPlan {
  const { name, required } = field
  const text = [...intro, field.title ?? name, field.description].filter(isNonEmpty).join('\n')
  const kind = field.kind === 'boolean' ? 'confirm' : field.kind === 'choice' ? 'choice' : 'text'
  const ask: AskRequest = { kind, title: appName, text }
  const def = defaultFor(field)
  if (def != null) ask.default = def
  if (field.kind === 'choice') ask.choices = field.choices

  const toValue: FieldPlan['toValue'] = (answer) => {
    if (field.kind === 'boolean') {
      return typeof answer === 'boolean'
        ? { ok: true, value: answer }
        : { ok: false, violation: 'must be yes or no' }
    }
    if (typeof answer !== 'string') return { ok: false, violation: 'must be text' }
    if (field.kind === 'choice') {
      return field.choices?.some((c) => c.value === answer)
        ? { ok: true, value: answer }
        : { ok: false, violation: CHOICE_MESSAGE }
    }
    if (!required && answer === '') return { ok: true }
    let value: string | number = answer
    if (field.kind === 'number' || field.kind === 'integer') {
      // Plain decimal notation only: no hex, binary, separators or Infinity
      const text = answer.trim()
      value = Number(text)
      if (!DECIMAL.test(text) || !Number.isFinite(value)) {
        return { ok: false, violation: NUMBER_MESSAGE }
      }
    }
    const [issue] = elicitIssuesOf(validator, value)
    return issue == null
      ? { ok: true, value }
      : { ok: false, violation: elicitDescribeIssue(issue) }
  }
  return { name, required, schema, ask, toValue }
}

function isNonEmpty(value: string | undefined): value is string {
  return value != null && value !== ''
}

export function planForm(
  params: FormParams,
  options: { appName: string; source: string },
): FormPlan {
  const parsed = elicitFormFields(params.requestedSchema)
  if (!parsed.ok) return parsed
  const properties = params.requestedSchema.properties
  if (parsed.fields.length > MAX_PROPERTIES) {
    return { ok: false, reason: `form has more than ${MAX_PROPERTIES} properties` }
  }
  const intro = [options.source, params.message].filter(isNonEmpty)
  const fields: Array<FieldPlan> = []
  for (const field of parsed.fields) {
    const { name } = field
    const schema = properties[name] as PrimitiveSchemaDefinition
    if (field.kind === 'multi') {
      return { ok: false, reason: `property "${name}" has an unsupported kind` }
    }
    // Compiled now, so a schema AJV cannot compile is declined before any dialog opens
    let validator: ElicitValidator
    try {
      validator = elicitCompile(elicitPropertyValidationSchema(schema))
    } catch (error) {
      return {
        ok: false,
        reason: `property "${name}" cannot be validated: ${elicitMessageOf(error)}`,
      }
    }
    fields.push(planField(field, schema, intro, options.appName, validator))
  }
  return { ok: true, fields }
}

/** Returns the request with the violation on the first line of its text. */
export function withViolation(ask: AskRequest, violation: string): AskRequest {
  return { ...ask, text: `${violation}\n${ask.text}` }
}
