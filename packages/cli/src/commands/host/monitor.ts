import { Command, Flags } from '@oclif/core'
import ora from 'ora'

import { createClient } from '../../host/daemon/controller.js'

export default class HostMonitor extends Command {
  static description = 'Monitor a MCP host'

  static flags = {
    path: Flags.string({ char: 'p', description: 'Custom socket path' }),
  }

  async run(): Promise<void> {
    const loader = ora().start('Connecting to host...')
    const { flags } = await this.parse(HostMonitor)
    const client = createClient(flags.path)
    const stream = await client.createStream('events')
    loader.succeed('Connected to host, listening to events')
    const reader = stream.receive.getReader()
    while (true) {
      const next = await reader.read()
      if (next.done) {
        break
      }
      this.log(JSON.stringify(next.value))
    }
  }
}
