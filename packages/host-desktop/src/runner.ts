import { type ChildProcess, execFile } from 'node:child_process'

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

const KILL_ESCALATION_MS = 1000

export function createRunner(): Runner {
  const children = new Set<ChildProcess>()
  let disposed = false

  function run(command: string, args: Array<string>, options: RunOptions): Promise<RunResult> {
    if (disposed) {
      return Promise.reject(new Error('Runner disposed'))
    }
    const { timeoutMs, signal } = options
    if (signal?.aborted) {
      return Promise.reject(signal.reason)
    }

    return new Promise<RunResult>((resolve, reject) => {
      let timedOut = false
      let aborted = false
      let settled = false

      const child = execFile(
        command,
        args,
        { windowsHide: true, encoding: 'utf8' },
        (error, stdout, stderr) => {
          cleanup()
          if (settled) {
            return
          }
          settled = true
          if (aborted) {
            reject(signal?.reason)
            return
          }
          if (error != null) {
            const code = (error as NodeJS.ErrnoException).code
            // A string code (ENOENT, EACCES...) is a spawn failure; a number is the exit code
            if (typeof code === 'string') {
              reject(error)
              return
            }
            resolve({
              code: typeof code === 'number' ? code : null,
              stdout,
              stderr,
              timedOut,
            })
            return
          }
          resolve({ code: 0, stdout, stderr, timedOut })
        },
      )
      children.add(child)

      const timer = setTimeout(() => {
        timedOut = true
        child.kill('SIGTERM')
      }, timeoutMs)

      const onAbort = () => {
        aborted = true
        child.kill('SIGTERM')
      }
      signal?.addEventListener('abort', onAbort, { once: true })

      function cleanup() {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        children.delete(child)
      }
    })
  }

  async function dispose(): Promise<void> {
    disposed = true
    const live = [...children]
    if (live.length === 0) {
      return
    }
    for (const child of live) {
      child.kill('SIGTERM')
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        for (const child of live) {
          if (child.exitCode == null && child.signalCode == null) {
            child.kill('SIGKILL')
          }
        }
      }, KILL_ESCALATION_MS)
      let remaining = live.length
      const done = () => {
        remaining -= 1
        if (remaining === 0) {
          clearTimeout(timer)
          resolve()
        }
      }
      for (const child of live) {
        if (child.exitCode != null || child.signalCode != null) {
          done()
        } else {
          child.once('close', done)
        }
      }
    })
  }

  return { run, dispose }
}
