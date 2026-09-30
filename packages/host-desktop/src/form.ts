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

const FORMATS = new Set(['email', 'uri', 'date', 'date-time'])
const CACHE_LIMIT = 64
const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/
const NUMBER_MESSAGE = 'must be a number, such as 42 or 3.5'

type SchemaObject = Record<string, unknown>

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function stringList(value: unknown): Array<string> | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? [...value]
    : undefined
}

function constList(value: unknown): Array<string> | undefined {
  if (!Array.isArray(value)) return undefined
  return stringList(value.map((item) => (item as { const?: unknown } | null)?.const))
}

/**
 * The part of a server property schema that validation compiles: only the keywords MCP
 * elicitation primitives allow, each with a value of the right type. Everything else (`$ref`,
 * `not`, `allOf`, unknown formats, a `minLength` that is not a count...) is dropped, as the
 * dialogs ignore it. `false` (nothing is valid) for a kind no primitive has.
 */
function propertyValidationSchema(schema: unknown): SchemaObject | false {
  if (schema == null || typeof schema !== 'object') return false
  const s = schema as SchemaObject
  switch (s.type) {
    case 'boolean':
      return { type: 'boolean' }
    case 'number':
    case 'integer': {
      const out: SchemaObject = { type: s.type }
      if (isFiniteNumber(s.minimum)) out.minimum = s.minimum
      if (isFiniteNumber(s.maximum)) out.maximum = s.maximum
      return out
    }
    case 'string': {
      if (s.oneOf != null || s.enum != null) {
        const values = s.oneOf != null ? constList(s.oneOf) : stringList(s.enum)
        return values == null ? false : { type: 'string', enum: values }
      }
      const out: SchemaObject = { type: 'string' }
      if (isCount(s.minLength)) out.minLength = s.minLength
      if (isCount(s.maxLength)) out.maxLength = s.maxLength
      if (typeof s.pattern === 'string') out.pattern = s.pattern
      if (typeof s.format === 'string' && FORMATS.has(s.format)) out.format = s.format
      return out
    }
    case 'array': {
      const items = (s.items ?? {}) as SchemaObject
      const values = items.enum != null ? stringList(items.enum) : constList(items.anyOf)
      if (values == null) return false
      const out: SchemaObject = { type: 'array', items: { type: 'string', enum: values } }
      if (isCount(s.minItems)) out.minItems = s.minItems
      if (isCount(s.maxItems)) out.maxItems = s.maxItems
      if (typeof s.uniqueItems === 'boolean') out.uniqueItems = s.uniqueItems
      return out
    }
    default:
      return false
  }
}

function contentValidationSchema(schema: RequestedSchema): SchemaObject {
  const properties: Record<string, SchemaObject | false> = {}
  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    properties[name] = propertyValidationSchema(property)
  }
  return {
    type: 'object',
    properties,
    required: stringList(schema.required) ?? [],
    additionalProperties: false,
  }
}

/**
 * Compiled validators (or the compile error) by the canonical JSON of the whitelisted schema,
 * least recently used first. Repeated forms reuse one compile: `@sozai/schema` shares one AJV
 * instance, whose code-gen scope keeps every compiled function for the life of the process.
 */
const compiled = new Map<string, Validator<unknown> | Error>()

function compile(schema: SchemaObject | false): Validator<unknown> {
  const key = JSON.stringify(schema)
  let entry = compiled.get(key)
  if (entry == null) {
    try {
      entry = createValidator(schema as unknown as Schema, { draft: '2020-12', strict: false })
    } catch (error) {
      entry = error instanceof Error ? error : new Error(String(error))
    }
    if (compiled.size >= CACHE_LIMIT) {
      compiled.delete(compiled.keys().next().value as string)
    }
  } else {
    compiled.delete(key)
  }
  compiled.set(key, entry)
  if (entry instanceof Error) throw entry
  return entry
}

function issuesOf(
  validator: Validator<unknown>,
  value: unknown,
): ReadonlyArray<ValidationErrorObject> {
  const result = validator(value)
  return result instanceof ValidationError ? result.issues : []
}

function plural(count: number, word: string): string {
  return `${count} ${count === 1 ? word : `${word}s`}`
}

/** A message a person can act on, for one AJV issue about a property value. */
function describeIssue(issue: ValidationErrorObject): string {
  const { keyword, params, message } = issue.details
  switch (keyword) {
    case 'type':
      if (params.type === 'integer') return 'must be a whole number'
      return `must be a ${[params.type].flat().join(' or ')}`
    case 'minLength':
      return `must be at least ${plural(params.limit, 'character')}`
    case 'maxLength':
      return `must be at most ${plural(params.limit, 'character')}`
    case 'minItems':
      return `choose at least ${plural(params.limit, 'option')}`
    case 'maxItems':
      return `choose at most ${plural(params.limit, 'option')}`
    case 'uniqueItems':
      return 'choose each option only once'
    case 'false schema':
      return 'has an unsupported kind'
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
  validator: Validator<unknown>,
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
    const [issue] = issuesOf(validator, value)
    return issue == null ? { ok: true, value } : { ok: false, violation: describeIssue(issue) }
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
    let validator: Validator<unknown>
    try {
      validator = compile(propertyValidationSchema(schema))
    } catch (error) {
      return { ok: false, reason: `property "${name}" cannot be validated: ${messageOf(error)}` }
    }
    fields.push(
      planField(name, schema, shape, required.has(name), intro, options.appName, validator),
    )
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

export type ContentValidator = (content: unknown) => Array<string>

/**
 * Compiles a validator for elicitation content, returning issues as `name: problem` (empty
 * means valid). A schema that cannot be compiled gives a validator reporting that as its one
 * issue, so it is caught when the validator is created, not when an answer arrives.
 */
export function createContentValidator(schema: RequestedSchema): ContentValidator {
  let validator: Validator<unknown>
  try {
    validator = compile(contentValidationSchema(schema))
  } catch (error) {
    const issue = `the requested schema cannot be validated: ${messageOf(error)}`
    return () => [issue]
  }
  return (content) => {
    if (content == null || typeof content !== 'object' || Array.isArray(content)) {
      return ['content must be an object']
    }
    // A key holding `undefined` is absent once serialised; validate it as absent
    const record = Object.fromEntries(
      Object.entries(content as Record<string, unknown>).filter(([, value]) => value !== undefined),
    )
    // One problem per property, the first AJV reports
    const byName = new Map<string, string>()
    for (const issue of issuesOf(validator, record)) {
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
}

/** Validates elicitation content against the requested schema. Empty result means valid. */
export function validateContent(schema: RequestedSchema, content: unknown): Array<string> {
  return createContentValidator(schema)(content)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Returns the request with the violation on the first line of its text. */
export function withViolation(ask: AskRequest, violation: string): AskRequest {
  return { ...ask, text: `${violation}\n${ask.text}` }
}
