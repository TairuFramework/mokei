import { NodeStreamsTransport } from '@enkaku/node-streams'
import {
  type ClientTransport,
  type ContextClient,
  type ContextTypes,
  type UnknownContextTypes,
  UnsupportedProtocolVersionError,
} from '@mokei/context-client'
import type { ProtocolVersion } from '@mokei/context-protocol'
import { isSupportedProtocolVersion } from '@mokei/context-protocol'
import { ContextHost, createHostedContext, type HostedContext } from '@mokei/host'

import { isSubprocessExit, type SpawnContextServerParams, spawnContextServer } from './spawn.js'

/** Default cap on total live stdout framer memory per context (8 MiB). */
const DEFAULT_MAX_BUFFER_SIZE = 8 * 1024 * 1024

/** Grace period (ms) between SIGTERM and SIGKILL when disposing a child. */
const DEFAULT_KILL_TIMEOUT = 5000

export type SpawnHostedContextParams = SpawnContextServerParams & {
  onExit?: (error: Error | null) => void
  /** Called when the stdout framing/read stream faults (invalid JSON or buffer overflow). */
  onStreamError?: (error: Error) => void
  /** Max total live framer memory in bytes. Default 8 MiB. */
  maxBufferSize?: number
  /** Optional tighter per-message cap in bytes. Default unset (= buffer cap). */
  maxMessageSize?: number
  /** Grace period (ms) between SIGTERM and SIGKILL on dispose. Default 5000. */
  killTimeout?: number
  /**
   * Revision the client speaks, or `'auto'` to probe the server. Defaults to `'auto'`:
   * the probe resolves `'2026-07-28'` when the server serves it and falls back to
   * `'2025-11-25'` otherwise. Pin a revision to skip the probe's extra round trip.
   */
  protocolVersion?: ProtocolVersion | 'auto'
}

export async function spawnHostedContext<T extends ContextTypes = UnknownContextTypes>(
  params: SpawnHostedContextParams,
): Promise<HostedContext<T>> {
  const {
    onExit,
    onStreamError,
    maxBufferSize,
    maxMessageSize,
    killTimeout,
    protocolVersion,
    ...spawnParams
  } = params
  // Validated before spawning: `ContextClient`'s constructor also rejects an unsupported pin,
  // but only after `createHostedContext` builds it below — by which point the child would
  // already be running with no disposer wired up to reap it. Same predicate the client uses, so
  // the supported-version list is not duplicated here.
  if (
    protocolVersion != null &&
    protocolVersion !== 'auto' &&
    !isSupportedProtocolVersion(protocolVersion)
  ) {
    throw new UnsupportedProtocolVersionError(protocolVersion)
  }
  const { childProcess, streams, subprocess } = await spawnContextServer(spawnParams)
  if (onExit != null) {
    subprocess.then(
      () => onExit(null),
      (error) => onExit(error as Error),
    )
  }
  const transport = new NodeStreamsTransport({
    streams,
    maxBufferSize: maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE,
    maxMessageSize,
    onInvalidJSON: (value, controller) => {
      // Strict: a server that can't speak clean JSONL is broken. Turn the bad
      // line into a stream error so it surfaces as `readFailed` and reaps the
      // context, instead of silently vanishing.
      controller.error(new Error(`Invalid JSON on context stdout: ${value.slice(0, 200)}`))
    },
  })
  // Single seam: every fatal framing fault (invalid JSON or buffer overflow)
  // surfaces here. No child kill — the host's reap disposes the transport (via
  // the dispose below), which kills the child, so handling the fault here would
  // only duplicate that teardown.
  transport.events.on('readFailed', ({ error }) => {
    onStreamError?.(error)
  })
  return createHostedContext({
    transport: transport as ClientTransport,
    protocolVersion,
    dispose: async () => {
      // Already exited — nothing to reap.
      if (childProcess.exitCode != null || childProcess.signalCode != null) {
        return
      }
      await new Promise<void>((resolve) => {
        let killTimer: ReturnType<typeof setTimeout>
        childProcess.once('exit', () => {
          clearTimeout(killTimer)
          resolve()
        })
        childProcess.kill('SIGTERM')
        killTimer = setTimeout(() => {
          // Child ignored SIGTERM; force it. The `exit` listener above still
          // resolves once the kill lands.
          childProcess.kill('SIGKILL')
        }, killTimeout ?? DEFAULT_KILL_TIMEOUT)
      })
    },
  })
}

export type AddLocalContextParams = SpawnContextServerParams & {
  key: string
  /** Override the default 8 MiB stdout framer memory cap. */
  maxBufferSize?: number
  /** Optional tighter per-message cap in bytes. */
  maxMessageSize?: number
  /**
   * Revision the client speaks, or `'auto'` to probe the server. Defaults to `'auto'`:
   * the probe resolves `'2026-07-28'` when the server serves it and falls back to
   * `'2025-11-25'` otherwise. Pin a revision to skip the probe's extra round trip.
   */
  protocolVersion?: ProtocolVersion | 'auto'
}

export class NodeContextHost extends ContextHost {
  async addLocalContext<T extends ContextTypes = UnknownContextTypes>(
    params: AddLocalContextParams,
  ): Promise<ContextClient<T>> {
    const { key, ...spawnParams } = params
    if (this._contexts[key] != null) {
      throw new Error(`Context ${key} already exists`)
    }

    // Set once when a framing fault is handled, so the follow-up `onExit` (from
    // the kill during reap) doesn't emit a second `context:failed`.
    let framingError: Error | null = null
    const context = await spawnHostedContext<T>({
      ...spawnParams,
      onStreamError: (error) => {
        // A framing fault only occurs while the read loop is actively pulling
        // the child's stdout — i.e. during a request the host drove (setup /
        // callTool). At that point the entry is still registered, so a present
        // entry is the normal case here. An idle context never reaches this:
        // with no consumer, the child's output is held by OS pipe backpressure
        // (bounded by the kernel pipe buffer, not host memory), so a flood from
        // an unused server cannot overflow the framer or exhaust the host.
        //
        // The `null` check guards the remaining teardown case: a `readFailed`
        // that lands after the entry is already gone (disposal, or the
        // re-rejection our own remove() causes) is noise, not a fault — this is
        // what keeps a clean remove() from emitting a bogus context:failed.
        if (this._contexts[key] == null) {
          return
        }
        framingError = error
        void this._events.emit('context:failed', { key, error }).catch(() => {})
        void this.remove(key).catch(() => {})
      },
      onExit: (error) => {
        if (framingError != null) {
          return
        }
        if (error != null && !isSubprocessExit(error)) {
          void this._events.emit('context:failed', { key, error }).catch(() => {})
        }
        void this.remove(key).catch(() => {})
      },
    })
    this._contexts[key] = context as unknown as HostedContext
    void this._events.emit('context:added', { key }).catch(() => {})
    return context.client
  }
}
