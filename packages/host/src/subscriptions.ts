import type { ContextClient } from '@mokei/context-client'

import { ContextUnavailableError } from './errors.js'
import { type GatedSend, isLossError, runGated } from './gate.js'
import type { HostedContext } from './hosted-context.js'
import type { ReconnectController } from './reconnect.js'

/**
 * A registration's resource subscriptions made through the host: the URIs the consumer wants,
 * and the one queue that serialises subscribe, unsubscribe and restoration.
 */
export type ResourceSubscriptions = {
  desired: Set<string>
  /** Settles when the last queued change has; never rejects. */
  tail: Promise<void>
}

/** The part of a registration's host-side state the subscriptions read. */
export type SubscriptionState = {
  subscriptions: ResourceSubscriptions
  controller?: ReconnectController
}

/** What the subscriptions need from the host, without access to its private state. */
export type ContextSubscriptionsParams = {
  /** Whether `registration` is still the key's registration. */
  isRegistered: (key: string, registration: HostedContext) => boolean
  /**
   * Whether `registration` is still the key's, `client` still its current client and no loss
   * happened since `generation` was read.
   */
  owns: (
    key: string,
    registration: HostedContext,
    client: ContextClient,
    generation: number | undefined,
  ) => boolean
  stateOf: (registration: HostedContext) => SubscriptionState
  /** Emits `resource:subscription-lost`. */
  onLost: (event: { key: string; uri: string; error: Error }) => void
}

/** Whether `client`'s acknowledged listen filter carries `uri`. */
export function hasResourceSubscription(client: ContextClient, uri: string): boolean {
  return client.subscriptionFilter?.resourceSubscriptions?.includes(uri) === true
}

function enqueueSubscription(
  subscriptions: ResourceSubscriptions,
  task: () => Promise<void>,
): Promise<void> {
  const run = subscriptions.tail.then(task)
  subscriptions.tail = run.then(
    () => {},
    () => {},
  )
  return run
}

/** Resource subscriptions made through the host, kept and restored across reconnects. */
export class ContextSubscriptions {
  #host: ContextSubscriptionsParams

  constructor(params: ContextSubscriptionsParams) {
    this.#host = params
  }

