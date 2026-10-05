import type { SpanTreeNode } from '@mokei/flow-client'
import { nestSpans, TERMINAL_RUN_STATES } from '@mokei/flow-client'
import type { FlowRunSnapshot, StoredSpan } from '@mokei/host-protocol'

export type SpanNode = {
  id: string
  name: string
  start: number
  end?: number
  status: 'ok' | 'error' | 'unset'
  attributes: Record<string, unknown>
  children: Array<SpanNode>
}

export function buildSpanTree(
  spans: Array<StoredSpan>,
  run: FlowRunSnapshot,
): { root: SpanNode; start: number; end: number } {
  const terminal = TERMINAL_RUN_STATES.includes(run.state)
  const root: SpanNode = {
    id: `run:${run.runID}`,
    name: run.label,
    start: run.createdAt,
    end: terminal ? run.updatedAt : undefined,
    status:
      run.state === 'completed'
        ? 'ok'
        : run.state === 'failed' || run.state === 'denied'
          ? 'error'
          : 'unset',
    attributes: { runID: run.runID, state: run.state },
    children: [],
  }
  let start = root.start
  let end = root.end ?? Date.now()
  const toSpanNode = ({ span, children }: SpanTreeNode): SpanNode => {
    start = Math.min(start, span.startTime)
    end = Math.max(end, span.endTime)
    return {
      id: span.spanID,
      name: span.name,
      start: span.startTime,
      end: span.endTime,
      status: span.status.code === 1 ? 'ok' : span.status.code === 2 ? 'error' : 'unset',
      attributes: span.attributes,
      children: children.map(toSpanNode),
    }
  }
  root.children = nestSpans(spans).map(toSpanNode)
  return { root, start, end: Math.max(start, end) }
}

export function barPosition(
  node: SpanNode,
  start: number,
  end: number,
): { left: number; width: number } {
  if (end <= start) return { left: 0, width: 0 }
  const left = Math.max(0, Math.min(1, (node.start - start) / (end - start)))
  const right = Math.max(left, Math.min(1, ((node.end ?? end) - start) / (end - start)))
  return { left, width: right - left }
}
