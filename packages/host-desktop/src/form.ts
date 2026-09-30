import type { ElicitRequest } from '@mokei/context-protocol'

import type { AskRequest } from './backends/types.js'

export type FormParams = Extract<ElicitRequest['params'], { requestedSchema: unknown }>
export type RequestedSchema = FormParams['requestedSchema']
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
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/

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
  minLength?: number
  maxLength?: number
  pattern?: string
  format?: string
  minimum?: number
  maximum?: number
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

function isValidDate(value: string): boolean {
  const match = DATE.exec(value)
  if (match == null) return false
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

function checkFormat(format: string, value: string): boolean {
  switch (format) {
    case 'email':
      return EMAIL.test(value)
    case 'uri':
      return URL.canParse(value)
    case 'date':
      return isValidDate(value)
    case 'date-time':
      return value.includes('T') && !Number.isNaN(Date.parse(value))
    default:
      return true
  }
}

function checkString(schema: Loose, value: string): string | undefined {
  // JSON Schema lengths count code points, not UTF-16 units
  const length = [...value].length
  if (schema.minLength != null && length < schema.minLength) {
    return `must satisfy minLength ${schema.minLength}`
  }
  if (schema.maxLength != null && length > schema.maxLength) {
    return `must satisfy maxLength ${schema.maxLength}`
  }
  if (schema.pattern != null) {
    let matches = false
    try {
      matches = new RegExp(`^(?:${schema.pattern})$`, 'u').test(value)
    } catch {
      // Unusable pattern, planForm rejects these up front.
    }
    if (!matches) return `must match pattern ${schema.pattern}`
  }
  if (schema.format != null && !checkFormat(schema.format, value)) {
    return `must satisfy format ${schema.format}`
  }
}

function checkNumber(schema: Loose, value: number): string | undefined {
  if (schema.type === 'integer' && !Number.isInteger(value)) return 'must be an integer'
  if (schema.minimum != null && value < schema.minimum) {
    return `must satisfy minimum ${schema.minimum}`
  }
  if (schema.maximum != null && value > schema.maximum) {
    return `must satisfy maximum ${schema.maximum}`
  }
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
        : { ok: false, violation: 'must be one of the offered choices' }
    }
    if (!required && answer === '') return { ok: true }
    if (shape.numeric) {
      const value = Number(answer)
      if (answer.trim() === '' || Number.isNaN(value)) {
        return { ok: false, violation: 'must be a number' }
      }
      const violation = checkNumber(s, value)
      return violation == null ? { ok: true, value } : { ok: false, violation }
    }
    const violation = checkString(s, answer)
    return violation == null ? { ok: true, value: answer } : { ok: false, violation }
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
    fields.push(planField(name, schema, shape, required.has(name), intro, options.appName))
  }
  return { ok: true, fields }
}

function validateValue(
  name: string,
  schema: PrimitiveSchemaDefinition,
  value: unknown,
): string | undefined {
  const s = loose(schema)
  const fail = (message: string) => `${name}: ${message}`
  if (s.type === 'array') {
    const allowed = s.items?.enum ?? s.items?.anyOf?.map((o) => o.const) ?? []
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
      return fail('must be an array of strings')
    }
    const unknown = (value as Array<string>).find((item) => !allowed.includes(item))
    return unknown == null ? undefined : fail(`"${unknown}" is not an offered choice`)
  }
  if (s.type === 'boolean')
    return typeof value === 'boolean' ? undefined : fail('must be a boolean')
  if (s.type === 'number' || s.type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fail('must be a number')
    const violation = checkNumber(s, value)
    return violation == null ? undefined : fail(violation)
  }
  if (s.type === 'string') {
    if (typeof value !== 'string') return fail('must be a string')
    const choices = s.oneOf?.map((o) => o.const) ?? s.enum
    if (choices != null && !choices.includes(value))
      return fail('must be one of the offered choices')
    const violation = checkString(s, value)
    return violation == null ? undefined : fail(violation)
  }
  return fail('has an unsupported kind')
}

/** Validates elicitation content against the requested schema. Empty result means valid. */
export function validateContent(schema: RequestedSchema, content: unknown): Array<string> {
  if (content == null || typeof content !== 'object' || Array.isArray(content)) {
    return ['content must be an object']
  }
  const record = content as Record<string, unknown>
  const issues: Array<string> = []
  for (const key of Object.keys(record)) {
    if (!Object.hasOwn(schema.properties, key)) issues.push(`${key}: unknown property`)
  }
  for (const key of schema.required ?? []) {
    if (record[key] === undefined) issues.push(`${key}: required`)
  }
  for (const [key, value] of Object.entries(record)) {
    if (!Object.hasOwn(schema.properties, key) || value === undefined) continue
    const issue = validateValue(key, schema.properties[key] as PrimitiveSchemaDefinition, value)
    if (issue != null) issues.push(issue)
  }
  return issues
}

/** Returns the request with the violation on the first line of its text. */
export function withViolation(ask: AskRequest, violation: string): AskRequest {
  return { ...ask, text: `${violation}\n${ask.text}` }
}
