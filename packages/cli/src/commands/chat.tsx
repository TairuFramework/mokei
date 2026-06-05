import { Command } from 'commander'

import { ChatLauncher, type ChatLifecycle } from '../chat/ChatLauncher.js'
import { runInk } from '../ink.js'
import { withChatOptions } from '../options.js'

export function createChatCommand(): Command {
  const cmd = new Command('chat').description('Interactive chat with a model provider')

  withChatOptions(cmd)

  cmd.action(async (opts: Record<string, string | undefined>) => {
    const timeoutSec = Number(opts.timeout ?? '300')
    if (!Number.isFinite(timeoutSec) || timeoutSec <= 0) {
      console.error('error: --timeout must be a positive number of seconds')
      process.exitCode = 1
      return
    }
    const lifecycle: ChatLifecycle = { dispose: null }
    await runInk(ChatLauncher, {
      initialProvider: opts.provider,
      chatOptions: {
        apiKey: opts.apiKey,
        apiUrl: opts.apiUrl,
        model: opts.model,
        timeoutMs: timeoutSec * 1000,
      },
      lifecycle,
    })
    // The ink app has exited. Dispose the session for a clean daemon disconnect,
    // then exit explicitly: the daemon client holds a persistent socket that
    // keeps the event loop alive, so the process would otherwise hang on quit.
    await lifecycle.dispose?.()
    process.exit(process.exitCode ?? 0)
  })

  return cmd
}
