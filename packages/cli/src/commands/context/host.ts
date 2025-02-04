import { existsSync, rmSync } from 'node:fs'
import { runDaemon } from '@mokei/host'
import { type Monitor, startMonitor } from '@mokei/host-monitor'
import { Command, Flags } from '@oclif/core'
import { default as c } from 'ansi-colors'
import ora from 'ora'

import { socketPathFlag } from '../../flags.js'

export default class ContextHost extends Command {
  static description = 'Start a context host'

  static flags = {
    monitor: Flags.boolean({ char: 'm', description: 'Start the monitor UI' }),
    path: socketPathFlag,
    port: Flags.integer({
      char: 'p',
      description: 'Port to use for the monitor UI server',
      relationships: [{ type: 'all', flags: ['monitor'] }],
    }),
  }

  async run(): Promise<void> {
    const loader = ora().start('Starting host...')
    const { flags } = await this.parse(ContextHost)

    if (existsSync(flags.path)) {
      rmSync(flags.path)
    }
    await runDaemon({ socketPath: flags.path })
    loader.succeed(`Host started on ${c.cyan(flags.path)}`)

    let monitor: Monitor | undefined
    if (flags.monitor) {
      loader.start('Starting monitor...')
      monitor = await startMonitor({ port: flags.port ?? 3001, socketPath: flags.path })
      const url = `http://localhost:${monitor.port}/`
      loader.succeed(`Monitor running on ${c.cyan(url)}`)
    }

    process.on('SIGINT', () => {
      monitor?.disposer.dispose()
      process.exit()
    })
  }
}
