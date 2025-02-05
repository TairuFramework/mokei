import type { Client, RequestCall } from '@enkaku/client'
import type { ProtocolDefinition } from '@enkaku/protocol'

import { useEffect, useMemo, useRef, useState } from 'react'

import { useEnvironment } from './context.js'

export function useCallKey(procedure: string, param?: unknown): string {
  return useMemo(() => `${procedure}:${param ? JSON.stringify(param) : ''}`, [param, procedure])
}

export type CallState<Result, Call extends RequestCall<Result>> =
  | { status: 'idle'; key: string }
  | { status: 'active'; key: string; call: Call }
  | { status: 'error'; key: string; error: unknown }
  | { status: 'result'; key: string; result: Result }

export function useCallState<
  Protocol extends ProtocolDefinition,
  Result,
  Call extends RequestCall<Result>,
>(key: string, executeCall: (client: Client<Protocol>) => Call): CallState<Result, Call> {
  const env = useEnvironment<Protocol>()
  const clientRef = useRef<Client<Protocol> | null>(null)
  const [state, setState] = useState<CallState<Result, Call>>({ status: 'idle', key })

  useEffect(() => {
    if (key !== state.key) {
      // Key changed: abort active call and reset to idle
      if (state.status === 'active') {
        state.call.abort()
      }
      setState({ status: 'idle', key })
      return
    }

    if (env.status === 'disconnected') {
      // Client disconnected: error if idle
      if (state.status === 'idle') {
        setState({
          status: 'error',
          key,
          error: new Error('Client disconnected'),
        })
      }
      return
    }

    const { client } = env
    if (clientRef.current !== client) {
      // Client changed: abort active call and reset to idle
      if (state.status === 'active') {
        state.call.abort()
      }
      setState({ status: 'idle', key })
    }

    if (state.status === 'idle') {
      // Client available and idle: start call
      clientRef.current = client
      const call = executeCall(client)
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
  }, [env, executeCall, key, state])

  return state
}

export function useCall<Result, Call extends RequestCall<Result>>(state: CallState<Result, Call>) {
  const keyRef = useRef(state.key)
  const [call, setCall] = useState<Call | undefined>(undefined)
  useEffect(() => {
    if (keyRef.current === state.key) {
      if (state.status === 'active') {
        setCall(state.call)
      }
    } else {
      keyRef.current = state.key
      setCall(state.status === 'active' ? state.call : undefined)
    }
  }, [state])
  return call
}

export function useCallStateResult<Result, Call extends RequestCall<Result>>(
  state: CallState<Result, Call>,
) {
  const keyRef = useRef(state.key)
  const [result, setResult] = useState<Result | undefined>(undefined)
  useEffect(() => {
    if (keyRef.current === state.key) {
      if (state.status === 'result') {
        setResult(state.result)
      }
    } else {
      keyRef.current = state.key
      setResult(state.status === 'result' ? state.result : undefined)
    }
  }, [state])
  return result
}
