import type { ClientDefinitionsType, RequestCall } from '@enkaku/client'
import type { ProtocolDefinition } from '@enkaku/protocol'

import { type CallState, useCallKey, useCallState } from './call.js'
import { useContext } from './context.js'

export type RequestConfig<
  Protocol extends ProtocolDefinition,
  Definitions extends ClientDefinitionsType<Protocol> = ClientDefinitionsType<Protocol>,
  Procedure extends keyof Definitions['Requests'] & string = keyof Definitions['Requests'] & string,
  T extends Definitions['Requests'][Procedure] = Definitions['Requests'][Procedure],
> = {
  procedure: Procedure
} & (T['Param'] extends never ? { param?: never } : { param: T['Param'] })

export function useRequestState<
  Protocol extends ProtocolDefinition,
  Definitions extends ClientDefinitionsType<Protocol> = ClientDefinitionsType<Protocol>,
  Procedure extends keyof Definitions['Requests'] & string = keyof Definitions['Requests'] & string,
  T extends Definitions['Requests'][Procedure] = Definitions['Requests'][Procedure],
>(
  config: RequestConfig<Protocol, Definitions, Procedure, T>,
): CallState<T['Result'], RequestCall<T['Result']>> {
  const client = useContext<Protocol>().client
  const key = useCallKey(config.procedure, config.param)
  return useCallState<T['Result'], RequestCall<T['Result']>>(key, () => {
    // @ts-ignore param type check
    return client.request(config.procedure, { param: config.param })
  })
}
