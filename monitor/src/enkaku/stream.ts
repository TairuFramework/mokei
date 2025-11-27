import type { ClientDefinitionsType, StreamCall } from '@enkaku/client'
import type { ProtocolDefinition } from '@enkaku/protocol'

import { type CallState, useCallKey, useCallState } from './call.js'

export type StreamConfig<
  Protocol extends ProtocolDefinition,
  Definitions extends ClientDefinitionsType<Protocol> = ClientDefinitionsType<Protocol>,
  Procedure extends keyof Definitions['Streams'] & string = keyof Definitions['Streams'] & string,
  T extends Definitions['Streams'][Procedure] = Definitions['Streams'][Procedure],
> = {
  procedure: Procedure
} & (T['Param'] extends never ? { param?: never } : { param: T['Param'] })

export function useStreamState<
  Protocol extends ProtocolDefinition,
  Definitions extends ClientDefinitionsType<Protocol> = ClientDefinitionsType<Protocol>,
  Procedure extends keyof Definitions['Streams'] & string = keyof Definitions['Streams'] & string,
  T extends Definitions['Streams'][Procedure] = Definitions['Streams'][Procedure],
>(
  config: StreamConfig<Protocol, Definitions, Procedure, T>,
): CallState<T['Result'], StreamCall<T['Receive'], T['Result']>> {
  const key = useCallKey(config.procedure, config.param)
  return useCallState<Protocol, T['Result'], StreamCall<T['Receive'], T['Result']>>(
    key,
    (client) => {
      // @ts-expect-error param type check
      return client.createStream<Procedure, T>(config.procedure, { param: config.param })
    },
  )
}
