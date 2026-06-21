import { createTransportStream } from '@enkaku/node-streams'
import { runDaemon } from '@mokei/host'
import { Command } from 'commander'

import { withSocketPath } from '../options.js'

export function createProxyCommand(): Command {
  const cmd = new Command('proxy')
    .description('Proxy an MCP context server on a host')
    .argument('<command>', 'command to run the MCP server')
    .argument('[args...]', 'arguments for the server command')
    .passThroughOptions()

  withSocketPath(cmd)

  cmd.action(
    async (command: string, args: Array<string>, opts: Record<string, string | undefined>) => {
      const client = await runDaemon({ socketPath: opts.path })
      const channel = client.createChannel('spawn', {
        param: { command, args },
      })
      const stdio = await createTransportStream({
        readable: process.stdin,
        writable: process.stdout,
      })
      await Promise.all([
        channel.readable.pipeTo(stdio.writable),
        stdio.readable.pipeTo(channel.writable),
      ])
    },
  )

  return cmd
}
