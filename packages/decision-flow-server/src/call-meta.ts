import type { JSONValue } from '@mokei/context-server'

export const FLOW_DEPTH_META = 'dev.mokei/flow-depth'
export const IDEMPOTENCY_KEY_META = 'dev.mokei/idempotency-key'
export const ATTEMPT_META = 'dev.mokei/attempt'
export const FLOW_GRANT_META = 'dev.mokei/flow-grant'
export const MAX_FLOW_DEPTH = 4

export function readFlowDepth(meta: Record<string, JSONValue>): number | undefined {
  if (!(FLOW_DEPTH_META in meta)) return 0
  const depth = meta[FLOW_DEPTH_META]
  return typeof depth === 'number' && Number.isInteger(depth) && depth >= 0 ? depth : undefined
}

export function callMeta(params: {
  depth: number
  key: string
  attempt: number
}): Record<string, JSONValue> {
  return {
    [FLOW_DEPTH_META]: params.depth,
    [IDEMPOTENCY_KEY_META]: params.key,
    [ATTEMPT_META]: params.attempt,
  }
}
