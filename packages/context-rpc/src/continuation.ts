import type { RequestID } from '@mokei/context-protocol'

export type ContinuationEntry = {
  exchangeID: RequestID
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

/**
 * Correlates input sub-requests by opaque token, decoupled from the outer
 * request id. Each entry is settled at most once and removed on settle.
 */
export class ContinuationStore {
  #entries: Map<string, ContinuationEntry> = new Map()

  register(token: string, entry: ContinuationEntry): void {
    this.#entries.set(token, entry)
  }

  route(token: string, result: { value: unknown } | { error: Error }): void {
    const entry = this.#entries.get(token)
    if (entry == null) {
      return
    }
    this.#entries.delete(token)
    if ('error' in result) {
      entry.reject(result.error)
    } else {
      entry.resolve(result.value)
    }
  }

  clearForExchange(exchangeID: RequestID, reason: Error): void {
    for (const [token, entry] of this.#entries) {
      if (entry.exchangeID === exchangeID) {
        this.#entries.delete(token)
        entry.reject(reason)
      }
    }
  }

  clearAll(reason: Error): void {
    const entries = Array.from(this.#entries.values())
    this.#entries.clear()
    for (const entry of entries) {
      entry.reject(reason)
    }
  }
}
