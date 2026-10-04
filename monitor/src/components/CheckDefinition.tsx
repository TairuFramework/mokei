import { Alert, Button, JsonInput, Stack, Text } from '@mantine/core'
import { useSetState } from '@mantine/hooks'
import type { FlowCheckResult } from '@mokei/flow-client'
import { useState } from 'react'

import { useFlow } from '../flow/FlowProvider.js'
import { isRecord } from '../flow/schema-fields.js'

type CheckState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'error'; error: string }
  | { status: 'done'; result: FlowCheckResult }

export function CheckDefinition() {
  const { control, connected, status } = useFlow()
  const [{ json, jsonError }, setInput] = useSetState<{ json: string; jsonError?: string }>({
    json: '{}',
  })
  const [state, setState] = useState<CheckState>({ status: 'idle' })
  const checking = state.status === 'checking'
  const error = state.status === 'error' ? state.error : undefined
  const result = state.status === 'done' ? state.result : undefined
  const disabled = !connected || status?.state !== 'ready' || checking

  async function check() {
    if (disabled) return
    let definition: unknown
    try {
      definition = JSON.parse(json)
      if (!isRecord(definition)) throw new Error('Expected object')
    } catch {
      setInput({ jsonError: 'Enter a valid JSON object' })
      return
    }
    setInput({ jsonError: undefined })
    setState({ status: 'checking' })
    try {
      setState({ status: 'done', result: await control.flows.check(definition) })
    } catch (error) {
      setState({ status: 'error', error: String(error) })
    }
  }

  const issues =
    result == null ? [] : [...('issues' in result ? result.issues : []), ...result.warnings]

  return (
    <Stack>
      <Text fw={600}>Check a definition</Text>
      <JsonInput
        label="Flow definition JSON"
        value={json}
        onChange={(json) => setInput({ json })}
        error={jsonError}
        formatOnBlur
        rows={8}
      />
      <Button disabled={disabled} loading={checking} onClick={() => void check()}>
        Check definition
      </Button>
      {error == null ? null : (
        <Alert color="red" title="Flow check failed">
          {error}
        </Alert>
      )}
      {issues.map((issue, index) => (
        <Alert
          key={`${index}:${issue.code}`}
          color={issue.severity === 'error' ? 'red' : 'yellow'}
          title={`${issue.severity}: ${issue.code}`}>
          {issue.path.join('.')}: {issue.message}
          {issue.hint == null ? null : <Text size="sm">{issue.hint}</Text>}
        </Alert>
      ))}
      {result != null && issues.length === 0 ? <Text>No issues found.</Text> : null}
    </Stack>
  )
}
