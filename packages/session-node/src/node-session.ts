import type { ProtocolVersion } from '@mokei/context-protocol'
import type { ContextTool, EnableToolsArg, HostedContext } from '@mokei/host'
import { type LocalReconnectOptions, NodeContextHost } from '@mokei/host-node'
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
  elicit?: false
  /** Respawn the server when it is lost; see `AddLocalContextParams.reconnect`. */
  reconnect?: boolean | LocalReconnectOptions
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
    const { contextHost, elicit, ...sessionParams } = params
    if (contextHost && elicit != null) {
      throw new Error('Cannot provide both contextHost and elicit')
    }
    super({
      ...sessionParams,
      contextHost: contextHost ?? new NodeContextHost({ elicit, tracing: params.tracing }),
    })
  }

  override get contextHost(): NodeContextHost {
    return super.contextHost as NodeContextHost
  }

  // Compares the registration, not the client: a reconnect swaps the client in place.
  async #removeIfOurs(key: string, registration: HostedContext): Promise<void> {
    let stillOurs = false
    try {
      stillOurs = this.contextHost.getContext(key) === registration
    } catch {
      // The context was already removed.
    }
    if (stillOurs) {
      await this.contextHost.remove(key).catch(() => {})
    }
  }

  addContext(params: AddContextParams): Promise<Array<ContextTool>> {
    const { key, command, args, env, enableTools, protocolVersion, elicit, reconnect } = params
    let registration: HostedContext | undefined
    const registrationPromise = this.contextHost
      .addLocalContext({
        key,
        command,
        args,
        env,
        protocolVersion,
        elicit,
        reconnect,
      })
      .then((client) => {
        const registered = this.contextHost.getContext(key)
        return registered.client === client ? registered : undefined
      })
    const setupPromise = (async () => {
      // Duplicate keys reject before registration, so they have nothing to clean up.
      registration = await registrationPromise
      try {
        const tools = await this.contextHost.setup({ key, enableTools, signal: params.signal })
        this.events.emit('context-added', { key, tools })
        return tools
      } catch (error) {
        if (registration != null) {
          await this.#removeIfOurs(key, registration)
        }
        throw error
      }
    })()

    if (!params.signal) {
      return setupPromise
    }
    return raceSignal(setupPromise, params.signal).catch(async (error) => {
      // Spawn may register after abort wins the race. Wait for registration, then
      // remove it to unblock setup if the child has not responded.
      const owned = await registrationPromise.catch(() => undefined)
      if (owned != null) {
        await this.#removeIfOurs(key, owned)
      }
      throw error
    })
  }
}
