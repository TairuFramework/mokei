import { basename } from 'node:path'
import type { Writable } from 'node:stream'
import {
  type SystemOneBackend,
  type SystemOneBackendPredictParams,
  SystemOneConnectionError,
  SystemOneError,
  type SystemOneModel,
  type SystemOneResult,
} from '@mokei/system-one-client'
import spawn, { SubprocessError } from 'nano-spawn'

import { PendingRequests, parseDaemonLine } from './protocol.js'

const DEFAULT_STARTUP_TIMEOUT_MS = 60_000
const CLOSE_GRACE_MS = 5_000
const STDERR_TAIL_LINES = 20

export type LayaDaemonBackendParams = {
  /** Path to a compiled Laya GGUF. One of `model` or `modelsDir` is required. */
  model?: string
  /** Directory of Laya GGUFs; the daemon routes english vs multilingual. */
  modelsDir?: string
  /** The `laya` executable. Defaults to `laya` on PATH. */
  binary?: string
  /** `--family`: auto, english, multilingual or typed-decisions. */
  family?: string
  /** `--device`: auto, cpu, cuda or metal. */
  device?: string
  /** `--threads`: CPU workers. */
  threads?: number
  /** How long to wait for the daemon's ready line. Defaults to 60 seconds. */
  startupTimeoutMs?: number
}

type Daemon = {
  stdin: Writable
  pending: PendingRequests
  exited: Promise<void>
  kill: () => void
  state: { closing: boolean }
}

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  promise.catch(() => {})
  return { promise, resolve, reject }
}

function formatTail(stderrTail: Array<string>): string {
  return stderrTail.length > 0 ? `: ${stderrTail.join('\n')}` : ''
}

function exitError(failure: unknown, stderrTail: Array<string>): SystemOneConnectionError {
  const tail = formatTail(stderrTail)
  if (failure instanceof SubprocessError) {
    if (failure.signalName != null) {
      return new SystemOneConnectionError(`laya daemon exited on ${failure.signalName}${tail}`, {
        cause: failure,
      })
    }
    if (failure.exitCode != null) {
      return new SystemOneConnectionError(
        `laya daemon exited with code ${failure.exitCode}${tail}`,
        {
          cause: failure,
        },
      )
    }
    return new SystemOneConnectionError(`Failed to start laya daemon: ${failure.message}`, {
      cause: failure,
    })
  }
  return new SystemOneConnectionError(`laya daemon exited${tail}`)
}

function daemonArgs(params: LayaDaemonBackendParams): Array<string> {
  const args = ['daemon']
  if (params.model != null) args.push(params.model)
  if (params.modelsDir != null) args.push('--models-dir', params.modelsDir)
  if (params.family != null) args.push('--family', params.family)
  if (params.device != null) args.push('--device', params.device)
  if (params.threads != null) args.push('--threads', String(params.threads))
  return args
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal == null) {
    return promise
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

/**
 * Runs Laya models through a long-lived `laya daemon` process: one JSON request per stdin
 * line, one response per stdout line, correlated by id. The process starts on the first call,
 * restarts after an exit, and stops on `close()`.
 */
export class LayaDaemonBackend implements SystemOneBackend {
  #params: LayaDaemonBackendParams
  #daemon: Promise<Daemon> | undefined
  #nextID = 0

  constructor(params: LayaDaemonBackendParams) {
    if (params.model == null && params.modelsDir == null) {
      throw new SystemOneError('LayaDaemonBackend requires `model` or `modelsDir`')
    }
    this.#params = params
  }

  async predict(params: SystemOneBackendPredictParams): Promise<SystemOneResult> {
    const { signal } = params
    signal?.throwIfAborted()
    const daemon = await abortable(this.#getDaemon(), signal)
    signal?.throwIfAborted()
    // The daemon ignores `model`: its router picks the family from the loaded GGUF(s).
    const id = String(++this.#nextID)
    // Serialize before registering: a state JSON cannot encode must not leave an orphan entry
    // that would take the next id-less response.
    const line = `${JSON.stringify({ id, state: params.state, questions: params.questions })}\n`
    const response = daemon.pending.add(id)
    const onAbort = () => daemon.pending.discard(id, signal?.reason)
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      daemon.stdin.write(line)
      return await response
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }
  }

  async listModels(): Promise<Array<SystemOneModel>> {
    const { model, modelsDir } = this.#params
    return [{ name: model != null ? basename(model) : (modelsDir as string) }]
  }

  async close(): Promise<void> {
    const started = this.#daemon
    this.#daemon = undefined
    if (started == null) {
      return
    }
    const daemon = await started.catch(() => undefined)
    if (daemon == null) {
      return
    }
    daemon.state.closing = true
    daemon.stdin.end()
    const timer = setTimeout(daemon.kill, CLOSE_GRACE_MS)
    await daemon.exited
    clearTimeout(timer)
  }

  #getDaemon(): Promise<Daemon> {
    if (this.#daemon == null) {
      const started: Promise<Daemon> = this.#startDaemon(() => {
        if (this.#daemon === started) {
          this.#daemon = undefined
        }
      })
      started.catch(() => {})
      this.#daemon = started
    }
    return this.#daemon
  }

  async #startDaemon(onExit: () => void): Promise<Daemon> {
    const subprocess = spawn(this.#params.binary ?? 'laya', daemonArgs(this.#params), {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    // Guard the subprocess promise so a spawn failure or abnormal exit is never an unhandled
    // rejection; the exit handler below reports it.
    subprocess.catch(() => {})
    const pending = new PendingRequests()
    const stderrTail: Array<string> = []
    const state = { closing: false }
    const ready = deferred<void>()

    // nano-spawn requires line iteration to start synchronously after spawn().
    const readStdout = (async () => {
      for await (const line of subprocess.stdout) {
        const parsed = parseDaemonLine(line)
        if (parsed.kind === 'ready') {
          ready.resolve()
        } else {
          pending.settle(parsed)
        }
      }
    })()
    const readStderr = (async () => {
      for await (const line of subprocess.stderr) {
        stderrTail.push(line)
        if (stderrTail.length > STDERR_TAIL_LINES) {
          stderrTail.shift()
        }
      }
    })()
    const exited = Promise.allSettled([readStdout, readStderr]).then(async () => {
      const failure = await subprocess.then(
        () => undefined,
        (error: unknown) => error,
      )
      const error = state.closing
        ? new SystemOneConnectionError('laya daemon closed')
        : exitError(failure, stderrTail)
      ready.reject(error)
      pending.rejectAll(error)
      onExit()
    })

    const child = await subprocess.nodeChildProcess.catch(() => undefined)
    const stdin = child?.stdin
    if (child == null || stdin == null) {
      await ready.promise
      throw new SystemOneConnectionError('Failed to start laya daemon')
    }
    // Writing after a crash raises EPIPE here; the exit handler rejects the pending calls.
    stdin.on('error', () => {})
    const kill = () => {
      child.kill('SIGTERM')
    }

    const timeoutMs = this.#params.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS
    const timer = setTimeout(() => {
      ready.reject(
        new SystemOneConnectionError(
          `laya daemon was not ready after ${timeoutMs}ms${formatTail(stderrTail)}`,
        ),
      )
      kill()
    }, timeoutMs)
    try {
      await ready.promise
    } finally {
      clearTimeout(timer)
    }
    return { stdin, pending, exited, kill, state }
  }
}
