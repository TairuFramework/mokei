import { readFile } from 'node:fs/promises'
import type { FlowRunSnapshot, InboxItem, RunStatus, RunTrace } from '@mokei/flow-client'
import { renderStatic } from '@tejika/cli'
import type { Command } from 'commander'
import { Box, Text } from 'ink'
import { createElement } from 'react'

export function addJSONOption(cmd: Command): Command {
  return cmd.option('--json', 'print the result as JSON')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Parses a JSON flag value; `@path` reads the JSON from a file. Errors name the flag. */
export async function parseJSONArg(flag: string, value: string): Promise<unknown> {
  let text = value
  let source = 'value'
  if (value.startsWith('@')) {
    const path = value.slice(1)
    source = `file ${path}`
    try {
      text = await readFile(path, 'utf8')
    } catch (error) {
      throw new Error(`Cannot read ${flag} file ${path}: ${errorMessage(error)}`, {
        cause: error,
      })
    }
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`Invalid JSON in ${flag} ${source}: ${errorMessage(error)}`, {
      cause: error,
    })
  }
}

export function printJSON(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

export function printNDJSON(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

export function renderTable(
  columns: Array<{ key: string; label: string }>,
  rows: Array<Record<string, string>>,
): void {
  const widths = columns.map((column) =>
    Math.max(column.label.length, ...rows.map((row) => (row[column.key] ?? '').length)),
  )
  const line = (cell: (column: { key: string; label: string }) => string, bold = false) =>
    createElement(
      Text,
      { bold },
      columns.map((column, i) => cell(column).padEnd(widths[i] ?? 0)).join('  '),
    )
  renderStatic(
    createElement(
      Box,
      { flexDirection: 'column', paddingX: 1 },
      line((column) => column.label, true),
      ...rows.map((row, i) =>
        createElement(
          Box,
          { key: i },
          line((column) => row[column.key] ?? ''),
        ),
      ),
    ),
  )
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
  const ids = new Set(trace.spans.map((span) => span.spanID))
  const children = new Map<string | undefined, RunTrace['spans']>()
  for (const span of trace.spans) {
    // Spans whose parent is absent from the trace are treated as roots.
    const key = span.parentSpanID && ids.has(span.parentSpanID) ? span.parentSpanID : undefined
    const siblings = children.get(key) ?? []
    siblings.push(span)
    children.set(key, siblings)
  }
  const lines: Array<string> = []
  const visit = (parent: string | undefined, depth: number, seen: Set<string>) => {
    const siblings = (children.get(parent) ?? []).toSorted((a, b) => a.startTime - b.startTime)
    for (const span of siblings) {
      if (seen.has(span.spanID)) continue
      seen.add(span.spanID)
      const duration = Math.round(span.endTime - span.startTime)
      lines.push(`${'  '.repeat(depth)}${span.name}  ${duration}ms`)
      visit(span.spanID, depth + 1, seen)
    }
  }
  visit(undefined, 0, new Set())
  if (trace.logs.length > 0) {
    lines.push('', 'logs:')
    for (const log of trace.logs) {
      lines.push(`  [${log.level}] ${log.message}`)
    }
  }
  return lines.join('\n')
}
