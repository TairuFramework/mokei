import type { ClientDefinitionsType, StreamCall } from '@enkaku/client'
import type { ProtocolDefinition } from '@enkaku/protocol'
import { useCallback, useEffect, useState } from 'react'

import { useClient } from './context.js'

export function getRequestKey(procedure: string, params?: unknown): string {
  return [procedure, JSON.stringify(params)].join('|')
}

export function useCreateStream<
  Protocol extends ProtocolDefinition,
  Definitions extends ClientDefinitionsType<Protocol> = ClientDefinitionsType<Protocol>,
  Procedure extends keyof Definitions['Streams'] & string = keyof Definitions['Streams'] & string,
  T extends Definitions['Streams'][Procedure] = Definitions['Streams'][Procedure],
>(procedure: Procedure): (param: T['Param']) => StreamCall<T['Receive'], T['Result']> {
  const client = useClient<Protocol>()
  return useCallback(
    (param: T['Param']): StreamCall<T['Receive'], T['Result']> => {
      // @ts-ignore type instantiation too deep
      return client.createStream<Procedure, T>(procedure, { param })
    },
    [client, procedure],
  )
}

export type StreamState<Receive, Result> =
  | { status: 'idle'; key: string }
  | { status: 'active'; key: string; call: StreamCall<Receive, Result> }
  | { status: 'error'; key: string; error: unknown }
  | { status: 'result'; key: string; result: Result }

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
): StreamState<T['Receive'], T['Result']> {
  const client = useClient<Protocol>()
  const [state, setState] = useState<StreamState<T['Receive'], T['Result']>>(() => {
    return { status: 'idle', key: getRequestKey(config.procedure, config.param) }
  })

  useEffect(() => {
    // TODO: check for in-flight call
    const key = getRequestKey(config.procedure, config.param)
    if (key === state.key) {
      if (state.status === 'idle') {
        // @ts-ignore type check
        const call = client.createStream<Procedure, T>(config.procedure, config.params)
        setState({ status: 'active', key, call })
        call
          .then((result) => {
            if (key === state.key) {
              setState({ status: 'result', key, result })
            }
          })
          .catch((error) => {
            if (key === state.key) {
              setState({ status: 'error', key, error })
            }
          })
      }
    } else {
      if (state.status === 'active') {
        state.call.abort()
      }
      setState({ status: 'idle', key })
    }
  }, [client, config, state])

  return state
}
