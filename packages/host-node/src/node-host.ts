import { NodeStreamsTransport } from '@enkaku/node-streams'
import {
  type ClientTransport,
  type ContextClient,
  type ContextTypes,
  type ElicitHandler,
  type UnknownContextTypes,
  UnsupportedProtocolVersionError,
} from '@mokei/context-client'
import type { ProtocolVersion } from '@mokei/context-protocol'
import { isSupportedProtocolVersion } from '@mokei/context-protocol'
import {
  type ContextFactory,
  ContextHost,
  createHostedContext,
  type HostedContext,
  ReconnectDeclinedError,
  type ReconnectOptions,
} from '@mokei/host'

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
  elicit?: ElicitHandler
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
    elicit,
    ...spawnParams
  } = params
  // Validated before spawning: `ContextClient`'s constructor also rejects an unsupported pin,
  // but only after `createHostedContext` builds it below -- by which point the child would
  // already be running with no disposer wired up to reap it. Same predicate the client uses, so
  // the supported-version list is not duplicated here.
  if (
    protocolVersion != null &&
    protocolVersion !== 'auto' &&
    !isSupportedProtocolVersion(protocolVersion)
  ) {
    throw new UnsupportedProtocolVersionError({ received: protocolVersion })
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
  // surfaces here. No child kill -- the host's reap disposes the transport (via
  // the dispose below), which kills the child, so handling the fault here would
  // only duplicate that teardown.
  transport.events.on('readFailed', ({ error }) => {
    onStreamError?.(error)
  })
  return createHostedContext({
    transport: transport as ClientTransport,
    protocolVersion,
    elicit,
    dispose: async () => {
      // Already exited -- nothing to reap.
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

/** Decides the spawn params of a lost stdio context's next server, or `false` to give up. */
export type RespawnContextServer = (
  previous: SpawnContextServerParams,
) => SpawnContextServerParams | false | Promise<SpawnContextServerParams | false>

export type LocalReconnectOptions = ReconnectOptions & {
  /**
   * Called once per loss, before the first attempt, with the params of the last spawn. The params
   * it returns are used for every attempt of that loss and become `previous` for the next one;
   * `false` ends the reconnect with `context:failed`. Without it, each attempt reuses the
   * previous params.
   */
  respawn?: RespawnContextServer
}

export type AddLocalContextParams = SpawnContextServerParams & {
  key: string
  elicit?: false
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
  /**
   * Respawn the server when it exits or its output breaks, instead of removing the context
   * (`true` = defaults). Applies once `setup()` has committed the context's tools. Clients
   * returned by `addLocalContext` or read from `getContext(key).client` earlier go stale after a
   * reconnect; `getContext(key).client` always returns the current one.
   */
  reconnect?: boolean | LocalReconnectOptions
}

export class NodeContextHost extends ContextHost {
  #pendingKeys = new Set<string>()

  #isRegistration(key: string, registration: HostedContext): boolean {
    return this.hasContext({ key }) && this.getContext(key) === registration
  }

  async addLocalContext<T extends ContextTypes = UnknownContextTypes>(
    params: AddLocalContextParams,
  ): Promise<ContextClient<T>> {
    const {
      key,
      elicit,
      reconnect,
      maxBufferSize,
      maxMessageSize,
      protocolVersion,
      ...spawnParams
    } = params
    if (this.hasContext({ key }) || this.#pendingKeys.has(key)) {
      throw new Error(`Context ${key} already exists`)
    }
    this.#pendingKeys.add(key)

    let registration: HostedContext | undefined
    const elicitHandler = this.createElicitHandler({ key, elicit })

    // One server process. Its callbacks act only while its client is the registration's current
    // one: a candidate that never committed, or a generation already replaced, is ignored.
    const spawn = async (params: SpawnContextServerParams): Promise<HostedContext<T>> => {
      let client: ContextClient<T> | undefined
      const isCurrent = () => {
        if (client == null || registration == null || !this.#isRegistration(key, registration)) {
          return false
        }
        return registration.client === (client as unknown as ContextClient)
      }
      // Set once when a framing fault is handled, so the follow-up `onExit` (from
      // the kill during reap) doesn't report the loss a second time.
      let framingError: Error | null = null
      const context = await spawnHostedContext<T>({
        ...params,
        maxBufferSize,
        maxMessageSize,
        protocolVersion,
        elicit: elicitHandler,
        onStreamError: (error) => {
          // A framing fault only occurs while the read loop is actively pulling
          // the child's stdout -- i.e. during a request the host drove (setup /
          // callTool). At that point the entry is still registered, so a present
          // entry is the normal case here. An idle context never reaches this:
          // with no consumer, the child's output is held by OS pipe backpressure
          // (bounded by the kernel pipe buffer, not host memory), so a flood from
          // an unused server cannot overflow the framer or exhaust the host.
          //
          // The current-client check guards the remaining teardown case: a `readFailed`
          // that lands after the entry is already gone (disposal, or the
          // re-rejection our own remove() causes) is noise, not a fault -- this is
          // what keeps a clean remove() from emitting a bogus context:failed.
          if (client == null || !isCurrent()) {
            return
          }
          framingError = error
          if (this.isReconnectArmed(key)) {
            this.reportLoss(key, client as unknown as ContextClient, error)
            return
          }
          void this.events.emit('context:failed', { key, error }).catch(() => {})
          void this.remove(key, 'lost').catch(() => {})
        },
        onExit: (error) => {
          if (framingError != null || client == null || !isCurrent()) {
            return
          }
          if (this.isReconnectArmed(key)) {
            this.reportLoss(
              key,
              client as unknown as ContextClient,
              error ?? new Error(`Context ${key} server exited`),
            )
            return
          }
          if (error != null && !isSubprocessExit(error)) {
            void this.events.emit('context:failed', { key, error }).catch(() => {})
          }
          void this.remove(key, 'lost').catch(() => {})
        },
      })
      client = context.client
      return context
    }

    try {
      const context = await spawn(spawnParams)
      registration = context as unknown as HostedContext
      try {
        this.registerHostedContext({
          key,
          context: registration,
          transport: 'stdio',
          reconnect:
            reconnect == null || reconnect === false
              ? undefined
              : this.#createReconnect(key, registration, reconnect, spawnParams, spawn),
        })
      } catch (error) {
        await context.disposer.dispose()
        throw error
      }
      void this.events.emit('context:added', { key }).catch(() => {})
      return context.client
    } finally {
      this.#pendingKeys.delete(key)
    }
  }

  #createReconnect<T extends ContextTypes>(
    key: string,
    registration: HostedContext,
    reconnect: true | LocalReconnectOptions,
    initial: SpawnContextServerParams,
    spawn: (params: SpawnContextServerParams) => Promise<HostedContext<T>>,
  ): { options: ReconnectOptions; factory: ContextFactory } {
    const { respawn, ...options } = reconnect === true ? {} : reconnect
    let previous = initial
    // The params of the loss being reconnected, keyed by the lost client: it stays the
    // registration's client until a candidate commits, so every attempt of one loss sees it.
    let decision: {
      lost: ContextClient
      params: Promise<SpawnContextServerParams | false>
    } | null = null

    const paramsFor = (lost: ContextClient): Promise<SpawnContextServerParams | false> => {
      if (decision?.lost !== lost) {
        const params =
          respawn == null
            ? Promise.resolve(previous)
            : Promise.resolve()
                .then(() => respawn(previous))
                .then((next) => {
                  if (next !== false) previous = next
                  return next
                })
        decision = { lost, params }
      }
      return decision.params
    }

    const factory: ContextFactory = async () => {
      const lost = registration.client
      const params = await paramsFor(lost)
      if (params === false) {
        // The controller gives up: `context:failed` (attempts 0, this as cause), then removal.
        throw new ReconnectDeclinedError({ message: 'respawn declined' })
      }
      // A removal since the decision ends this loss: spawn nothing.
      if (!this.#isRegistration(key, registration) || registration.client !== lost) {
        throw new Error(`Context ${key} was removed during reconnect`)
      }
      const { client, disposer } = await spawn(params)
      return { client: client as unknown as ContextClient, disposer }
    }

    return { options, factory }
  }
}
