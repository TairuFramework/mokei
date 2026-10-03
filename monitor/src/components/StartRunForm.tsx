import { Alert, Button, JsonInput, Stack, TextInput } from '@mantine/core'
import type { FlowSummary } from '@mokei/flow-client'
import { useState } from 'react'

import { useFlow } from '../flow/FlowProvider.js'
import { isRecord, schemaToFields } from '../flow/schema-fields.js'
import { SchemaForm } from './SchemaForm.js'

type StartRunFormProps = {
  flow: FlowSummary
  onStarted(runID: string): void
}

export function StartRunForm({ flow, onStarted }: StartRunFormProps) {
  const { control, connected, status } = useFlow()
  const [label, setLabel] = useState('')
  const [json, setJSON] = useState('{}')
  const [jsonError, setJSONError] = useState<string>()
  const [error, setError] = useState<string>()
  const [starting, setStarting] = useState(false)
  const disabled = !connected || status?.state !== 'ready' || starting
  async function start(input: Record<string, unknown>) {
    if (disabled) return
    setStarting(true)
    setError(undefined)
    try {
      const run = await control.runs.start({ flow: flow.id, input, label: label || undefined })
      onStarted(run.runID)
    } catch (error) {
      setError(String(error))
    } finally {
      setStarting(false)
    }
  }
  function submitJSON() {
    let input: unknown
    try {
      input = JSON.parse(json)
      if (!isRecord(input)) throw new Error('Expected object')
    } catch {
      setJSONError('Enter a valid JSON object')
      return
    }
    setJSONError(undefined)
    void start(input)
  }
  return (
    <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0 }}>
      <Stack>
        <TextInput
          label="Label"
          description="Optional run label"
          value={label}
          onChange={(event) => setLabel(event.currentTarget.value)}
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
                onChange={setJSON}
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
