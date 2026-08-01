import { Transport } from '@enkaku/transport'
import type {
  ClientTransport,
  ContextClient,
  ContextTypes,
  UnknownContextTypes,
} from '@mokei/context-client'
import type { ProtocolVersion } from '@mokei/context-protocol'

import { type DaemonOptions, type HostClient, runDaemon } from './daemon.js'
import { ContextHost } from './host.js'
import { filterEnv } from './utils.js'

export type ProxySpawnParams = {
  key: string
  command: string
  args?: Array<string>
  env?: Record<string, string | null | undefined>
  /**
   * Revision the client speaks, or `'auto'` to probe the server. Defaults to
   * `'2026-07-28'`.
   */
  protocolVersion?: ProtocolVersion | 'auto'
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
    // `spawnParam` is forwarded verbatim to the daemon channel, so `protocolVersion` is
    // destructured out here: it belongs to the local client, not to the daemon's spawn param.
    const { key, env, protocolVersion, ...spawnParam } = params
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
      protocolVersion,
      dispose: () => {
        channel.close()
      },
    })
  }
}
