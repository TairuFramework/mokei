import { type ElicitFormField, elicitFormFields } from '@mokei/context-protocol'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

export function schemaToFields(schema: unknown): Array<ElicitFormField> | null {
  const result = elicitFormFields(schema)
  return result.ok ? result.fields : null
}
