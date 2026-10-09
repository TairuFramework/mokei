import {
  Alert,
  Box,
  Button,
  Group,
  Loader,
  NativeSelect,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { TraceList } from '../components/TraceList.js'
import { type TraceListFilters, useTraceList } from '../traces/useTraceList.js'

export function validateTraceSearch(search: Record<string, unknown>): TraceListFilters {
  const number = (value: unknown) =>
    value == null || value === '' || !Number.isFinite(Number(value)) ? undefined : Number(value)
  return {
    kind:
      search.kind === 'flow' ||
      search.kind === 'context' ||
      search.kind === 'mcp' ||
      search.kind === 'step'
        ? search.kind
        : undefined,
    active:
      search.active === true || search.active === 'true'
        ? true
        : search.active === false || search.active === 'false'
          ? false
          : undefined,
    outcome:
      search.outcome === 'ok' || search.outcome === 'error' || search.outcome === 'interrupted'
        ? search.outcome
        : undefined,
    name: typeof search.name === 'string' && search.name !== '' ? search.name : undefined,
    since: number(search.since),
    until: number(search.until),
  }
}

function TracesPage() {
  const search = Route.useSearch()
  const navigate = useNavigate()
  const { traces, loading, error, retry, loadMore, hasMore } = useTraceList(search)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  function update(filters: Partial<TraceListFilters>) {
    void navigate({ to: '.', search: (previous) => ({ ...previous, ...filters }), replace: true })
  }
  return (
    <Stack>
      <Title order={1}>Traces</Title>
      <Group align="end">
        <NativeSelect
          label="Kind"
          value={search.kind ?? ''}
          data={[{ value: '', label: 'All' }, 'flow', 'context', 'mcp', 'step']}
          onChange={(event) =>
            update({ kind: validateTraceSearch({ kind: event.target.value }).kind })
          }
        />
        <NativeSelect
          label="Active"
          value={search.active == null ? '' : String(search.active)}
          data={[
            { value: '', label: 'All' },
            { value: 'true', label: 'Active' },
            { value: 'false', label: 'Recent' },
          ]}
          onChange={(event) =>
            update({ active: validateTraceSearch({ active: event.target.value }).active })
          }
        />
        <NativeSelect
          label="Outcome"
          value={search.outcome ?? ''}
          data={[{ value: '', label: 'All' }, 'ok', 'error', 'interrupted']}
          onChange={(event) =>
            update({ outcome: validateTraceSearch({ outcome: event.target.value }).outcome })
          }
        />
        <TextInput
          label="Name"
          value={search.name ?? ''}
          onChange={(event) => update({ name: event.target.value || undefined })}
        />
        {(['since', 'until'] as const).map((key) => (
          <TextInput
            key={key}
            type="datetime-local"
            label={key === 'since' ? 'Since' : 'Until'}
            value={
              search[key] == null
                ? ''
                : new Date(search[key] as number).toLocaleString('sv-SE').replace(' ', 'T')
            }
            onChange={(event) =>
              update({
                [key]: event.target.value ? new Date(event.target.value).getTime() : undefined,
              })
            }
          />
        ))}
      </Group>
      <Box style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <Stack style={{ flex: '1 1 260px' }}>
          {error == null ? null : (
            <Alert color="red" title="Trace list request failed">
              {error.message}
              <Button onClick={retry}>Retry</Button>
            </Alert>
          )}
          {loading ? <Loader size="sm" aria-label="Loading traces" /> : null}
          {!loading && traces.length === 0 ? <Text>No traces match this filter.</Text> : null}
          <TraceList traces={traces} now={now} />
          <Button onClick={loadMore} disabled={loading || !hasMore}>
            Load more
          </Button>
        </Stack>
        <Box style={{ flex: '3 1 600px', minWidth: 0 }}>
          <Outlet />
        </Box>
      </Box>
    </Stack>
  )
}
export const Route = createFileRoute('/traces')({
  validateSearch: validateTraceSearch,
  component: TracesPage,
})
