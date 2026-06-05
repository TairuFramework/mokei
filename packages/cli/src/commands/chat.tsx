import { Command } from 'commander'

import { ChatLauncher } from '../chat/ChatLauncher.js'
import { runInk } from '../ink.js'
import { withChatOptions } from '../options.js'

export function createChatCommand(): Command {
  const cmd = new Command('chat').description('Interactive chat with a model provider')

  withChatOptions(cmd)

  cmd.action(async (opts: Record<string, string | undefined>) => {
    const timeoutSec = Number.parseInt(opts.timeout ?? '300', 10)
    if (Number.isNaN(timeoutSec)) {
      console.error('error: --timeout must be a number (seconds)')
      process.exitCode = 1
      return
    }
    await runInk(ChatLauncher, {
      initialProvider: opts.provider,
      chatOptions: {
        apiKey: opts.apiKey,
        apiUrl: opts.apiUrl,
        model: opts.model,
        timeoutMs: timeoutSec * 1000,
      },
    })
  })

  return cmd
}
