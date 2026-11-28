import type { CLIResult, RunCLIOptions, SpawnedCLI } from '@tejika/test'
import { runCLI as run, spawnCLI as spawn } from '@tejika/test'

import { packageFile, packageRoot } from '../packages.js'

export const CLI_CWD = packageRoot('mokei')
export const CLI_BINARY = packageFile('mokei', 'bin/dev.js')

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
