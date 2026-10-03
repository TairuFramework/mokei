import type { InboxItem } from '@mokei/flow-host'

export type PromptOutcome = { action: 'accept' | 'decline' | 'cancel' }
export type SurfaceStatus = 'attended' | 'reachable' | 'unavailable'
export type SurfaceDelivery = {
  /** Withdraws the notification (or prompt) if still shown. Idempotent. */
  close(): void
  /** Resolves when the delivery is gone: closed, settled, or its target lost. */
  closed: Promise<void>
}
export type InboxSurface = {
  name: string
  /** Cheap, synchronous hint; delivery methods verify liveness themselves. */
  status(): SurfaceStatus
  /** Verified attention: resolves true only when an attended target answered a fresh ping. */
  isAttended(signal: AbortSignal): Promise<boolean>
  /** Resolves null when the surface could not deliver; the next surface is tried. */
  notify(item: InboxItem, options: { signal: AbortSignal }): Promise<SurfaceDelivery | null>
  /**
   * Resolves null when the surface could not show the prompt (the next surface is tried), or a delivery whose
   * settlement the controller observes.
   */
  prompt?(item: InboxItem, options: { signal: AbortSignal }): Promise<SurfaceDelivery | null>
}
