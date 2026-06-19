import { DEFAULT_SOCKET_PATH } from '@mokei/host-protocol'
import type { Command } from 'commander'

export function withChatOptions(cmd: Command): Command {
  return cmd
    .option('-p, --provider <name>', 'model provider (ollama, openai, anthropic)')
    .option(
      '-k, --api-key <key>',
      'provider API key (or set OPENAI_API_KEY / ANTHROPIC_API_KEY; env var preferred, -k leaks via ps/shell history)',
    )
    .option('-u, --api-url <url>', 'provider API URL')
    .option('-m, --model <name>', 'name of the model to use')
    .option('-t, --timeout <seconds>', 'agent turn timeout in seconds', '300')
}

export function withSocketPath(cmd: Command): Command {
  return cmd.option('-s, --path <path>', 'socket path', DEFAULT_SOCKET_PATH)
}
