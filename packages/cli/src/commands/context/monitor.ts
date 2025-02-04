import { runDaemon } from '@mokei/host'
import { startMonitor } from '@mokei/host-monitor'
import { Command, Flags } from '@oclif/core'
import { default as c } from 'ansi-colors'
import ora from 'ora'

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
    const loader = ora().start('Starting monitor...')
    const { flags } = await this.parse(ContextMonitor)

    await runDaemon({ socketPath: flags.path })
    const monitor = await startMonitor({ port: flags.port ?? 3001, socketPath: flags.path })
    const url = `http://localhost:${monitor.port}/`
    loader.succeed(`Monitor running on ${c.cyan(url)}`)

    process.on('SIGINT', () => {
      monitor.disposer.dispose()
      process.exit()
    })
  }
}
