import {
  Alert,
  Button,
  Checkbox,
  Group,
  JsonInput,
  NativeSelect,
  NumberInput,
  Stack,
  TextInput,
} from '@mantine/core'
import { useMemo, useState } from 'react'

import { isRecord, schemaToFields } from '../flow/schema-fields.js'

type SchemaFormProps = {
  schema: unknown
  onSubmit(values: Record<string, unknown>): void
  onDecline?(): void
  onCancel?(): void
  errors?: Array<string>
}

function ownValue<TValue>(record: Record<string, TValue>, key: string): TValue | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined
}

export function SchemaForm({
  schema,
  onSubmit,
  onDecline,
  onCancel,
  errors = [],
}: SchemaFormProps) {
  const fields = useMemo(() => schemaToFields(schema), [schema])
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(
      (fields ?? []).flatMap((field) => {
        if (field.default !== undefined) return [[field.name, field.default]]
        return field.kind === 'boolean' ? [[field.name, false]] : []
      }),
    ),
  )
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [json, setJSON] = useState('{}')
  const [jsonError, setJSONError] = useState<string>()
  function change(name: string, value: unknown) {
    setValues((previous) => ({ ...previous, [name]: value }))
    setFieldErrors((previous) => ({ ...previous, [name]: '' }))
  }
  function submit() {
    if (fields == null) {
      try {
        const content: unknown = JSON.parse(json)
        if (!isRecord(content)) throw new Error('Enter a JSON object')
        setJSONError(undefined)
        onSubmit(content)
      } catch {
        setJSONError('Enter a valid JSON object')
      }
      return
    }
    const content: Record<string, unknown> = {}
    const invalid: Record<string, string> = {}
    for (const field of fields) {
      const value = ownValue(values, field.name)
      if (
        value === undefined ||
        (value === '' &&
          !(field.kind === 'enum' && field.options?.some((option) => option.value === '')))
      ) {
        if (field.required) invalid[field.name] = 'Required'
        continue
      }
      if (field.kind === 'number' || field.kind === 'integer') {
        const number = typeof value === 'number' ? value : Number(value)
        if (!Number.isFinite(number) || (field.kind === 'integer' && !Number.isInteger(number))) {
          invalid[field.name] = field.kind === 'integer' ? 'Enter an integer' : 'Enter a number'
          continue
        }
        Object.defineProperty(content, field.name, {
          value: number,
          enumerable: true,
          writable: true,
        })
      } else {
        Object.defineProperty(content, field.name, { value, enumerable: true, writable: true })
      }
    }
    setFieldErrors(invalid)
    if (Object.keys(invalid).length === 0) onSubmit(content)
  }
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}>
      <Stack>
        {errors.map((error, index) => (
          <Alert color="red" key={`${index}:${error}`}>
            {error}
          </Alert>
        ))}
        {fields == null ? (
          <JsonInput
            label="JSON input"
            value={json}
            onChange={setJSON}
            error={jsonError}
            formatOnBlur
            rows={4}
          />
        ) : (
          fields.map((field) => {
            const props = {
              label: field.title ?? field.name,
              description: field.description,
              error: ownValue(fieldErrors, field.name),
            }
            const value = ownValue(values, field.name)
            if (field.kind === 'boolean')
              return (
                <Checkbox
                  key={field.name}
                  {...props}
                  checked={value === true}
                  onChange={(event) => change(field.name, event.currentTarget.checked)}
                />
              )
            if (field.kind === 'enum') {
              const options = field.options ?? []
              return (
                <NativeSelect
                  key={field.name}
                  {...props}
                  required={field.required}
                  value={
                    value === undefined
                      ? ''
                      : String(options.findIndex((option) => option.value === value))
                  }
                  data={[
                    { value: '', label: 'Choose an option' },
                    ...options.map((option, index) => ({
                      value: String(index),
                      label: option.label,
                    })),
                  ]}
                  onChange={(event) =>
                    change(
                      field.name,
                      event.currentTarget.value === ''
                        ? undefined
                        : options[Number(event.currentTarget.value)]?.value,
                    )
                  }
                />
              )
            }
            if (field.kind === 'number' || field.kind === 'integer')
              return (
                <NumberInput
                  key={field.name}
                  {...props}
                  required={field.required}
                  value={typeof value === 'number' || typeof value === 'string' ? value : ''}
                  allowDecimal={field.kind !== 'integer'}
                  onChange={(value) => change(field.name, value)}
                />
              )
            const type =
              field.format === 'email'
                ? 'email'
                : field.format === 'uri'
                  ? 'url'
                  : field.format === 'date'
                    ? 'date'
                    : 'text'
            return (
              <TextInput
                key={field.name}
                {...props}
                required={field.required}
                type={type}
                value={typeof value === 'string' ? value : ''}
                onChange={(event) => change(field.name, event.currentTarget.value)}
              />
            )
          })
        )}
        <Group>
          <Button type="submit">Accept</Button>
          {onDecline == null ? null : (
            <Button variant="light" color="red" onClick={onDecline}>
              Decline
            </Button>
          )}
          {onCancel == null ? null : (
            <Button variant="default" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </Group>
      </Stack>
    </form>
  )
}
