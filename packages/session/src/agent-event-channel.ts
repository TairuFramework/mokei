import type { ProviderTypes } from '@mokei/model-provider'

import type { AgentEvent } from './agent-types.js'

/** Ordered events produced outside the async generator's current turn. */
export class AgentEventChannel<T extends ProviderTypes = ProviderTypes> {
  #events: Array<AgentEvent<T>> = []
  #waiters = new Set<() => void>()
  #closed = false

  push(event: AgentEvent<T>): void {
    if (this.#closed) return
    this.#events.push(event)
    this.#wake()
  }

  takeAll(): Array<AgentEvent<T>> {
    return this.#events.splice(0)
  }

  waitForEvent(): Promise<void> {
    if (this.#events.length > 0 || this.#closed) return Promise.resolve()
    return new Promise((resolve) => this.#waiters.add(resolve))
  }

  close(): void {
    this.#closed = true
    this.#wake()
  }

  #wake(): void {
    for (const resolve of this.#waiters) resolve()
    this.#waiters.clear()
  }
}
