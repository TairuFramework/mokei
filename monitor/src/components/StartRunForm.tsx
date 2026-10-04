import { Alert, Button, JsonInput, Stack, TextInput } from '@mantine/core'
import { useInputState, useSetState } from '@mantine/hooks'
import type { FlowSummary } from '@mokei/flow-client'
import { useState } from 'react'

import { useFlow } from '../flow/FlowProvider.js'
import { isRecord, schemaToFields } from '../flow/schema-fields.js'
import { SchemaForm } from './SchemaForm.js'

type StartState = { status: 'idle' } | { status: 'starting' } | { status: 'error'; error: string }

type StartRunFormProps = {
  flow: FlowSummary
  onStarted(runID: string): void
}

export function StartRunForm({ flow, onStarted }: StartRunFormProps) {
  const { control, connected, status } = useFlow()
  const [label, setLabel] = useInputState('')
  const [{ json, jsonError }, setInput] = useSetState<{ json: string; jsonError?: string }>({
    json: '{}',
  })
  const [state, setState] = useState<StartState>({ status: 'idle' })
  const starting = state.status === 'starting'
  const error = state.status === 'error' ? state.error : undefined
  const disabled = !connected || status?.state !== 'ready' || starting
  async function start(input: Record<string, unknown>) {
    if (disabled) return
    setState({ status: 'starting' })
    try {
      const run = await control.runs.start({ flow: flow.id, input, label: label || undefined })
      onStarted(run.runID)
      setState({ status: 'idle' })
    } catch (error) {
      setState({ status: 'error', error: String(error) })
    }
  }
  function submitJSON() {
    let input: unknown
    try {
      input = JSON.parse(json)
      if (!isRecord(input)) throw new Error('Expected object')
    } catch {
      setInput({ jsonError: 'Enter a valid JSON object' })
      return
    }
    setInput({ jsonError: undefined })
    void start(input)
  }
  return (
    <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0 }}>
      <Stack>
        <TextInput
          label="Label"
          description="Optional run label"
          value={label}
          onChange={setLabel}
        />
        {schemaToFields(flow.input) != null ? (
          <SchemaForm
            schema={flow.input}
            submitLabel="Start run"
            onSubmit={(input) => void start(input)}
            errors={error == null ? [] : [error]}
          />
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              submitJSON()
            }}>
            <Stack>
              {error == null ? null : <Alert color="red">{error}</Alert>}
              <JsonInput
                label="JSON input"
                value={json}
                onChange={(json) => setInput({ json })}
                error={jsonError}
                formatOnBlur
                rows={4}
              />
              <Button type="submit" loading={starting}>
                Start run
              </Button>
            </Stack>
          </form>
        )}
      </Stack>
    </fieldset>
  )
}
