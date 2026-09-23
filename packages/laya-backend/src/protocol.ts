import { SystemOneResponseError, type SystemOneResult } from '@mokei/system-one-client'

/** One stdout line of `laya daemon`, classified. */
export type DaemonLine =
  | { kind: 'ready' }
  | { kind: 'result'; id: string | undefined; result: SystemOneResult }
  | { kind: 'error'; id: string | undefined; message: string }
  | { kind: 'invalid'; line: string }

export function parseDaemonLine(line: string): DaemonLine {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return { kind: 'invalid', line }
  }
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return { kind: 'invalid', line }
  }
  const { id, ...rest } = value as Record<string, unknown>
  if (rest.status === 'ready') {
    return { kind: 'ready' }
  }
  const lineID = id == null ? undefined : String(id)
  if (typeof rest.error === 'string') {
    return { kind: 'error', id: lineID, message: rest.error }
  }
  // Shape validation happens in SystemOneClient.validateResult.
  return { kind: 'result', id: lineID, result: rest as SystemOneResult }
}

type Entry = {
  resolve: (result: SystemOneResult) => void
  reject: (reason: unknown) => void
  discarded: boolean
}

/**
 * Calls written to the daemon and not yet answered, in write order. The daemon answers
 * serially, so a line without an id belongs to the oldest entry.
 */
export class PendingRequests {
  #entries = new Map<string, Entry>()
  #closed: { error: unknown } | undefined

  get size(): number {
    return this.#entries.size
  }

  add(id: string): Promise<SystemOneResult> {
    const closed = this.#closed
    if (closed != null) {
      // The daemon already exited: nothing would ever answer this call.
      return Promise.reject(closed.error)
    }
    return new Promise<SystemOneResult>((resolve, reject) => {
      this.#entries.set(id, { resolve, reject, discarded: false })
    })
  }

  /** Rejects the call now, but keeps its entry so the late response is consumed, not misrouted. */
  discard(id: string, reason: unknown): void {
    const entry = this.#entries.get(id)
    if (entry == null || entry.discarded) {
      return
    }
    entry.discarded = true
    entry.reject(reason)
  }

  settle(line: DaemonLine): void {
    if (line.kind === 'ready') {
      return
    }
    const id = line.kind === 'invalid' ? undefined : line.id
    const key = id == null ? this.#entries.keys().next().value : id
    if (key == null) {
      return
    }
    const entry = this.#entries.get(key)
    if (entry == null) {
      return
    }
    this.#entries.delete(key)
    if (entry.discarded) {
      return
    }
    if (line.kind === 'result') {
      entry.resolve(line.result)
    } else if (line.kind === 'error') {
      entry.reject(new SystemOneResponseError(`laya daemon error: ${line.message}`))
    } else {
      entry.reject(
        new SystemOneResponseError(`laya daemon wrote a non-JSON line: ${line.line.slice(0, 200)}`),
      )
    }
  }

  rejectAll(error: unknown): void {
    this.#closed = { error }
    for (const entry of this.#entries.values()) {
      if (!entry.discarded) {
        entry.reject(error)
      }
    }
    this.#entries.clear()
  }
}
