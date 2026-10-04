export type FormField = {
  name: string
  kind: 'string' | 'number' | 'integer' | 'boolean' | 'enum'
  title?: string
  description?: string
  required: boolean
  default?: unknown
  format?: string
  options?: Array<{ value: string; label: string }>
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

export function schemaToFields(schema: unknown): Array<FormField> | null {
  if (!isRecord(schema) || schema.type !== 'object') return null
  if (['$ref', 'allOf', 'anyOf', 'oneOf', 'not'].some((key) => key in schema)) return null
  const properties = schema.properties ?? {}
  if (!isRecord(properties)) return null
  if (
    schema.required != null &&
    (!Array.isArray(schema.required) ||
      !schema.required.every((name) => typeof name === 'string' && Object.hasOwn(properties, name)))
  )
    return null
  const required = new Set(Array.isArray(schema.required) ? schema.required : [])
  const fields: Array<FormField> = []
  for (const [name, property] of Object.entries(properties)) {
    if (!isRecord(property) || ['$ref', 'allOf', 'anyOf', 'not'].some((key) => key in property))
      return null
    const field: FormField = { name, kind: 'string', required: required.has(name) }
    if (typeof property.title === 'string') field.title = property.title
    if (typeof property.description === 'string') field.description = property.description
    if ('default' in property) field.default = property.default
    if (typeof property.format === 'string') field.format = property.format
    if (property.type === 'string' && Array.isArray(property.enum)) {
      if (
        !property.enum.length ||
        !property.enum.every((value) => typeof value === 'string') ||
        'oneOf' in property
      )
        return null
      const labels = property.enumNames
      if (
        labels != null &&
        (!Array.isArray(labels) ||
          labels.length !== property.enum.length ||
          !labels.every((label) => typeof label === 'string'))
      )
        return null
      field.kind = 'enum'
      field.options = property.enum.map((value, index) => ({
        value,
        label: Array.isArray(labels) ? labels[index] : value,
      }))
    } else if (property.type === 'string' && Array.isArray(property.oneOf)) {
      const options: Array<{ value: string; label: string }> = []
      for (const option of property.oneOf) {
        if (
          !isRecord(option) ||
          typeof option.const !== 'string' ||
          typeof option.title !== 'string' ||
          Object.keys(option).some((key) => !['const', 'title'].includes(key))
        )
          return null
        options.push({ value: option.const, label: option.title })
      }
      if (!options.length) return null
      field.kind = 'enum'
      field.options = options
    } else {
      if ('oneOf' in property || 'enum' in property || 'const' in property) return null
      if (
        property.type !== 'string' &&
        property.type !== 'number' &&
        property.type !== 'integer' &&
        property.type !== 'boolean'
      )
        return null
      field.kind = property.type
    }
    fields.push(field)
  }
  return fields
}
