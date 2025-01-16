import { createServerBridge } from '@enkaku/http-server-transport'
import { serve } from '@hono/node-server'
import { Command, Flags } from '@oclif/core'
import { Hono } from 'hono'
import ora from 'ora'

import { socketPathFlag } from '../../host/flags.js'
import type { Protocol } from '../../host/protocol.js'
import { connectSocket, createTransportStream } from '../../host/transport.js'

// TODO: start HTTP server with API proxy so monitor app client connects to daemon

export default class HostMonitor extends Command {
  static description = 'Monitor a MCP host'

  static flags = {
    path: socketPathFlag,
  }

  async run(): Promise<void> {
    const loader = ora().start('Connecting to host...')
    const { flags } = await this.parse(HostMonitor)

    const socket = await connectSocket(flags.path)
    const socketStream = await createTransportStream(socket)

    const serverBridge = createServerBridge<Protocol>()
    const app = new Hono()
    app.all('/api', (ctx) => serverBridge.handleRequest(ctx.req.raw))
    serve({ fetch: app.fetch, port: 3001 })

    const decoupled = Promise.all([
      socketStream.readable.pipeTo(serverBridge.stream.writable),
      serverBridge.stream.readable.pipeTo(socketStream.writable),
    ])

    loader.succeed('HTTP API available on http://localhost:3001/api')

    await decoupled

    // const client = createClient(flags.path)
    // const stream = await client.createStream('events')
    // loader.succeed('Connected to host, listening to events')
    // const reader = stream.receive.getReader()
    // while (true) {
    //   const next = await reader.read()
    //   if (next.done) {
    //     break
    //   }
    //   this.log(JSON.stringify(next.value))
    // }
  }
}
