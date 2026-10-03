import { type ChildProcessByStdio, spawn } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'

export const CLI_CWD = fileURLToPath(new URL('../../../packages/cli', import.meta.url))
export const CLI_BINARY = fileURLToPath(
  new URL('../../../packages/cli/bin/dev.js', import.meta.url),
)

const RUN_TIMEOUT_MS = 30_000

export type CLIEnv = Record<string, string>
export type CLIResult = { code: number | null; stdout: string; stderr: string }
export type SpawnedCLI = {
  child: ChildProcessByStdio<Writable, Readable, Readable>
  /** Output captured so far. */
  stdout: () => string
  stderr: () => string
  /** Settles when the process exits; kills it after `timeoutMs`. */
  done: Promise<CLIResult>
}

/**
 * Spawns `mokei <args>` from `packages/cli` with piped stdio (so never a TTY) and `env` layered
 * over the parent environment. `input` is written to stdin, which is then closed.
 */
export function spawnCLI(
  args: Array<string>,
  options: { env: CLIEnv; input?: string; timeoutMs?: number },
): SpawnedCLI {
  const child = spawn(process.execPath, [CLI_BINARY, ...args], {
    cwd: CLI_CWD,
    env: { ...process.env, ...options.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString()
  })
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })
  child.stdin.on('error', () => {})
  child.stdin.end(options.input)
  const done = new Promise<CLIResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(
        new Error(
          `mokei ${args.join(' ')} timed out after ${options.timeoutMs ?? RUN_TIMEOUT_MS}ms\nstdout: ${stdout}\nstderr: ${stderr}`,
        ),
      )
    }, options.timeoutMs ?? RUN_TIMEOUT_MS)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
  return { child, stdout: () => stdout, stderr: () => stderr, done }
}

export function runCLI(
  args: Array<string>,
  options: { env: CLIEnv; input?: string },
): Promise<CLIResult> {
  return spawnCLI(args, options).done
}
