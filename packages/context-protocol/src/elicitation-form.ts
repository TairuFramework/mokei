export type ElicitFormFieldKind = 'boolean' | 'number' | 'integer' | 'text' | 'choice' | 'multi'
export type ElicitFormChoice = { value: string; label: string }
export type ElicitFormField = {
  name: string
  kind: ElicitFormFieldKind
  required: boolean
  title?: string
  description?: string
  default?: unknown
  format?: string
  pattern?: string
  choices?: Array<ElicitFormChoice>
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
}
export type ElicitFormResult =
  | { ok: true; fields: Array<ElicitFormField> }
  | { ok: false; reason: string }

const COMPOSITION_KEYS = ['$ref', 'allOf', 'anyOf', 'oneOf', 'not']

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

type ChoiceResult = { ok: true; choices: Array<ElicitFormChoice> } | { ok: false; reason: string }

function parseChoices(
  name: string,
  schema: Record<string, unknown>,
  keyword: 'oneOf' | 'anyOf',
): ChoiceResult {
  const fail = (reason: string): ChoiceResult => {
    return { ok: false, reason: `property "${name}" ${reason}` }
  }
  const choices: Array<ElicitFormChoice> = []
  if ('enum' in schema) {
    if (keyword in schema) return fail('has conflicting choices')
    const values = schema.enum
    if (!Array.isArray(values) || !values.every((value) => typeof value === 'string')) {
      return fail('has a non-string enum value')
    }
    const labels = schema.enumNames
    if ('enumNames' in schema) {
      if (!Array.isArray(labels) || !labels.every((label) => typeof label === 'string')) {
        return fail('has invalid enumNames')
      }
      if (labels.length !== values.length) {
        return fail('has an enumNames length different from its enum')
      }
    }
    for (const [index, value] of values.entries()) {
      choices.push({ value, label: Array.isArray(labels) ? labels[index] : value })
    }
  } else {
    const entries = schema[keyword]
    if (!Array.isArray(entries)) return fail(`has an unsupported ${keyword} entry`)
    for (const entry of entries) {
      if (
        !isRecord(entry) ||
        typeof entry.const !== 'string' ||
        (entry.title != null && typeof entry.title !== 'string') ||
        Object.keys(entry).some((key) => !['const', 'title'].includes(key))
      ) {
        return fail(`has an unsupported ${keyword} entry`)
      }
      choices.push({
        value: entry.const,
        label: typeof entry.title === 'string' ? entry.title : entry.const,
      })
    }
  }
  if (choices.length === 0) return fail('has no choices')
  const values = choices.map((choice) => choice.value)
  const labels = choices.map((choice) => choice.label)
  if (
    values.includes('') ||
    labels.includes('') ||
    new Set(values).size !== values.length ||
    new Set(labels).size !== labels.length
  ) {
    return fail('has duplicate or empty choice values or labels')
  }
  return { ok: true, choices }
}

/** Describes the portable elicitation form subset without compiling validators. */
export function elicitFormFields(schema: unknown): ElicitFormResult {
  if (!isRecord(schema) || schema.type !== 'object' || !isRecord(schema.properties)) {
    return { ok: false, reason: 'form is not an object form' }
  }
  const unsupported = COMPOSITION_KEYS.find((key) => key in schema)
  if (unsupported != null) return { ok: false, reason: `form has an unsupported ${unsupported}` }
  const properties = schema.properties
  if (
    schema.required !== undefined &&
    (!Array.isArray(schema.required) ||
      !schema.required.every((name) => {
        return typeof name === 'string' && Object.hasOwn(properties, name)
      }))
  ) {
    return { ok: false, reason: 'form has invalid required properties' }
  }
  const required = new Set(Array.isArray(schema.required) ? schema.required : [])
  const fields: Array<ElicitFormField> = []
  for (const [name, property] of Object.entries(properties)) {
    const fail = (reason: string): ElicitFormResult => {
      return { ok: false, reason: `property "${name}" ${reason}` }
    }
    if (!isRecord(property)) return fail('is not a schema object')
    // String oneOf is the supported titled-choice encoding, not general composition.
    const unsupported = COMPOSITION_KEYS.find((key) => {
      return key in property && !(key === 'oneOf' && property.type === 'string')
    })
    if (unsupported != null) return fail(`has an unsupported ${unsupported}`)
    if ('const' in property) return fail('has an unsupported const')
    if ('pattern' in property) {
      if (typeof property.pattern !== 'string') return fail('has an invalid pattern')
      try {
        new RegExp(property.pattern, 'u')
      } catch {
        return fail('has an invalid pattern')
      }
    }
    let kind: ElicitFormFieldKind
    let choices: Array<ElicitFormChoice> | undefined
    if (property.type === 'string') {
      kind = 'text'
      if ('enum' in property || 'oneOf' in property) {
        const result = parseChoices(name, property, 'oneOf')
        if (!result.ok) return result
        kind = 'choice'
        choices = result.choices
      }
    } else if (property.type === 'array') {
      const items = property.items
      if (
        !isRecord(items) ||
        (items.type !== undefined && items.type !== 'string') ||
        ['$ref', 'allOf', 'oneOf', 'not', 'const'].some((key) => key in items) ||
        (!('enum' in items) && !('anyOf' in items)) ||
        'enum' in property
      ) {
        return fail('has an unsupported kind')
      }
      const result = parseChoices(name, items, 'anyOf')
      if (!result.ok) return result
      kind = 'multi'
      choices = result.choices
    } else if (
      property.type === 'boolean' ||
      property.type === 'number' ||
      property.type === 'integer'
    ) {
      if ('enum' in property) return fail('has an unsupported enum')
      kind = property.type
    } else {
      return fail('has an unsupported kind')
    }
    const field: ElicitFormField = { name, kind, required: required.has(name) }
    for (const key of ['title', 'description', 'format', 'pattern'] as const) {
      if (typeof property[key] === 'string') field[key] = property[key]
    }
    for (const key of ['minimum', 'maximum', 'minLength', 'maxLength'] as const) {
      if (typeof property[key] === 'number') field[key] = property[key]
    }
    if ('default' in property) field.default = property.default
    if (choices != null) field.choices = choices
    fields.push(field)
  }
  return { ok: true, fields }
}
