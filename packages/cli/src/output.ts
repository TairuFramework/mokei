import type {
  FlowRunSnapshot,
  InboxItem,
  RunStatus,
  RunTrace,
  SpanTreeNode,
} from '@mokei/flow-client'
import { nestSpans } from '@mokei/flow-client'

export {
  addJSONOption,
  fail,
  parseJSONArg,
  printJSON,
  printNDJSON,
  renderTable,
} from '@tejika/cli'

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function describePending(item: RunStatus['pending'][number]): string {
  return item.kind === 'input'
    ? `${item.id} (input): ${item.message}`
    : `${item.id} (approval): ${item.plan.tools.join(', ')}`
}

export function formatRunStatus(status: RunStatus): string {
  const lines = [`${status.runID}  ${status.state}`]
  for (const item of status.pending) {
    lines.push(`  pending ${describePending(item)}`)
  }
  if (status.error) {
    lines.push(`  error: ${status.error.message}`)
  }
  return lines.join('\n')
}

function formatTime(value: number): string {
  return new Date(value).toISOString()
}

export function formatSnapshotRow(snapshot: FlowRunSnapshot): Record<string, string> {
  return {
    runID: snapshot.runID,
    flow: snapshot.flowID ?? '',
    label: snapshot.label,
    state: snapshot.state,
    updated: formatTime(snapshot.updatedAt),
  }
}

export function formatInboxRow(item: InboxItem): Record<string, string> {
  return {
    id: item.id,
    runID: item.runID,
    kind: item.kind,
    summary: item.kind === 'input' ? item.message : `approve: ${item.plan.tools.join(', ')}`,
    created: formatTime(item.createdAt),
  }
}

/** Span tree indented by `parentSpanID` with durations in ms, followed by the logs. */
export function formatTrace(trace: RunTrace): string {
  const lines: Array<string> = []
  const visit = (nodes: Array<SpanTreeNode>, depth: number) => {
    for (const { span, children } of nodes) {
      const duration = Math.round(span.endTime - span.startTime)
      lines.push(`${'  '.repeat(depth)}${span.name}  ${duration}ms`)
      visit(children, depth + 1)
    }
  }
  visit(nestSpans(trace.spans), 0)
  if (trace.logs.length > 0) {
    lines.push('', 'logs:')
    for (const log of trace.logs) {
      lines.push(`  [${log.level}] ${log.message}`)
    }
  }
  return lines.join('\n')
}
