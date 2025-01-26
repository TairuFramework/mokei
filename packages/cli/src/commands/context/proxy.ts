import { Client } from '@enkaku/client'
import { createTransportStream } from '@enkaku/node-streams-transport'
import { SocketTransport } from '@enkaku/socket-transport'
import type { ClientMessage, Protocol, ServerMessage } from '@mokei/host-protocol'
import { Args, Command } from '@oclif/core'

import { socketPathFlag } from '../../flags.js'

export default class ContextProxy extends Command {
  static strict = false
  static description = 'Proxy a context server on a host'

  static args = {
    command: Args.string({
      description: 'Command to run the MCP server',
      required: true,
    }),
  }

  static flags = {
    path: socketPathFlag,
  }

  async run(): Promise<void> {
    const { args, argv, flags } = await this.parse(ContextProxy)
    const transport = new SocketTransport<ServerMessage, ClientMessage>({ socket: flags.path })
    const client = new Client<Protocol>({ transport })

    const channel = client.createChannel('spawn', {
      param: {
        command: args.command,
        args: argv.slice(1) as Array<string>,
      },
    })
    const stdio = await createTransportStream({ readable: process.stdin, writable: process.stdout })
    await Promise.all([
      channel.readable.pipeTo(stdio.writable),
      stdio.readable.pipeTo(channel.writable),
    ])
  }
}
