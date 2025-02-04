import { Disposer } from '@enkaku/async'
import { Transport } from '@enkaku/transport'
import { type ClientTransport, ContextClient } from '@mokei/context-client'

import { type DaemonOptions, type HostClient, runDaemon } from './daemon/controller.js'
import { ContextHost } from './host.js'

export class ProxyHost extends ContextHost {
  static async forDaemon(options?: DaemonOptions): Promise<ProxyHost> {
    const client = await runDaemon(options)
    return new ProxyHost(client)
  }

  #client: HostClient

  constructor(client: HostClient) {
    super()
    this.#client = client
  }

  get client(): HostClient {
    return this.#client
  }

  /** @internal */
  async _dispose(): Promise<void> {
    await super._dispose()
    await this.#client.dispose()
  }

  async spawn(key: string, command: string, args: Array<string> = []): Promise<ContextClient> {
    if (this._contexts[key] != null) {
      throw new Error(`Context ${key} already exists`)
    }

    const channel = this.#client.createChannel('spawn', { param: { command, args } })
    const transport = new Transport({
      stream: { readable: channel.readable, writable: channel.writable },
    }) as ClientTransport
    const client = new ContextClient({ transport })
    const disposer = new Disposer({
      dispose: async () => {
        channel.close()
        await transport.dispose()
      },
    })

    this._contexts[key] = { client, disposer, tools: [] }
    return client
  }
}
