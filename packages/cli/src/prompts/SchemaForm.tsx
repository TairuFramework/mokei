import { TextInput } from '@inkjs/ui'
import { ConfirmCard, SelectCard } from '@tejika/ui'
import { Box, Text, useApp, useInput } from 'ink'
import { useEffect, useRef, useState } from 'react'

import { type FormField, validateFieldInput } from './schema-form.js'

export type SchemaFormProps = {
  title?: string
  fields: Array<FormField>
  onSubmit: (values: Record<string, unknown>) => void
  onCancel: () => void
  onInvalid?: (issues: Array<string>) => void
}

export function SchemaForm({ title, fields, onSubmit, onCancel, onInvalid }: SchemaFormProps) {
  const [index, setIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const values = useRef<Record<string, unknown>>({})
  const cancelled = useRef(false)

  // Esc reaches this handler and the active card's; the card's answer is deferred so Esc wins.
  useInput((_input, key) => {
    if (key.escape && !cancelled.current) {
      cancelled.current = true
      onCancel()
    }
  })

  const field = fields[index]
  const empty = fields.length === 0
  const onSubmitRef = useRef(onSubmit)
  onSubmitRef.current = onSubmit
  useEffect(() => {
    if (empty) onSubmitRef.current({})
  }, [empty])
  if (field == null) return null

  const advance = (value: unknown) => {
    if (cancelled.current) return
    if (value !== undefined) {
      Object.defineProperty(values.current, field.key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      })
    }
    setError(null)
    if (index + 1 >= fields.length) {
      onSubmit(values.current)
    } else {
      setIndex(index + 1)
    }
  }

  const submitText = (raw: string) => {
    const result = validateFieldInput(field, raw)
    if (result.error != null) {
      setError(result.error)
      onInvalid?.([result.error])
      return
    }
    advance(result.skip ? undefined : result.value)
  }

  const label = `${field.label}${field.required ? '' : ' (optional)'}`
  const heading = title == null ? undefined : `${title} [${index + 1}/${fields.length}]`

  let input: React.ReactNode
  if (field.kind === 'boolean') {
    input = (
      <ConfirmCard
        key={field.key}
        message={label}
        onConfirm={() => advance(true)}
        onCancel={() => queueMicrotask(() => advance(false))}
      />
    )
  } else if (field.kind === 'select') {
    input = (
      <SelectCard
        key={field.key}
        title={label}
        items={field.options ?? []}
        onSelect={(value) => advance(value)}
        onCancel={() => {}}
      />
    )
  } else {
    input = (
      <Box key={field.key} flexDirection="column" borderStyle="round" borderColor="cyan">
        <Text color="cyan">{label}</Text>
        <Box>
          <Text color="cyan">› </Text>
          <TextInput
            defaultValue={field.default == null ? undefined : String(field.default)}
            onSubmit={submitText}
          />
        </Box>
        <Text dimColor>[enter] {field.required ? 'confirm' : 'confirm / skip'} [esc] cancel</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {heading == null ? null : <Text bold>{heading}</Text>}
      {input}
      {error == null ? null : <Text color="red">{error}</Text>}
    </Box>
  )
}

export type FormRunnerProps = Omit<SchemaFormProps, 'onSubmit' | 'onCancel'> & {
  onDone: (values: Record<string, unknown> | undefined) => void
}

/** Runs a `SchemaForm` inside `runInk`: reports the outcome, then exits the app. */
export function FormRunner({ onDone, ...props }: FormRunnerProps) {
  const { exit } = useApp()
  const finish = (values: Record<string, unknown> | undefined) => {
    onDone(values)
    exit()
  }
  return <SchemaForm {...props} onSubmit={finish} onCancel={() => finish(undefined)} />
}
