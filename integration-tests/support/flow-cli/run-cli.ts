import { fileURLToPath } from 'node:url'
import type { CLIResult, RunCLIOptions, SpawnedCLI } from '@tejika/test'
import { runCLI as run, spawnCLI as spawn } from '@tejika/test'

export const CLI_CWD = fileURLToPath(new URL('../../../packages/cli', import.meta.url))
export const CLI_BINARY = fileURLToPath(
  new URL('../../../packages/cli/bin/dev.js', import.meta.url),
)

const RUN_TIMEOUT_MS = 30_000

export type CLIEnv = Record<string, string>
type CLIOptions = { env?: CLIEnv; input?: string; timeoutMs?: number }

function cliOptions(options: CLIOptions): RunCLIOptions {
  return {
    command: process.execPath,
    cwd: CLI_CWD,
    env: { ...process.env, ...options.env },
    // Close stdin even when callers supply no input.
    input: options.input ?? '',
    timeoutMs: options.timeoutMs ?? RUN_TIMEOUT_MS,
  }
}

export function spawnCLI(args: Array<string>, options: CLIOptions = {}): SpawnedCLI {
  return spawn([CLI_BINARY, ...args], cliOptions(options))
}

export function runCLI(args: Array<string>, options: CLIOptions = {}): Promise<CLIResult> {
  return run([CLI_BINARY, ...args], cliOptions(options))
}
