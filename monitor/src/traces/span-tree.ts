import type { OpenSpan, StoredSpan, TraceSummary } from '@mokei/host-protocol'

export type SpanNode = {
  id: string
  name: string
  start: number
  end: number
  status: 'ok' | 'error' | 'unset'
  attributes: Record<string, unknown>
  children: Array<SpanNode>
  open: boolean
  placeholder: boolean
  kind?: string
  contextLink?: { traceID: string }
}

export function buildTraceTree(
  spans: Array<StoredSpan | OpenSpan>,
  summary: TraceSummary | undefined,
  now: number,
): { roots: Array<SpanNode>; start: number; end: number } {
  const nodes = new Map<string, SpanNode>()
  for (const span of spans) {
    const open = !('endTime' in span)
    const kind = span.attributes['mokei.kind']
    const contextTraceID = span.attributes['mokei.context.trace_id']
    const code = 'status' in span ? span.status.code : 0
    nodes.set(span.spanID, {
      id: span.spanID,
      name: span.name,
      start: span.startTime,
      end: open ? now : span.endTime,
      status: code === 1 ? 'ok' : code === 2 ? 'error' : 'unset',
      attributes: span.attributes,
      children: [],
      open,
      placeholder: false,
      kind: typeof kind === 'string' ? kind : undefined,
      contextLink:
        kind === 'mcp' && typeof contextTraceID === 'string' && contextTraceID !== span.traceID
          ? { traceID: contextTraceID }
          : undefined,
    })
  }
  if (summary != null && !nodes.has(summary.rootSpanID)) {
    nodes.set(summary.rootSpanID, {
      id: summary.rootSpanID,
      name: summary.name,
      start: summary.startTime,
      end: summary.active ? now : (summary.endTime ?? summary.startTime),
      status: summary.outcome === 'ok' ? 'ok' : summary.outcome === 'error' ? 'error' : 'unset',
      attributes: summary.attributes,
      children: [],
      open: summary.active,
      placeholder: true,
      kind: summary.kind,
    })
  }
  const childIDs = new Set<string>()
  for (const span of spans) {
    if (span.parentSpanID == null) continue
    let parent = nodes.get(span.parentSpanID)
    const node = nodes.get(span.spanID)
    if (node == null) continue
    if (parent == null) {
      parent = {
        id: span.parentSpanID,
        name: `Missing span: ${span.parentSpanID}`,
        start: node.start,
        end: node.end,
        status: 'unset',
        attributes: {},
        children: [],
        open: false,
        placeholder: true,
      }
      nodes.set(parent.id, parent)
    }
    parent.children.push(node)
    childIDs.add(node.id)
  }
  const roots = [...nodes.values()].filter((node) => !childIDs.has(node.id))
  function updatePlaceholder(node: SpanNode) {
    for (const child of node.children) updatePlaceholder(child)
    if (node.placeholder && node.id !== summary?.rootSpanID) {
      node.start = Math.min(...node.children.map((child) => child.start))
      node.end = Math.max(...node.children.map((child) => child.end))
      node.open = node.children.some((child) => child.open)
    }
    node.children.sort((a, b) => a.start - b.start)
  }
  for (const root of roots) updatePlaceholder(root)
  roots.sort((a, b) => a.start - b.start)
  const start = nodes.size === 0 ? now : Math.min(...[...nodes.values()].map((node) => node.start))
  const end = Math.max(start, ...[...nodes.values()].map((node) => node.end))
  return { roots, start, end }
}

export function barPosition(
  node: SpanNode,
  start: number,
  end: number,
): { left: number; width: number } {
  if (end <= start) return { left: 0, width: 0 }
  const left = Math.max(0, Math.min(1, (node.start - start) / (end - start)))
  const right = Math.max(left, Math.min(1, (node.end - start) / (end - start)))
  return { left, width: right - left }
}
