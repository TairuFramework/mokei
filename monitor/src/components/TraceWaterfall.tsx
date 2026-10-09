import {
  Box,
  Button,
  DataList,
  Group,
  Splitter,
  Stack,
  Text,
  Tree,
  type TreeNodeData,
  useTree,
} from '@mantine/core'
import type { OpenSpan, StoredSpan, TraceSummary } from '@mokei/host-protocol'
import { useEffect, useMemo, useState } from 'react'

import { barPosition, buildTraceTree, type SpanNode } from '../traces/span-tree.js'
import { JsonPayload } from './JsonPayload.js'

export type TraceWaterfallProps = {
  spans: Array<StoredSpan | OpenSpan>
  summary?: TraceSummary
  selectedSpanID?: string
  onOpenContext: (traceID: string) => void
  now: number
  onSelectSpan: (spanID?: string) => void
}

export function TraceWaterfall({
  spans,
  summary,
  selectedSpanID,
  onSelectSpan,
  onOpenContext,
  now,
}: TraceWaterfallProps) {
  const { start, end, nodes, data, defaultExpandedState } = useMemo(() => {
    const range = buildTraceTree(spans, summary, now)
    const nodes = new Map<string, SpanNode>()
    const expandedState: Record<string, boolean> = {}
    function toTree(node: SpanNode): TreeNodeData {
      nodes.set(node.id, node)
      expandedState[node.id] = true
      return { value: node.id, label: node.name, children: node.children.map(toTree) }
    }
    return { ...range, nodes, defaultExpandedState: expandedState, data: range.roots.map(toTree) }
  }, [spans, summary, now])
  const [selectedState, setSelectedState] = useState<Array<string>>(
    selectedSpanID == null ? [] : [selectedSpanID],
  )
  useEffect(() => {
    setSelectedState(selectedSpanID == null ? [] : [selectedSpanID])
  }, [selectedSpanID])
  const [expansionChoices, setExpansionChoices] = useState<Record<string, boolean>>({})
  const expandedState = useMemo(
    () => ({ ...defaultExpandedState, ...expansionChoices }),
    [defaultExpandedState, expansionChoices],
  )
  const tree = useTree({
    expandedState,
    onExpandedStateChange: setExpansionChoices,
    selectedState,
    onSelectedStateChange: (values) => {
      setSelectedState(values)
      onSelectSpan(nodes.get(values[0])?.placeholder ? undefined : values[0])
    },
  })
  const selected = nodes.get(selectedState[0])
  const stored = spans.find((span) => span.spanID === selected?.id)
  const columns = 'minmax(180px, 40%) 1fr'
  return (
    <Splitter mih={280}>
      <Splitter.Pane defaultSize="70%" min="30%">
        <Stack p="sm" style={{ overflow: 'auto' }}>
          <Group justify="space-between">
            <Text fw={600}>Span trace</Text>
            <Button size="xs" variant="subtle" onClick={() => tree.clearSelected()}>
              Clear span selection
            </Button>
          </Group>
          <Box style={{ display: 'grid', gridTemplateColumns: columns }}>
            <Text size="xs">Name / duration</Text>
            <Group justify="space-between" gap={0} aria-label="Time ruler">
              {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
                <Text key={fraction} size="xs">
                  {((end - start) * fraction).toFixed(0)} ms
                </Text>
              ))}
            </Group>
          </Box>
          <Tree
            data={data}
            tree={tree}
            selectOnClick
            expandOnClick={false}
            allowRangeSelection={false}
            levelOffset={0}
            renderNode={({ node, level, hasChildren, expanded, elementProps }) => {
              const span = nodes.get(node.value)
              if (span == null) return null
              const position = barPosition(span, start, end)
              return (
                <Box
                  {...elementProps}
                  style={{
                    ...elementProps.style,
                    display: 'grid',
                    gridTemplateColumns: columns,
                    alignItems: 'center',
                  }}>
                  <Group gap="xs" wrap="nowrap" pl={(level - 1) * 16}>
                    {hasChildren ? (
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        aria-label={`${expanded ? 'Collapse' : 'Expand'} ${span.name}`}
                        onClick={(event) => {
                          event.stopPropagation()
                          tree.toggleExpanded(span.id)
                        }}>
                        {expanded ? '−' : '+'}
                      </Button>
                    ) : null}
                    <Button
                      variant="subtle"
                      size="compact-sm"
                      style={{
                        opacity: span.placeholder ? 0.6 : 1,
                        whiteSpace: 'normal',
                        textAlign: 'left',
                      }}>
                      {span.name}
                    </Button>
                    {span.contextLink == null ? null : (
                      <Button
                        variant="subtle"
                        size="compact-xs"
                        onClick={(event) => {
                          event.stopPropagation()
                          if (span.contextLink != null) onOpenContext(span.contextLink.traceID)
                        }}>
                        context ↗
                      </Button>
                    )}
                    <Text size="xs" c="dimmed">
                      {span.open ? 'running' : `${(span.end - span.start).toFixed(1)} ms`}
                    </Text>
                  </Group>
                  <Box
                    h={12}
                    style={{
                      position: 'relative',
                      background: 'var(--mantine-color-default-hover)',
                    }}>
                    <Box
                      h={12}
                      data-open={span.open}
                      data-placeholder={span.placeholder}
                      style={{
                        opacity: span.open || span.placeholder ? 0.6 : 1,
                        border: span.open ? '1px dashed currentColor' : undefined,
                        position: 'absolute',
                        left: `${position.left * 100}%`,
                        width: `${position.width * 100}%`,
                        background: `var(--mantine-color-${span.status === 'ok' ? 'green' : span.status === 'error' ? 'red' : 'gray'}-6)`,
                        borderRadius: 3,
                      }}
                    />
                  </Box>
                </Box>
              )
            }}
          />
        </Stack>
      </Splitter.Pane>
      <Splitter.Pane defaultSize="30%" min="20%">
        <Stack p="sm" style={{ overflow: 'auto', overflowWrap: 'anywhere' }}>
          {selected == null ? (
            <Text c="dimmed">Select a span to inspect its attributes and events.</Text>
          ) : (
            <>
              <Text fw={600}>{selected.name}</Text>
              <DataList orientation="vertical">
                <DataList.Item>
                  <DataList.ItemLabel>Span ID</DataList.ItemLabel>
                  <DataList.ItemValue>{selected.id}</DataList.ItemValue>
                </DataList.Item>
                <DataList.Item>
                  <DataList.ItemLabel>Status</DataList.ItemLabel>
                  <DataList.ItemValue>
                    {selected.status}
                    {stored != null && 'status' in stored && stored.status.message
                      ? `: ${stored.status.message}`
                      : ''}
                  </DataList.ItemValue>
                </DataList.Item>
                {Object.entries(selected.attributes).map(([name, value]) => (
                  <DataList.Item key={name}>
                    <DataList.ItemLabel>{name}</DataList.ItemLabel>
                    <DataList.ItemValue>
                      <JsonPayload key={`${selected.id}:${name}`} value={value} />
                    </DataList.ItemValue>
                  </DataList.Item>
                ))}
                {(stored != null && 'events' in stored ? stored.events : []).map((event, index) => (
                  <DataList.Item key={`${event.time}:${index}`}>
                    <DataList.ItemLabel>{event.name}</DataList.ItemLabel>
                    <DataList.ItemValue>
                      <Text size="xs">{(event.time - start).toFixed(1)} ms</Text>
                      <JsonPayload
                        key={`${selected.id}:${event.time}:${index}`}
                        value={event.attributes}
                      />
                    </DataList.ItemValue>
                  </DataList.Item>
                ))}
              </DataList>
            </>
          )}
        </Stack>
      </Splitter.Pane>
    </Splitter>
  )
}
