import { fileURLToPath } from 'node:url'
import { Client } from '@enkaku/client'
import { createTransportStream } from '@enkaku/node-streams-transport'
import { SocketTransport } from '@enkaku/socket-transport'
import type { ClientMessage, Protocol, ServerMessage } from '@mokei/host-protocol'
import { Command } from '@oclif/core'

import { socketPathFlag } from '../../flags.js'

const SQLITE_SERVER_PATH = fileURLToPath(
  import.meta.resolve('../../../../../mcp-servers/sqlite/lib/index.js'),
)

export default class HostProxy extends Command {
  static description = 'Proxy a MCP server on a host'

  static flags = {
    path: socketPathFlag,
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(HostProxy)
    const transport = new SocketTransport<ServerMessage, ClientMessage>({ socket: flags.path })
    const client = new Client<Protocol>({ transport })
    const [channel, stdio] = await Promise.all([
      client.createChannel('spawn', {
        command: 'node',
        args: [SQLITE_SERVER_PATH],
      }),
      createTransportStream({ readable: process.stdin, writable: process.stdout }),
    ])
    const channelWritable = new WritableStream({
      async write(msg) {
        await channel.send(msg)
      },
    })
    await Promise.all([
      channel.receive.pipeTo(stdio.writable),
      stdio.readable.pipeTo(channelWritable),
    ])
  }
}
