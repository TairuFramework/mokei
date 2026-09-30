import type { ElicitRequest } from '@mokei/context-protocol'
import {
  createValidator,
  type Schema,
  ValidationError,
  type ValidationErrorObject,
  type Validator,
} from '@sozai/schema'

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
const CHOICE_MESSAGE = 'must be one of the offered choices'
const FORMAT_MESSAGES: Record<string, string> = {
  email: 'must be an email address',
  uri: 'must be a URI, such as https://example.com',
  date: 'must be a date, such as 2024-01-31',
  'date-time': 'must be a date and time, such as 2024-01-31T10:00:00Z',
}

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

const validators = new WeakMap<object, Validator<unknown>>()

/**
 * Compiles `schema` with AJV once per schema object. MCP elicitation schemas use the 2020-12
 * dialect, so a `$schema` is dropped. The compiled copy gets a unique `$id`, which lets
 * `@sozai/schema` remove it from AJV's shared cache (a schema without one would stay forever).
 */
function validatorFor(schema: object, extra: Record<string, unknown> = {}): Validator<unknown> {
  let validator = validators.get(schema)
  if (validator == null) {
    const { $schema: _schema, $id: _id, ...rest } = schema as Record<string, unknown>
    validator = createValidator(
      { ...rest, ...extra, $id: `urn:uuid:${crypto.randomUUID()}` } as Schema,
      { draft: '2020-12', strict: false },
    )
    validators.set(schema, validator)
  }
  return validator
}

function issuesOf(
  validator: Validator<unknown>,
  value: unknown,
): ReadonlyArray<ValidationErrorObject> {
  const result = validator(value)
  return result instanceof ValidationError ? result.issues : []
}

/** A message a person can act on, for one AJV issue about a property value. */
function describeIssue(issue: ValidationErrorObject): string {
  const { keyword, params, message } = issue.details
  switch (keyword) {
    case 'type':
      if (params.type === 'integer') return 'must be a whole number'
      return `must be a ${params.type}`
    case 'minLength':
      return `must be at least ${params.limit} ${params.limit === 1 ? 'character' : 'characters'}`
    case 'maxLength':
      return `must be at most ${params.limit} ${params.limit === 1 ? 'character' : 'characters'}`
    case 'pattern':
      return `must match the pattern ${params.pattern}`
    case 'format':
      return FORMAT_MESSAGES[params.format] ?? `must be a valid ${params.format}`
    case 'minimum':
      return `must be at least ${params.limit}`
    case 'maximum':
      return `must be at most ${params.limit}`
    case 'exclusiveMinimum':
      return `must be greater than ${params.limit}`
    case 'exclusiveMaximum':
      return `must be less than ${params.limit}`
    case 'enum':
    case 'const':
    case 'anyOf':
    case 'oneOf':
      return CHOICE_MESSAGE
    default:
      return message ?? `does not satisfy ${keyword}`
  }
}

/** The first violation of a single property value, or undefined when it is valid. */
function checkValue(schema: PrimitiveSchemaDefinition, value: unknown): string | undefined {
  const [issue] = issuesOf(validatorFor(schema), value)
  return issue == null ? undefined : describeIssue(issue)
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
        : { ok: false, violation: CHOICE_MESSAGE }
    }
    if (!required && answer === '') return { ok: true }
    if (shape.numeric) {
      const value = Number(answer)
      if (answer.trim() === '' || Number.isNaN(value)) {
        return { ok: false, violation: 'must be a number' }
      }
      const violation = checkValue(schema, value)
      return violation == null ? { ok: true, value } : { ok: false, violation }
    }
    const violation = checkValue(schema, answer)
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

/** Describes one issue with elicitation content, with the property it is about ('' for none). */
function describeContentIssue(
  issue: ValidationErrorObject,
  content: Record<string, unknown>,
): { name: string; text: string } {
  const { keyword, params } = issue.details
  const [name, index] = issue.path
  if (name == null) {
    if (keyword === 'required') return { name: params.missingProperty, text: 'required' }
    if (keyword === 'additionalProperties') {
      return { name: params.additionalProperty, text: 'unknown property' }
    }
    return { name: '', text: `content ${describeIssue(issue)}` }
  }
  if (index != null) {
    // An item of a multi-select array
    if (keyword === 'type') return { name, text: 'must be an array of strings' }
    const item = (content[name] as Array<unknown>)[Number(index)]
    return { name, text: `${JSON.stringify(item)} is not an offered choice` }
  }
  if (keyword === 'type' && params.type === 'array') {
    return { name, text: 'must be an array of strings' }
  }
  return { name, text: describeIssue(issue) }
}

/** Validates elicitation content against the requested schema. Empty result means valid. */
export function validateContent(schema: RequestedSchema, content: unknown): Array<string> {
  if (content == null || typeof content !== 'object' || Array.isArray(content)) {
    return ['content must be an object']
  }
  // A key holding `undefined` is absent once serialised; validate it as absent
  const record = Object.fromEntries(
    Object.entries(content as Record<string, unknown>).filter(([, value]) => value !== undefined),
  )
  let issues: ReadonlyArray<ValidationErrorObject>
  try {
    issues = issuesOf(validatorFor(schema, { additionalProperties: false }), record)
  } catch (error) {
    return [`the requested schema cannot be validated: ${(error as Error).message}`]
  }
  // One problem per property, the first AJV reports
  const byName = new Map<string, string>()
  for (const issue of issues) {
    const described = describeContentIssue(issue, record)
    if (!byName.has(described.name)) {
      byName.set(
        described.name,
        described.name === '' ? described.text : `${described.name}: ${described.text}`,
      )
    }
  }
  return [...byName.values()]
}

/** Returns the request with the violation on the first line of its text. */
export function withViolation(ask: AskRequest, violation: string): AskRequest {
  return { ...ask, text: `${violation}\n${ask.text}` }
}
