import type { ElicitRequest } from '@mokei/context-protocol'
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
type Choice = { value: string; label: string }

/** Loose view over the schema union, narrowed by `describeProperty`. */
type Loose = {
  type?: string
  title?: string
  description?: string
  default?: unknown
  enum?: Array<string>
  enumNames?: Array<string>
  oneOf?: Array<{ const: string; title?: string }>
  items?: { enum?: Array<string>; anyOf?: Array<{ const: string }> }
  pattern?: string
}

type Shape =
  | { kind: 'text'; numeric: boolean }
  | { kind: 'confirm' }
  | { kind: 'choice'; choices: Array<Choice> }
  | { kind: 'multi'; values: Array<string> }

function loose(schema: PrimitiveSchemaDefinition): Loose {
  return schema as unknown as Loose
}

function hasDuplicateOrEmpty(items: Array<string>): boolean {
  return items.some((item) => item === '') || new Set(items).size !== items.length
}

function buildChoices(name: string, schema: Loose): Array<Choice> | string {
  let choices: Array<Choice>
  if (schema.oneOf != null) {
    choices = schema.oneOf.map((o) => ({ value: o.const, label: o.title ?? o.const }))
  } else {
    const values = schema.enum ?? []
    if (schema.enumNames != null && schema.enumNames.length !== values.length) {
      return `property "${name}" has an enumNames length different from its enum`
    }
    choices = values.map((value, i) => ({ value, label: schema.enumNames?.[i] ?? value }))
  }
  if (choices.length === 0) return `property "${name}" has no choices`
  if (
    hasDuplicateOrEmpty(choices.map((c) => c.value)) ||
    hasDuplicateOrEmpty(choices.map((c) => c.label))
  ) {
    return `property "${name}" has duplicate or empty choice values or labels`
  }
  return choices
}

function describeProperty(name: string, schema: PrimitiveSchemaDefinition): Shape | string {
  const s = loose(schema)
  if (s.type === 'array') {
    const values = s.items?.enum ?? s.items?.anyOf?.map((o) => o.const)
    return values == null ? `property "${name}" has an unsupported kind` : { kind: 'multi', values }
  }
  if (s.type === 'boolean') return { kind: 'confirm' }
  if (s.type === 'number' || s.type === 'integer') return { kind: 'text', numeric: true }
  if (s.type === 'string') {
    if (s.oneOf != null || s.enum != null) {
      const choices = buildChoices(name, s)
      return typeof choices === 'string' ? choices : { kind: 'choice', choices }
    }
    if (s.pattern != null) {
      try {
        new RegExp(s.pattern, 'u')
      } catch {
        return `property "${name}" has an invalid pattern`
      }
    }
    return { kind: 'text', numeric: false }
  }
  return `property "${name}" has an unsupported kind`
}

function defaultFor(shape: Shape, schema: Loose): string | undefined {
  const value = schema.default
  if (value == null) return undefined
  if (shape.kind === 'confirm') return value === true ? 'yes' : value === false ? 'no' : undefined
  if (shape.kind === 'choice') {
    return typeof value === 'string' && shape.choices.some((c) => c.value === value)
      ? value
      : undefined
  }
  return shape.kind === 'text' ? String(value) : undefined
}

function planField(
  name: string,
  schema: PrimitiveSchemaDefinition,
  shape: Exclude<Shape, { kind: 'multi' }>,
  required: boolean,
  intro: Array<string>,
  appName: string,
  validator: ElicitValidator,
): FieldPlan {
  const s = loose(schema)
  const text = [...intro, s.title ?? name, s.description].filter(isNonEmpty).join('\n')
  const ask: AskRequest = { kind: shape.kind, title: appName, text }
  const def = defaultFor(shape, s)
  if (def != null) ask.default = def
  if (shape.kind === 'choice') ask.choices = shape.choices

  const toValue: FieldPlan['toValue'] = (answer) => {
    if (shape.kind === 'confirm') {
      return typeof answer === 'boolean'
        ? { ok: true, value: answer }
        : { ok: false, violation: 'must be yes or no' }
    }
    if (typeof answer !== 'string') return { ok: false, violation: 'must be text' }
    if (shape.kind === 'choice') {
      return shape.choices.some((c) => c.value === answer)
        ? { ok: true, value: answer }
        : { ok: false, violation: CHOICE_MESSAGE }
    }
    if (!required && answer === '') return { ok: true }
    let value: string | number = answer
    if (shape.numeric) {
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
  const properties = params.requestedSchema.properties
  const names = Object.keys(properties)
  if (names.length > MAX_PROPERTIES) {
    return { ok: false, reason: `form has more than ${MAX_PROPERTIES} properties` }
  }
  const required = new Set(params.requestedSchema.required ?? [])
  const intro = [options.source, params.message].filter(isNonEmpty)
  const fields: Array<FieldPlan> = []
  for (const name of names) {
    const schema = properties[name] as PrimitiveSchemaDefinition
    const shape = describeProperty(name, schema)
    if (typeof shape === 'string' || shape.kind === 'multi') {
      return {
        ok: false,
        reason: typeof shape === 'string' ? shape : `property "${name}" has an unsupported kind`,
      }
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
    fields.push(
      planField(name, schema, shape, required.has(name), intro, options.appName, validator),
    )
  }
  return { ok: true, fields }
}

/** Returns the request with the violation on the first line of its text. */
export function withViolation(ask: AskRequest, violation: string): AskRequest {
  return { ...ask, text: `${violation}\n${ask.text}` }
}
