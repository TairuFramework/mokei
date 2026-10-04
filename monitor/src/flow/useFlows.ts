import type { FlowSummary } from '@mokei/flow-client'
import { useMemo } from 'react'

import { useFlow } from './FlowProvider.js'
import { type ReconciledQuery, useReconciledQuery } from './useReconciledQuery.js'

export function useFlows() {
  const { control } = useFlow()
  const query = useMemo<ReconciledQuery<Array<FlowSummary>, never>>(
    () => ({
      initial: [],
      read: () => control.flows.list(),
      affected: () => undefined,
      readAffected: () => Promise.reject(new Error('Flow definitions have no live events')),
      merge: (data) => data,
      apply: (data) => data,
    }),
    [control],
  )
  const { data, ...state } = useReconciledQuery(query)
  return { flows: data, ...state }
}
