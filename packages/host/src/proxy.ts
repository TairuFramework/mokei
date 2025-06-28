import { Transport } from '@enkaku/transport'
import type {
  ClientTransport,
  ContextClient,
  ContextTypes,
  UnknownContextTypes,
} from '@mokei/context-client'

import { type DaemonOptions, type HostClient, runDaemon } from './daemon/controller.js'
import { ContextHost } from './host.js'
import { filterEnv } from './utils.js'

export type ProxySpawnParams = {
  key: string
  command: string
  args?: Array<string>
  env?: Record<string, string | null | undefined>
}

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

  async spawn<T extends ContextTypes = UnknownContextTypes>(
    params: ProxySpawnParams,
  ): Promise<ContextClient<T>> {
    const { key, env, ...spawnParam } = params
    if (this._contexts[key] != null) {
      throw new Error(`Context ${key} already exists`)
    }

    const channel = this.#client.createChannel('spawn', {
      param: { ...spawnParam, env: filterEnv(env) },
    })
    const transport = new Transport({ stream: channel }) as ClientTransport

    return this.createContext({
      key,
      transport,
      dispose: () => {
        channel.close()
      },
    })
  }
}
