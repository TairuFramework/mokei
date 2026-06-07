import type { FunctionToolCall } from '@mokei/model-provider'
import type { ToolApprovalContext, ToolApprovalFn } from '@mokei/session'
import { useCallback, useState } from 'react'

export type PendingApproval = {
  call: FunctionToolCall<unknown>
  context: ToolApprovalContext
  resolve: (ok: boolean) => void
}

export type ToolApprovalAPI = {
  pending: PendingApproval | null
  approve: () => void
  deny: () => void
  toolApprovalFn: ToolApprovalFn
}

export function useToolApproval(): ToolApprovalAPI {
  const [pending, setPending] = useState<PendingApproval | null>(null)

  const toolApprovalFn = useCallback<ToolApprovalFn>((call, context) => {
    return new Promise<boolean>((resolve) => {
      setPending({ call, context, resolve })
    })
  }, [])

  const approve = useCallback(() => {
    setPending((current) => {
      current?.resolve(true)
      return null
    })
  }, [])

  const deny = useCallback(() => {
    setPending((current) => {
      current?.resolve(false)
      return null
    })
  }, [])

  return { pending, approve, deny, toolApprovalFn }
}
