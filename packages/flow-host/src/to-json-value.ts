import type { LogRecord } from '@logtape/logtape'
import type { JSONValue } from '@mokei/context-server'

export function toJSONValue(value: unknown): JSONValue {
  try {
    const json = JSON.stringify(value)
    if (json !== undefined) return JSON.parse(json) as JSONValue
  } catch {
    // Non-JSON values are represented by their guarded string form.
  }

  return guardedString(value)
}

function guardedString(value: unknown): string {
  try {
    return String(value)
  } catch {
    return '[unrenderable]'
  }
}

function renderInterpolation(value: unknown): string {
  try {
    const json = JSON.stringify(value)
    if (json !== undefined) return json
  } catch {
    // Match LogTape's template rendering while keeping malformed values visible.
  }

  return guardedString(value)
}

export function renderLogMessage(record: Pick<LogRecord, 'rawMessage' | 'message'>): string {
  if (typeof record.rawMessage === 'string') return record.rawMessage

  return record.message
    .map((part, index) => {
      if (typeof part === 'string') return part
      if (index % 2 === 1) return renderInterpolation(part)
      return guardedString(part)
    })
    .join('')
}
