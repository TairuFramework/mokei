import { fileURLToPath } from 'node:url'
import { createTransportStream } from '@enkaku/node-streams-transport'
import { Command, Flags } from '@oclif/core'

import { createClient } from '../../host/daemon/controller.js'
import { socketPathFlag } from '../../host/flags.js'

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
    const client = createClient(flags.path)
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
