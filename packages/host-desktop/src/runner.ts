import { execa, type ResultPromise } from 'execa'

export type RunOptions = { timeoutMs: number; signal?: AbortSignal }
export type RunResult = {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}
export type Runner = {
  run(command: string, args: Array<string>, options: RunOptions): Promise<RunResult>
  dispose(): Promise<void>
}

/** Grace period between SIGTERM and SIGKILL for a timeout, an abort or dispose. */
const KILL_ESCALATION_MS = 1000

export function createRunner(): Runner {
  const children = new Set<ResultPromise>()
  let disposed = false

  async function run(
    command: string,
    args: Array<string>,
    options: RunOptions,
  ): Promise<RunResult> {
    if (disposed) {
      throw new Error('Runner disposed')
    }
    const { timeoutMs, signal } = options
    signal?.throwIfAborted()

    // No shell: the command and each argument are passed as they are
    const child = execa(command, args, {
      timeout: timeoutMs,
      cancelSignal: signal,
      forceKillAfterDelay: KILL_ESCALATION_MS,
      cleanup: true,
      reject: false,
      stripFinalNewline: false,
      windowsHide: true,
    })
    children.add(child)
    let result: Awaited<typeof child>
    try {
      // Settles only once the process has exited, after any SIGKILL escalation
      result = await child
    } finally {
      children.delete(child)
    }

    if (signal?.aborted) {
      throw signal.reason
    }
    if (
      result.failed &&
      result.exitCode === undefined &&
      !result.timedOut &&
      !result.isTerminated
    ) {
      // A spawn failure (ENOENT, EACCES...): `reject: false` returns the error as the result
      throw result
    }
    return {
      code: result.exitCode ?? null,
      stdout: String(result.stdout ?? ''),
      stderr: String(result.stderr ?? ''),
      timedOut: result.timedOut,
    }
  }

  async function dispose(): Promise<void> {
    disposed = true
    const live = [...children]
    for (const child of live) {
      // `kill()` applies `forceKillAfterDelay`: SIGTERM, then SIGKILL after the grace period
      child.kill()
    }
    await Promise.allSettled(live)
  }

  return { run, dispose }
}
