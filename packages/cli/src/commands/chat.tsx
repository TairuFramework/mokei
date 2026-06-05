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
    // then exit explicitly. The daemon connection is an idle Unix socket whose
    // enkaku transport stream is never materialized when no context was added, so
    // the dispose-time socket.unref() in @enkaku/socket-transport never runs and
    // the ref'd handle keeps the loop alive. See
    // docs/agents/issues/2026-06-05-enkaku-socket-transport-dispose-leak.md.
    await lifecycle.dispose?.()
    process.exit(process.exitCode ?? 0)
  })

  return cmd
}
