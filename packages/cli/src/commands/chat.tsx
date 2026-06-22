import { runInk } from '@tejika/cli'
import { Command } from 'commander'
import { ChatLauncher, type ChatLifecycle } from '../chat/ChatLauncher.js'
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
    await runInk(
      <ChatLauncher
        initialProvider={opts.provider}
        chatOptions={{
          apiKey: opts.apiKey,
          apiUrl: opts.apiUrl,
          model: opts.model,
          timeoutMs: timeoutSec * 1000,
        }}
        lifecycle={lifecycle}
      />,
    )
    // The ink app has exited; dispose the session so the daemon socket is
    // released (ContextHost._dispose → client.dispose, and @enkaku/socket
    // unref's the socket on dispose) and the process can exit cleanly.
    await lifecycle.dispose?.()
  })

  return cmd
}
