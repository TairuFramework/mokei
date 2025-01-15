import { existsSync, rmSync } from 'node:fs'
import { Command, Flags } from '@oclif/core'
import { default as c } from 'ansi-colors'
import ora from 'ora'

import { DEFAULT_SOCKET_PATH } from '../../host/constants.js'
import { startServer } from '../../host/daemon/server.js'

// import {
//   type HostClient,
//   type StartDaemonParams,
//   createClient,
//   startDaemon,
// } from '../../host/daemon/controller.js'
// import type { HostInfoResult } from '../../host/protocol.js'

// type Connected = {
//   client: HostClient
//   info: HostInfoResult
//   socketPath: string
// }

// async function tryConnect(params: StartDaemonParams): Promise<Connected> {
//   const [status, socketPath] = await startDaemon(params)
//   if (status !== 'OK') {
//     throw new Error(`Unexpected daemon status: ${status}`)
//   }

//   const client = createClient(socketPath)
//   const info = await client.request('info').toValue()
//   return { client, info, socketPath }
// }

export default class HostStart extends Command {
  static description = 'Start a MCP host'

  static flags = {
    // force: Flags.boolean({ char: 'f', description: 'Force the host to start' }),
    path: Flags.string({
      char: 'p',
      description: 'Custom socket path',
      default: DEFAULT_SOCKET_PATH,
    }),
  }

  async run(): Promise<void> {
    const loader = ora().start('Starting host...')
    const { flags } = await this.parse(HostStart)

    if (existsSync(flags.path)) {
      rmSync(flags.path)
    }
    const server = await startServer()

    process.on('SIGINT', () => {
      server.close()
      process.exit()
    })
    loader.succeed(`Host started on ${c.cyan(flags.path)}`)

    // let connected: Connected
    // try {
    //   connected = await tryConnect({ path: flags.path })
    // } catch (err) {
    //   if (flags.force) {
    //     connected = await tryConnect({ path: flags.path, force: true })
    //   } else {
    //     throw err
    //   }
    // }
    // loader.succeed(`Host started on ${c.cyan(connected.socketPath)}`)
  }
}
