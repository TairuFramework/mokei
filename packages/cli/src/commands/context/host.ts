import { existsSync, rmSync } from 'node:fs'
import { startServer } from '@mokei/host'
import { startMonitor } from '@mokei/host-monitor'
import { Command, Flags } from '@oclif/core'
import { default as c } from 'ansi-colors'
import ora from 'ora'

import { socketPathFlag } from '../../flags.js'

export default class ContextHost extends Command {
  static description = 'Start a context host'

  static flags = {
    // force: Flags.boolean({ char: 'f', description: 'Force the host to start' }),
    path: socketPathFlag,
    port: Flags.integer({
      char: 'p',
      description: 'Port to listen on',
      default: 3001,
    }),
  }

  async run(): Promise<void> {
    const loader = ora().start('Starting host...')
    const { flags } = await this.parse(ContextHost)

    if (existsSync(flags.path)) {
      rmSync(flags.path)
    }
    const server = await startServer({ socketPath: flags.path })
    loader.info(`Host started on ${c.cyan(flags.path)}`).start('Starting monitor...')
    const monitor = await startMonitor({ port: flags.port, socketPath: flags.path })
    const url = `http://localhost:${flags.port}/`
    loader.succeed(`Monitor running on ${c.cyan(url)}`)

    process.on('SIGINT', () => {
      monitor.dispose()
      server.close()
      process.exit()
    })
  }
}
