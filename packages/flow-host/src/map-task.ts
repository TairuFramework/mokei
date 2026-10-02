import type { CallToolResult, DetailedTask } from '@mokei/context-protocol'
import type { JSONValue } from '@mokei/context-server'

import type { FlowRunSnapshot, RunState } from './types.js'

export function resultText(result: CallToolResult): string {
  return result.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n')
}
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}
export function mapTaskSnapshot(task: DetailedTask): {
  state: RunState
  result?: FlowRunSnapshot['result']
  error?: FlowRunSnapshot['error']
} {
  if (task.status === 'failed')
    return { state: 'failed', error: { type: 'TaskFailed', message: task.error.message } }
  if (task.status !== 'completed') return { state: task.status }
  const result = task.result
  const structured = object(result.structuredContent)
  if (result.isError === true) {
    const error = object(structured.error)
    const lastFailure = object(error.lastFailure)
    return {
      state: 'failed',
      error: {
        type:
          typeof lastFailure.type === 'string'
            ? lastFailure.type
            : typeof error.name === 'string'
              ? error.name
              : 'FlowError',
        message: resultText(result),
        ...(typeof error.code === 'string' ? { code: error.code } : {}),
      },
    }
  }
  const output: JSONValue | undefined =
    structured.output === undefined ? undefined : JSON.parse(JSON.stringify(structured.output))
  return {
    state: 'completed',
    result: {
      content: result.content,
      ...(typeof structured.outcome === 'string' ? { outcome: structured.outcome } : {}),
      ...(output === undefined ? {} : { output }),
    },
  }
}
