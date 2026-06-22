import { withSocketPath as tejikaWithSocketPath } from '@tejika/cli'
import type { Command } from 'commander'

export function withChatOptions(cmd: Command): Command {
  return cmd
    .option('-p, --provider <name>', 'model provider (ollama, openai, anthropic, llama)')
    .option(
      '-k, --api-key <key>',
      'provider API key (or set OPENAI_API_KEY / ANTHROPIC_API_KEY; env var preferred, -k leaks via ps/shell history)',
    )
    .option('-u, --api-url <url>', 'provider API URL')
    .option('-m, --model <name>', 'model name (or GGUF file path for llama)')
    .option('-t, --timeout <seconds>', 'agent turn timeout in seconds', '300')
}

/**
 * Add `-s, --socket-path <path>`, defaulting (lazily, at action time) to
 * `@tejika/env`'s socket path for app "mokei" — the same path the host daemon
 * binds by default. Delegates to `@tejika/cli`.
 */
export function withSocketPath(cmd: Command): Command {
  return tejikaWithSocketPath(cmd, 'mokei')
}
