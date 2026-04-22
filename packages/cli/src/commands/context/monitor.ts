import { runDaemon } from '@mokei/host'
import { startMonitor } from '@mokei/host-monitor'
import { Command, Flags } from '@oclif/core'

import { socketPathFlag } from '../../flags.js'

export default class ContextMonitor extends Command {
  static description = 'Start a context host monitor'

  static flags = {
    path: socketPathFlag,
    port: Flags.integer({
      char: 'p',
      description: 'Port to use for the monitor UI server',
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(ContextMonitor)

    console.log('Starting monitor...')
    await runDaemon({ socketPath: flags.path })
    const monitor = await startMonitor({ port: flags.port, socketPath: flags.path })
    const url = `http://localhost:${monitor.port}/`
    console.log(`Monitor running on ${url}`)

    process.on('SIGINT', () => {
      monitor.disposer.dispose()
      process.exit()
    })
  }
}
