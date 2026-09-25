import type { ProtocolVersion } from '@mokei/context-protocol'
import type { ContextTool, EnableToolsArg } from '@mokei/host'
import { NodeContextHost } from '@mokei/host-node'
import type { ProviderTypes } from '@mokei/model-provider'
import { Session, type SessionParams } from '@mokei/session'
import { raceSignal } from '@sozai/async'

export type AddContextParams = {
  key: string
  command: string
  args?: Array<string>
  env?: Record<string, string>
  signal?: AbortSignal
  enableTools?: EnableToolsArg
  /** Revision to speak, or `'auto'` to probe the server. */
  protocolVersion?: ProtocolVersion | 'auto'
}

export type NodeSessionParams<T extends ProviderTypes = ProviderTypes> = Omit<
  SessionParams<T>,
  'contextHost'
> & {
  contextHost?: NodeContextHost
}

export class NodeSession<T extends ProviderTypes = ProviderTypes> extends Session<T> {
  constructor(params: NodeSessionParams<T> = {}) {
    super({ ...params, contextHost: params.contextHost ?? new NodeContextHost() })
  }

  override get contextHost(): NodeContextHost {
    return super.contextHost as NodeContextHost
  }

  async #removeIfOurs(key: string, client: unknown): Promise<void> {
    let stillOurs = false
    try {
      stillOurs = this.contextHost.getContext(key).client === client
    } catch {
      // The context was already removed.
    }
    if (stillOurs) {
      await this.contextHost.remove(key).catch(() => {})
    }
  }

  addContext(params: AddContextParams): Promise<Array<ContextTool>> {
    const { key, command, args, env, enableTools, protocolVersion } = params
    let registeredClient: unknown
    const registrationPromise = this.contextHost.addLocalContext({
      key,
      command,
      args,
      env,
      protocolVersion,
    })
    const setupPromise = (async () => {
      // Duplicate keys reject before registration, so they have nothing to clean up.
      registeredClient = await registrationPromise
      try {
        const tools = await this.contextHost.setup({ key, enableTools, signal: params.signal })
        this.events.emit('context-added', { key, tools })
        return tools
      } catch (error) {
        await this.#removeIfOurs(key, registeredClient)
        throw error
      }
    })()

    if (!params.signal) {
      return setupPromise
    }
    return raceSignal(setupPromise, params.signal).catch(async (error) => {
      // Spawn may register after abort wins the race. Wait for registration, then
      // remove it to unblock setup if the child has not responded.
      const client = await registrationPromise.catch(() => null)
      if (client != null) {
        await this.#removeIfOurs(key, client)
      }
      throw error
    })
  }
}
