import { raceSignal } from '@sozai/async'

/** Rejects with the signal's reason as soon as it aborts, without waiting for `promise`. */
export function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  return signal == null ? promise : raceSignal(promise, signal)
}
