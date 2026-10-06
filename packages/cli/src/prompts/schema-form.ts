import { type ElicitFormField, elicitFormFields } from '@mokei/context-protocol'

export type UnsupportedSchemaErrorParams = { reason: string }

export class UnsupportedSchemaError extends Error {
  constructor(params: UnsupportedSchemaErrorParams) {
    super(`${params.reason}; pass the answer with --value instead`)
    this.name = 'UnsupportedSchemaError'
  }
}

export type FieldValidation = { value?: unknown; error?: string; skip?: boolean }

/** Converts an elicitation form schema into ordered form fields. */
export function parseElicitationForm(schema: unknown): Array<ElicitFormField> {
  const result = elicitFormFields(schema)
  if (!result.ok) throw new UnsupportedSchemaError({ reason: result.reason })
  return result.fields
}

/** Validates raw text entered for a field. */
export function validateFieldInput(field: ElicitFormField, raw: string): FieldValidation {
  const label = field.title ?? field.name
  if (raw === '') {
    if (field.default !== undefined) return { value: field.default }
    if (field.required) return { error: `${label} is required` }
    return { skip: true }
  }
  switch (field.kind) {
    case 'number':
    case 'integer': {
      if (raw.trim() === '') return { error: `${label} must be a number` }
      const value = Number(raw)
      if (!Number.isFinite(value)) return { error: `${label} must be a number` }
      if (field.kind === 'integer' && !Number.isInteger(value)) {
        return { error: `${label} must be an integer` }
      }
      if (field.minimum != null && value < field.minimum) {
        return { error: `${label} must be at least ${field.minimum}` }
      }
      if (field.maximum != null && value > field.maximum) {
        return { error: `${label} must be at most ${field.maximum}` }
      }
      return { value }
    }
    case 'choice':
      return field.choices?.some((o) => o.value === raw)
        ? { value: raw }
        : { error: `${label} must be one of the listed options` }
    case 'boolean': {
      const lower = raw.toLowerCase()
      if (lower === 'y' || lower === 'true') return { value: true }
      if (lower === 'n' || lower === 'false') return { value: false }
      return { error: `${label} must be yes or no` }
    }
    default:
      if (field.minLength != null && [...raw].length < field.minLength) {
        return { error: `${label} must be at least ${field.minLength} characters` }
      }
      if (field.maxLength != null && [...raw].length > field.maxLength) {
        return { error: `${label} must be at most ${field.maxLength} characters` }
      }
      return { value: raw }
  }
}
