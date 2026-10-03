import { Alert, Button, JsonInput, Stack, Text } from '@mantine/core'
import type { FlowCheckResult } from '@mokei/flow-client'
import { useState } from 'react'

import { useFlow } from '../flow/FlowProvider.js'
import { isRecord } from '../flow/schema-fields.js'

export function CheckDefinition() {
  const { control, connected, status } = useFlow()
  const [json, setJSON] = useState('{}')
  const [jsonError, setJSONError] = useState<string>()
  const [error, setError] = useState<string>()
  const [result, setResult] = useState<FlowCheckResult>()
  const [checking, setChecking] = useState(false)
  const disabled = !connected || status?.state !== 'ready' || checking

  async function check() {
    if (disabled) return
    let definition: unknown
    try {
      definition = JSON.parse(json)
      if (!isRecord(definition)) throw new Error('Expected object')
    } catch {
      setJSONError('Enter a valid JSON object')
      return
    }
    setJSONError(undefined)
    setError(undefined)
    setResult(undefined)
    setChecking(true)
    try {
      setResult(await control.flows.check(definition))
    } catch (error) {
      setError(String(error))
    } finally {
      setChecking(false)
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
        onChange={setJSON}
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
