import { Anchor, Badge, Group, Stack, Text, Title } from '@mantine/core'
import type { TraceSummary } from '@mokei/host-protocol'
import { IconPlugConnected, IconRoute, IconServer, IconStairs } from '@tabler/icons-react'
import { Link } from '@tanstack/react-router'

const kindIcons = { flow: IconRoute, context: IconServer, mcp: IconPlugConnected, step: IconStairs }

export function TraceList({ traces, now }: { traces: Array<TraceSummary>; now: number }) {
  return (
    <Stack>
      {(['Active', 'Recent'] as const).map((group) => (
        <Stack key={group} gap="xs">
          <Title order={2}>{group}</Title>
          {traces
            .filter((trace) => trace.active === (group === 'Active'))
            .map((trace) => {
              const KindIcon = kindIcons[trace.kind]
              return (
                <Stack key={trace.traceID} gap={2}>
                  <Group gap="xs">
                    <KindIcon size={16} aria-label={trace.kind} />
                    <Anchor
                      renderRoot={(props) => (
                        <Link
                          {...props}
                          to="/traces/$traceID"
                          params={{ traceID: trace.traceID }}
                          search={(previous) => ({ ...previous, span: undefined })}
                        />
                      )}>
                      {trace.name}
                    </Anchor>
                  </Group>
                  <Text size="xs">
                    {Math.max(
                      0,
                      (trace.active ? now : (trace.endTime ?? now)) - trace.startTime,
                    ).toFixed(0)}{' '}
                    ms · {trace.spanCount} spans · {trace.errorCount} errors
                  </Text>
                  {trace.droppedCount > 0 ? (
                    <Badge color="orange">Dropped: {trace.droppedCount}</Badge>
                  ) : null}
                </Stack>
              )
            })}
        </Stack>
      ))}
    </Stack>
  )
}