  /**
   * Subscribes to a resource's updates (`2026-07-28`). Resolves once the server acknowledges it;
   * only then is the URI recorded, so a context added with `reconnect` subscribes to it again on
   * each new connection. Changes for one context run one at a time, in call order.
   */
  subscribe(
    key: string,
    registration: HostedContext,
    uri: string,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const { subscriptions } = this.#host.stateOf(registration)
    return enqueueSubscription(subscriptions, async () => {
      await this.#sendSubscriptionChange(key, registration, signal, (client, timeout) =>
        client.subscribeResource({ uri, signal, timeout }),
      )
      if (this.#host.isRegistered(key, registration)) {
        subscriptions.desired.add(uri)
      }
    })
  }

  /**
   * Unsubscribes from a resource's updates. The URI stops being restored at once, even while a
   * restoration is running; if the server refuses the change the URI is kept, as the client keeps
   * it, and the call rejects.
   */
  unsubscribe(
    key: string,
    registration: HostedContext,
    uri: string,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const { subscriptions } = this.#host.stateOf(registration)
    // Removed now rather than when the queue reaches this change, so a restoration ahead of it
    // in the queue skips the URI.
    let wasDesired = subscriptions.desired.delete(uri)
    return enqueueSubscription(subscriptions, async () => {
      // A subscribe queued ahead of this change may have recorded it since.
      wasDesired = subscriptions.desired.delete(uri) || wasDesired
      try {
        await this.#sendSubscriptionChange(key, registration, signal, (client, timeout) =>
          client.unsubscribeResource({ uri, signal, timeout }),
        )
      } catch (error) {
        if (wasDesired && this.#host.isRegistered(key, registration)) {
          // The unsubscribe did not happen: the URI is still wanted.
          subscriptions.desired.add(uri)
          await this.#reconcileSubscription(key, registration, uri)
        }
        throw error
      }
    })
  }

  /** Sends a subscription change, through the gate when the context can reconnect. */
  async #sendSubscriptionChange(
    key: string,
    registration: HostedContext,
    signal: AbortSignal | undefined,
    send: GatedSend<void>,
  ): Promise<void> {
    if (!this.#host.isRegistered(key, registration)) {
      throw new ContextUnavailableError({
        key,
        cause: new Error(`Context ${key} was removed while the change waited`),
      })
    }
    const controller = this.#host.stateOf(registration).controller
    if (controller == null) {
      await send(registration.client, undefined)
      return
    }
    await runGated({
      key,
      registration,
      controller,
      isRegistered: () => this.#host.isRegistered(key, registration),
      options: { signal },
      request: { send },
    })
  }

  /**
   * Re-subscribes a desired URI that the current client's acknowledged filter lacks (a restoration
   * skipped it while its unsubscribe was pending). Runs inside the subscription queue. Waits for
   * nothing during a reconnect: the coming restoration covers the URI.
   */
  async #reconcileSubscription(
    key: string,
    registration: HostedContext,
    uri: string,
  ): Promise<void> {
    const state = this.#host.stateOf(registration)
    if (state.controller?.state === 'reconnecting') return
    const client = registration.client
    if (hasResourceSubscription(client, uri)) return
    await this.#resubscribe(key, registration, state, client, state.controller?.generation, uri)
  }

  /**
   * Subscribes `client` to a desired `uri` on the host's behalf, with no caller signal (over HTTP,
   * `subscriptions/listen` is always sent non-interactive, so this never opens a sign-in). A
   * refusal drops the URI with `resource:subscription-lost`; a loss keeps it for the next
   * connection. Returns `false` when `client` stopped being current.
   */
  async #resubscribe(
    key: string,
    registration: HostedContext,
    state: SubscriptionState,
    client: ContextClient,
    generation: number | undefined,
    uri: string,
  ): Promise<boolean> {
    try {
      await client.subscribeResource({ uri })
      return this.#host.owns(key, registration, client, generation)
    } catch (cause) {
      if (!this.#host.owns(key, registration, client, generation)) return false
      const error = cause instanceof Error ? cause : new Error(String(cause))
      if (isLossError(cause)) {
        if (generation != null) state.controller?.lose(generation, error)
        return false
      }
      this.#dropSubscription(key, state, uri, error)
      return true
    }
  }

  #dropSubscription(key: string, state: SubscriptionState, uri: string, error: Error): void {
    state.subscriptions.desired.delete(uri)
    this.#host.onLost({ key, uri, error })
  }

  /**
   * Subscribes the new client of a reconnected context to the desired URIs, one at a time, in the
   * subscription queue. The gate is already open: calls never wait for this. URIs unsubscribed
   * meanwhile are skipped, and it stops when the client stops being current. A URI the new server
   * refuses (or cannot subscribe to) is dropped with `resource:subscription-lost`. Restoration
   * never opens a sign-in: the HTTP transport always sends `subscriptions/listen` non-interactive.
   */
  restore(
    key: string,
    registration: HostedContext,
    state: SubscriptionState,
    client: ContextClient,
    generation: number,
  ): void {
    const { subscriptions } = state
    void enqueueSubscription(subscriptions, async () => {
      // Read from the discovery snapshot, not a request: a request here could open a sign-in.
      // `null` (not discovered yet, or invalidated by a list change) is unknown, not unsupported:
      // each URI is then tried, and a refusal drops only that URI.
      const capabilities = client.discoveredCapabilities
      const unsupported = capabilities != null && capabilities.resources?.subscribe !== true
      for (const uri of Array.from(subscriptions.desired)) {
        if (!this.#host.owns(key, registration, client, generation)) return
        if (!subscriptions.desired.has(uri)) continue
        if (unsupported) {
          this.#dropSubscription(
            key,
            state,
            uri,
            new Error(`Context ${key}'s server does not support resource subscriptions`),
          )
          continue
        }
        if (!(await this.#resubscribe(key, registration, state, client, generation, uri))) return
      }
    })
  }
}
