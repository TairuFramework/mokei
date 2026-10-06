import type { ElicitRequest } from '@mokei/context-protocol'
import { canonicalize } from '@sozai/json'
import {
  createValidatorFactory,
  type Schema,
  ValidationError,
  type ValidationErrorObject,
  type Validator,
  type ValidatorFactory,
} from '@sozai/schema'

export type RequestedSchema = Extract<
  ElicitRequest['params'],
  { requestedSchema: unknown }
>['requestedSchema']

const CHOICE_MESSAGE = 'must be one of the offered choices'
const FORMAT_MESSAGES: Record<string, string> = {
  email: 'must be an email address',
  uri: 'must be a URI, such as https://example.com',
  date: 'must be a date, such as 2024-01-31',
  'date-time': 'must be a date and time, such as 2024-01-31T10:00:00Z',
}

const FORMATS = new Set(['email', 'uri', 'date', 'date-time'])
const CACHE_LIMIT = 64
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
export function elicitPropertyValidationSchema(schema: unknown): SchemaObject | false {
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
  // fromEntries defines own properties, so a property named __proto__ stays a property
  const properties: Record<string, SchemaObject | false> = Object.fromEntries(
    Object.entries(schema.properties ?? {}).map(([name, property]) => {
      return [name, elicitPropertyValidationSchema(property)]
    }),
  )
  const required: Array<unknown> = Array.isArray(schema.required) ? schema.required : []
  return {
    type: 'object',
    properties,
    required: required.filter((name): name is string => typeof name === 'string'),
    additionalProperties: false,
  }
}

/** Distinct compiles on one factory before it is disposed and replaced. */
const MAX_COMPILES = 256

/**
 * Compiled validators (or the compile error) by the canonical JSON of the whitelisted schema,
 * least recently used first. Repeated forms reuse one compile. Validators come from an isolated
 * factory instead of the AJV instance `@sozai/schema` shares process-wide, whose code-gen scope
 * keeps every compiled function for the life of the process. The factory is disposed and
 * replaced after MAX_COMPILES distinct compiles, and the cache is cleared with it; validators
 * handed out earlier keep working.
 */
const compiled = new Map<string, Validator<unknown> | Error>()
let factory: ValidatorFactory | undefined
let generation = 0
let compiles = 0

export type ElicitValidator = Validator<unknown>

export function elicitCompile(schema: SchemaObject | false): ElicitValidator {
  // Schemas always serialize, so canonicalize never returns undefined here.
  const key = canonicalize(schema) as string
  let entry = compiled.get(key)
  if (entry == null) {
    if (factory !== undefined && compiles >= MAX_COMPILES) {
      factory.dispose()
      factory = undefined
      compiled.clear()
      compiles = 0
      generation += 1
    }
    factory ??= createValidatorFactory({ draft: '2020-12', strict: false })
    try {
      entry = factory.createValidator(schema as unknown as Schema) as Validator<unknown>
    } catch (error) {
      entry = error instanceof Error ? error : new Error(String(error))
    }
    compiles += 1
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

export function elicitValidatorStats(): { generation: number; compiles: number; entries: number } {
  return { generation, compiles, entries: compiled.size }
}

/** Reset the cache and factory. Tests only. */
export function resetElicitValidators(): void {
  factory?.dispose()
  factory = undefined
  generation = 0
  compiles = 0
  compiled.clear()
}

export function elicitIssuesOf(
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
export function elicitDescribeIssue(issue: ValidationErrorObject): string {
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
    return { name: '', text: `content ${elicitDescribeIssue(issue)}` }
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
  return { name, text: elicitDescribeIssue(issue) }
}

export type ElicitContentValidator = (content: unknown) => Array<string>

/**
 * Compiles a validator for elicitation content, returning issues as `name: problem` (empty
 * means valid). A schema that cannot be compiled gives a validator reporting that as its one
 * issue, so it is caught when the validator is created, not when an answer arrives.
 */
export function createElicitContentValidator(schema: RequestedSchema): ElicitContentValidator {
  let validator: Validator<unknown>
  try {
    validator = elicitCompile(contentValidationSchema(schema))
  } catch (error) {
    const issue = `the requested schema cannot be validated: ${elicitMessageOf(error)}`
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
    for (const issue of elicitIssuesOf(validator, record)) {
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

/** Converts a thrown validation error into a readable message. */
export function elicitMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Validates elicitation content against the requested schema. Empty result means valid. */
export function validateElicitContent(schema: RequestedSchema, content: unknown): Array<string> {
  return createElicitContentValidator(schema)(content)
}
