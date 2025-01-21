import type { ChannelCall, ClientDefinitionsType } from '@enkaku/client'
import type { ProtocolDefinition } from '@enkaku/protocol'

import { type CallState, useCallKey, useCallState } from './call.js'
import { useContext } from './context.js'

export type ChannelConfig<
  Protocol extends ProtocolDefinition,
  Definitions extends ClientDefinitionsType<Protocol> = ClientDefinitionsType<Protocol>,
  Procedure extends keyof Definitions['Channels'] & string = keyof Definitions['Channels'] & string,
  T extends Definitions['Channels'][Procedure] = Definitions['Channels'][Procedure],
> = {
  procedure: Procedure
} & (T['Param'] extends never ? { param?: never } : { param: T['Param'] })

export function useChannelState<
  Protocol extends ProtocolDefinition,
  Definitions extends ClientDefinitionsType<Protocol> = ClientDefinitionsType<Protocol>,
  Procedure extends keyof Definitions['Channels'] & string = keyof Definitions['Channels'] & string,
  T extends Definitions['Channels'][Procedure] = Definitions['Channels'][Procedure],
>(
  config: ChannelConfig<Protocol, Definitions, Procedure, T>,
): CallState<T['Result'], ChannelCall<T['Receive'], T['Send'], T['Result']>> {
  const client = useContext<Protocol>().client
  const key = useCallKey(config.procedure, config.param)
  return useCallState<T['Result'], ChannelCall<T['Receive'], T['Send'], T['Result']>>(key, () => {
    // @ts-ignore param type check
    return client.createChannel<Procedure, T>(config.procedure, { param: config.param })
  })
}
