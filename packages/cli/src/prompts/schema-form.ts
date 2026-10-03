export class UnsupportedSchemaError extends Error {
  constructor(reason: string) {
    super(`${reason}; pass the answer with --value instead`)
    this.name = 'UnsupportedSchemaError'
  }
}

export type FormFieldKind = 'boolean' | 'select' | 'text' | 'number' | 'integer'

export type FormField = {
  key: string
  label: string
  kind: FormFieldKind
  required: boolean
  default?: unknown
  options?: Array<{ label: string; value: string }>
  min?: number
  max?: number
  minLength?: number
  maxLength?: number
}

export type FieldValidation = { value?: unknown; error?: string; skip?: boolean }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function parseOptions(key: string, prop: Record<string, unknown>): FormField['options'] {
  if (Array.isArray(prop.enum)) {
    const names = Array.isArray(prop.enumNames) ? prop.enumNames : []
    return prop.enum.map((value, index) => {
      if (typeof value !== 'string') {
        throw new UnsupportedSchemaError(`Property "${key}" has a non-string enum value`)
      }
      const name = names[index]
      return { label: typeof name === 'string' ? name : value, value }
    })
  }
  if (Array.isArray(prop.oneOf)) {
    return prop.oneOf.map((entry) => {
      if (!isRecord(entry) || typeof entry.const !== 'string') {
        throw new UnsupportedSchemaError(`Property "${key}" has an unsupported oneOf entry`)
      }
      return {
        label: typeof entry.title === 'string' ? entry.title : entry.const,
        value: entry.const,
      }
    })
  }
  return undefined
}

/** Converts an elicitation form schema into ordered form fields. */
export function parseElicitationForm(schema: Record<string, unknown>): Array<FormField> {
  if (schema.type !== 'object' || !isRecord(schema.properties)) {
    throw new UnsupportedSchemaError('The requested schema is not an object form')
  }
  const required = new Set(
    Array.isArray(schema.required) ? schema.required.filter((k) => typeof k === 'string') : [],
  )
  return Object.entries(schema.properties).map(([key, prop]) => {
    if (!isRecord(prop)) {
      throw new UnsupportedSchemaError(`Property "${key}" is not a schema object`)
    }
    const base = {
      key,
      label: typeof prop.title === 'string' ? prop.title : key,
      required: required.has(key),
      ...(prop.default !== undefined ? { default: prop.default } : {}),
    }
    switch (prop.type) {
      case 'boolean':
        return { ...base, kind: 'boolean' } satisfies FormField
      case 'number':
      case 'integer':
        return {
          ...base,
          kind: prop.type,
          min: numberOf(prop.minimum),
          max: numberOf(prop.maximum),
        } satisfies FormField
      case 'string': {
        const options = parseOptions(key, prop)
        if (options != null) return { ...base, kind: 'select', options } satisfies FormField
        return {
          ...base,
          kind: 'text',
          minLength: numberOf(prop.minLength),
          maxLength: numberOf(prop.maxLength),
        } satisfies FormField
      }
      default:
        throw new UnsupportedSchemaError(
          `Property "${key}" has unsupported type ${JSON.stringify(prop.type)}`,
        )
    }
  })
}

/** Validates raw text entered for a field. */
export function validateFieldInput(field: FormField, raw: string): FieldValidation {
  if (raw === '') {
    if (field.default !== undefined) return { value: field.default }
    if (field.required) return { error: `${field.label} is required` }
    return { skip: true }
  }
  switch (field.kind) {
    case 'number':
    case 'integer': {
      if (raw.trim() === '') return { error: `${field.label} must be a number` }
      const value = Number(raw)
      if (!Number.isFinite(value)) return { error: `${field.label} must be a number` }
      if (field.kind === 'integer' && !Number.isInteger(value)) {
        return { error: `${field.label} must be an integer` }
      }
      if (field.min != null && value < field.min) {
        return { error: `${field.label} must be at least ${field.min}` }
      }
      if (field.max != null && value > field.max) {
        return { error: `${field.label} must be at most ${field.max}` }
      }
      return { value }
    }
    case 'select':
      return field.options?.some((o) => o.value === raw)
        ? { value: raw }
        : { error: `${field.label} must be one of the listed options` }
    case 'boolean': {
      const lower = raw.toLowerCase()
      if (lower === 'y' || lower === 'true') return { value: true }
      if (lower === 'n' || lower === 'false') return { value: false }
      return { error: `${field.label} must be yes or no` }
    }
    default:
      if (field.minLength != null && [...raw].length < field.minLength) {
        return { error: `${field.label} must be at least ${field.minLength} characters` }
      }
      if (field.maxLength != null && [...raw].length > field.maxLength) {
        return { error: `${field.label} must be at most ${field.maxLength} characters` }
      }
      return { value: raw }
  }
}
