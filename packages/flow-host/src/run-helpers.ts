import type { InboxItem, RunRecord } from './types.js'

export function approvalItem(record: RunRecord): InboxItem {
  return {
    id: `${record.runID}:approval`,
    runID: record.runID,
    kind: 'approval',
    plan: structuredClone(record.plan),
    createdAt: record.createdAt,
  }
}

export function interruptedError(error: unknown = new Error('Task not found')) {
  return {
    type: 'Interrupted',
    message: error instanceof Error ? error.message : String(error),
  }
}

export function isTaskNotFound(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === -32602 &&
    'message' in error &&
    error.message === 'Task not found'
  )
}

export function equalValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object')
    return false
  if (Array.isArray(left) !== Array.isArray(right)) return false
  const a = left as Record<string, unknown>
  const b = right as Record<string, unknown>
  const keys = Object.keys(a)
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && equalValue(a[key], b[key]))
  )
}
