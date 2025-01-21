import type { RequestCall } from '@enkaku/client'
import { useEffect, useMemo, useRef, useState } from 'react'

export function useCallKey(procedure: string, param?: unknown): string {
  return useMemo(() => `${procedure}:${param ? JSON.stringify(param) : ''}`, [param, procedure])
}

export type CallState<Result, Call extends RequestCall<Result>> =
  | { status: 'idle'; key: string }
  | { status: 'active'; key: string; call: Call }
  | { status: 'error'; key: string; error: unknown }
  | { status: 'result'; key: string; result: Result }

export function useCallState<Result, Call extends RequestCall<Result>>(
  key: string,
  executeCall: () => Call,
): CallState<Result, Call> {
  const [state, setState] = useState<CallState<Result, Call>>({ status: 'idle', key })

  useEffect(() => {
    if (key === state.key) {
      if (state.status === 'idle') {
        const call = executeCall()
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
  }, [executeCall, key, state])

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
