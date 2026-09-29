import type { ProviderTypes } from '@mokei/model-provider'

import type { AgentEvent } from './agent-types.js'

/** Ordered events produced outside the async generator's current turn. */
export class AgentEventChannel<T extends ProviderTypes = ProviderTypes> {
  #events: Array<AgentEvent<T>> = []
  #waiters = new Set<() => void>()
  #drainWaiters = new Set<() => void>()
  #taken = 0
  #closed = false

  push(event: AgentEvent<T>): void {
    if (this.#closed) return
    this.#events.push(event)
    this.#wake()
  }

  takeAll(): Array<AgentEvent<T>> {
    const events = this.#events.splice(0)
    this.#taken += events.length
    return events
  }

  acknowledge(count: number): void {
    this.#taken -= count
    this.#wakeDrain()
  }

  waitForDrain(): Promise<void> {
    if (this.isDrained()) {
      return Promise.resolve()
    }
    return new Promise((resolve) => this.#drainWaiters.add(resolve))
  }

  isDrained(): boolean {
    return this.#closed || (this.#events.length === 0 && this.#taken === 0)
  }

  waitForEvent(): Promise<void> {
    if (this.#events.length > 0 || this.#closed) return Promise.resolve()
    return new Promise((resolve) => this.#waiters.add(resolve))
  }

  close(): void {
    this.#closed = true
    this.#wake()
    this.#wakeDrain()
  }

  #wake(): void {
    for (const resolve of this.#waiters) resolve()
    this.#waiters.clear()
  }

  #wakeDrain(): void {
    if (!this.#closed && (this.#events.length > 0 || this.#taken > 0)) return
    for (const resolve of this.#drainWaiters) resolve()
    this.#drainWaiters.clear()
  }
}
