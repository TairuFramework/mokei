import {
  isSupportedProtocolVersion,
  PROTOCOL_VERSIONS,
  type ProtocolVersion,
} from '@mokei/context-protocol'
import { withSocketPath as tejikaWithSocketPath } from '@tejika/cli'
import type { Command } from 'commander'

/**
 * The accepted `--protocol` values, spelled for a human. Derived from `PROTOCOL_VERSIONS` so
 * adding a revision cannot leave the help text and the error message behind; `auto` is appended
 * separately because it is not a revision.
 */
const PROTOCOL_CHOICES = `${PROTOCOL_VERSIONS.join(', ')} or auto`

export const PROTOCOL_OPTION_DESCRIPTION = `protocol revision to speak: ${PROTOCOL_CHOICES}`

/**
 * Validates a user-supplied protocol revision. Without this the value would reach the client as
 * an unchecked cast and surface as an obscure internal failure rather than a usage error.
 */
export function parseProtocolOption(value: string): ProtocolVersion | 'auto' {
  if (value === 'auto' || isSupportedProtocolVersion(value)) {
    return value
  }
  throw new Error(`Unsupported protocol revision "${value}": expected ${PROTOCOL_CHOICES}`)
}

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
